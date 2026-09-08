// Renders one authoritative Markdown source for the /reqs hub. The renderer
// escapes all raw HTML by construction (see src/lib/markdown.ts), so the
// sanitized string is safe to mount. Each article carries its source path and
// the deployed revision as visible provenance cues.
import { renderMarkdown } from "../lib/markdown";
import { loadRequirementsDocument, deployedRevision } from "../lib/requirements-server";

interface MarkdownArticleProps {
  sourcePath: string;
}

export function MarkdownArticle({ sourcePath }: MarkdownArticleProps) {
  const { html } = renderMarkdown(loadRequirementsDocument(sourcePath));
  return (
    <article className="doc" data-source-path={sourcePath}>
      <p className="source-cue">
        Source: <code>{sourcePath}</code> · Revision: <code>{deployedRevision()}</code>
      </p>
      {/* Safe: renderMarkdown escapes every source character it does not
          deliberately emit as a renderer-generated tag. */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
