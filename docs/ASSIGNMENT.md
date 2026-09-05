# The assignment

Source: `Factory __ Build an MVP (2).pdf`, supplied 2026-09-04.

## Brief, as given

> As part of your interview, we'd like you to create a minimum viable product (MVP)
> using Factory. The goal isn't to build something big or polished — it's to see how
> you approach problem-solving, how you use AI tools, and how you explain your
> thinking. Please make sure you build something new specifically for this interview,
> and be ready to show full sessions of the build process.

**Guidelines.** You must use Factory to create your MVP. This will show how you work
with agent-driven development to produce something functional.

**What to build.** Freedom to decide. Two suggested paths:

1. *Personal workflow MVP* — a small tool, web app, script, or workflow that solves a
   problem you've faced personally.
2. *Factory feature idea* — a potential feature or extension you think could improve
   the Factory product.

**Interview format.** Live demo over screen share, plus questions on:

1. The problem you chose and why it matters.
2. How you approached building it and how you used AI tooling along the way.
3. What you'd do next if you had more time.

**Expectations.**

1. Timebox: no more than ~4 hours total.
2. Scope: the MVP can be rough — functionality matters more than polish.
3. Evaluation focus:
   - Creativity in what you choose to build.
   - Clarity in framing the problem.
   - Effective use of AI tools.
   - Ability to explain your process and decisions.

## How this repository satisfies it

| Requirement | Where it is answered |
| --- | --- |
| Built new, specifically for this interview | Repository created 2026-09-04 from an empty directory; full git history is the evidence |
| Built with Factory | Every commit authored through a Factory droid session; session narrative in `docs/SESSION-LOG.md` |
| Something functional | `src/` — the MVP itself |
| Problem framing | `README.md` opens with the problem statement, not the feature list |
| Process and decisions explained | `docs/DECISIONS.md` (plain text) and `docs/dashboard/index.html` (browser view), both generated from `docs/decisions/decisions.json` |
| Provenance of each decision | `origin` field on every decision record separates *human-directed* from *agent-proposed, human-approved* |
| Dead ends and reversals | `docs/SESSION-LOG.md`, plus `superseded_by` links in the decision log |
| "What next if you had more time" | `docs/NEXT.md` |
| Respect for the timebox | Elapsed time tracked per session in `docs/SESSION-LOG.md`; scope cuts recorded as decisions |

## A note on the meta-work

Building the decision-logging apparatus is itself work, and it consumes timebox. It
is counted honestly in the session log. The justification is that criterion (d),
"ability to explain your process and decisions," is a graded output, so the
apparatus is on the critical path rather than beside it.
