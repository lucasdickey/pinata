// A throwaway Pinata on this machine: the production build (`npm run build`
// first) started against a fresh file database and the local screenshot
// store (D141), with a generated editor password and session secret. Every
// provider variable is set explicitly, empty where it must be off, because
// Next.js never lets .env.local override a variable the shell already set:
// nothing a scratch run does can reach the shared database, Blob, or
// Browserless.
//
// Library: const scratch = await startScratch({ port }); ... await scratch.stop();
// CLI:     node scripts/seed/scratch.mjs [--until STAGE] [--port 3100] [seed.json]
//          starts one, applies the seed (scripts/seed/apply.mjs), and keeps
//          it running for a look around until Ctrl-C.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applySeed, DEFAULT_SEED } from "./apply.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(command, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${args.join(" ")} failed: ${errors.trim()}`))));
  });
}

async function waitForServer(base, child, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("scratch: the server exited before it was ready");
    try {
      const response = await fetch(base, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`scratch: ${base} did not answer within ${timeoutMs / 1000}s`);
}

/**
 * Start a scratch server. Resolves once it answers; `stop()` ends it and
 * deletes its database and screenshots unless `keep` is set.
 */
export async function startScratch({ port = 3100, keep = false } = {}) {
  if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("scratch: no production build; run `npm run build` first");
  }
  const dir = await mkdtemp(join(tmpdir(), "pinata-scratch-"));
  const password = randomBytes(18).toString("base64url");
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: `file:${join(dir, "pinata.db")}`,
    TURSO_AUTH_TOKEN: "scratch",
    PINATA_LOCAL_BLOB_DIR: join(dir, "blobs"),
    BLOB_READ_WRITE_TOKEN: "",
    BROWSERLESS_TOKEN: "",
    PINATA_SERVER_CAPTURE: "off",
    CRON_SECRET: "",
    CAPTURE_SWEEP_SECRET: "",
    PINATA_AUTH_DISABLED: "",
    EDITOR_PASSWORD: password,
    SESSION_SECRET: randomBytes(32).toString("base64url"),
    NODE_ENV: "production",
  };
  delete env.VERCEL;
  await run(process.execPath, ["scripts/db-migrate.mjs"], env);
  await writeFile(join(dir, "editor-password.txt"), `${password}\n`, { mode: 0o600 });

  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  try {
    await waitForServer(base, child);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${output.trim().split("\n").slice(-8).join("\n")}`);
  }

  return {
    base,
    password,
    dir,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((done) => child.once("exit", done));
      }
      if (!keep) await rm(dir, { recursive: true, force: true });
    },
  };
}

// CLI: a scratch Pinata with the seed applied, to look around in.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const until = option("--until") ?? "replied";
  const port = Number(option("--port") ?? 3100);
  const seedFile = args[0] ? resolve(args[0]) : DEFAULT_SEED;
  const scratch = await startScratch({ port });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    await applySeed({ browser, base: scratch.base, password: scratch.password, seedFile, until, log: (line) => console.log(`seed: ${line}`) });
  } catch (error) {
    await scratch.stop();
    throw error;
  } finally {
    await browser.close();
  }
  console.log(`\nScratch Pinata at ${scratch.base}, seeded to "${until}".`);
  console.log(`Editor password: ${join(scratch.dir, "editor-password.txt")}`);
  console.log("Ctrl-C stops it and deletes its data.");
  const stop = async () => {
    await scratch.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
