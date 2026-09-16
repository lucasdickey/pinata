"use client";

// The controlled React Flow canvas for one active ready capture
// (VAL-CANVAS-001/002/003/006/008).
//
// The capture is one immutable coordinate plane: a single fixed,
// unselectable screenshot parent node rendered at exactly the persisted
// document dimensions. The project/page/device/version navigation lives
// outside this canvas; only one plane is ever mounted, keyed by capture id,
// and camera state is remembered per capture for the session (in memory
// only) so switching planes never shares or transfers a camera.
//
// There are no interaction modes (D074). One number tells the two intents
// apart: PLACEMENT_SLOP_SCREEN_PX. A press on the screenshot that releases
// within it drops one transient draft pin at that natural pixel; a press
// that travels past it pans the camera. Saved pins drag by their badge in
// every state and commit exactly one revisioned write at drag end
// (onMovePin); a press on a saved pin that releases within the slop is a
// click and selects it instead, so a tap can never write. Drafts are local
// UI state — draggable with the pointer's grab offset preserved, clamped
// inclusively to the frame, cleared by Escape, and dropped on any capture
// switch (the keyed remount). The comment composer for a draft opens in a
// popover beside the badge: it is rendered outside the transformed plane
// and re-positioned from the draft's projected screen point on every pan
// and zoom, so it never leaves the visible frame.
//
// Region marks share the plane and the numbering: rectangles (D079) and
// circles (D082). A press that moves while Shift is held, or after one of
// the mark tools armed the next drag, draws a region from press to release
// in natural pixels, clamped to the frame; a release below MIN_SHAPE_SIZE_PX
// draws nothing. A circle is square-constrained: the drag's larger dimension
// sets its size, and it renders as an ellipse inscribed in that bounding
// square. The drawn region is the one draft (the same composer opens at its
// top-right corner, with candidates ranked by overlap with the bounding
// box), draggable and resizable before it is saved. Saved regions drag by
// their stroke or badge and resize by their handles — eight for a box, the
// four corners for a circle; each gesture commits exactly one revisioned
// geometry write at its end (onMoveRectangle / onMoveCircle), clamped to the
// frame and never below the minimum size. A click on a region's stroke or
// badge selects it; a click inside one lands on the screenshot and drops a
// pin as usual. The founder's read-only plane renders regions with no
// handles, no drag, and no tools.
//
// Arrows (D083) are the one mark with no area. An armed Arrow tool draws
// one: the press sets the tail and the release sets the head, and the head
// is what the mark is about, so the nearby-element context is taken from it
// and the badge rides at the tail instead. Selecting or moving an arrow is a
// distance-to-segment test at ARROW_HIT_TOLERANCE_CSS_PX rather than a box
// test: the shaft carries an invisible band that wide, so a click near but
// off the line falls through to the screenshot and drops a pin as usual.
// After a save each endpoint drags on its own and the shaft drags the whole
// arrow, each gesture committing exactly one revisioned write. The stroke
// and the head scale with the zoom so the arrow stays visible without the
// stored endpoints changing, and the founder sees it with no handles.
//
// Keyboard, on the canvas region when focus is not in a text field: J or
// ArrowDown selects the next saved mark, K or ArrowUp the previous, N drops
// a draft pin at the viewport center (clamped to the frame), and B, C, or A
// arms the box, circle, or arrow tool for the next drag. Escape cancels a
// draw in progress, then disarms the armed tool, then clears the draft.
// Inside the composer, Enter saves, Shift+Enter inserts a newline, Escape
// cancels.
//
// Camera state is local UI state only. The three named modes — entire
// capture (the initial contain view), fit width, and natural size — come
// from the pure math in src/lib/canvas/camera.ts, and pan/zoom gestures
// never issue annotation writes or touch browser history. Domain records
// stay canonical: nothing here reads or persists raw React Flow state.
//
// The stage is inert toward the captured site: it renders a static image
// from the authorized same-origin asset route, with no link, iframe, or
// handler that could navigate to the source.

import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { MIN_HIT_TARGET_CSS_PX } from "../lib/boundaries";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_PADDING_PX,
  centerCamera,
  clampCanvasZoom,
  containCamera,
  naturalCamera,
  widthFitCamera,
  type CanvasCamera,
  type NaturalPoint,
} from "../lib/canvas/camera";
import {
  clampNaturalPointToCapture,
  dragPinBox,
  pinHitBox,
  PLACEMENT_SLOP_SCREEN_PX,
  tipFromPinBox,
  type PinBox,
} from "../lib/canvas/geometry";
import {
  ARROW_TYPE,
  CAPTURE_FRAME_TYPE,
  CIRCLE_TYPE,
  CONTEXT_PREVIEW_TYPE,
  DRAFT_ARROW_TYPE,
  DRAFT_CIRCLE_TYPE,
  DRAFT_PIN_TYPE,
  DRAFT_RECTANGLE_TYPE,
  PIN_TYPE,
  RECTANGLE_TYPE,
  draftArrowNodeId,
  draftCircleNodeId,
  draftPinNodeId,
  draftRectangleNodeId,
  nodesForPlane,
  type ArrowNode,
  type CanvasArrow,
  type CanvasCircle,
  type CanvasPin,
  type CanvasRectangle,
  type CaptureFrameDomain,
  type CaptureFrameNode,
  type CircleNode,
  type ContextPreviewNode,
  type ContextRect,
  type DraftArrowNode,
  type DraftCircleNode,
  type DraftPinNode,
  type DraftRectangleNode,
  type PinNode,
  type RectangleNode,
} from "../lib/canvas/flow-model";
import {
  markCenter,
  markExtent,
  markKindNoun,
  marksEqual,
  type DraftMark,
} from "../lib/canvas/marks";
import {
  circleFromCorners,
  meetsMinimumCircleSize,
  moveCircle,
  resizeCircle,
  type CircleResizeHandle,
  type NaturalCircle,
} from "../lib/canvas/circle";
import {
  arrowFromPoints,
  dragArrowEndpoint,
  meetsMinimumArrowLength,
  translateArrow,
  type ArrowEndpoint,
  type NaturalArrow,
} from "../lib/canvas/arrow";
import { placePopover, popoverBounds, type ScreenSize } from "../lib/canvas/popover";
import {
  handleAnchor,
  handleCursor,
  meetsMinimumSize,
  moveRect,
  rectFromCorners,
  resizeRect,
  type NaturalRect,
  type ResizeHandle,
} from "../lib/canvas/rectangle";
import { PinComposer, type PinComposerProps } from "./pin-composer";

/**
 * The mark tools (D079, D082): each arms exactly the next drag and disarms
 * itself afterwards, so a tool is a one-gesture arming, never a mode you
 * live in (D074). Shift-drag stays the pointer shortcut for a box.
 */
export const MARK_TOOLS = [
  { id: "rectangle", label: "Draw a box", key: "b" },
  { id: "circle", label: "Draw a circle", key: "c" },
  { id: "arrow", label: "Draw an arrow", key: "a" },
] as const;

export type MarkTool = (typeof MARK_TOOLS)[number]["id"];

