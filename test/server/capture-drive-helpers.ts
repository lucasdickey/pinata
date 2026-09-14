// Shared fixtures for the server-driven capture tests (D076): a scheduler
// that records continuation tasks and runs them on demand, a DNS resolver
// double, and a deterministic project seed. Nothing here reaches the network.

import { and, asc, eq } from "drizzle-orm";
import type { AdmissionDeps } from "../../src/lib/server/captures/admission";
import type { ContinuationScheduler } from "../../src/lib/server/captures/continuation";
import type { DnsResolver } from "../../src/lib/server/captures/dns";
import { schema, type Database } from "../../src/lib/server/db/client";
import { createProjectAtomically } from "../../src/lib/server/projects/create";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";

export const T0 = 1_800_000_000_000;

export interface InlineScheduler {
  after: ContinuationScheduler;
  /** Tasks handed over and not yet run. */
  queue: (() => Promise<void>)[];
  /** Every task ever handed over. */
  scheduled: number;
  /** Run queued tasks, including the ones they schedule, until none remain. */
  flush(): Promise<void>;
  /** Run exactly the tasks queued right now, not the ones they add. */
  step(): Promise<void>;
}

/** A continuation scheduler tests can drain synchronously. */
export function inlineScheduler(): InlineScheduler {
  const scheduler: InlineScheduler = {
    queue: [],
    scheduled: 0,
    after(task) {
      scheduler.scheduled += 1;
      scheduler.queue.push(task);
    },
    async flush() {
      while (scheduler.queue.length > 0) await scheduler.step();
    },
    async step() {
      const batch = scheduler.queue.splice(0);
      for (const task of batch) await task();
    },
  };
  return scheduler;
}

export function resolverFor(answers: Record<string, string[]>): DnsResolver {
  const reject = (code: string) => () =>
    Promise.reject(Object.assign(new Error(code), { code }));
  return {
    resolveCname: reject("ENODATA"),
    resolve4: (host) =>
      answers[host] ? Promise.resolve(answers[host]!) : Promise.resolve().then(reject("ENOTFOUND")),
    resolve6: reject("ENODATA"),
  };
}

/** Admission that resolves `safe.example` publicly and nothing else. */
export function safeAdmission(): AdmissionDeps {
  return { resolver: resolverFor({ "safe.example": ["93.184.216.34"] }), dnsTimeoutMs: 50 };
}

let counter = 0;

/** Deterministic ids for a seeded project; unique across seeds in one file. */
export function seedDeps(now: number) {
  return {
    now: () => now,
    newId: () => `id-${String(++counter).padStart(4, "0")}`,
    newPublicId: () => `pub-${String(counter)}`,
  };
}

export async function seedProject(
  db: Database,
  rootUrl: string,
  urls: string[],
  key: string,
  now = T0,
) {
  const submission = validateProjectSubmission({ rootUrl, urls });
  if (!submission.ok) throw new Error("fixture submission must be valid");
  const result = await createProjectAtomically(db, submission, key, seedDeps(now));
  if (!result.ok) throw new Error("fixture project must be created");
  return result.project;
}

export async function attemptsFor(db: Database, pageId: string, variant: string) {
  return db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, variant)))
    .orderBy(asc(schema.captures.attempt));
}

export async function allCaptures(db: Database) {
  return db.select().from(schema.captures).orderBy(asc(schema.captures.createdAt), asc(schema.captures.id));
}
