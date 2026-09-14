# AGENTS.md — pinata

Operating rules for any AI agent working in this repository.

`CLAUDE.md` is a pointer to this file. Repository-level rules here take precedence
over the workspace-level `AGENTS.md` one directory up.

---

## 1. What this project is

`pinata` is an MVP built for the Factory candidate assignment
(see `docs/ASSIGNMENT.md`). The assignment is graded on four things:

1. Creativity in what is built.
2. Clarity in framing the problem.
3. Effective use of AI tooling.
4. **Ability to explain the process and the decisions.**

Item 4 means the decision trail is a shipped deliverable, not a byproduct.
Treat `docs/DECISIONS.md` and `docs/dashboard/index.html` with the same care as
application code.

---

## 2. The documentation protocol (non-negotiable)

### 2.1 Single source of truth

All decisions live in **`docs/decisions/decisions.json`**. That is the only file a
human or agent edits by hand.

Two artifacts are **generated** from it and must never be hand-edited:

| Generated file | Purpose |
| --- | --- |
| `docs/DECISIONS.md` | plain-text Markdown log for reading and diffing |
| `docs/dashboard/decisions-data.js` | data island for the browser dashboard |

Regenerate with:

```bash
npm run docs
```

Run it after every change to `decisions.json`, before committing. If the generated
files are stale in a commit, the commit is wrong.

### 2.2 When to record a decision

Record one whenever any of these is true:

- A choice constrains future work (stack, storage, data model, interface shape).
- A choice was made between two or more real alternatives.
- Scope was added, cut, or deferred.
- A choice was reversed. Never delete the original; add a new record and set
  `supersedes` / `superseded_by`.
- Something was learned that invalidates an earlier assumption.

Do **not** record routine mechanics: renaming a variable, fixing a typo, adding a
test that was already implied. Noise makes the log useless.

### 2.3 Provenance is the point

Every record carries an `origin` field. This taxonomy exists because the reviewer
wants to distinguish what the human directed from what the agent proposed. Be
accurate even when it is unflattering.

| `origin` | Meaning | Required evidence |
| --- | --- | --- |
| `user-directed` | The human asked for this specifically. The agent executed. | `transcript.request` = verbatim quote of the human's instruction |
| `agent-proposed-user-approved` | The agent raised the question or proposed the option; the human approved it. | `transcript.proposal` = what the agent asked, **and** `transcript.approval` = verbatim human approval |
| `agent-autonomous` | The agent decided without asking, inside previously granted latitude. | `rationale` must state why it was safe to decide unilaterally |
| `user-deferred` | Raised and consciously postponed. | `transcript` for who raised it; `status` stays `pending` until answered, then flips to `superseded` with `superseded_by` naming the record that answered it |

Rules:

- Never upgrade `agent-autonomous` to `agent-proposed-user-approved` after the fact.
  Silence is not approval.
- Never label something `user-directed` if the agent supplied the idea and the human
  merely said yes. That is `agent-proposed-user-approved`. Answering a question the
  agent posed is approval, not direction.
- Quote the human verbatim. Paraphrase in `rationale`, not in `transcript`.
- Answering a deferral does not mean editing the deferral. Add the record that
  answers it and point the two at each other, so the fact that it was once open
  stays visible.

### 2.4 Record shape

```jsonc
{
  "id": "D007",                         // sequential, never reused
  "date": "2026-09-04",
  "phase": "setup",                     // setup | concept | design | build | validate | wrap
  "title": "Short imperative summary",
  "origin": "agent-proposed-user-approved",
  "status": "accepted",                 // accepted | pending | rejected | superseded
  "problem": "What was actually at stake.",
  "decision": "What we are doing.",
  "alternatives": [
    { "option": "The road not taken", "why_not": "Concrete reason." }
  ],
  "rationale": "Why this one won.",
  "consequences": ["What this now forces or forecloses."],
  "transcript": {
    "request": "verbatim human instruction, if user-directed",
    "proposal": "what the agent asked, if agent-proposed",
    "approval": "verbatim human approval, if agent-proposed"
  },
  "artifacts": [
    { "type": "screenshot", "path": "screenshots/D007-before.png", "caption": "..." },
    { "type": "file", "path": "src/index.ts", "caption": "..." },
    { "type": "link", "url": "https://...", "caption": "..." }
  ],
  "supersedes": null,
  "superseded_by": null
}
```