/** The named camera modes; "entire" is the initial view of every capture. */
export const CAMERA_MODES = [
  { id: "entire", label: "Entire page" },
  { id: "width", label: "Fit width" },
  { id: "natural", label: "Natural size" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];

/**
 * One plane's remembered camera: the transform, the named mode it came from,
 * and whether that mode still follows stage resizes. Session-local memory
 * keyed by capture id; never persisted, never shared between planes.
 */
export interface CaptureCameraState {
  camera: CanvasCamera;
  mode: CameraMode;
  follow: boolean;
}

/** The immutable screenshot frame: a natural-size image, nothing else. */
function CaptureFrame({ data }: NodeProps<CaptureFrameNode>) {
  return (
    // draggable={false} on the image itself suppresses the native image
    // drag ghost; a press-and-drag on the frame pans the camera instead.
    <img
      className="capture-frame-image"
      src={data.assetUrl}
      alt={data.name}
      width={data.width}
      height={data.height}
      draggable={false}
    />
  );
}

/**
 * The transient draft pin badge. The node box is the zoom-aware hit area;
 * the badge is anchored so the teardrop's tip lands exactly on the canonical
 * natural pixel (left/top are the in-box tip offsets, the transform puts the
 * element's bottom-center there, and the SVG path's tip is its bottom-center
 * point). The badge scales inversely with zoom through the box size, keeping
 * the shared minimum screen hit target without ever moving the tip.
 */
function DraftPin({ data }: NodeProps<DraftPinNode>) {
  return (
    <div
      className="pin-badge pin-badge-draft"
      data-testid="draft-pin-badge"
      style={{
        left: data.tipOffsetX,
        top: data.tipOffsetY,
        width: data.size,
        height: data.size,
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z" />
        <circle cx="12" cy="9" r="3.2" />
      </svg>
    </div>
  );
}

/**
 * A persisted numbered pin badge. Same anchoring as the draft: the box is
 * the zoom-aware hit area and the teardrop tip lands exactly on the
 * canonical natural pixel. The number rides in the bulb at a size derived
 * from the box, so badges stay screen-readable from overview to 8x while
 * the tip never moves. The badge itself is click-transparent; presses land
 * on the React Flow node wrapper (drag, or select via onNodeClick).
 */
function Pin({ data }: NodeProps<PinNode>) {
  return (
    <div
      className="pin-badge pin-badge-saved"
      data-testid="pin-badge"
      data-pin-number={data.number}
      data-selected={data.selected ? "true" : undefined}
      style={{
        left: data.tipOffsetX,
        top: data.tipOffsetY,
        width: data.size,
        height: data.size,
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z" />
      </svg>
      <span className="pin-badge-number" style={{ fontSize: data.size * 0.38 }} aria-hidden="true">
        {data.number}
      </span>
    </div>
  );
}

/**
 * The transient nearby-candidate highlight: a bare box at exactly the
 * candidate's persisted natural-pixel rect, parented to the frame so the
 * plane's own transform keeps it aligned at every zoom. Pure decoration —
 * it ignores the pointer, is hidden from assistive tech (the composer's
 * candidate list is the accessible surface), and never persists.
 */
function ContextPreview(_: NodeProps<ContextPreviewNode>) {
  return <div className="context-preview" data-testid="context-preview" aria-hidden="true" />;
}

/**
 * What a region's resize handle reports when pressed. The node component
 * cannot see the canvas state, so the canvas provides this through context
 * and owns the whole gesture (window pointer listeners, the pure resize
 * math, and the single commit at release). The canvas looks the region's
 * starting geometry up itself, so nothing geometric crosses this boundary.
 */
interface RegionGestures {
  beginResize: (
    target: { draft: true } | { draft: false; id: string },
    handle: string,
    pointer: { x: number; y: number },
  ) => void;
  /** The same for one of an arrow's two endpoints (D083). */
  beginEndpoint: (
    target: { draft: true } | { draft: false; id: string },
    endpoint: ArrowEndpoint,
    pointer: { x: number; y: number },
  ) => void;
}

const RegionGestureContext = createContext<RegionGestures | null>(null);

/**
 * One region mark, saved or draft: a box (D079) or the ellipse inscribed in
 * a circle's bounding square (D082). The node wrapper is pointer-transparent
 * (see rectangleNode); the parts that take the pointer are the stroke (a
 * wide invisible grab stroke over the visible one, so dragging the edge
 * moves the mark), the number badge at the bounding box's top-left corner,
 * and — on an editable plane — the resize handles the kind offers: eight for
 * a box, the four corners for a circle, whose square constraint makes one
 * drag govern both dimensions. The handles carry React Flow's `nodrag` class
 * so a press on one resizes instead of starting a node drag. Every size is
 * derived from the zoom so the chrome stays the same on screen while the
 * geometry stays exact.
 */
function RegionMark({
  data,
}: NodeProps<RectangleNode | DraftRectangleNode | CircleNode | DraftCircleNode>) {
  const gestures = useContext(RegionGestureContext);
  const dash = data.draft ? `${data.strokeWidth * 4} ${data.strokeWidth * 3}` : undefined;
  const round = data.shape === "circle";
  // One helper for both outlines: the grab stroke and the visible stroke
  // differ only in class and width, and a circle swaps the rect for an
  // ellipse inscribed in the very same box.
  const outline = (className: string, testId: string | undefined, strokeWidth: number) =>
    round ? (
      <ellipse
        className={className}
        data-testid={testId}
        cx="50%"
        cy="50%"
        rx="50%"
        ry="50%"
        strokeWidth={strokeWidth}
        strokeDasharray={className.endsWith("stroke") ? dash : undefined}
      />
    ) : (
      <rect
        className={className}
        data-testid={testId}
        x={0}
        y={0}
        width="100%"
        height="100%"
        strokeWidth={strokeWidth}
        strokeDasharray={className.endsWith("stroke") ? dash : undefined}
      />
    );
  return (
    <div
      className={`mark-rectangle${data.draft ? " mark-rectangle-draft" : ""}`}
      data-testid={data.draft ? `draft-${data.shape}` : data.shape}
      data-shape={data.shape}
      data-mark-number={data.number ?? undefined}
      data-selected={data.selected ? "true" : undefined}
      data-drawing={data.drawing ? "true" : undefined}
    >
      <svg className="mark-rectangle-svg" aria-hidden="true" focusable="false">
        {data.drawing
          ? null
          : outline("mark-rectangle-grab", `${data.shape}-edge`, data.grabWidth)}
        {outline("mark-rectangle-stroke", undefined, data.strokeWidth)}
      </svg>
      {data.drawing ? null : (
        <div
          className={`pin-badge ${data.draft ? "pin-badge-draft" : "pin-badge-saved"} mark-rectangle-badge`}
          data-testid={data.draft ? `draft-${data.shape}-badge` : `${data.shape}-badge`}
          data-mark-number={data.number ?? undefined}
          data-selected={data.selected ? "true" : undefined}
          style={{ left: 0, top: 0, width: data.badgeSize, height: data.badgeSize }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z" />
            {data.draft ? <circle cx="12" cy="9" r="3.2" /> : null}
          </svg>
          {data.number === null ? null : (
            <span
              className="pin-badge-number"
              style={{ fontSize: data.badgeSize * 0.38 }}
              aria-hidden="true"
            >
              {data.number}
            </span>
          )}
        </div>
      )}
      {data.handles && gestures
        ? data.handleNames.map((handle) => {
            const anchor = handleAnchor(handle as ResizeHandle);
            return (
              <div
                key={handle}
                className="nodrag nopan mark-rectangle-handle"
                data-testid={`${data.shape}-handle`}
                data-handle={handle}
                aria-hidden="true"
                style={{
                  left: anchor.x * data.rectWidth - data.handleSize / 2,
                  top: anchor.y * data.rectHeight - data.handleSize / 2,
                  width: data.handleSize,
                  height: data.handleSize,
                  cursor: handleCursor(handle as ResizeHandle),
                }}
                onPointerDown={(event) => {
                  // Only the primary pointer resizes, and the press is the
                  // handle's alone: the wrapper must not read it as a click.
                  if (event.isPrimary === false || event.button > 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  gestures.beginResize(
                    data.draft ? { draft: true } : { draft: false, id: data.annotationId },
                    handle,
                    { x: event.clientX, y: event.clientY },
                  );
                }}
              >
                <span
                  className="mark-rectangle-handle-dot"
                  style={{ width: data.handleDotSize, height: data.handleDotSize }}
                />
              </div>
            );
          })
        : null}
    </div>
  );
}

/**
 * One arrow, saved or draft (D083). The node wrapper is pointer-transparent;
 * what takes the pointer is a wide invisible band along the shaft (so
 * selecting and moving an arrow is a distance-to-segment test at the
 * published tolerance, not a box test), the number badge at the tail, and —
 * on an editable plane — the two endpoint handles. The head is a filled
 * triangle at `end`, rotated to the shaft; its size and the stroke width are
 * derived from the zoom, so the arrow stays visible at any camera without
 * the stored endpoints changing. The badge rides at the tail so it never
 * covers what the arrow points at.
 */
function ArrowMark({ data }: NodeProps<ArrowNode | DraftArrowNode>) {
  const gestures = useContext(RegionGestureContext);
  const dx = data.localEndX - data.localStartX;
  const dy = data.localEndY - data.localStartY;
  const length = Math.hypot(dx, dy);
  const unit = length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const normal = { x: -unit.y, y: unit.x };
  const head = data.headLength;
  // The shaft stops at the head's base so the line never shows through the
  // triangle's point.
  const base = {
    x: data.localEndX - unit.x * head,
    y: data.localEndY - unit.y * head,
  };
  const wing = head * 0.45;
  const points = [
    `${data.localEndX},${data.localEndY}`,
    `${base.x + normal.x * wing},${base.y + normal.y * wing}`,
    `${base.x - normal.x * wing},${base.y - normal.y * wing}`,
  ].join(" ");
  const dash = data.draft ? `${data.strokeWidth * 3} ${data.strokeWidth * 2}` : undefined;
  const endpoints: { name: ArrowEndpoint; x: number; y: number }[] = [
    { name: "start", x: data.localStartX, y: data.localStartY },
    { name: "end", x: data.localEndX, y: data.localEndY },
  ];
  return (
    <div
      className={`mark-arrow${data.draft ? " mark-arrow-draft" : ""}`}
      data-testid={data.draft ? "draft-arrow" : "arrow"}
      data-mark-number={data.number ?? undefined}
      data-selected={data.selected ? "true" : undefined}
      data-drawing={data.drawing ? "true" : undefined}
    >
      <svg className="mark-arrow-svg" aria-hidden="true" focusable="false">
        {data.drawing ? null : (
          <line
            className="mark-arrow-grab"
            data-testid="arrow-shaft"
            x1={data.localStartX}
            y1={data.localStartY}
            x2={data.localEndX}
            y2={data.localEndY}
            strokeWidth={data.grabWidth}
          />
        )}
        <line
          className="mark-arrow-stroke"
          x1={data.localStartX}
          y1={data.localStartY}
          x2={length > head ? base.x : data.localEndX}
          y2={length > head ? base.y : data.localEndY}
          strokeWidth={data.strokeWidth}
          strokeDasharray={dash}
        />
        <polygon className="mark-arrow-head" data-testid="arrow-head" points={points} />
      </svg>
      {data.drawing ? null : (
        <div
          className={`pin-badge ${data.draft ? "pin-badge-draft" : "pin-badge-saved"} mark-arrow-badge`}
          data-testid={data.draft ? "draft-arrow-badge" : "arrow-badge"}
          data-mark-number={data.number ?? undefined}
          data-selected={data.selected ? "true" : undefined}
          // The badge sits at the tail, never at the head: it must not cover
          // the thing the arrow is pointing at.
          style={{
            left: data.localStartX,
            top: data.localStartY,
            width: data.badgeSize,
            height: data.badgeSize,
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z" />
            {data.draft ? <circle cx="12" cy="9" r="3.2" /> : null}
          </svg>
          {data.number === null ? null : (
            <span
              className="pin-badge-number"
              style={{ fontSize: data.badgeSize * 0.38 }}
              aria-hidden="true"
            >
              {data.number}
            </span>
          )}
        </div>
      )}
      {data.handles && gestures
        ? endpoints.map((endpoint) => (
            <div
              key={endpoint.name}
              className="nodrag nopan mark-rectangle-handle"
              data-testid="arrow-handle"
              data-endpoint={endpoint.name}
              aria-hidden="true"
              style={{
                left: endpoint.x - data.handleSize / 2,
                top: endpoint.y - data.handleSize / 2,
                width: data.handleSize,
                height: data.handleSize,
                cursor: "move",
              }}
              onPointerDown={(event) => {
                if (event.isPrimary === false || event.button > 0) return;
                event.stopPropagation();
                event.preventDefault();
                gestures.beginEndpoint(
                  data.draft ? { draft: true } : { draft: false, id: data.annotationId },
                  endpoint.name,
                  { x: event.clientX, y: event.clientY },
                );
              }}
            >
              <span
                className="mark-rectangle-handle-dot"
                style={{ width: data.handleDotSize, height: data.handleDotSize }}
              />
            </div>
          ))
        : null}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  [CAPTURE_FRAME_TYPE]: CaptureFrame,
  [PIN_TYPE]: Pin,
  [DRAFT_PIN_TYPE]: DraftPin,
  [CONTEXT_PREVIEW_TYPE]: ContextPreview,
  [RECTANGLE_TYPE]: RegionMark,
  [DRAFT_RECTANGLE_TYPE]: RegionMark,
  [CIRCLE_TYPE]: RegionMark,
  [DRAFT_CIRCLE_TYPE]: RegionMark,
  [ARROW_TYPE]: ArrowMark,
  [DRAFT_ARROW_TYPE]: ArrowMark,
};

/** The node types a persisted region mark uses. */
const REGION_TYPES: readonly string[] = [RECTANGLE_TYPE, CIRCLE_TYPE];

/** Every persisted mark that is not a pin: regions and arrows alike. */
const SHAPE_TYPES: readonly string[] = [...REGION_TYPES, ARROW_TYPE];

/** Every draft node type, for the drag-end branch that only re-settles. */
const DRAFT_TYPES: readonly string[] = [
  DRAFT_PIN_TYPE,
  DRAFT_RECTANGLE_TYPE,
  DRAFT_CIRCLE_TYPE,
  DRAFT_ARROW_TYPE,
];

/** Live zoom percentage, kept inside the provider so it tracks gestures. */
function ZoomReadout() {
  const { zoom } = useViewport();
  return (
    <output className="capture-zoom" aria-label="Current zoom">
      {Math.round(zoom * 100)}%
    </output>
  );
}

/** True when a key event came from somewhere text is being entered. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** The popover's size before it has been measured. */
const COMPOSER_SIZE_GUESS: ScreenSize = { width: 320, height: 240 };

/**
 * The screen-fixed popover the draft composer lives in. It is a sibling of
 * the transformed plane, not a child: the draft's anchor (a pin's tip, or a
 * box's top-right corner) is projected to client coordinates on every
 * camera change (useViewport re-renders this on each pan and zoom frame),
 * on window scroll, and on resize, and the pure placement math flips or
 * clamps the box so it stays inside the visible part of the canvas frame
 * (or, when that is too small, the browser viewport).
 */
function DraftComposerPopover({
  draft,
  frameRef,
  children,
}: {
  draft: DraftMark;
  frameRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const instance = useReactFlow();
  // Subscribing to the viewport is what re-positions the popover on pan
  // and zoom; the values themselves come from flowToScreenPosition below.
  useViewport();
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ScreenSize>(COMPOSER_SIZE_GUESS);
  const [, setLayoutTick] = useState(0);

  useEffect(() => {
    const bump = () => setLayoutTick((value) => value + 1);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, []);

  // Measure the rendered box so the clamp uses its real size; the guess
  // above only covers the first paint.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
      setSize({ width, height });
    }
  });

  // A pin anchors at its tip with the badge rising above it; a region
  // anchors at its bounding box's top-right corner with nothing to clear.
  const extent = markExtent(draft);
  const anchorNatural =
    draft.kind === "pin" || !extent ? markCenter(draft) : { x: extent.x + extent.width, y: extent.y };
  const anchor = instance.flowToScreenPosition(anchorNatural);
  const frame = frameRef.current?.getBoundingClientRect();
  const viewport = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  const bounds = popoverBounds(
    frame
      ? { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom }
      : viewport,
    viewport,
    size,
  );
  const badge = draft.kind === "pin" ? Math.min(MIN_HIT_TARGET_CSS_PX, size.height) : 0;
  const placed = placePopover({ anchor, badge, size, bounds });

  return (
    <div
      ref={ref}
      className="pin-composer"
      role="dialog"
      aria-label={`New ${markKindNoun(draft.kind)}`}
      data-testid="pin-composer"
      data-side={placed.side}
      data-draft-kind={draft.kind}
      style={{ left: placed.left, top: placed.top }}
    >
      {children}
    </div>
  );
}

/** A pointer gesture the canvas owns from press to release. */
type Gesture =
  | { type: "draw"; tool: MarkTool; start: NaturalPoint }
  | {
      type: "resize";
      target: { draft: true } | { draft: false; id: string };
      handle: string;
      /** The region as it was when the press landed: a box or a circle. */
      startMark: DraftMark;
      startPointer: NaturalPoint;
    }
  | {
      type: "endpoint";
      target: { draft: true } | { draft: false; id: string };
      endpoint: ArrowEndpoint;
      /** The arrow as it was when the press landed. */
      startArrow: NaturalArrow;
      startPointer: NaturalPoint;
    };

/** The mark a draw produces between press and release, in the tool's shape. */
function drawnMark(
  tool: MarkTool,
  start: NaturalPoint,
  end: NaturalPoint,
  doc: { width: number; height: number },
): DraftMark {
  if (tool === "circle") return { kind: "circle", circle: circleFromCorners(start, end, doc) };
  // An arrow is drawn, not bounded: the press sets the tail and the release
  // sets the head, and they are never reordered.
  if (tool === "arrow") return { kind: "arrow", arrow: arrowFromPoints(start, end, doc) };
  return { kind: "rectangle", rect: rectFromCorners(start, end, doc) };
}

/** Whether a drawn mark reaches its kind's published minimum. */
function drawnMarkIsBigEnough(mark: DraftMark): boolean {
  if (mark.kind === "rectangle") return meetsMinimumSize(mark.rect);
  if (mark.kind === "circle") return meetsMinimumCircleSize(mark.circle);
  if (mark.kind === "arrow") return meetsMinimumArrowLength(mark.arrow);
  return false;
}

/** One region resized by dragging a handle, in its own shape's math. */
function resizedRegion(
  start: DraftMark,
  handle: string,
  delta: NaturalPoint,
  doc: { width: number; height: number },
): DraftMark | null {
  if (start.kind === "rectangle") {
    return { kind: "rectangle", rect: resizeRect(start.rect, handle as ResizeHandle, delta, doc) };
  }
  if (start.kind === "circle") {
    return {
      kind: "circle",
      circle: resizeCircle(start.circle, handle as CircleResizeHandle, delta, doc),
    };
  }
  return null;
}

/**
 * The point a saved mark's drag is measured from, so drag end can tell a
 * click from a move: a region's bounding corner, an arrow's tail.
 */
function markDragAnchor(mark: DraftMark): NaturalPoint | null {
  if (mark.kind === "arrow") return mark.arrow.start;
  const extent = markExtent(mark);
  return extent ? { x: extent.x, y: extent.y } : null;
}

/** One region moved so its bounding box's corner lands at `position`. */
function movedRegion(
  mark: DraftMark,
  position: NaturalPoint,
  doc: { width: number; height: number },
): DraftMark | null {
  if (mark.kind === "rectangle") {
    return { kind: "rectangle", rect: moveRect(mark.rect, position, doc) };
  }
  if (mark.kind === "circle") {
    return { kind: "circle", circle: moveCircle(mark.circle, position, doc) };
  }
  return null;
}

function CaptureCanvasInner({
  domain,
  regionName,
  readOnly,
  pins,
  rectangles,
  circles,
  arrows,
  previewRect,
  selectedPinId,
  onSelectPin,
  onMovePin,
  onMoveRectangle,
  onMoveCircle,
  onMoveArrow,
  savedCamera,
  onCameraChange,
  onDraftChange,
  onDraftSettled,
  draftResetSignal,
  composer,
  onStepPin,
  autoFocus,
  revealSelected,
}: {
  domain: CaptureFrameDomain;
  regionName: string;
  /**
   * The founder's read/reply-only plane: no drafts, no pin dragging, no
   * composer, and no keyboard shortcuts that could create or move a mark.
   * Pan, zoom, and selecting a saved pin to read its thread still work.
   * Defaults to the editor's full behavior.
   */
  readOnly: boolean;
  /** This plane's persisted pins (server is canonical; never RF state). */
  pins: Omit<CanvasPin, "selected">[];
  /** This plane's persisted rectangles (D079), same numbering as the pins. */
  rectangles: Omit<CanvasRectangle, "selected">[];
  /** This plane's persisted circles (D082), same numbering again. */
  circles: Omit<CanvasCircle, "selected">[];
  /** This plane's persisted arrows (D083), same numbering again. */
  arrows: Omit<CanvasArrow, "selected">[];
  /**
   * The transient nearby-candidate highlight: one manifest rectangle in
   * natural pixels, or null. Local UI state only — never persisted, never
   * an annotation.
   */
  previewRect?: ContextRect | null;
  selectedPinId?: string | null;
  onSelectPin?: (annotationId: string | null) => void;
  /** The single commit at the end of a pin drag: one clamped tip, one write. */
  onMovePin?: (annotationId: string, tip: NaturalPoint) => void;
  /**
   * The single commit at the end of a rectangle move or resize: one clamped
   * box of at least the minimum size, one write.
   */
  onMoveRectangle?: (annotationId: string, rect: NaturalRect) => void;
  /** The same single commit for a circle move or resize (D082). */
  onMoveCircle?: (annotationId: string, circle: NaturalCircle) => void;
  /**
   * The same single commit for an arrow moved by its shaft or by one of its
   * endpoints (D083): one clamped arrow of at least the minimum length.
   */
  onMoveArrow?: (annotationId: string, arrow: NaturalArrow) => void;
  savedCamera?: CaptureCameraState | null;
  onCameraChange?: (state: CaptureCameraState) => void;
  onDraftChange?: (draft: DraftMark | null) => void;
  /**
   * Fires only when a draft's geometry is final for now — the placement
   * click, the N shortcut, the end of a draw, and the end of a draft drag
   * or resize — so the workspace can resolve nearby context once per
   * gesture instead of per frame. Never a write.
   */
  onDraftSettled?: (draft: DraftMark) => void;
  /** Increments when a draft was saved; the canvas drops the unsaved draft. */
  draftResetSignal?: number;
  /** The draft composer's state and callbacks; shown beside the draft. */
  composer?: PinComposerProps | null;
  /**
   * Project-wide stepping (D077): when given, J/K and the arrow keys hand
   * the direction to the workspace, which steps through every pin in the
   * project and switches plane as needed, instead of wrapping inside this
   * plane. Without it the shortcuts step through this plane's pins alone.
   */
  onStepPin?: (direction: 1 | -1) => void;
  /**
   * Focus the canvas region as soon as it mounts, so a keyboard step that
   * landed on another plane keeps the keyboard in the new plane (D077).
   */
  autoFocus?: boolean;
  /**
   * Increments to bring the selected mark into the middle of the frame
   * (D078): the founder's list does this on a tap, so on a phone the
   * screenshot opens on the note that was chosen. The zoom is kept, except
   * that a box wider or taller than the frame zooms out just enough to fit.
   */
  revealSelected?: number;
}) {
  const instance = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // A plane opened by a keyboard step takes focus once, on mount, so the
  // next J or K keeps stepping without a click (D077).
  useEffect(() => {
    if (autoFocus && !readOnly) wrapperRef.current?.focus({ preventScroll: true });
    // Mount only: focus is handed over once, never re-stolen on re-render.
  }, []);
  const doc = useMemo(() => ({ width: domain.width, height: domain.height }), [domain]);
  // The canonical draft state is one mark in screenshot-natural pixels: a
  // pin tip or a rectangle. The node array is a disposable view derived
  // from it; the hit-box sizes of drafts and persisted marks follow the
  // live zoom, tracked on every camera change so badges and handles stay
  // screen-sized without their geometry moving.
  const [draft, setDraft] = useState<DraftMark | null>(null);
  const [liveZoom, setLiveZoom] = useState(1);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const liveZoomRef = useRef(liveZoom);
  liveZoomRef.current = liveZoom;
  // A persisted pin being dragged: movement is local state, re-derived
  // through the pure clamping adapter; the commit at drag end is one write.
  // The ref mirrors the latest tip synchronously so drag end can read it
  // without going through a state updater.
  const [pinDrag, setPinDrag] = useState<{ id: string; tip: NaturalPoint } | null>(null);
  const pinDragRef = useRef<{ id: string; tip: NaturalPoint } | null>(null);
  // A persisted region (a box or a circle) being moved or resized, the same
  // way: local movement, one write at the end of the gesture.
  const [regionDrag, setRegionDrag] = useState<{ id: string; mark: DraftMark } | null>(null);
  const regionDragRef = useRef<{ id: string; mark: DraftMark } | null>(null);
  // The region being drawn right now: the tool, the press point, and the
  // current pointer point, both clamped to the frame. Rendered as the draft
  // without handles.
  const [drawing, setDrawing] = useState<{
    tool: MarkTool;
    start: NaturalPoint;
    current: NaturalPoint;
  } | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  // The armed mark tool: it arms exactly the next drag, then disarms itself.
  const [armed, setArmed] = useState<MarkTool | null>(null);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  // The gesture in flight (a draw or a resize) and a state mirror that
  // mounts the window listeners for it.
  const gestureRef = useRef<Gesture | null>(null);
  const [gestureActive, setGestureActive] = useState(false);

  const effectivePins = useMemo<CanvasPin[]>(
    () =>
      pins.map((pin) => ({
        ...pin,
        tip: pinDrag?.id === pin.id ? pinDrag.tip : pin.tip,
        selected: pin.id === selectedPinId,
      })),
    [pins, pinDrag, selectedPinId],
  );
  const effectiveRectangles = useMemo<CanvasRectangle[]>(
    () =>
      rectangles.map((rectangle) => {
        const dragged = regionDrag?.id === rectangle.id ? regionDrag.mark : null;
        return {
          ...rectangle,
          rect: dragged?.kind === "rectangle" ? dragged.rect : rectangle.rect,
          selected: rectangle.id === selectedPinId,
        };
      }),
    [rectangles, regionDrag, selectedPinId],
  );
  const effectiveCircles = useMemo<CanvasCircle[]>(
    () =>
      circles.map((entry) => {
        const dragged = regionDrag?.id === entry.id ? regionDrag.mark : null;
        return {
          ...entry,
          circle: dragged?.kind === "circle" ? dragged.circle : entry.circle,
          selected: entry.id === selectedPinId,
        };
      }),
    [circles, regionDrag, selectedPinId],
  );
  const effectiveArrows = useMemo<CanvasArrow[]>(
    () =>
      arrows.map((entry) => {
        const dragged = regionDrag?.id === entry.id ? regionDrag.mark : null;
        return {
          ...entry,
          arrow: dragged?.kind === "arrow" ? dragged.arrow : entry.arrow,
          selected: entry.id === selectedPinId,
        };
      }),
    [arrows, regionDrag, selectedPinId],
  );
  /** Every persisted region by id, in the draft shape the gestures use. */
  const regionById = useMemo(() => {
    const map = new Map<string, DraftMark>();
    for (const rectangle of rectangles) map.set(rectangle.id, { kind: "rectangle", rect: rectangle.rect });
    for (const entry of circles) map.set(entry.id, { kind: "circle", circle: entry.circle });
    return map;
  }, [rectangles, circles]);
  /** Every persisted mark that is not a pin, including arrows. */
  const shapeById = useMemo(() => {
    const map = new Map<string, DraftMark>(regionById);
    for (const entry of arrows) map.set(entry.id, { kind: "arrow", arrow: entry.arrow });
    return map;
  }, [regionById, arrows]);
  const nodes = useMemo(() => {
    // While a region is being drawn it stands in for the draft; a release
    // below the minimum size brings the previous draft back untouched.
    const inFlight = drawing ? drawnMark(drawing.tool, drawing.start, drawing.current, doc) : null;
    const built = nodesForPlane(domain, {
      pins: effectivePins,
      rectangles: effectiveRectangles,
      circles: effectiveCircles,
      arrows: effectiveArrows,
      draft: inFlight ?? draft,
      drawing: drawing !== null,
      zoom: liveZoom,
      preview: previewRect ?? null,
      readOnly,
    });
    // The adapter marks pins draggable; only a read-only plane turns that
    // off. There is no mode that could.
    if (!readOnly) return built;
    return built.map((node) => (node.type === PIN_TYPE ? { ...node, draggable: false } : node));
  }, [
    domain,
    doc,
    effectivePins,
    effectiveRectangles,
    effectiveCircles,
    effectiveArrows,
    draft,
    drawing,
    liveZoom,
    previewRect,
    readOnly,
  ]);

  const [mode, setMode] = useState<CameraMode>("entire");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // While true, the active named mode re-applies when the stage resizes.
  // Any user pan/zoom gesture ends the follow; picking a mode resumes it.
  const autoFollow = useRef(true);
  // setViewport is a no-op until React Flow's pane machinery has mounted;
  // onInit is the reliable signal that camera writes will land.
  const initialized = useRef(false);
  // This plane's remembered camera, captured once at mount (the parent keys
  // the canvas by capture id, so a mount is always one plane).
  const restored = useRef(savedCamera ?? null);
  // The last camera this plane set or was told about: what a reveal below
  // keeps the zoom of.
  const cameraRef = useRef<CanvasCamera | null>(savedCamera?.camera ?? null);

  const reportCamera = useCallback(
    (camera: CanvasCamera) => {
      cameraRef.current = { x: camera.x, y: camera.y, zoom: camera.zoom };
      onCameraChange?.({ camera, mode: modeRef.current, follow: autoFollow.current });
    },
    [onCameraChange],
  );

  const applyMode = useCallback(
    (next: CameraMode) => {
      const wrapper = wrapperRef.current;
      // A hidden or unmeasured stage (zero size) has no meaningful camera.
      if (!wrapper || wrapper.clientWidth <= 0 || wrapper.clientHeight <= 0) return;
      const viewport = { width: wrapper.clientWidth, height: wrapper.clientHeight };
      const camera =
        next === "entire"
          ? containCamera(viewport, doc)
          : next === "width"
            ? widthFitCamera(viewport, doc)
            : naturalCamera(viewport, doc);
      setMode(next);
      autoFollow.current = true;
      void instance.setViewport({ x: camera.x, y: camera.y, zoom: camera.zoom });
      reportCamera(camera);
    },
    [instance, doc, reportCamera],
  );

  // Initial camera and resize tracking: onInit restores this plane's
  // remembered camera when one exists, otherwise applies the entire-capture
  // view as soon as the pane can accept it. The observer re-applies the
  // active mode on later resizes until the user takes the camera over with
  // a gesture.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (initialized.current && autoFollow.current) applyMode(modeRef.current);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [applyMode]);

  // Report the draft to the workspace (and clear it there) whenever it
  // changes; the workspace owns the comment, the key, and the save. The
  // initial null mount is not a change and is never reported.
  const draftReported = useRef(false);
  useEffect(() => {
    if (!draftReported.current) {
      draftReported.current = true;
      if (draft === null) return;
    }
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  // When a draft closes (saved, cancelled, escaped) the composer's textarea
  // unmounts and focus would fall to the document body; hand it back to the
  // canvas region so the keyboard shortcuts keep working.
  const hadDraft = useRef(false);
  useEffect(() => {
    const had = hadDraft.current;
    hadDraft.current = draft !== null;
    if (had && draft === null && document.activeElement === document.body) {
      wrapperRef.current?.focus({ preventScroll: true });
    }
  }, [draft]);

  // A successful save clears the unsaved draft from the canvas: the parent
  // increments the reset signal and this plane drops its transient mark.
  // The report effect above then announces the null draft as usual.
  const lastDraftReset = useRef(draftResetSignal ?? 0);
  useEffect(() => {
    const signal = draftResetSignal ?? 0;
    if (signal !== lastDraftReset.current) {
      lastDraftReset.current = signal;
      setDraft(null);
    }
  }, [draftResetSignal]);

  /** The natural pixel under a client point, or null off the plane math. */
  const naturalAt = useCallback(
    (point: { x: number; y: number }): NaturalPoint | null => {
      const natural = instance.screenToFlowPosition(point);
      return Number.isFinite(natural.x) && Number.isFinite(natural.y) ? natural : null;
    },
    [instance],
  );

  /** Track the live zoom right after a gesture so new chrome is sized. */
  const syncZoom = useCallback(() => {
    const zoom = instance.getViewport().zoom;
    liveZoomRef.current = zoom;
    setLiveZoom(zoom);
  }, [instance]);

  /**
   * Bring the selected mark into the middle of the frame (D078): a pin's
   * tip or a region's middle, at the zoom the reader already has, except
   * that a region that would not fit zooms out until it does. A deliberate
   * camera move like a gesture, so it ends any named mode's resize-follow.
   */
  const revealSelection = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || wrapper.clientWidth <= 0 || wrapper.clientHeight <= 0) return;
    const pin = pins.find((candidate) => candidate.id === selectedPinId);
    const mark: DraftMark | null = pin
      ? { kind: "pin", tip: pin.tip }
      : selectedPinId
        ? (shapeById.get(selectedPinId) ?? null)
        : null;
    if (!mark) return;
    const viewport = { width: wrapper.clientWidth, height: wrapper.clientHeight };
    let zoom = cameraRef.current?.zoom ?? instance.getViewport().zoom;
    const extent = markExtent(mark);
    if (extent) {
      const fit = Math.min(
        (viewport.width - 2 * CANVAS_PADDING_PX) / extent.width,
        (viewport.height - 2 * CANVAS_PADDING_PX) / extent.height,
      );
      if (Number.isFinite(fit) && fit > 0) zoom = Math.min(zoom, fit);
    }
    const camera = centerCamera(viewport, markCenter(mark), zoom);
    autoFollow.current = false;
    void instance.setViewport(camera);
    liveZoomRef.current = camera.zoom;
    setLiveZoom(camera.zoom);
    reportCamera(camera);
  }, [instance, pins, shapeById, selectedPinId, reportCamera]);

  // Each increment of the signal reveals the selection once; a signal that
  // arrives before React Flow's pane is ready waits for onInit.
  const lastReveal = useRef(revealSelected ?? 0);
  const pendingReveal = useRef(false);
  useEffect(() => {
    const signal = revealSelected ?? 0;
    if (signal === lastReveal.current) return;
    lastReveal.current = signal;
    if (!initialized.current) {
      pendingReveal.current = true;
      return;
    }
    revealSelection();
  }, [revealSelected, revealSelection]);

  /** Abandon the gesture in flight without writing or drafting anything. */
  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setGestureActive(false);
    setDrawing(null);
    if (gesture?.type === "resize" && !gesture.target.draft) {
      regionDragRef.current = null;
      setRegionDrag(null);
    }
    if (gesture?.type === "resize" && gesture.target.draft) {
      setDraft((current) => (current?.kind === gesture.startMark.kind ? gesture.startMark : current));
    }
    if (gesture?.type === "endpoint") {
      if (gesture.target.draft) {
        setDraft((current) =>
          current?.kind === "arrow" ? { kind: "arrow", arrow: gesture.startArrow } : current,
        );
      } else {
        regionDragRef.current = null;
        setRegionDrag(null);
      }
    }
  }, []);

  // Escape, in order of what is most transient: a draw or resize in flight
  // is abandoned; then an armed box toggle is disarmed; then the draft is
  // cleared. It never fires while typing in an editable element (the
  // composer handles its own Escape and stops it here), and it never
  // touches persisted state.
  useEffect(() => {
    if (!draft && !armed && !gestureActive) return;
    const onKey = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isTextEntry(event.target)) return;
      if (gestureRef.current) {
        cancelGesture();
        setArmed(null);
        return;
      }
      if (armedRef.current) {
        setArmed(null);
        return;
      }
      setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, armed, gestureActive, cancelGesture]);

  // A press that will draw must not also pan the camera or start a node
  // drag. Both of those begin on the native mousedown/touchstart that React
  // Flow's d3 handlers listen for on the pane and the nodes, so a capture
  // listener on the wrapper (an ancestor) stops that event before it
  // reaches them. The pointer events the draw itself uses are unaffected.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || readOnly) return;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0 && (event.shiftKey || armedRef.current !== null)) {
        event.stopPropagation();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      if (armedRef.current !== null) event.stopPropagation();
    };
    wrapper.addEventListener("mousedown", onMouseDown, true);
    wrapper.addEventListener("touchstart", onTouchStart, true);
    return () => {
      wrapper.removeEventListener("mousedown", onMouseDown, true);
      wrapper.removeEventListener("touchstart", onTouchStart, true);
    };
  }, [readOnly]);

  /** The one revisioned write a finished region gesture commits, by kind. */
  const commitRegion = useCallback(
    (annotationId: string, mark: DraftMark) => {
      if (mark.kind === "rectangle") onMoveRectangle?.(annotationId, mark.rect);
      else if (mark.kind === "circle") onMoveCircle?.(annotationId, mark.circle);
      else if (mark.kind === "arrow") onMoveArrow?.(annotationId, mark.arrow);
    },
    [onMoveRectangle, onMoveCircle, onMoveArrow],
  );

  // The window listeners for a gesture in flight: movement updates local
  // state through the pure geometry; the release is the one moment anything
  // settles (a draft for a draw, a context re-query for a draft resize, one
  // revisioned write for a saved region's resize). Attached in a layout effect, not
  // a passive one, so they are in place before the browser can dispatch the
  // matching pointerup — a very fast tap that begins and ends a gesture in one
  // frame would otherwise strand it with a passive effect that runs after paint.
  useLayoutEffect(() => {
    if (!gestureActive) return;
    const onMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const natural = naturalAt({ x: event.clientX, y: event.clientY });
      if (!natural) return;
      if (gesture.type === "draw") {
        setDrawing({
          tool: gesture.tool,
          start: gesture.start,
          current: clampNaturalPointToCapture(natural, doc),
        });
        return;
      }
      if (gesture.type === "endpoint") {
        // One endpoint follows the pointer; the other stays exactly put.
        const base = gesture.endpoint === "start" ? gesture.startArrow.start : gesture.startArrow.end;
        const moved = {
          x: base.x + (natural.x - gesture.startPointer.x),
          y: base.y + (natural.y - gesture.startPointer.y),
        };
        const next: DraftMark = {
          kind: "arrow",
          arrow: dragArrowEndpoint(gesture.startArrow, gesture.endpoint, moved, doc),
        };
        if (gesture.target.draft) {
          setDraft(next);
        } else {
          const dragged = { id: gesture.target.id, mark: next };
          regionDragRef.current = dragged;
          setRegionDrag(dragged);
        }
        return;
      }
      const delta = {
        x: natural.x - gesture.startPointer.x,
        y: natural.y - gesture.startPointer.y,
      };
      const resized = resizedRegion(gesture.startMark, gesture.handle, delta, doc);
      if (!resized) return;
      if (gesture.target.draft) {
        setDraft(resized);
      } else {
        const next = { id: gesture.target.id, mark: resized };
        regionDragRef.current = next;
        setRegionDrag(next);
      }
    };
    const onUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gestureRef.current = null;
      setGestureActive(false);
      if (gesture.type === "draw") {
        const natural = naturalAt({ x: event.clientX, y: event.clientY });
        const end = natural
          ? clampNaturalPointToCapture(natural, doc)
          : (drawingRef.current?.current ?? gesture.start);
        const mark = drawnMark(gesture.tool, gesture.start, end, doc);
        setDrawing(null);
        // The tool armed exactly this drag, whatever it produced.
        setArmed(null);
        // Too small to be a mark: nothing is drafted and nothing changes.
        if (!drawnMarkIsBigEnough(mark)) return;
        setDraft(mark);
        onDraftSettled?.(mark);
        syncZoom();
        return;
      }
      const startMark: DraftMark =
        gesture.type === "endpoint"
          ? { kind: "arrow", arrow: gesture.startArrow }
          : gesture.startMark;
      if (gesture.target.draft) {
        // A draft resize or endpoint drag commits nothing; it re-anchors the
        // nearby context query on the final geometry.
        const current = draftRef.current;
        if (current && current.kind === startMark.kind) onDraftSettled?.(current);
        return;
      }
      const drop = regionDragRef.current;
      regionDragRef.current = null;
      setRegionDrag(null);
      // The one write of the gesture, and only when the geometry actually
      // changed: a press-and-release on a handle writes nothing.
      if (drop && drop.id === gesture.target.id && !marksEqual(drop.mark, startMark)) {
        commitRegion(drop.id, drop.mark);
      }
    };
    const onCancel = () => cancelGesture();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [gestureActive, doc, naturalAt, cancelGesture, onDraftSettled, commitRegion, syncZoom]);

  const gestures = useMemo<RegionGestures>(
    () => ({
      beginResize: (target, handle, pointer) => {
        if (readOnly || gestureRef.current) return;
        const startPointer = naturalAt(pointer);
        if (!startPointer) return;
        const startMark = target.draft ? draftRef.current : (regionById.get(target.id) ?? null);
        if (!startMark || startMark.kind === "pin") return;
        gestureRef.current = {
          type: "resize",
          target: target.draft ? { draft: true } : { draft: false, id: target.id },
          handle,
          startMark,
          startPointer,
        };
        setGestureActive(true);
      },
      beginEndpoint: (target, endpoint, pointer) => {
        if (readOnly || gestureRef.current) return;
        const startPointer = naturalAt(pointer);
        if (!startPointer) return;
        const startMark = target.draft ? draftRef.current : (shapeById.get(target.id) ?? null);
        if (startMark?.kind !== "arrow") return;
        gestureRef.current = {
          type: "endpoint",
          target: target.draft ? { draft: true } : { draft: false, id: target.id },
          endpoint,
          startArrow: startMark.arrow,
          startPointer,
        };
        setGestureActive(true);
      },
    }),
    [readOnly, naturalAt, regionById, shapeById],
  );

  // Node dragging: React Flow emits the node's new top-left position; the
  // pure adapters re-derive the clamped canonical geometry from it. For
  // pins the grab offset (where inside the box the tip sits) is captured
  // once at drag start and held for the whole gesture: re-deriving it per
  // change from a frame-clamped box would corrupt it, and React Flow's
  // drag-end position re-emission would then advance the tip with no
  // pointer movement at all. For rectangles the emitted position is the box
  // corner itself. All movement is local state — the persisted commit
  // happens exactly once, at drag end, in onNodeDragStop.
  const dragGrab = useRef<Pick<PinBox, "tipOffsetX" | "tipOffsetY"> | null>(null);
  // Where a saved mark's anchor was when its drag began: drag end compares
  // the final geometry against it to tell a click from a move.
  const dragOrigin = useRef<NaturalPoint | null>(null);
  // An arrow's node box is padded chrome around its endpoints, so its
  // emitted position is not its geometry. The box corner and the arrow at
  // drag start are snapshotted here, and every change applies the difference
  // to that snapshot, which keeps the shaft's length and direction exact.
  const arrowDrag = useRef<{ id: string; position: NaturalPoint; arrow: NaturalArrow } | null>(
    null,
  );
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        const position = change.position;
        const arrowOrigin = arrowDrag.current;
        if (arrowOrigin && arrowOrigin.id === change.id) {
          const delta = {
            x: position.x - arrowOrigin.position.x,
            y: position.y - arrowOrigin.position.y,
          };
          const moved: DraftMark = {
            kind: "arrow",
            arrow: translateArrow(arrowOrigin.arrow, delta, doc),
          };
          if (change.id === draftArrowNodeId(domain.captureId)) {
            setDraft((current) => (current?.kind === "arrow" ? moved : current));
          } else {
            const next = { id: change.id, mark: moved };
            regionDragRef.current = next;
            setRegionDrag(next);
          }
          continue;
        }
        if (change.id === draftPinNodeId(domain.captureId)) {
          setDraft((current) => {
            if (current?.kind !== "pin") return current;
            const zoom = liveZoomRef.current;
            const grab = dragGrab.current ?? pinHitBox(current.tip, doc, zoom);
            return { kind: "pin", tip: tipFromPinBox(dragPinBox(position, grab, doc, zoom)) };
          });
        } else if (
          change.id === draftRectangleNodeId(domain.captureId) ||
          change.id === draftCircleNodeId(domain.captureId)
        ) {
          setDraft((current) => (current ? (movedRegion(current, position, doc) ?? current) : current));
        } else if (regionById.has(change.id)) {
          // A persisted region: track the clamped geometry locally; the
          // single revisioned write fires at drag stop.
          const moved = movedRegion(regionById.get(change.id)!, position, doc);
          if (!moved) continue;
          const next = { id: change.id, mark: moved };
          regionDragRef.current = next;
          setRegionDrag(next);
        } else {
          // A persisted pin: track the clamped tip locally; the single
          // revisioned write fires at drag stop.
          const grab = dragGrab.current;
          if (!grab) continue;
          const tip = tipFromPinBox(dragPinBox(position, grab, doc, liveZoomRef.current));
          pinDragRef.current = { id: change.id, tip };
          setPinDrag({ id: change.id, tip });
        }
      }
    },
    [domain.captureId, doc, regionById],
  );

  // Put the one draft pin at a natural point and let the workspace resolve
  // nearby context for it. Exactly one draft per plane: a second click or
  // press of N moves the same draft rather than stacking marks.
  const placeDraft = useCallback(
    (natural: NaturalPoint) => {
      const mark: DraftMark = { kind: "pin", tip: natural };
      setDraft(mark);
      onDraftSettled?.(mark);
      syncZoom();
    },
    [onDraftSettled, syncZoom],
  );

  // A click on the screenshot: a press/release pair with no more than the
  // placement slop of travel. It lands on the wrapper so both the pane and
  // the frame image behave identically; releases on a mark or on the draft
  // itself are theirs (select, or the end of a drag), and releases outside
  // the screenshot do nothing.
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const onWrapperPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // isPrimary is undefined on some synthetic event surfaces; only an
    // explicit non-primary pointer is ignored.
    if (event.isPrimary === false) return;
    if (!readOnly && !gestureRef.current && (event.shiftKey || armedRef.current !== null)) {
      // A draw begins: the press point, clamped to the frame, is one corner.
      // Shift is the box shortcut (D079); otherwise the armed tool decides.
      const natural = naturalAt({ x: event.clientX, y: event.clientY });
      if (!natural) return;
      const tool: MarkTool = armedRef.current ?? "rectangle";
      const start = clampNaturalPointToCapture(natural, doc);
      gestureRef.current = { type: "draw", tool, start };
      setDrawing({ tool, start, current: start });
      setGestureActive(true);
      pressStart.current = null;
      event.preventDefault();
      return;
    }
    pressStart.current = { x: event.clientX, y: event.clientY };
  };

  const onWrapperPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pressStart.current;
    pressStart.current = null;
    // A draw or resize in flight ends in the window listener, never here.
    if (gestureRef.current) return;
    if (readOnly || !start || event.isPrimary === false) return;
    const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    // Past the slop it was a pan (or a mark drag), never a placement.
    if (travel > PLACEMENT_SLOP_SCREEN_PX) return;
    const target = event.target as HTMLElement | null;
    // A click on an existing mark is selection, not placement: a draft
    // stacked on a saved mark would be invisible and confusing.
    if (
      target?.closest(
        ".react-flow__node-draftPin, .react-flow__node-pin, .react-flow__node-rectangle, .react-flow__node-draftRectangle, .react-flow__node-circle, .react-flow__node-draftCircle, .react-flow__node-arrow, .react-flow__node-draftArrow",
      )
    ) {
      return;
    }
    const natural = naturalAt({ x: event.clientX, y: event.clientY });
    // Placement is only meaningful on the screenshot itself.
    if (
      !natural ||
      natural.x < 0 ||
      natural.y < 0 ||
      natural.x > doc.width ||
      natural.y > doc.height
    ) {
      return;
    }
    placeDraft(natural);
  };

  /** N: a draft pin at the visible center of the canvas, clamped to the frame. */
  const dropAtViewportCenter = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const center = {
      x: rect.left + wrapper.clientWidth / 2,
      y: rect.top + wrapper.clientHeight / 2,
    };
    const natural = naturalAt(center);
    if (!natural) return;
    onSelectPin?.(null);
    placeDraft(clampNaturalPointToCapture(natural, doc));
  }, [naturalAt, doc, onSelectPin, placeDraft]);

  /** J/K: the next or previous saved mark in number order, wrapping around. */
  const stepSelection = useCallback(
    (direction: 1 | -1) => {
      const ordered = [...pins, ...rectangles, ...circles, ...arrows].sort(
        (a, b) => a.number - b.number,
      );
      if (ordered.length === 0) return;
      const index = ordered.findIndex((mark) => mark.id === selectedPinId);
      const next =
        index === -1
          ? direction === 1
            ? 0
            : ordered.length - 1
          : (index + direction + ordered.length) % ordered.length;
      onSelectPin?.(ordered[next]!.id);
    },
    [pins, rectangles, circles, arrows, selectedPinId, onSelectPin],
  );

  /** Arm one tool for the next drag, or disarm it when it is already armed. */
  const toggleTool = useCallback((tool: MarkTool) => {
    setArmed((current) => (current === tool ? null : tool));
  }, []);

  const onRegionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    // Never while typing, and never as part of a browser or OS shortcut.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTextEntry(event.target)) return;
    // One key per mark tool (D082): it arms the next drag exactly as the
    // button does, and pressing it again disarms.
    const tool = MARK_TOOLS.find((candidate) => candidate.key === event.key.toLowerCase());
    if (tool) {
      event.preventDefault();
      toggleTool(tool.id);
      return;
    }
    switch (event.key) {
      case "j":
      case "J":
      case "ArrowDown":
        event.preventDefault();
        (onStepPin ?? stepSelection)(1);
        return;
      case "k":
      case "K":
      case "ArrowUp":
        event.preventDefault();
        (onStepPin ?? stepSelection)(-1);
        return;
      case "n":
      case "N":
        event.preventDefault();
        dropAtViewportCenter();
        return;
      default:
        return;
    }
  };

  return (
    <div className="capture-stage capture-stage-canvas" data-testid="capture-stage">
      <p className="capture-camera" role="group" aria-label="Camera modes and zoom">
        {CAMERA_MODES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            aria-pressed={mode === candidate.id}
            onClick={() => applyMode(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            // A deliberate camera gesture like any other: ends the named
            // mode's resize-follow so the exact camera survives resizes and
            // plane switches. (Programmatic zoom carries no source event, so
            // onMoveStart cannot see it.)
            autoFollow.current = false;
            void instance.zoomOut();
          }}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => {
            autoFollow.current = false;
            void instance.zoomIn();
          }}
        >
          +
        </button>
        <ZoomReadout />
      </p>
      {readOnly ? null : (
        // The mark tools (D079, D082). Each arms exactly the next drag, then
        // disarms itself; pressing it again, or Escape, disarms it early.
        // Shift-drag stays the pointer shortcut for a box.
        <p className="capture-tools" role="group" aria-label="Mark tools">
          {MARK_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="capture-draw-toggle"
              aria-pressed={armed === tool.id}
              aria-keyshortcuts={tool.key.toUpperCase()}
              title={
                tool.id === "rectangle"
                  ? "The next drag draws a box (or hold Shift while dragging)"
                  : tool.id === "circle"
                    ? "The next drag draws a circle"
                    : "The next drag draws an arrow, from the tail to the head"
              }
              onClick={() => toggleTool(tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </p>
      )}
      <div
        className="capture-canvas"
        ref={wrapperRef}
        role="region"
        aria-label={regionName}
        // Focusable on an editable plane so the shortcuts have somewhere to
        // land; a click on the pane focuses it, and Tab reaches it.
        tabIndex={readOnly ? undefined : 0}
        aria-keyshortcuts={readOnly ? undefined : "J K N B C A ArrowDown ArrowUp"}
        data-read-only={readOnly ? "true" : undefined}
        data-draw-armed={armed ? "true" : undefined}
        data-draw-tool={armed ?? undefined}
        data-drawing={drawing ? "true" : undefined}
        onKeyDown={onRegionKeyDown}
        onPointerDown={onWrapperPointerDown}
        onPointerUp={onWrapperPointerUp}
      >
        <RegionGestureContext.Provider value={readOnly ? null : gestures}>
          <ReactFlow
            nodes={nodes}
            nodeTypes={nodeTypes}
            minZoom={CANVAS_MIN_ZOOM}
            maxZoom={CANVAS_MAX_ZOOM}
            onInit={() => {
              initialized.current = true;
              const saved = restored.current;
              if (saved) {
                autoFollow.current = saved.follow;
                setMode(saved.mode);
                const camera = {
                  x: saved.camera.x,
                  y: saved.camera.y,
                  zoom: clampCanvasZoom(saved.camera.zoom),
                };
                cameraRef.current = camera;
                void instance.setViewport(camera);
              } else {
                applyMode(modeRef.current);
              }
              if (pendingReveal.current) {
                pendingReveal.current = false;
                revealSelection();
              }
            }}
            onNodesChange={handleNodesChange}
            onNodeDragStart={(_event, node) => {
              if (node.type === DRAFT_PIN_TYPE && draftRef.current?.kind === "pin") {
                dragGrab.current = pinHitBox(draftRef.current.tip, doc, liveZoomRef.current);
              } else if (node.type === PIN_TYPE) {
                // The rendered box's recorded offsets are the grab: the tip's
                // position inside the box at drag start, held for the gesture.
                const data = node.data as PinNode["data"];
                dragGrab.current = { tipOffsetX: data.tipOffsetX, tipOffsetY: data.tipOffsetY };
                dragOrigin.current = { x: data.tipX, y: data.tipY };
                pinDragRef.current = null;
              } else if (REGION_TYPES.includes(node.type ?? "")) {
                const data = node.data as RectangleNode["data"];
                dragOrigin.current = { x: data.rectX, y: data.rectY };
                regionDragRef.current = null;
              } else if (node.type === ARROW_TYPE || node.type === DRAFT_ARROW_TYPE) {
                // The emitted position is the padded node box, not the
                // geometry, so both are snapshotted for the whole drag.
                const data = node.data as ArrowNode["data"];
                const arrow = {
                  start: { x: data.startX, y: data.startY },
                  end: { x: data.endX, y: data.endY },
                };
                arrowDrag.current = { id: node.id, position: { ...node.position }, arrow };
                dragOrigin.current = { x: data.startX, y: data.startY };
                regionDragRef.current = null;
              }
            }}
            onNodeDragStop={(_event, node) => {
              if (node.type === PIN_TYPE) {
                // React Flow applies the final position (handleNodesChange
                // above, which fills pinDragRef) before it calls this, so the
                // ref holds the drop tip.
                const drop = pinDragRef.current;
                const origin = dragOrigin.current;
                pinDragRef.current = null;
                dragOrigin.current = null;
                setPinDrag(null);
                if (drop && drop.id === node.id) {
                  // A press that barely moved is a click: select the pin and
                  // write nothing (the badge snaps back to the saved tip). Past
                  // the slop it is the one write of the drag: the final
                  // clamped natural tip. Intermediate frames were local only.
                  const travel = origin
                    ? Math.hypot(drop.tip.x - origin.x, drop.tip.y - origin.y) *
                      liveZoomRef.current
                    : Number.POSITIVE_INFINITY;
                  if (travel <= PLACEMENT_SLOP_SCREEN_PX) onSelectPin?.(node.id);
                  else onMovePin?.(node.id, drop.tip);
                }
              } else if (SHAPE_TYPES.includes(node.type ?? "")) {
                // Same rule for a region or an arrow moved by its stroke,
                // shaft, or badge: a click selects and writes nothing; a
                // move is one write.
                const drop = regionDragRef.current;
                const origin = dragOrigin.current;
                regionDragRef.current = null;
                dragOrigin.current = null;
                setRegionDrag(null);
                // The same anchor the drag start recorded: a region's
                // bounding corner, an arrow's tail.
                const anchor = drop ? markDragAnchor(drop.mark) : null;
                if (drop && anchor && drop.id === node.id) {
                  const travel = origin
                    ? Math.hypot(anchor.x - origin.x, anchor.y - origin.y) * liveZoomRef.current
                    : Number.POSITIVE_INFINITY;
                  if (travel <= PLACEMENT_SLOP_SCREEN_PX) onSelectPin?.(node.id);
                  else commitRegion(node.id, drop.mark);
                }
              } else if (DRAFT_TYPES.includes(node.type ?? "") && draftRef.current) {
                // A draft drag commits nothing; it only re-anchors the nearby
                // context query on the final geometry.
                onDraftSettled?.(draftRef.current);
              }
              dragGrab.current = null;
              arrowDrag.current = null;
            }}
            onNodeClick={(_event, node) => {
              if (node.type === PIN_TYPE || SHAPE_TYPES.includes(node.type ?? "")) {
                onSelectPin?.(node.id);
              }
            }}
            onPaneClick={() => onSelectPin?.(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            // Shift is the draw key (D079); React Flow must not treat it as
            // its own selection-box key.
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            // Drags must anchor at pointer-down, not at the first move past a
            // threshold: the default threshold of 1 captures the drag origin
            // at the first qualifying pointermove, so every drop would land a
            // few screen pixels short of where Lucas released it (VAL-PIN-002
            // drop fidelity, D062). Click-versus-drag is decided at drop time
            // against PLACEMENT_SLOP_SCREEN_PX instead (D074).
            nodeDragThreshold={0}
            zoomOnDoubleClick={false}
            panOnDrag
            onMove={(_event, viewport: Viewport) => {
              // Badge hit boxes keep the shared minimum screen target by
              // tracking the live zoom. Only a zoom change re-renders the
              // node array — panning keeps the same zoom and stays cheap.
              if (viewport.zoom !== liveZoomRef.current) {
                liveZoomRef.current = viewport.zoom;
                setLiveZoom(viewport.zoom);
              }
            }}
            onMoveStart={(event) => {
              // Programmatic mode changes carry no source event; only a real
              // gesture (drag, wheel, pinch, keys) ends resize-follow.
              if (event) autoFollow.current = false;
            }}
            onMoveEnd={(_event, viewport) => reportCamera(viewport)}
          />
        </RegionGestureContext.Provider>
      </div>
      {/* The composer sits beside the draft but outside the transformed
          plane, so it never scales with the zoom and never leaves the
          visible frame. It waits while a box is still being drawn. A
          read-only plane has no drafts and no composer. */}
      {draft && composer && !readOnly && !drawing ? (
        <DraftComposerPopover draft={draft} frameRef={wrapperRef}>
          <PinComposer {...composer} draftKind={draft.kind} />
        </DraftComposerPopover>
      ) : null}
    </div>
  );
}

export function CaptureCanvas({
  captureId,
  pageUrl,
  variant,
  attempt,
  width,
  height,
  readOnly = false,
  pins = [],
  rectangles = [],
  circles = [],
  arrows = [],
  previewRect = null,
  selectedPinId,
  onSelectPin,
  onMovePin,
  onMoveRectangle,
  onMoveCircle,
  onMoveArrow,
  savedCamera,
  onCameraChange,
  onDraftChange,
  onDraftSettled,
  draftResetSignal,
  composer,
  onStepPin,
  autoFocus = false,
  revealSelected,
}: {
  captureId: string;
  pageUrl: string;
  variant: string;
  attempt: number;
  width: number;
  height: number;
  /**
   * Render the founder's read/reply-only plane: no drafts, pin drags,
   * composer, or shortcuts that create or move a mark. Defaults to the
   * editor's full behavior, so existing planes are unchanged.
   */
  readOnly?: boolean;
  /** This plane's persisted pins; empty until they load or when none exist. */
  pins?: Omit<CanvasPin, "selected">[];
  /** This plane's persisted rectangles (D079); empty until they load. */
  rectangles?: Omit<CanvasRectangle, "selected">[];
  /** This plane's persisted circles (D082); empty until they load. */
  circles?: Omit<CanvasCircle, "selected">[];
  /** This plane's persisted arrows (D083); empty until they load. */
  arrows?: Omit<CanvasArrow, "selected">[];
  /** The transient nearby-candidate highlight rect in natural pixels. */
  previewRect?: ContextRect | null;
  selectedPinId?: string | null;
  onSelectPin?: (annotationId: string | null) => void;
  onMovePin?: (annotationId: string, tip: NaturalPoint) => void;
  onMoveRectangle?: (annotationId: string, rect: NaturalRect) => void;
  onMoveCircle?: (annotationId: string, circle: NaturalCircle) => void;
  onMoveArrow?: (annotationId: string, arrow: NaturalArrow) => void;
  savedCamera?: CaptureCameraState | null;
  onCameraChange?: (state: CaptureCameraState) => void;
  onDraftChange?: (draft: DraftMark | null) => void;
  onDraftSettled?: (draft: DraftMark) => void;
  draftResetSignal?: number;
  /** The draft composer's state and callbacks; rendered beside the draft. */
  composer?: PinComposerProps | null;
  /** Project-wide J/K stepping (D077); see CaptureCanvasInner. */
  onStepPin?: (direction: 1 | -1) => void;
  /** Focus the canvas region on mount (D077); see CaptureCanvasInner. */
  autoFocus?: boolean;
  /** Increments to center the selected mark (D078); see CaptureCanvasInner. */
  revealSelected?: number;
}) {
  const name = `Screenshot of ${pageUrl} (${variant}, version ${attempt})`;
  const domain = useMemo<CaptureFrameDomain>(
    () => ({
      captureId,
      assetUrl: `/api/captures/${encodeURIComponent(captureId)}/asset`,
      name,
      width,
      height,
    }),
    [captureId, name, width, height],
  );
  return (
    <ReactFlowProvider>
      <CaptureCanvasInner
        domain={domain}
        regionName={name}
        readOnly={readOnly}
        pins={pins}
        rectangles={rectangles}
        circles={circles}
        arrows={arrows}
        previewRect={previewRect}
        selectedPinId={selectedPinId}
        onSelectPin={onSelectPin}
        onMovePin={onMovePin}
        onMoveRectangle={onMoveRectangle}
        onMoveCircle={onMoveCircle}
        onMoveArrow={onMoveArrow}
        savedCamera={savedCamera}
        onCameraChange={onCameraChange}
        onDraftChange={onDraftChange}
        onDraftSettled={onDraftSettled}
        draftResetSignal={draftResetSignal}
        composer={composer}
        onStepPin={onStepPin}
        autoFocus={autoFocus}
        revealSelected={revealSelected}
      />
    </ReactFlowProvider>
  );
}
