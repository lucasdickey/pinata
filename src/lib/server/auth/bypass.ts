// Server-only local development escape hatch (D052, user-directed
// 2026-09-09: "remove the password / comment it out for now. i just want to
// use it. auth is low priority."). When PINATA_AUTH_DISABLED is exactly "1",
// server-side session verification treats every request as an authenticated
// editor with a synthetic session, so the landing page renders the editor
// workspace directly and every editor API authorizes.
//
// HARD CONSTRAINTS:
// - LOCAL-ONLY and TEMPORARY ("for now"): production keeps auth. Never set
//   the flag in any Vercel environment.
// - NEVER a NEXT_PUBLIC_* variable and never read from client-reachable code.
// - NEVER added to .env.local: the validation gate and all validators run
//   with .env.local present and must keep proving the real auth posture
//   (anonymous denial, login, throttling). Servers for live user sessions
//   are started with the flag inline, e.g. `PINATA_AUTH_DISABLED=1 npm run
//   start`.
//
// Default is OFF: any value other than exactly "1" — including unset —
// keeps the real password/session behavior byte-identical.
//
// ENFORCED, not just documented (D098): the flag is ignored whenever
// VERCEL is set. Vercel sets it at build time and at runtime in every
// environment (production, preview, development builds), so a flag that
// leaks into a Vercel project's variables cannot switch auth off there. The
// guard deliberately does not key on NODE_ENV: local live sessions run the
// production build (`npm run start`, NODE_ENV=production) with the flag on.

let warnedIgnoredOnVercel = false;

/** True only when the local-only editor auth bypass is explicitly enabled. */
export function isAuthDisabled(): boolean {
  if (process.env.PINATA_AUTH_DISABLED !== "1") return false;
  if (process.env.VERCEL) {
    // Say once, server-side, that the deployment carries a flag it must not
    // have; the flag's name is not a secret and no value is logged.
    if (!warnedIgnoredOnVercel) {
      warnedIgnoredOnVercel = true;
      console.warn(
        "[auth] PINATA_AUTH_DISABLED is set on Vercel and is ignored; editor auth stays on. Remove the variable from the project (D052, D098).",
      );
    }
    return false;
  }
  return true;
}

/** Test-only helper: allow the Vercel warning to be emitted again. */
export function __resetAuthBypassWarningForTests(): void {
  warnedIgnoredOnVercel = false;
}