`artifacts[].path` for screenshots is relative to `docs/dashboard/`. Put the image
files in `docs/dashboard/screenshots/` and name them `<id>-<slug>.png` so the
dashboard and the Markdown log resolve them identically.

### 2.5 Session log

`docs/SESSION-LOG.md` is append-only prose, newest section at the bottom. One
section per working session. Each section records: elapsed time against the
timebox, what was attempted, what broke, and which decision IDs came out of it.

The decision log answers *what we chose*. The session log answers *what actually
happened*, including dead ends. Dead ends are evidence of process. Keep them.

### 2.6 Wrap-up artifact

`docs/NEXT.md` answers the assignment's third interview question, "what you'd do
next if you had more time." Update it opportunistically as ideas get cut, rather
than trying to reconstruct it at the end.

---

## 3. Validation contract

This is the authoritative answer to "how do I know a change is good?" Any agent,
mission, or CI job should use exactly these commands. The prerequisite is
Node 24 (`D019`) and a one-time `npm ci`.

| Command | What it proves |
| --- | --- |
| `npm run lint` | ESLint over the JavaScript surface, plus repository integrity: every `.mjs`/`.js` parses, every `.json` parses, dependencies stay within the approved pinned set (`scripts/lib/approved-deps.mjs`), one lockfile exists, and the generated files still carry their banner. |
| `npm run typecheck` | `tsc --noEmit` passes over the app, tests, and configs. |
| `npm test` | The Vitest suite in `test/` — unit, component (jsdom + React Testing Library), and repository-integrity tests. |
| `npm run docs` | Rewrites the generated artifacts from `decisions.json`. |
| `npm run docs:check` | The committed artifacts match what the generator would write. Fails on stale docs. Writes nothing. |
| `npm run build` | The Next.js production build succeeds under Node 24. |
| `npm run e2e` | Playwright Chromium end-to-end tests against `next start` on `127.0.0.1:3100`, at most two workers. |
| `npm run validate` | `lint` → `typecheck` → `test` → `docs:check` → `build` → `e2e`, in that order. **This is the gate.** |

**Run `npm run validate` before declaring any piece of work finished.** A
non-zero exit means the work is not done. CI runs the same single command under
Node 24, so a green local run and a green CI run mean the same thing.

### What the suite actually covers

- `test/decisions.test.mjs` — the decision-log rules against fixtures: required
  fields, id and date formats, the provenance-evidence rules from section 2.3,
  supersession pointer integrity, and deterministic rendering.
- `test/artifacts.test.mjs` — the real repository: `decisions.json` validates,
  ids are gapless, referenced screenshots exist on disk, the generated files are
  not stale, the dashboard pulls in no third-party assets and reads no field the
  generator does not emit, every element the dashboard script looks up exists in
  the markup, every relative link in `README.md` resolves, and the dependency
  lists stay within the approved set while the docs tooling stays
  zero-dependency.
- `test/home.test.tsx` — the Vitest + jsdom + React Testing Library chain
  against a real component.
- `e2e/smoke.spec.ts` — the Playwright Chromium chain against the production
  server on `127.0.0.1:3100`.
- `test/e2e-env-gate.test.ts` — the environment gate below, plus the rule that
  no Playwright spec may read `.env.local` on its own.

### Configured versus unconfigured environments

The gate runs in two places with different configuration, and it has to be
green in both:

- **Locally (and against a deployment)** `.env.local` supplies the real editor
  secrets, Turso credentials, Blob token, and Browserless token, so every test
  runs and coverage is complete.
- **In CI** there are no repository secrets by design — none are needed to
  prove the repository is sound, and none should be handed to a workflow that
  runs on pull requests.

Tests that need real configuration therefore **skip, never fail, when it is
absent**:

- Vitest integration suites under `test/integration/` gate on the provider
  variables with `describe.skipIf`.
- Playwright specs gate through `e2e/local-env.ts`: `localEnvGate([...names])`
  reports what is missing, the spec calls `test.skip(!gate.ready, gate.reason)`,
  and `requireLocalEnvValue(name)` reads the value only after the gate passed.
  A skip reason names variables, never values. Specs must not read `.env.local`
  directly — `test/e2e-env-gate.test.ts` enforces that.

The consequence is explicit: a green CI run proves the anonymous and public
surfaces, not the credentialed paths. Anything that needs real secrets — editor
login, Turso, Blob, Browserless — is proven by a local `npm run validate` with
`.env.local` present, and by validation against the deployment. Run the gate
locally before declaring work finished; CI alone is not sufficient evidence.

