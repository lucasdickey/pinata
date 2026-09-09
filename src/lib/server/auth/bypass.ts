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

/** True only when the local-only editor auth bypass is explicitly enabled. */
export function isAuthDisabled(): boolean {
  return process.env.PINATA_AUTH_DISABLED === "1";
}
