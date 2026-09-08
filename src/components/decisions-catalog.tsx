// Renders the full decision trail from docs/decisions/decisions.json (via
// src/lib/decisions.ts) in source order. Every schema field is shown: id,
// date, phase, title, status, origin label, problem, decision, alternatives,
// rationale, consequences, provenance transcript, artifacts, and supersession
// links. React escaping keeps quoted evidence inert.
import type { Decision } from "../lib/decisions";
import { DECISIONS_SOURCE, originLabel } from "../lib/decisions";
import { deployedRevision } from "../lib/requirements-server";

function ArtifactList({ decision }: { decision: Decision }) {
  if (decision.artifacts.length === 0) return null;
  return (
    <section aria-label="Artifacts">
      <h4>Artifacts</h4>
      <ul>
        {decision.artifacts.map((artifact, index) => (
          <li key={index}>
            <span className="artifact-type">{artifact.type}</span>{" "}
            {artifact.type === "link" && artifact.url ? (
              <a href={artifact.url} target="_blank" rel="noopener noreferrer">
                {artifact.caption}
              </a>
            ) : (
              <code>{artifact.path}</code>
            )}{" "}
            {artifact.type === "link" ? null : <span>— {artifact.caption}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Transcript({ decision }: { decision: Decision }) {
  const { request, proposal, approval } = decision.transcript;
  if (!request && !proposal && !approval) return null;
  return (
    <section aria-label="Provenance transcript">
      <h4>Provenance</h4>
      {request ? (
        <blockquote>
          <p>
            <strong>Human:</strong> “{request}”
          </p>
        </blockquote>
      ) : null}
      {proposal ? (
        <blockquote>
          <p>
            <strong>Agent proposed:</strong> “{proposal}”
          </p>
        </blockquote>
      ) : null}
      {approval ? (
        <blockquote>
          <p>
            <strong>Human approved:</strong> “{approval}”
          </p>
        </blockquote>
      ) : null}
    </section>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <article className="decision-card" id={decision.id} data-decision-id={decision.id}>
      <h3>
        {decision.id} — {decision.title}
      </h3>
      <p className="decision-meta">
        <span>{decision.date}</span> · <span>{decision.phase}</span> ·{" "}
        <span className={`status status-${decision.status}`}>{decision.status}</span> ·{" "}
        <span className="origin">{originLabel(decision.origin)}</span>
      </p>
      <h4>Problem</h4>
      <p>{decision.problem}</p>
      <h4>Decision</h4>
      <p>{decision.decision}</p>
      {decision.alternatives.length > 0 ? (
        <section aria-label="Alternatives considered">
          <h4>Alternatives considered</h4>
          <ul>
            {decision.alternatives.map((alt, index) => (
              <li key={index}>
                <strong>{alt.option}</strong> — {alt.why_not}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h4>Rationale</h4>
      <p>{decision.rationale}</p>
      {decision.consequences.length > 0 ? (
        <section aria-label="Consequences">
          <h4>Consequences</h4>
          <ul>
            {decision.consequences.map((c, index) => (
              <li key={index}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <Transcript decision={decision} />
      <ArtifactList decision={decision} />
      {decision.supersedes || decision.superseded_by ? (
        <p className="supersession">
          {decision.supersedes ? (
            <>
              Supersedes <a href={`#${decision.supersedes}`}>{decision.supersedes}</a>.{" "}
            </>
          ) : null}
          {decision.superseded_by ? (
            <>
              Superseded by <a href={`#${decision.superseded_by}`}>{decision.superseded_by}</a>.
            </>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

export function DecisionsCatalog() {
  const { decisions } = DECISIONS_SOURCE;
  return (
    <div className="doc decisions-catalog" data-source-path="docs/decisions/decisions.json">
      <p className="source-cue">
        Source: <code>docs/decisions/decisions.json</code> · Revision:{" "}
        <code>{deployedRevision()}</code>
      </p>
      <p>
        {decisions.length} decisions, in record order. Provenance labels distinguish what the human
        directed, what the agent proposed and the human approved, what the agent decided alone, and
        what was consciously deferred.
      </p>
      {decisions.map((decision) => (
        <DecisionCard key={decision.id} decision={decision} />
      ))}
    </div>
  );
}
