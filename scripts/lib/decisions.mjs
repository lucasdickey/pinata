// Pure functions for validating and rendering the decision log.
//
// Kept free of filesystem and process access so the validation rules can be
// tested directly. All I/O lives in scripts/build-docs.mjs.

export const REQUIRED_FIELDS = [
  "id",
  "date",
  "phase",
  "title",
  "origin",
  "status",
  "problem",
  "decision",
  "rationale",
];

export const VALID_STATUSES = ["accepted", "pending", "rejected", "superseded"];
export const VALID_PHASES = ["setup", "concept", "design", "build", "validate", "wrap"];

/**
 * Checks a decisions document against the rules in AGENTS.md section 2.
 * @returns {string[]} human-readable errors; empty means valid.
 */
export function validate(data) {
  const errors = [];

  if (!data || typeof data !== "object") return ["decisions document is not an object"];
  if (!data.origins || typeof data.origins !== "object" || !Object.keys(data.origins).length) {
    errors.push("`origins` map is missing or empty");
  }
  if (!Array.isArray(data.decisions)) return errors.concat("`decisions` must be an array");

  const origins = Object.keys(data.origins ?? {});
  const ids = new Set(data.decisions.map((d) => d?.id).filter(Boolean));
  const seen = new Set();

  for (const [i, d] of data.decisions.entries()) {
    const at = d?.id ?? `index ${i}`;

    if (!d || typeof d !== "object") {
      errors.push(`${at}: record is not an object`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!d[field] || String(d[field]).trim() === "") {
        errors.push(`${at}: missing required field \`${field}\``);
      }
    }

    if (d.id) {
      if (!/^D\d{3,}$/.test(d.id)) errors.push(`${at}: id must look like D001`);
      if (seen.has(d.id)) errors.push(`${at}: duplicate id`);
      seen.add(d.id);
    }
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      errors.push(`${at}: date must be YYYY-MM-DD`);
    }
    if (d.origin && !origins.includes(d.origin)) {
      errors.push(`${at}: unknown origin \`${d.origin}\``);
    }
    if (d.status && !VALID_STATUSES.includes(d.status)) {
      errors.push(`${at}: unknown status \`${d.status}\``);
    }
    if (d.phase && !VALID_PHASES.includes(d.phase)) {
      errors.push(`${at}: unknown phase \`${d.phase}\``);
    }

    // Provenance evidence. This is the whole point of the log, so a missing
    // quote is a hard error rather than a warning.
    const t = d.transcript ?? {};
    if (d.origin === "user-directed" && !t.request) {
      errors.push(`${at}: origin is user-directed but transcript.request is empty`);
    }
    if (d.origin === "agent-proposed-user-approved" && !(t.proposal && t.approval)) {
      errors.push(
        `${at}: origin is agent-proposed-user-approved but transcript needs both proposal and approval`,
      );
    }
    if (d.origin === "user-deferred" && d.status !== "pending") {
      errors.push(`${at}: user-deferred records stay status=pending until answered`);
    }

    for (const key of ["supersedes", "superseded_by"]) {
      if (d[key] && !ids.has(d[key])) {
        errors.push(`${at}: \`${key}\` points at unknown id \`${d[key]}\``);
      }
      if (d[key] === d.id) errors.push(`${at}: \`${key}\` points at itself`);
    }
    if (d.superseded_by && d.status !== "superseded") {
      errors.push(`${at}: has superseded_by but status is \`${d.status}\`, expected superseded`);
    }

    for (const [j, a] of (d.artifacts ?? []).entries()) {
      const aat = `${at}.artifacts[${j}]`;
      if (!["screenshot", "file", "link"].includes(a?.type)) {
        errors.push(`${aat}: type must be screenshot, file, or link`);
      } else if (a.type === "link" && !a.url) {
        errors.push(`${aat}: link artifacts need a url`);
      } else if (a.type !== "link" && !a.path) {
        errors.push(`${aat}: ${a.type} artifacts need a path`);
      }
    }

    for (const [j, alt] of (d.alternatives ?? []).entries()) {
      if (!alt?.option || !alt?.why_not) {
        errors.push(`${at}.alternatives[${j}]: needs both option and why_not`);
      }
    }
  }

  return errors;
}

/** Screenshot paths are relative to docs/dashboard/ so both views resolve them alike. */
export function screenshotPaths(data) {
  return (data.decisions ?? []).flatMap((d) =>
    (d.artifacts ?? []).filter((a) => a.type === "screenshot").map((a) => a.path),
  );
}

/**
 * GitHub-compatible heading slug, so the index links in DECISIONS.md resolve.
 *
 * GitHub drops disallowed characters and then maps each remaining space to one
 * hyphen without collapsing runs. Collapsing them here would break any title
 * containing a character that sits between two spaces, such as an em dash.
 */
export function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

export function anchor(decision) {
  return githubSlug(`${decision.id}--${decision.title}`);
}

function quote(text) {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n>\n");
}

