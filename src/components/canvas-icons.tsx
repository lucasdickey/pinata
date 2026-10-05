// The canvas controls' icons (D111): inline SVG drawn on one 24-unit grid
// in the style of the drawer's chevron, stroked in the current text color
// so pressed (solid ink), hover, and both themes need no icon variants.
// Purely decorative: every button that carries one keeps its accessible
// name in aria-label.

export type CanvasIconName =
  | "rectangle"
  | "circle"
  | "arrow"
  | "zoom-in"
  | "zoom-out"
  | "caret-down"
  | "help"
  | "back"
  | "previous"
  | "next"
  | "close"
  | "panel-hide"
  | "panel-show"
  | "link"
  | "agent"
  | "copy";

const PATHS: Record<CanvasIconName, string> = {
  rectangle: "M4.5 6.5h15v11h-15z",
  circle: "M12 4.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z",
  arrow: "M5.5 18.5L18 6M10.5 6H18v7.5",
  "zoom-in": "M12 6v12M6 12h12",
  "zoom-out": "M6 12h12",
  "caret-down": "M8 10l4 4 4-4",
  help: "M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0-17zM9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.6M12 16.6v.1",
  back: "M15 5l-7 7 7 7",
  previous: "M6 15l6-6 6 6",
  next: "M6 9l6 6 6-6",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  "panel-hide": "M4.5 5.5h15v13h-15zM14.5 5.5v13M8 10l2 2-2 2",
  "panel-show": "M4.5 5.5h15v13h-15zM14.5 5.5v13M10 10l-2 2 2 2",
  // The project header's link controls (D122).
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  agent: "M4.5 5.5h15v13h-15zM8 10l2.5 2L8 14M12.5 14.5H16",
  copy: "M9 9h10v10H9zM15 9V5H5v10h4",
};

export function CanvasIcon({ name, size = 18 }: { name: CanvasIconName; size?: number }) {
  return (
    <svg
      className="canvas-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
