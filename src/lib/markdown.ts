// Zero-dependency, safe-by-construction Markdown renderer for the /reqs hub.
//
// There is deliberately no Markdown package in the approved dependency set
// (see docs/decisions D021/D022), so this module implements the small subset
// the requirements documents use: ATX headings, paragraphs, lists whose items
// may wrap onto continuation lines, pipe tables, fenced code, blockquotes,
// and inline code/strong/em/links.
//
// Safety contract (pinned by test/requirements-markdown.test.ts):
// - Raw HTML is disabled: every source character passes through escapeHtml
//   unless it becomes a tag this renderer emitted itself.
// - Link targets are allow-listed: https?, root-relative, relative, and
//   in-page anchors only. javascript:/data:/vbscript:/protocol-relative,
//   empty, and malformed targets render as inert text.
// - External links open in a new tab with rel="noopener noreferrer" and
//   visibly name their destination host.
// - Heading anchors are unique: collisions get deterministic -2, -3 suffixes.

export interface MarkdownHeading {
  depth: number;
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: MarkdownHeading[];
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function isSafeLinkTarget(target: string): boolean {
  if (!target) return false;
  // Strip whitespace and control characters before scheme checks so that
  // "java\tscript:" and friends cannot smuggle a scheme past the allow-list.
  const compact = target.replace(/[- ]/g, "").toLowerCase();
  if (compact.startsWith("#")) return true;
  if (compact.startsWith("/")) return !compact.startsWith("//");
  if (compact.startsWith("./") || compact.startsWith("../")) return true;
  return /^https?:\/\//.test(compact);
}

function renderLink(label: string, rawTarget: string): string {
  const target = rawTarget.trim();
  // Unsafe, empty, or malformed targets render as visibly inert text — the
  // label survives, the navigation does not.
  if (!isSafeLinkTarget(target)) {
    return `<span class="inert-link">${escapeHtml(label)}</span>`;
  }
  const href = escapeHtml(target);
  if (/^https?:\/\//i.test(target)) {
    let host = "";
    try {
      host = new URL(target).host;
    } catch {
      host = "";
    }
    const hostSuffix = host ? ` <span class="external-host">(${escapeHtml(host)})</span>` : "";
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>${hostSuffix}`;
  }
  return `<a href="${href}">${escapeHtml(label)}</a>`;
}

const INLINE =
  /\[([^\]\n]*)\]\(([^)\n]*)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

function renderInline(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, match.index));
    const [whole, linkLabel, linkTarget, code, strong, em] = match;
    if (linkLabel !== undefined) out += renderLink(linkLabel, linkTarget);
    else if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`;
    else if (strong !== undefined) out += `<strong>${escapeHtml(strong)}</strong>`;
    else if (em !== undefined) out += `<em>${escapeHtml(em)}</em>`;
    last = match.index + whole.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "");
}

function uniqueSlug(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const seen = (used.get(base) ?? 0) + 1;
  used.set(base, seen);
  return seen === 1 ? base : `${base}-${seen}`;
}

function splitTableRow(line: string): string[] {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]*-[\s:|-]*$/.test(line.trim()) && line.includes("-");
}

export function renderMarkdown(source: string): RenderedMarkdown {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  const headings: MarkdownHeading[] = [];
  const usedIds = new Map<string, number>();
  let i = 0;

  const startsBlock = (line: string): boolean =>
    /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,})\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      html.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const depth = heading[1].length;
      const content = heading[2].trim();
      const id = uniqueSlug(plainText(content), usedIds);
      headings.push({ depth, text: plainText(content), id });
      html.push(`<h${depth} id="${id}">${renderInline(content)}</h${depth}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote><p>${renderInline(buf.join(" "))}</p></blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const head = header.map((c) => `<th>${renderInline(c)}</th>`).join("");
      const body = rows
        .map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
        .join("");
      html.push(
        `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
      continue;
    }

    // Both list loops consume wrapped continuation lines: any non-blank
    // line that does not start another block belongs to the current item.
    // A blank line therefore ends a list, and the source documents must
    // separate a following paragraph from the list with one (D046).
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, "");
        i++;
        while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
          item += ` ${lines[i].trim()}`;
          i++;
        }
        items.push(item);
      }
      html.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d+\.\s+/, "");
        i++;
        while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
          item += ` ${lines[i].trim()}`;
          i++;
        }
        items.push(item);
      }
      html.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`);
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }

  return { html: html.join("\n"), headings };
}