### Determinism

Generated artifacts embed a SHA-256 prefix of the source and the latest decision
date instead of a wall-clock timestamp. Without that, every build would differ
from the last and `docs:check` could never pass. Keep generated output a pure
function of `decisions.json`.

### Adding to the suite

When product code lands in `app/` or `src/`, add its tests under `test/` (Vitest)
or `e2e/` (Playwright) so the same `npm run validate` keeps covering everything.
Do not introduce a second test runner or a competing entry point. If a bug
escapes to a human, add the failing test before fixing it.

---

## 4. Working rules

- **Timebox awareness.** Log elapsed build time in `docs/SESSION-LOG.md`. When the
  remaining budget will not cover a piece of scope, cut it and record the cut as a
  decision rather than silently running over.
- **Demo-first.** The MVP is shown live over screen share. Anything that cannot be
  demonstrated in a browser or a terminal in under a minute is deprioritized.
- **No unrequested dependencies.** Application dependencies are limited to the
  mission-approved set pinned exactly in `package.json`
  (`scripts/lib/approved-deps.mjs` is the allowlist the gate enforces). The
  one addition since planning is Remotion, requested by the user for the
  walkthrough (`D072`/`D073`): `remotion` and `@remotion/player` in the app,
  `@remotion/cli` dev-only. The docs
  tooling stays zero-dependency (one Node script, dashboard opens over
  `file://`) so the artifacts survive without a build environment. Keep it that
  way.
- **Ask before deciding product direction.** Stack and scope choices that shape the
  demo get surfaced for approval. Mechanical choices inside an approved direction do
  not.
- **Commit straight to `main`.** No feature branches, no pull requests (`D010`).
  Which means `npm run validate` has to pass **before** every commit, not merely
  before a merge — CI reports after the change is already on the default branch.
- **Commit hygiene.** Conventional-ish subject line, body naming the decision IDs
  the commit implements. Regenerate docs before committing. Commit and push early
  and often — at minimum whenever a decision lands — rather than batching; the
  remote commit graph is part of the graded deliverable (see `D011`).

---

## 5. Repository layout

```
pinata/
├── AGENTS.md                       # this file
├── CLAUDE.md                       # pointer to this file
├── README.md
├── package.json                    # scripts + the approved pinned dependency set
├── package-lock.json               # the one lockfile
├── tsconfig.json                   # strict TypeScript, Next.js plugin
├── next.config.ts                  # Next.js configuration
├── vitest.config.ts                # unit/component/integration runner
├── playwright.config.ts            # Chromium e2e against 127.0.0.1:3100
├── eslint.config.js                # flat config, JavaScript surface
├── .github/workflows/validate.yml  # CI: Node 24, `npm run validate`
├── app/                            # Next.js App Router entry points
├── src/                            # application source (components, lib)
├── remotion/                       # the /walkthrough composition (D072); Studio + render via npm run walkthrough*
├── public/walkthrough/             # imagery the walkthrough borrows (derived from committed sources)
├── remotion.config.ts              # Remotion CLI settings; the app never reads it
├── e2e/                            # Playwright specs
├── scripts/
│   ├── build-docs.mjs              # CLI: generate, or --check for staleness
│   ├── lint.mjs                    # dependency-free syntax + repo-rule checks
│   └── lib/
│       ├── decisions.mjs           # pure validate + render functions
│       └── approved-deps.mjs       # the approved dependency allowlist
├── test/
│   ├── decisions.test.mjs          # rules, against fixtures (Vitest)
│   ├── artifacts.test.mjs          # the real repo's integrity (Vitest)
│   └── home.test.tsx               # component chain smoke test
└── docs/
    ├── ASSIGNMENT.md               # the brief, and how we intend to satisfy it
    ├── DECISIONS.md                # GENERATED
    ├── SESSION-LOG.md              # append-only build narrative
    ├── NEXT.md                     # what we'd do with more time
    ├── decisions/
    │   └── decisions.json          # SOURCE OF TRUTH
    └── dashboard/
        ├── index.html              # open directly in a browser
        ├── decisions-data.js       # GENERATED
        └── screenshots/
```

The local application always runs on `127.0.0.1:3100` (`npm run dev` for
development, `npm run start` for the production build). Port 3000 is off-limits.