function escapePipes(text) {
  return String(text).replace(/\|/g, "\\|");
}

/** Latest decision date in the set. Deterministic stand-in for a build timestamp. */
export function asOf(data) {
  const dates = (data.decisions ?? []).map((d) => d.date).filter(Boolean).sort();
  return dates[dates.length - 1] ?? "unknown";
}

export function renderMarkdown(data, { sourceHash = "unknown" } = {}) {
  const { decisions, origins } = data;
  const L = [];

  L.push("<!-- GENERATED FILE. Do not edit.");
  L.push("     Source: docs/decisions/decisions.json");
  L.push("     Regenerate: npm run docs -->");
  L.push("");
  L.push("# Decision log");
  L.push("");
  L.push(`**${data.project}** — ${data.tagline}  `);
  L.push(`${data.assignment}  `);
  L.push(`Timebox: ~${data.timebox_hours}h`);
  L.push("");
  L.push("Every record is tagged with its **origin**, which separates what the human");
  L.push("directed from what the agent proposed and the human approved. See `AGENTS.md`");
  L.push("section 2.3 for the taxonomy and the evidence each origin requires.");
  L.push("");

  L.push("## Provenance at a glance");
  L.push("");
  L.push("| Origin | Count | Decisions |");
  L.push("| --- | --: | --- |");
  for (const [key, meta] of Object.entries(origins)) {
    const hits = decisions.filter((d) => d.origin === key);
    L.push(`| ${meta.label} | ${hits.length} | ${hits.map((d) => d.id).join(", ") || "—"} |`);
  }
  L.push(`| **Total** | **${decisions.length}** | |`);
  L.push("");

  L.push("## Index");
  L.push("");
  L.push("| ID | Phase | Decision | Origin | Status |");
  L.push("| --- | --- | --- | --- | --- |");
  for (const d of decisions) {
    L.push(
      `| [${d.id}](#${anchor(d)}) | ${d.phase} | ${escapePipes(d.title)} | ${
        origins[d.origin].label
      } | ${d.status} |`,
    );
  }
  L.push("");
  L.push("---");
  L.push("");

  for (const d of decisions) {
    L.push(`## ${d.id} — ${d.title}`);
    L.push("");
    L.push(
      `*${d.date} · phase: ${d.phase} · origin: **${origins[d.origin].label}** · status: **${d.status}***`,
    );
    if (d.supersedes) L.push(`*Supersedes ${d.supersedes}.*`);
    if (d.superseded_by) L.push(`*Superseded by ${d.superseded_by}.*`);
    L.push("");

    L.push("**Problem**");
    L.push("");
    L.push(d.problem);
    L.push("");
    L.push("**Decision**");
    L.push("");
    L.push(d.decision);
    L.push("");

    if (d.alternatives?.length) {
      L.push("**Alternatives considered**");
      L.push("");
      for (const a of d.alternatives) L.push(`- *${a.option}* — ${a.why_not}`);
      L.push("");
    }

    L.push("**Rationale**");
    L.push("");
    L.push(d.rationale);
    L.push("");

    if (d.consequences?.length) {
      L.push("**Consequences**");
      L.push("");
      for (const c of d.consequences) L.push(`- ${c}`);
      L.push("");
    }

    const t = d.transcript ?? {};
    if (t.request || t.proposal || t.approval) {
      L.push("**Provenance evidence**");
      L.push("");
      for (const [who, text] of [
        ["Human instruction", t.request],
        ["Agent asked", t.proposal],
        ["Human approved", t.approval],
      ]) {
        if (!text) continue;
        L.push(`${who}:`);
        L.push("");
        L.push(quote(text));
        L.push("");
      }
    }

    if (d.artifacts?.length) {
      L.push("**Artifacts**");
      L.push("");
      for (const a of d.artifacts) {
        if (a.type === "screenshot") {
          L.push(`- ![${a.caption ?? a.path}](dashboard/${a.path}) — ${a.caption ?? ""}`);
        } else if (a.type === "link") {
          L.push(`- [${a.caption ?? a.url}](${a.url})`);
        } else {
          L.push(`- \`${a.path}\` — ${a.caption ?? ""}`);
        }
      }
      L.push("");
    }

    L.push("---");
    L.push("");
  }

  L.push(
    `<sub>Generated from ${decisions.length} record(s) as of ${asOf(data)} · source \`${sourceHash}\`</sub>`,
  );
  L.push("");
  return L.join("\n");
}

/**
 * The dashboard opens over file://, where fetch() is blocked by the browser, so
 * the data ships as an assignable script rather than as JSON.
 */
export function renderDataIsland(data, { sourceHash = "unknown" } = {}) {
  const payload = { ...data, as_of: asOf(data), source_hash: sourceHash };
  return [
    "// GENERATED FILE. Do not edit.",
    "// Source: docs/decisions/decisions.json",
    "// Regenerate: npm run docs",
    `window.PINATA = ${JSON.stringify(payload, null, 2)};`,
    "",
  ].join("\n");
}
