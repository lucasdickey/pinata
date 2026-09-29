// The landing page's static example of a marked-up capture
// (VAL-LANDING-002, D066, D103): a captured pricing page with one mark of each
// kind — a pin, a circle, an arrow, and a box — a comment thread, and a
// visible DOM metadata panel. Everything renders from the repo fixture
// src/lib/example-capture.ts with inline SVG only — no client runtime, no
// fetch, no /api/* request, no database. The layout mirrors the real
// workspace (capture left, panel right), and the marks are drawn the way the
// canvas draws them: accent strokes, a numbered teardrop badge at a region's
// top-left corner or an arrow's tail, and the selected mark in ink.

import { markLabel } from "../lib/canvas/marks";
import {
  EXAMPLE_CAPTURE,
  EXAMPLE_CAPTURE_FRAME,
  EXAMPLE_LAYOUT,
  type ExampleMark,
} from "../lib/example-capture";

const FRAME_W = EXAMPLE_CAPTURE_FRAME.width;
const FRAME_H = EXAMPLE_CAPTURE_FRAME.height;

/** The example mark's name, built the way the product names every mark (D078). */
function exampleMarkLabel(mark: ExampleMark): string {
  return markLabel({
    kind: mark.kind,
    number: mark.number,
    body: mark.body,
    elementSnapshot: mark.element
      ? { text: mark.element.text, accessibleName: "", tag: mark.element.tag }
      : null,
  });
}

/** Where a mark's numbered badge rides, as the canvas places it. */
function badgePoint(mark: ExampleMark): { x: number; y: number } {
  switch (mark.kind) {
    case "pin":
      return mark.tip;
    case "rectangle":
      return { x: mark.rect.x, y: mark.rect.y };
    case "circle":
      return { x: mark.circle.x, y: mark.circle.y };
    case "arrow":
      return mark.arrow.start;
  }
}

