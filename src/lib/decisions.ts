// Types and the single-source import for decision records. The /reqs/decisions
// route renders straight from docs/decisions/decisions.json — the same file
// the docs generator and integrity tests validate — so there is no second
// decision dataset to drift.
import raw from "../../docs/decisions/decisions.json";

export interface DecisionAlternative {
  option: string;
  why_not: string;
}

export interface DecisionTranscript {
  request?: string;
  proposal?: string;
  approval?: string;
}

export interface DecisionArtifact {
  type: "screenshot" | "file" | "link";
  path?: string;
  url?: string;
  caption: string;
}

export interface Decision {
  id: string;
  date: string;
  phase: string;
  title: string;
  origin: "user-directed" | "agent-proposed-user-approved" | "agent-autonomous" | "user-deferred";
  status: "accepted" | "pending" | "rejected" | "superseded";
  problem: string;
  decision: string;
  alternatives: DecisionAlternative[];
  rationale: string;
  consequences: string[];
  transcript: DecisionTranscript;
  artifacts: DecisionArtifact[];
  supersedes: string | null;
  superseded_by: string | null;
}

export interface DecisionOrigin {
  label: string;
  description: string;
  color: string;
}

export interface DecisionsSource {
  project: string;
  tagline: string;
  origins: Record<string, DecisionOrigin>;
  decisions: Decision[];
}

export const DECISIONS_SOURCE = raw as DecisionsSource;

export function originLabel(origin: string): string {
  return DECISIONS_SOURCE.origins[origin]?.label ?? origin;
}
