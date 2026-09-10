// The landing page's static example of a marked-up capture
// (VAL-LANDING-002, D066): a screenshot region with two numbered pins, a
// two-entry comment thread, and a visible DOM metadata panel. Everything
// renders from the repo fixture src/lib/example-capture.ts with inline SVG
// only — no client runtime, no fetch, no /api/* request, no database. The
// layout mirrors the real workspace (capture left, screen-fixed panel right)
// and reuses the product's pin-badge mark; the thread is depicted as saved
// content with deliberately no reply control (threads are deferred, D051).

import { EXAMPLE_CAPTURE, EXAMPLE_CAPTURE_FRAME } from "../lib/example-capture";

/**
 * The decorative in-frame page mock: an inline SVG pricing page in warm
 * neutrals. Purely illustrative and hidden from assistive tech — the figure's
 * accessible name and the panel text carry the content. Geometry is in the
 * example frame's natural pixels so the numbered pins land on the toggle and
 * the Pro card's CTA exactly where their fixture tips say.
 */
function ExampleMock() {
  return (
    <svg
      className="example-mock"
      viewBox={`0 0 ${EXAMPLE_CAPTURE_FRAME.width} ${EXAMPLE_CAPTURE_FRAME.height}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect
        className="mock-page"
        width={EXAMPLE_CAPTURE_FRAME.width}
        height={EXAMPLE_CAPTURE_FRAME.height}
      />
      {/* browser chrome */}
      <rect className="mock-chrome" width={EXAMPLE_CAPTURE_FRAME.width} height="44" />
      <rect className="mock-block" x="96" y="12" width="300" height="20" rx="10" />
      {/* site nav */}
      <rect className="mock-block" x="96" y="76" width="120" height="24" rx="12" />
      <rect className="mock-block" x="1080" y="80" width="64" height="14" rx="7" />
      <rect className="mock-block" x="1164" y="80" width="64" height="14" rx="7" />
      <rect className="mock-block" x="1248" y="80" width="64" height="14" rx="7" />
      {/* hero */}
      <rect className="mock-ink" x="96" y="150" width="520" height="34" rx="8" />
      <rect className="mock-block" x="96" y="200" width="680" height="16" rx="8" />
      <rect className="mock-block" x="96" y="228" width="430" height="16" rx="8" />
      {/* billing toggle — pin 1's element at (392, 386, 176, 44) */}
      <rect className="mock-toggle" x="392" y="386" width="176" height="44" rx="22" />
      <circle className="mock-page-block" cx="414" cy="408" r="14" />
      {/* pricing cards */}
      {[140, 540, 940].map((x) => (
        <g key={x}>
          <rect className="mock-card" x={x} y="480" width="360" height="330" rx="16" />
          <rect className="mock-ink" x={x + 28} y="512" width="130" height="20" rx="6" />
          <rect className="mock-block" x={x + 28} y="552" width="90" height="30" rx="6" />
          <rect className="mock-block" x={x + 28} y="610" width="280" height="12" rx="6" />
          <rect className="mock-block" x={x + 28} y="636" width="250" height="12" rx="6" />
          <rect className="mock-block" x={x + 28} y="662" width="265" height="12" rx="6" />
        </g>
      ))}
      {/* the Pro card's CTA — pin 2's element at (990, 560, 260, 48) overlays
          the third card */}
      <rect className="mock-cta" x="990" y="560" width="260" height="48" rx="24" />
    </svg>
  );
}

export function ExampleCapture() {
  // The example depicts one selected pin, as the real workspace panel does.
  const selected = EXAMPLE_CAPTURE.pins[0]!;
  return (
    <section className="landing-example" aria-labelledby="example-heading">
      <h2 id="example-heading">See what a marked-up capture looks like</h2>
      <p className="hint">
        A static example drawn from bundled fixture data — nothing here calls a server.
      </p>
      <div className="example-grid">
        <figure className="example-figure">
          <div
            className="example-shot"
            data-testid="example-shot"
            role="img"
            aria-label={`Example capture of ${EXAMPLE_CAPTURE.pageUrl}, ${EXAMPLE_CAPTURE.device}, version ${EXAMPLE_CAPTURE.version}, with ${EXAMPLE_CAPTURE.pins.length} numbered pins`}
          >
            <ExampleMock />
            {EXAMPLE_CAPTURE.pins.map((pin) => (
              <span
                key={pin.number}
                className="pin-badge pin-badge-example"
                data-pin-number={pin.number}
                aria-hidden="true"
                style={{
                  left: `${(pin.tip.x / EXAMPLE_CAPTURE_FRAME.width) * 100}%`,
                  top: `${(pin.tip.y / EXAMPLE_CAPTURE_FRAME.height) * 100}%`,
                  width: 30,
                  height: 30,
                }}
              >
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z" />
                </svg>
                <span className="pin-badge-number" style={{ fontSize: 11 }}>
                  {pin.number}
                </span>
              </span>
            ))}
          </div>
          <figcaption className="hint">
            {EXAMPLE_CAPTURE.projectTitle} — {EXAMPLE_CAPTURE.pageUrl} ·{" "}
            {EXAMPLE_CAPTURE.device} · version {EXAMPLE_CAPTURE.version}
          </figcaption>
        </figure>

        <div className="example-panel">
          <h3>Pin {selected.number}</h3>
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
                  {selected.element.rect.width} × {selected.element.rect.height} px natural
                </dd>
              </dl>
            </>
          ) : null}
          <h3>Pins on this capture</h3>
          <ol className="example-pins" aria-label="Example pins">
            {EXAMPLE_CAPTURE.pins.map((pin) => (
              <li
                key={pin.number}
                aria-current={pin.number === selected.number ? "true" : undefined}
              >
                Pin {pin.number} — at ({pin.tip.x}, {pin.tip.y})
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
