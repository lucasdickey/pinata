// Response rules shared by the agent link's public routes (D121).
//
// The token is in the URL path, so every answer — the brief, a screenshot,
// and every denial — says: never cache this, never index it, never send
// this URL on as a referrer, never frame it. A denial is one plain-text 404
// whatever the cause, so the routes never confirm that a token or a capture
// exists.

const AGENT_HEADERS: readonly (readonly [string, string])[] = [
  ["cache-control", "private, no-store, max-age=0"],
  ["referrer-policy", "no-referrer"],
  ["x-robots-tag", "noindex, nofollow, noarchive"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
];

export function withAgentSafety(response: Response): Response {
  for (const [key, value] of AGENT_HEADERS) response.headers.set(key, value);
  return response;
}

export function agentNotFound(): Response {
  return withAgentSafety(
    new Response("Not found.\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}

export function agentUnavailable(): Response {
  return withAgentSafety(
    new Response("Pinata is unavailable right now. Try again shortly.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}

export function agentMethodNotAllowed(): Response {
  const response = withAgentSafety(
    new Response("Method not allowed.\n", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
  response.headers.set("allow", "GET, HEAD");
  return response;
}

/** The agent link path for a token; the screenshot paths hang off it. */
export function agentLinkPath(token: string): string {
  return `/a/${token}`;
}
