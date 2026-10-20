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
  const { html, headings } = renderMarkdown(loadRequirementsDocument(sourcePath));
  // "On this page" (D149): the document's sections, as a sticky rail beside
  // the text on wide screens. Only worth showing when there is somewhere to
  // jump to.
  const sections = headings.filter((heading) => heading.depth === 2);
  return (
    <article
      className={sections.length >= 3 ? "doc doc-with-toc" : "doc"}
      data-source-path={sourcePath}
    >
      <p className="source-cue">
        Source: <code>{sourcePath}</code> · Revision: <code>{deployedRevision()}</code>
      </p>
      {sections.length >= 3 ? (
        <nav className="doc-toc" aria-label="On this page">
          <p className="doc-toc-title">On this page</p>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {/* Safe: renderMarkdown escapes every source character it does not
          deliberately emit as a renderer-generated tag. */}
      <div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
