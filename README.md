# pinata

**pin** + **anno**tation + at **ya**

Built for the Factory candidate assignment: a small MVP produced through
agent-driven development, with the reasoning trail kept as a first-class artifact.
The brief is transcribed in [`docs/ASSIGNMENT.md`](docs/ASSIGNMENT.md).

## The problem

_To be written once the product direction is fixed. This section leads with the
problem, not the feature list, because "clarity in framing the problem" is one of
the four graded criteria._

## Status

Documentation scaffolding is in place. Product direction is still open — see
[`D006`](docs/DECISIONS.md#d006--build-the-scaffolding-before-fixing-the-product-concept).

## How the work is documented

The assignment is graded partly on the ability to explain the process and the
decisions, so the decision trail is maintained continuously rather than
reconstructed afterwards.

| Artifact | What it is |
| --- | --- |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Plain-text decision log. Generated. |
| `docs/dashboard/index.html` | Same data as a browser page, with screenshots. Open it directly, no server needed. |
| [`docs/SESSION-LOG.md`](docs/SESSION-LOG.md) | What actually happened each session, dead ends included. |
| [`docs/NEXT.md`](docs/NEXT.md) | What I'd do with more time. |
| [`AGENTS.md`](AGENTS.md) | The rules the agent works under. |

Every decision carries an **origin** that distinguishes what the human directed
from what the agent proposed and the human approved, each backed by a verbatim
quote. That split is the point: it makes the division of labour between human and
agent auditable rather than asserted.

### Editing the log

`docs/decisions/decisions.json` is the only file edited by hand. After changing it:

```bash
npm run docs
```

That regenerates `docs/DECISIONS.md` and `docs/dashboard/decisions-data.js`, and
fails loudly if a record is missing its required provenance evidence.

To view the dashboard, open it directly. It needs no server:

```bash
open docs/dashboard/index.html
```

## Validation

Requires Node 20.9+. There is nothing to install — the project has no
dependencies, and `npm run validate` is the whole gate.

```bash
git clone https://github.com/lucasdickey/pinata.git
cd pinata
npm run validate
```

| Command | What it proves |
| --- | --- |
| `npm run lint` | Everything parses, the dependency lists are still empty, generated files still say so. |
| `npm run docs:check` | The committed artifacts match what the generator would write. Fails on stale docs. |
| `npm test` | The `node:test` suite in `test/`. |
| `npm run validate` | All three. This is the gate, and CI runs the identical command. |

The suite tests the provenance rules themselves, not just the rendering: a
decision tagged as human-directed with no quote behind it fails the build. See
[`AGENTS.md`](AGENTS.md) section 3 for the full contract.
