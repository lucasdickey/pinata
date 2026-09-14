// A decorative page, the same one the landing's static example draws, sized
// to any width. Aspect 1440 : 900 like a desktop capture. Painted with tokens
// only so it reads as part of the product, not a stock illustration.
import { THEME } from "../theme";

export function PageMock({ width, mobile = false }: { width: number; mobile?: boolean }) {
  const vbW = mobile ? 390 : 1440;
  const vbH = mobile ? 844 : 900;
  const height = (width * vbH) / vbW;
  const s = mobile ? 0.62 : 1;
  const cards = mobile
    ? [
        { x: 40, y: 400, w: 310, h: 120 },
        { x: 40, y: 540, w: 310, h: 120 },
        { x: 40, y: 680, w: 310, h: 120 },
      ]
    : [
        { x: 160, y: 470, w: 330, h: 300 },
        { x: 555, y: 470, w: 330, h: 300 },
        { x: 950, y: 470, w: 330, h: 300 },
      ];
  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={width}
      height={height}
      style={{
        display: "block",
        borderRadius: 14,
        border: `2px solid ${THEME.line}`,
        background: THEME.surface,
      }}
      aria-hidden="true"
    >
      <rect x={0} y={0} width={vbW} height={mobile ? 60 : 56} fill={THEME.line} />
      <rect x={30 * s} y={mobile ? 22 : 20} width={120 * s} height={16} rx={8} fill={THEME.inkSoft} />
      {!mobile ? (
        <>
          <rect x={1060} y={20} width={70} height={14} rx={7} fill={THEME.inkSoft} />
          <rect x={1150} y={20} width={70} height={14} rx={7} fill={THEME.inkSoft} />
          <rect x={1240} y={20} width={90} height={14} rx={7} fill={THEME.inkSoft} />
        </>
      ) : null}
      <rect
        x={mobile ? 30 : 160}
        y={mobile ? 110 : 130}
        width={mobile ? 300 : 620}
        height={mobile ? 28 : 36}
        rx={10}
        fill={THEME.ink}
      />
      <rect
        x={mobile ? 30 : 160}
        y={mobile ? 156 : 190}
        width={mobile ? 330 : 780}
        height={14}
        rx={7}
        fill={THEME.line}
      />
      <rect
        x={mobile ? 30 : 160}
        y={mobile ? 182 : 218}
        width={mobile ? 250 : 520}
        height={14}
        rx={7}
        fill={THEME.line}
      />
      {/* the billing toggle */}
      <rect
        x={mobile ? 100 : 392}
        y={mobile ? 260 : 386}
        width={176}
        height={44}
        rx={22}
        fill={THEME.accentSoft}
        stroke={THEME.accent}
        strokeWidth={2}
      />
      <rect x={mobile ? 106 : 398} y={mobile ? 266 : 392} width={80} height={32} rx={16} fill={THEME.accent} />
      {cards.map((c, i) => (
        <g key={i}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={16} fill={THEME.bg} stroke={THEME.line} strokeWidth={2} />
          <rect x={c.x + 24} y={c.y + 28} width={c.w * 0.4} height={16} rx={8} fill={THEME.ink} />
          <rect x={c.x + 24} y={c.y + 62} width={c.w * 0.25} height={12} rx={6} fill={THEME.inkSoft} />
          {!mobile ? (
            <>
              <rect x={c.x + 24} y={c.y + 110} width={c.w - 48} height={10} rx={5} fill={THEME.line} />
              <rect x={c.x + 24} y={c.y + 134} width={c.w - 80} height={10} rx={5} fill={THEME.line} />
              <rect x={c.x + 24} y={c.y + 158} width={c.w - 60} height={10} rx={5} fill={THEME.line} />
              <rect
                x={c.x + 24}
                y={c.y + 220}
                width={c.w - 48}
                height={44}
                rx={10}
                fill={i === 2 ? THEME.accent : THEME.line}
              />
            </>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
