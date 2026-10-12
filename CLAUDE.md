# CLAUDE.md

See [`AGENTS.md`](./AGENTS.md) for the rules that govern work in this repository.

The short version: every material decision goes into
`docs/decisions/decisions.json`, tagged with whether the human directed it or the
agent proposed it and the human approved it. Then run
`node scripts/build-docs.mjs` to refresh `docs/DECISIONS.md` and the browser
dashboard. Do not hand-edit generated files.

Branding (fonts, colors, the mark, voice, casing) lives in `brand.md` at the
root. Update it in the same commit as any material branding decision.
