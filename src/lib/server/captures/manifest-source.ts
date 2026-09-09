// The in-page inspection pass: geometry, device observations, and the bounded
// sanitized DOM manifest (VAL-CAPTURE-005, VAL-CAPTURE-006).
//
// This is source text executed inside the Browserless sandbox, so it is a
// self-contained expression: it may not reference anything from this module,
// and every helper it needs is written inside it. It is exported separately
// from the capture function so `test/server/capture-manifest-page.test.ts`
// can evaluate this exact text against a real DOM and prove what it collects
// and — more importantly — what it refuses to collect.
//
// The rules it implements:
//
//  1. **Visibility is effective, not declared.** An element counts only if it
//     and every ancestor render, and only if it survives intersection with
//     every clipping ancestor. That is what excludes a collapsed mobile menu,
//     a closed `<details>`, an off-canvas drawer, and a screen-reader-only
//     node whose own `display` is perfectly ordinary.
//  2. **Only inert, bounded fields leave the page.** No outer HTML, no
//     URL-bearing attribute, no arbitrary attribute, no cookie or storage
//     read, no form value, no shadow-root or frame traversal. Text is
//     assembled from visible text nodes, so a hidden descendant's text cannot
//     ride out inside its visible parent's `textContent`.
//  3. **Hostile values are neutralized before they are data.** Control
//     characters, bidi controls, line/paragraph separators, and stacked
//     combining marks are stripped; every string is bounded by code point, so
//     no surrogate pair is ever split; every rectangle must be finite and
//     inside the published bound.
//  4. **Truncation is deterministic and positional.** When there are more
//     candidates than the budget allows, the kept set is an even stride over
//     the vertically ordered candidates, so top, middle, and bottom of the
//     page all survive.

/**
 * `(context) => inspection` as source text. Returns viewport observations,
 * document geometry, and the bounded manifest from one stabilized layout.
 */
