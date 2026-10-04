// Shared shapes for the agent link (D121), used by the editor route and the
// editor's control.

export interface AgentLinkView {
  state: "none" | "active" | "revoked";
  version: number;
  revokedAt: number | null;
}

/** GET/DELETE /api/projects/[publicId]/agent-link response. */
export interface AgentLinkStatusResponse {
  link: AgentLinkView;
}

/** POST /api/projects/[publicId]/agent-link response: the token, once. */
export interface AgentLinkIssueResponse {
  link: AgentLinkView;
  /** Path of the brief, token included: `/a/<token>`. */
  path: string;
}

/** The one line to paste into an agent along with the link. */
export function agentPrompt(url: string): string {
  return `Read ${url} — it lists open design feedback on our site, with screenshots. Work through each open mark, make the changes in this codebase, then tell me what you changed for each one.`;
}