/** A check glyph for a plan's feature line, drawn in the site's own color. */
function Check({ x, y }: { x: number; y: number }) {
  return (
    <path
      className="site-brand-stroke"
      d={`M${x} ${y} l7 7 l13 -15`}
      fill="none"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const FEATURES: Record<string, string[]> = {
  Starter: ["1 kitchen", "50 recipes", "Email support"],
  Team: ["5 kitchens", "Unlimited recipes", "Shared shopping lists"],
  Pro: ["Unlimited kitchens", "Supplier ordering", "Priority support"],
};

/**
 * The captured page: a pricing page drawn in its own colors (a green brand,
 * not Pinata's), so the site reads as someone else's and the marks on top
 * read as ours. Purely illustrative and hidden from assistive tech — the
 * figure's accessible name and the panel carry the content. Geometry comes
 * from EXAMPLE_LAYOUT so each mark lands on the element its snapshot names.
 */
function ExamplePage() {
  const { toggle, annual, cards, popular } = EXAMPLE_LAYOUT;
  return (
    <svg
      className="example-mock"
      viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect className="site-bg" width={FRAME_W} height={FRAME_H} />

      {/* browser chrome */}
      <rect className="site-chrome" width={FRAME_W} height="48" />
      {[28, 50, 72].map((cx) => (
        <circle key={cx} className="site-chrome-dot" cx={cx} cy="24" r="6" />
      ))}
      <rect className="site-urlbar" x="520" y="11" width="400" height="26" rx="13" />
      <text className="site-soft" x="720" y="29" fontSize="15" textAnchor="middle">
        chickpea.co/pricing
      </text>

      {/* site nav */}
      <text className="site-ink" x="96" y="104" fontSize="28" fontWeight="650">
        chickpea
      </text>
      <circle className="site-brand" cx="228" cy="95" r="6" />
      {(
        [
          ["Product", 836],
          ["Pricing", 940],
          ["Customers", 1040],
        ] as const
      ).map(([label, x]) => (
        <text key={label} className="site-soft" x={x} y="102" fontSize="19">
          {label}
        </text>
      ))}
      <rect className="site-brand" x="1184" y="76" width="160" height="42" rx="21" />
      <text
        className="site-on-brand"
        x="1264"
        y="103"
        fontSize="18"
        fontWeight="600"
        textAnchor="middle"
      >
        Start free
      </text>

      {/* hero */}
      <text
        className="site-ink"
        x="720"
        y="208"
        fontSize="50"
        fontWeight="650"
        textAnchor="middle"
      >
        Plans for every kitchen
      </text>
      <text className="site-soft" x="720" y="256" fontSize="22" textAnchor="middle">
        Start free. Upgrade when your team grows.
      </text>

      {/* billing toggle: two halves that look identical, which is pin 1's point */}
      <rect
        className="site-tint"
        x={toggle.x}
        y={toggle.y}
        width={toggle.width}
        height={toggle.height}
        rx={toggle.height / 2}
      />
      <rect className="site-bg" x="544" y="304" width="176" height="44" rx="22" />
      <rect
        className="site-bg"
        x={annual.x}
        y={annual.y}
        width={annual.width}
        height={annual.height}
        rx={annual.height / 2}
      />
      <text
        className="site-ink"
        x="632"
        y="333"
        fontSize="18"
        fontWeight="550"
        textAnchor="middle"
      >
        Monthly
      </text>
      <text
        className="site-ink"
        x="808"
        y="333"
        fontSize="18"
        fontWeight="550"
        textAnchor="middle"
      >
        Annual (save 20%)
      </text>

      {/* plan cards */}
      {cards.map((card) => {
        const featured = card.name === "Team";
        return (
          <g key={card.name}>
            <rect
              className={featured ? "site-card site-card-featured" : "site-card"}
              x={card.x}
              y={card.y}
              width={card.width}
              height={card.height}
              rx="18"
            />
            <text
              className="site-ink"
              x={card.x + 28}
              y={card.y + 60}
              fontSize="26"
              fontWeight="650"
            >
              {card.name}
            </text>
            <text
              className="site-ink"
              x={card.x + 28}
              y={card.y + 150}
              fontSize="54"
              fontWeight="700"
            >
              {card.price}
            </text>
            <text
              className="site-soft"
              x={card.x + 36 + card.price.length * 32}
              y={card.y + 150}
              fontSize="22"
            >
              /mo
            </text>
            {FEATURES[card.name]!.map((feature, index) => (
              <g key={feature}>
                <Check x={card.x + 30} y={card.y + 204 + index * 40} />
                <text
                  className="site-soft"
                  x={card.x + 64}
                  y={card.y + 210 + index * 40}
                  fontSize="20"
                >
                  {feature}
                </text>
              </g>
            ))}
            <rect
              className={featured ? "site-brand" : "site-button"}
              x={card.x + 28}
              y={card.y + 370}
              width={card.width - 56}
              height="52"
              rx="26"
            />
            <text
              className={featured ? "site-on-brand" : "site-ink"}
              x={card.x + card.width / 2}
              y={card.y + 402}
              fontSize="19"
              fontWeight="600"
              textAnchor="middle"
            >
              {card.cta}
            </text>
          </g>
        );
      })}

      {/* the "Most popular" tag on the Team card, where arrow 3 starts */}
      <rect
        className="site-brand"
        x={popular.x}
        y={popular.y}
        width={popular.width}
        height={popular.height}
        rx={popular.height / 2}
      />
      <text
        className="site-on-brand"
        x={popular.x + popular.width / 2}
        y={popular.y + 22}
        fontSize="15"
        fontWeight="600"
        textAnchor="middle"
      >
        Most popular
      </text>
    </svg>
  );
}

/**
 * The marks' strokes, in the capture's natural pixels on the same viewBox as
 * the page, so they stay on their elements at any width. A pin has no stroke;
 * its badge is the whole mark.
 */
function ExampleMarkStrokes({ selected }: { selected: number }) {
  return (
    <svg
      className="example-marks"
      viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id="example-arrow-head"
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="30"
          markerHeight="30"
          orient="auto-start-reverse"
        >
          <path className="example-mark-head" d="M0 0 L10 5 L0 10 z" />
        </marker>
      </defs>
      {EXAMPLE_CAPTURE.marks.map((mark) => {
        const state = mark.number === selected ? "true" : undefined;
        switch (mark.kind) {
          case "rectangle":
            return (
              <rect
                key={mark.number}
                className="example-mark-stroke"
                data-selected={state}
                x={mark.rect.x}
                y={mark.rect.y}
                width={mark.rect.width}
                height={mark.rect.height}
                rx="6"
              />
            );
          case "circle":
            return (
              <ellipse
                key={mark.number}
                className="example-mark-stroke"
                data-selected={state}
                cx={mark.circle.x + mark.circle.size / 2}
                cy={mark.circle.y + mark.circle.size / 2}
                rx={mark.circle.size / 2}
                ry={mark.circle.size / 2}
              />
            );
          case "arrow":
            return (
              <line
                key={mark.number}
                className="example-mark-stroke"
                data-selected={state}
                x1={mark.arrow.start.x}
                y1={mark.arrow.start.y}
                x2={mark.arrow.end.x}
                y2={mark.arrow.end.y}
                markerEnd="url(#example-arrow-head)"
              />
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}

export function ExampleCapture() {
  // The example depicts one selected mark, as the real workspace panel does.
  const selected = EXAMPLE_CAPTURE.marks[0]!;
  return (
    <section className="landing-example" aria-labelledby="example-heading">
      <p className="section-eyebrow">what the founder sees</p>
      <h2 id="example-heading">a marked-up capture, notes pinned where they belong</h2>
      <p className="hint">
        A static example drawn from bundled fixture data — nothing here calls a server.
      </p>
      <div className="example-grid">
        <figure className="example-figure">
          <div
            className="example-shot"
            data-testid="example-shot"
            role="img"
            aria-label={`Example capture of ${EXAMPLE_CAPTURE.pageUrl}, ${EXAMPLE_CAPTURE.device}, version ${EXAMPLE_CAPTURE.version}, with ${EXAMPLE_CAPTURE.marks.length} numbered marks: a pin, a circle, an arrow, and a box`}
          >
            <ExamplePage />
            <ExampleMarkStrokes selected={selected.number} />
            {EXAMPLE_CAPTURE.marks.map((mark) => {
              const at = badgePoint(mark);
              return (
                <span
                  key={mark.number}
                  className="pin-badge pin-badge-example"
                  data-mark-number={mark.number}
                  data-mark-kind={mark.kind}
                  data-selected={mark.number === selected.number ? "true" : undefined}
                  aria-hidden="true"
                  style={{
                    left: `${(at.x / FRAME_W) * 100}%`,
                    top: `${(at.y / FRAME_H) * 100}%`,
                  }}
                >
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z" />
                  </svg>
                  <span className="pin-badge-number">{mark.number}</span>
                </span>
              );
            })}
          </div>
          <figcaption className="hint">
            {EXAMPLE_CAPTURE.projectTitle} — {EXAMPLE_CAPTURE.pageUrl} ·{" "}
            {EXAMPLE_CAPTURE.device} · version {EXAMPLE_CAPTURE.version}
          </figcaption>
        </figure>

        <div className="example-panel">
          <h3>{exampleMarkLabel(selected)}</h3>
          <h4 className="example-subheading">Comment thread</h4>
          {/* The accessible name avoids the bare word "Comment" so the
              workspace panel's Comment field label stays unambiguous for
              assistive tech and e2e selectors alike. */}
          <ol className="example-thread" aria-label="Example thread">
            {selected.thread.map((entry, index) => (
              <li key={index}>
                <span className="example-author">{entry.author}</span>
                <p>{entry.body}</p>
              </li>
            ))}
          </ol>
          {selected.element ? (
            <>
              <h3>DOM context</h3>
              <dl className="panel-facts">
                <dt>Element</dt>
                <dd>
                  {selected.element.kind} &lt;{selected.element.tag}&gt;
                </dd>
                <dt>Role</dt>
                <dd>{selected.element.role}</dd>
                <dt>Text</dt>
                <dd>“{selected.element.text}”</dd>
                <dt>Path</dt>
                <dd>
                  <code>{selected.element.path.join(" › ")}</code>
                </dd>
                <dt>Position</dt>
                <dd>
                  {selected.element.rect.x}, {selected.element.rect.y} ·{" "}
                  {selected.element.rect.width} × {selected.element.rect.height} px
                </dd>
              </dl>
            </>
          ) : null}
          <h3>Marks on this capture</h3>
          <ol className="example-pins" aria-label="Example marks">
            {EXAMPLE_CAPTURE.marks.map((mark) => (
              <li
                key={mark.number}
                aria-current={mark.number === selected.number ? "true" : undefined}
              >
                {exampleMarkLabel(mark)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