export const MANIFEST_INSPECT_SOURCE = String.raw`(context) => {
  const limits = context.limits;

  // ---- string sanitization -------------------------------------------------

  const forbiddenCode = (code) =>
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f) ||
    code === 0x61c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff;

  const combiningCode = (code) =>
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x483 && code <= 0x489) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20f0) ||
    (code >= 0xfe20 && code <= 0xfe2f);

  const clean = (value, max) => {
    if (typeof value !== "string" || value.length === 0 || max <= 0) return "";
    let filtered = "";
    let marks = 0;
    // Iterating the string yields whole code points, so a surrogate pair is
    // never split into a lone half that would serialize as U+FFFD later.
    for (const ch of value) {
      if (filtered.length >= max * 8) break;
      const code = ch.codePointAt(0);
      if (forbiddenCode(code)) continue;
      if (combiningCode(code)) {
        marks += 1;
        if (marks > limits.markMaxRun) continue;
      } else {
        marks = 0;
      }
      filtered += ch;
    }
    const collapsed = filtered.replace(/\s+/g, " ").trim();
    let out = "";
    for (const ch of collapsed) {
      if (out.length + ch.length > max) break;
      out += ch;
    }
    return out;
  };

  const round = (value) => {
    const factor = Math.pow(10, limits.rectDecimals);
    return Math.round(value * factor) / factor;
  };

  const boundedRect = (rect) => {
    const values = [rect.x, rect.y, rect.width, rect.height];
    for (let i = 0; i < values.length; i += 1) {
      if (typeof values[i] !== "number" || !isFinite(values[i])) return null;
      if (Math.abs(values[i]) > limits.rectMaxPx) return null;
    }
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
    };
  };

  // ---- effective visibility ------------------------------------------------

  const styles = new Map();
  const styleOf = (el) => {
    let style = styles.get(el);
    if (!style) {
      style = getComputedStyle(el);
      styles.set(el, style);
    }
    return style;
  };

  const CLIPPING = ["hidden", "clip", "scroll", "auto"];
  const clips = (value) => CLIPPING.indexOf(value) !== -1;

  /** True when this element alone removes itself and its subtree from view. */
  const selfHidden = (el) => {
    if (el.hasAttribute("hidden") || el.hasAttribute("inert")) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    const style = styleOf(el);
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") return true;
    if (style.getPropertyValue("content-visibility") === "hidden") return true;
    const opacity = parseFloat(style.opacity);
    if (!isNaN(opacity) && opacity === 0) return true;
    // The screen-reader-only patterns: clipped to nothing while still "rendered".
    const clipPath = (style.getPropertyValue("clip-path") || "").replace(/\s+/g, "");
    if (clipPath.indexOf("inset(50%") === 0 || clipPath.indexOf("inset(100%") === 0) return true;
    const legacyClip = (style.getPropertyValue("clip") || "").replace(/\s+/g, "");
    if (legacyClip.indexOf("rect(0") === 0) return true;
    return false;
  };

  /** The summary of a closed <details> renders; nothing else inside it does. */
  const closedDetailsHides = (details, el) => {
    if (details.open) return false;
    if (details === el) return false;
    const summary = details.querySelector(":scope > summary");
    if (!summary) return true;
    return !(summary === el || summary.contains(el));
  };

  /**
   * The element's visible document-space rectangle, or null when it is not
   * effectively visible. Ancestors contribute both their own hiding and their
   * clipping: a zero-height "overflow:hidden" wrapper (the collapsed mobile
   * menu) leaves nothing to intersect with.
   */
  const visibleRect = (el) => {
    let left = -Infinity;
    let top = -Infinity;
    let right = Infinity;
    let bottom = Infinity;
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < limits.visibilityMaxDepth) {
      if (selfHidden(node)) return null;
      const tag = node.tagName.toLowerCase();
      if (tag === "details" && closedDetailsHides(node, el)) return null;
      if (tag === "dialog" && !node.open) return null;
      if (node !== el) {
        const style = styleOf(node);
        // Longhands and the shorthand are both consulted: engines resolve the
        // shorthand into the longhands, but a DOM without full shorthand
        // decomposition reports only the shorthand itself.
        const clipX = clips(style.overflowX) || clips(style.overflow);
        const clipY = clips(style.overflowY) || clips(style.overflow);
        if (clipX || clipY) {
          const box = node.getBoundingClientRect();
          if (clipX) {
            left = Math.max(left, box.left);
            right = Math.min(right, box.right);
          }
          if (clipY) {
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
          }
        }
      }
      node = node.parentElement;
      depth += 1;
    }

    const rect = el.getBoundingClientRect();
    const x0 = Math.max(rect.left, left);
    const y0 = Math.max(rect.top, top);
    const x1 = Math.min(rect.right, right);
    const y1 = Math.min(rect.bottom, bottom);
    if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) return null;
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const docX = x0 + window.scrollX;
    const docY = y0 + window.scrollY;
    // Positioned off the document — the other classic way to hide a drawer.
    if (docX + (x1 - x0) <= 0 || docY + (y1 - y0) <= 0) return null;
    return boundedRect({ x: docX, y: docY, width: x1 - x0, height: y1 - y0 });
  };

  // ---- visible text --------------------------------------------------------

  const OPAQUE_TAGS = {
    SCRIPT: 1,
    STYLE: 1,
    TEMPLATE: 1,
    NOSCRIPT: 1,
    IFRAME: 1,
    FRAME: 1,
    OBJECT: 1,
    EMBED: 1,
    CANVAS: 1,
    SVG: 1,
    HEAD: 1,
    TITLE: 1,
    LINK: 1,
    META: 1,
  };

  /** Cheap per-node render test used while walking text; no clipping math. */
  const rendersText = (el) => {
    if (selfHidden(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  };

  /**
   * Any closed <details> above an element hides it, except the path down to
   * that details element's own summary, which renders while closed.
   */
  const blockedByClosedDetails = (el) => {
    let details = el.closest("details");
    while (details) {
      if (!details.open) {
        const summary = details.querySelector(":scope > summary");
        if (!summary || !(summary === el || summary.contains(el))) return true;
      }
      details = details.parentElement ? details.parentElement.closest("details") : null;
    }
    return false;
  };

  /**
   * Text assembled from the visible text nodes under "root". A hidden
   * descendant contributes nothing, which is what keeps a "display:none"
   * sentinel — or the panel of a closed menu — out of its visible parent's
   * entry. Shadow roots and frames are never entered.
   */
  const visibleText = (root, max) => {
    let out = "";
    let scanned = 0;
    const walk = (node) => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (out.length >= max * 8 || scanned >= limits.textNodeScanMax) return;
        if (child.nodeType === 3) {
          scanned += 1;
          out += child.nodeValue + " ";
          continue;
        }
        if (child.nodeType !== 1) continue;
        scanned += 1;
        if (OPAQUE_TAGS[child.tagName]) continue;
        if (blockedByClosedDetails(child)) continue;
        if (!rendersText(child)) continue;
        walk(child);
      }
    };
    walk(root);
    return clean(out, max);
  };

  // ---- element description -------------------------------------------------

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (["header", "footer", "main", "nav", "aside", "form"].indexOf(tag) !== -1) return "landmark";
    if (["h1", "h2", "h3", "h4", "h5", "h6"].indexOf(tag) !== -1) return "heading";
    if (tag === "a") return "link";
    if (["button", "input", "select", "textarea"].indexOf(tag) !== -1) return "control";
    if (tag === "img") return "image";
    if (tag === "td" || tag === "th") return "table-cell";
    if (tag === "details") return "details";
    if (tag === "summary") return "summary";
    return "text";
  };

  const SAFE_TAG = /^[a-z][a-z0-9-]{0,31}$/;
  const safeTag = (el) => {
    const tag = el.tagName.toLowerCase();
    return SAFE_TAG.test(tag) ? tag : "element";
  };

  /**
   * A bounded array of "tag:index" segments. It is deliberately structural
   * data, not a selector to execute: the tag is checked against a safe
   * pattern and the index is a number, so nothing a page controls survives
   * into it.
   */
  const pathOf = (el) => {
    const segments = [];
    let node = el;
    while (node && node.nodeType === 1 && segments.length < limits.pathMaxDepth) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling && index <= limits.siblingScanMax) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      segments.unshift(safeTag(node) + ":" + index);
      node = node.parentElement;
    }
    return segments;
  };

  const describe = (el, rect) => {
    const classes = [];
    if (el.classList) {
      for (let c = 0; c < el.classList.length && classes.length < limits.maxClasses; c += 1) {
        const value = clean(el.classList[c], limits.hintMaxChars);
        if (value) classes.push(value);
      }
    }
    const text = visibleText(el, limits.textMaxChars);
    // Only these approved attributes are read, and each is a bounded human
    // label: never a URL-bearing, form-value, or data-payload attribute.
    const name = clean(
      el.getAttribute("aria-label") ||
        el.getAttribute("alt") ||
        el.getAttribute("title") ||
        text,
      limits.nameMaxChars,
    );
    return {
      id: "",
      kind: kindOf(el),
      tag: safeTag(el),
      role: clean(el.getAttribute("role") || "", limits.hintMaxChars),
      text: text,
      accessibleName: name,
      hints: {
        id: clean(el.getAttribute("id") || "", limits.hintMaxChars),
        classes: classes,
        alt: clean(el.getAttribute("alt") || "", limits.nameMaxChars),
        title: clean(el.getAttribute("title") || "", limits.nameMaxChars),
        testId: clean(el.getAttribute("data-testid") || "", limits.hintMaxChars),
      },
      path: pathOf(el),
      rect: rect,
    };
  };

  // ---- candidate collection ------------------------------------------------

  const nodes = document.querySelectorAll(
    "header,footer,main,nav,aside,form,h1,h2,h3,h4,h5,h6,a,button,input,select," +
      "textarea,img,td,th,details,summary,p,li,blockquote,figcaption,dt,dd",
  );
  const candidates = [];
  for (let i = 0; i < nodes.length && i < limits.candidateScanMax; i += 1) {
    const el = nodes[i];
    if (el.closest("[data-pinata-capture]")) continue;
    const rect = visibleRect(el);
    if (!rect) continue;
    const entry = describe(el, rect);
    entry.order = candidates.length;
    candidates.push(entry);
  }

  // The capture's own nonce overlay is described separately and always kept,
  // so the manifest and the screenshot can be correlated even when the rest
  // of the page overflowed the budget.
  const nonceNode = document.querySelector('[data-pinata-capture="nonce"]');
  const nonceRect = nonceNode ? visibleRect(nonceNode) : null;
  let nonceEntry = null;
  if (nonceNode && nonceRect) {
    nonceEntry = describe(nonceNode, nonceRect);
    nonceEntry.id = "nonce";
    nonceEntry.text = clean(context.layoutNonce, limits.textMaxChars);
    nonceEntry.accessibleName = nonceEntry.text;
    nonceEntry.order = -1;
  }

  // ---- deterministic bounding ----------------------------------------------

  // Vertical order is what makes "top, middle, and bottom survive" true: an
  // even stride over it always keeps the first and last candidate on the page
  // and spreads the rest evenly between them.
  const vertical = candidates.slice().sort((a, b) => {
    if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
    if (a.rect.x !== b.rect.x) return a.rect.x - b.rect.x;
    return a.order - b.order;
  });

  const sample = (list, keep) => {
    if (keep >= list.length) return list.slice();
    if (keep <= 0) return [];
    if (keep === 1) return [list[0]];
    const out = [];
    for (let i = 0; i < keep; i += 1) {
      out.push(list[Math.round((i * (list.length - 1)) / (keep - 1))]);
    }
    return out;
  };

  const build = (picked) => {
    const elements = picked.slice().sort((a, b) => a.order - b.order);
    const out = [];
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      out.push({
        id: element.id || "e" + (i + 1),
        kind: element.kind,
        tag: element.tag,
        role: element.role,
        text: element.text,
        accessibleName: element.accessibleName,
        hints: element.hints,
        path: element.path,
        rect: element.rect,
      });
    }
    return out;
  };

  const measure = (elements, truncated) =>
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: limits.manifestSchemaVersion,
        truncated: truncated,
        elements: elements,
      }),
    ).length;

  const budget = limits.manifestMaxElements - (nonceEntry ? 1 : 0);
  let keep = Math.min(candidates.length, budget);
  let truncated = keep < candidates.length;
  let picked = sample(vertical, keep);
  let elements = build(nonceEntry ? [nonceEntry].concat(picked) : picked);
  let guard = 0;
  while (
    keep > 1 &&
    guard < limits.manifestShrinkMaxRounds &&
    measure(elements, true) > limits.manifestMaxBytes
  ) {
    keep = Math.floor(keep * 0.8);
    truncated = true;
    picked = sample(vertical, keep);
    elements = build(nonceEntry ? [nonceEntry].concat(picked) : picked);
    guard += 1;
  }

  const body = document.body;
  const root = document.documentElement;
  return {
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
      hoverNone: window.matchMedia("(hover: none)").matches,
      prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      userAgent: (navigator.userAgent || "").slice(0, 256),
    },
    document: {
      width: Math.max(body ? body.scrollWidth : 0, root.scrollWidth, window.innerWidth),
      height: Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root.scrollHeight,
        root.offsetHeight,
      ),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      title: clean(document.title || "", limits.documentTitleMaxChars),
    },
    manifest: {
      schemaVersion: limits.manifestSchemaVersion,
      truncated: truncated,
      elements: elements,
    },
  };
}`;
