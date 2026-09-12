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
// Rectangles (D079) share the plane and the numbering. A press that moves
// while Shift is held, or after the "Draw a box" toggle armed the next
// drag, draws a box from press to release in natural pixels, clamped to
// the frame; a release below MIN_SHAPE_SIZE_PX in either dimension draws
// nothing. The drawn box is the one draft (the same composer opens at its
// top-right corner, with candidates ranked by overlap), draggable and
// resizable by eight handles before it is saved. Saved boxes drag by their
// stroke or badge and resize by their handles; each gesture commits exactly
// one revisioned geometry write at its end (onMoveRectangle), clamped to
// the frame and never below the minimum size. A click on a box's stroke or
// badge selects it; a click inside a box lands on the screenshot and drops a
// pin as usual. The founder's read-only plane renders boxes with no handles
// and no drag.
//
// Keyboard, on the canvas region when focus is not in a text field: J or
// ArrowDown selects the next saved mark, K or ArrowUp the previous, N drops
// a draft pin at the viewport center (clamped to the frame). Escape cancels
// a draw in progress, then disarms the box toggle, then clears the draft.
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
  CAPTURE_FRAME_TYPE,
  CONTEXT_PREVIEW_TYPE,
  DRAFT_PIN_TYPE,
  DRAFT_RECTANGLE_TYPE,
  PIN_TYPE,
  RECTANGLE_TYPE,
  draftPinNodeId,
  draftRectangleNodeId,
  nodesForPlane,
  type CanvasPin,
  type CanvasRectangle,
  type CaptureFrameDomain,
  type CaptureFrameNode,
  type ContextPreviewNode,
  type ContextRect,
  type DraftPinNode,
  type DraftRectangleNode,
  type PinNode,
  type RectangleNode,
} from "../lib/canvas/flow-model";
import { markCenter, markKindNoun, type DraftMark } from "../lib/canvas/marks";
import { placePopover, popoverBounds, type ScreenSize } from "../lib/canvas/popover";
import {
  handleAnchor,
  handleCursor,
  meetsMinimumSize,
  moveRect,
  rectFromCorners,
  rectsEqual,
  resizeRect,
  RESIZE_HANDLES,
  type NaturalRect,
  type ResizeHandle,
} from "../lib/canvas/rectangle";
import { PinComposer, type PinComposerProps } from "./pin-composer";

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
 * What a rectangle's resize handle reports when pressed. The node
 * component cannot see the canvas state, so the canvas provides this
 * through context and owns the whole gesture (window pointer listeners,
 * the pure resize math, and the single commit at release).
 */
interface RectangleGestures {
  beginResize: (
    target: { draft: true } | { draft: false; id: string; rect: NaturalRect },
    handle: ResizeHandle,
    pointer: { x: number; y: number },
  ) => void;
}

const RectangleGestureContext = createContext<RectangleGestures | null>(null);

/**
 * One rectangle, saved or draft (D079). The node wrapper is
 * pointer-transparent (see rectangleNode); the parts that take the pointer
 * are the stroke (a wide invisible grab stroke over the visible one, so
 * dragging the edge moves the box), the number badge at the top-left
 * corner, and — on an editable plane — the eight resize handles. The
 * handles carry React Flow's `nodrag` class so a press on one resizes
 * instead of starting a node drag. Every size is derived from the zoom so
 * the chrome stays the same on screen while the box stays exact.
 */
function RectangleMark({ data }: NodeProps<RectangleNode | DraftRectangleNode>) {
  const gestures = useContext(RectangleGestureContext);
  const dash = data.draft ? `${data.strokeWidth * 4} ${data.strokeWidth * 3}` : undefined;
  return (
    <div
      className={`mark-rectangle${data.draft ? " mark-rectangle-draft" : ""}`}
      data-testid={data.draft ? "draft-rectangle" : "rectangle"}
      data-mark-number={data.number ?? undefined}
      data-selected={data.selected ? "true" : undefined}
      data-drawing={data.drawing ? "true" : undefined}
    >
      <svg className="mark-rectangle-svg" aria-hidden="true" focusable="false">
        {data.drawing ? null : (
          <rect
            className="mark-rectangle-grab"
            data-testid="rectangle-edge"
            x={0}
            y={0}
            width="100%"
            height="100%"
            strokeWidth={data.grabWidth}
          />
        )}
        <rect
          className="mark-rectangle-stroke"
          x={0}
          y={0}
          width="100%"
          height="100%"
          strokeWidth={data.strokeWidth}
          strokeDasharray={dash}
        />
      </svg>
      {data.drawing ? null : (
        <div
          className={`pin-badge ${data.draft ? "pin-badge-draft" : "pin-badge-saved"} mark-rectangle-badge`}
          data-testid={data.draft ? "draft-rectangle-badge" : "rectangle-badge"}
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
        ? RESIZE_HANDLES.map((handle) => {
            const anchor = handleAnchor(handle);
            return (
              <div
                key={handle}
                className="nodrag nopan mark-rectangle-handle"
                data-testid="rectangle-handle"
                data-handle={handle}
                aria-hidden="true"
                style={{
                  left: anchor.x * data.rectWidth - data.handleSize / 2,
                  top: anchor.y * data.rectHeight - data.handleSize / 2,
                  width: data.handleSize,
                  height: data.handleSize,
                  cursor: handleCursor(handle),
                }}
                onPointerDown={(event) => {
                  // Only the primary pointer resizes, and the press is the
                  // handle's alone: the wrapper must not read it as a click.
                  if (event.isPrimary === false || event.button > 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  gestures.beginResize(
                    data.draft
                      ? { draft: true }
                      : {
                          draft: false,
                          id: data.annotationId,
                          rect: {
                            x: data.rectX,
                            y: data.rectY,
                            width: data.rectWidth,
                            height: data.rectHeight,
                          },
                        },
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

const nodeTypes: NodeTypes = {
  [CAPTURE_FRAME_TYPE]: CaptureFrame,
  [PIN_TYPE]: Pin,
  [DRAFT_PIN_TYPE]: DraftPin,
  [CONTEXT_PREVIEW_TYPE]: ContextPreview,
  [RECTANGLE_TYPE]: RectangleMark,
  [DRAFT_RECTANGLE_TYPE]: RectangleMark,
};

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

  // A pin anchors at its tip with the badge rising above it; a box anchors
  // at its top-right corner with nothing to clear.
  const anchorNatural =
    draft.kind === "pin"
      ? draft.tip
      : { x: draft.rect.x + draft.rect.width, y: draft.rect.y };
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
  | { type: "draw"; start: NaturalPoint }
  | {
      type: "resize";
      target: { draft: true } | { draft: false; id: string };
      handle: ResizeHandle;
      startRect: NaturalRect;
      startPointer: NaturalPoint;
    };

function CaptureCanvasInner({
  domain,
  regionName,
  readOnly,
  pins,
  rectangles,
  previewRect,
  selectedPinId,
  onSelectPin,
  onMovePin,
  onMoveRectangle,
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
  // A persisted rectangle being moved or resized, the same way.
  const [rectDrag, setRectDrag] = useState<{ id: string; rect: NaturalRect } | null>(null);
  const rectDragRef = useRef<{ id: string; rect: NaturalRect } | null>(null);
  // The box being drawn right now: press point and current pointer point,
  // both clamped to the frame. Rendered as the draft box without handles.
  const [drawing, setDrawing] = useState<{ start: NaturalPoint; current: NaturalPoint } | null>(
    null,
  );
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  // "Draw a box": arms exactly the next drag, then disarms itself.
  const [armed, setArmed] = useState(false);
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
      rectangles.map((rectangle) => ({
        ...rectangle,
        rect: rectDrag?.id === rectangle.id ? rectDrag.rect : rectangle.rect,
        selected: rectangle.id === selectedPinId,
      })),
    [rectangles, rectDrag, selectedPinId],
  );
  const rectangleById = useMemo(
    () => new Map(rectangles.map((rectangle) => [rectangle.id, rectangle])),
    [rectangles],
  );
  const nodes = useMemo(() => {
    const built = nodesForPlane(domain, {
      pins: effectivePins,
      rectangles: effectiveRectangles,
      // While a box is being drawn it stands in for the draft; a release
      // below the minimum size brings the previous draft back untouched.
      draft: drawing
        ? { kind: "rectangle", rect: rectFromCorners(drawing.start, drawing.current, doc) }
        : draft,
      drawing: drawing !== null,
      zoom: liveZoom,
      preview: previewRect ?? null,
      readOnly,
    });
    // The adapter marks pins draggable; only a read-only plane turns that
    // off. There is no mode that could.
    if (!readOnly) return built;
    return built.map((node) => (node.type === PIN_TYPE ? { ...node, draggable: false } : node));
  }, [domain, doc, effectivePins, effectiveRectangles, draft, drawing, liveZoom, previewRect, readOnly]);

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
   * tip or a box's middle, at the zoom the reader already has, except that
   * a box that would not fit zooms out until it does. A deliberate camera
   * move like a gesture, so it ends any named mode's resize-follow.
   */
  const revealSelection = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || wrapper.clientWidth <= 0 || wrapper.clientHeight <= 0) return;
    const pin = pins.find((candidate) => candidate.id === selectedPinId);
    const rectangle = pin ? null : rectangles.find((candidate) => candidate.id === selectedPinId);
    const mark: DraftMark | null = pin
      ? { kind: "pin", tip: pin.tip }
      : rectangle
        ? { kind: "rectangle", rect: rectangle.rect }
        : null;
    if (!mark) return;
    const viewport = { width: wrapper.clientWidth, height: wrapper.clientHeight };
    let zoom = cameraRef.current?.zoom ?? instance.getViewport().zoom;
    if (mark.kind === "rectangle") {
      const fit = Math.min(
        (viewport.width - 2 * CANVAS_PADDING_PX) / mark.rect.width,
        (viewport.height - 2 * CANVAS_PADDING_PX) / mark.rect.height,
      );
      if (Number.isFinite(fit) && fit > 0) zoom = Math.min(zoom, fit);
    }
    const camera = centerCamera(viewport, markCenter(mark), zoom);
    autoFollow.current = false;
    void instance.setViewport(camera);
    liveZoomRef.current = camera.zoom;
    setLiveZoom(camera.zoom);
    reportCamera(camera);
  }, [instance, pins, rectangles, selectedPinId, reportCamera]);

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
      rectDragRef.current = null;
      setRectDrag(null);
    }
    if (gesture?.type === "resize" && gesture.target.draft) {
      setDraft((current) =>
        current?.kind === "rectangle" ? { kind: "rectangle", rect: gesture.startRect } : current,
      );
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
        setArmed(false);
        return;
      }
      if (armedRef.current) {
        setArmed(false);
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
      if (event.button === 0 && (event.shiftKey || armedRef.current)) event.stopPropagation();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (armedRef.current) event.stopPropagation();
    };
    wrapper.addEventListener("mousedown", onMouseDown, true);
    wrapper.addEventListener("touchstart", onTouchStart, true);
    return () => {
      wrapper.removeEventListener("mousedown", onMouseDown, true);
      wrapper.removeEventListener("touchstart", onTouchStart, true);
    };
  }, [readOnly]);

  // The window listeners for a gesture in flight: movement updates local
  // state through the pure geometry; the release is the one moment anything
  // settles (a draft for a draw, a context re-query for a draft resize, one
  // revisioned write for a saved-box resize).
  useEffect(() => {
    if (!gestureActive) return;
    const onMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const natural = naturalAt({ x: event.clientX, y: event.clientY });
      if (!natural) return;
      if (gesture.type === "draw") {
        setDrawing({ start: gesture.start, current: clampNaturalPointToCapture(natural, doc) });
        return;
      }
      const delta = {
        x: natural.x - gesture.startPointer.x,
        y: natural.y - gesture.startPointer.y,
      };
      const rect = resizeRect(gesture.startRect, gesture.handle, delta, doc);
      if (gesture.target.draft) {
        setDraft({ kind: "rectangle", rect });
      } else {
        const next = { id: gesture.target.id, rect };
        rectDragRef.current = next;
        setRectDrag(next);
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
        const rect = rectFromCorners(gesture.start, end, doc);
        setDrawing(null);
        // The toggle armed exactly this drag, whatever it produced.
        setArmed(false);
        // Too small to be a box: nothing is drafted and nothing changes.
        if (!meetsMinimumSize(rect)) return;
        const mark: DraftMark = { kind: "rectangle", rect };
        setDraft(mark);
        onDraftSettled?.(mark);
        syncZoom();
        return;
      }
      if (gesture.target.draft) {
        // A draft resize commits nothing; it re-anchors the nearby context
        // query on the final box.
        const current = draftRef.current;
        if (current?.kind === "rectangle") onDraftSettled?.(current);
        return;
      }
      const drop = rectDragRef.current;
      rectDragRef.current = null;
      setRectDrag(null);
      // The one write of the gesture, and only when the box actually
      // changed: a press-and-release on a handle writes nothing.
      if (drop && drop.id === gesture.target.id && !rectsEqual(drop.rect, gesture.startRect)) {
        onMoveRectangle?.(drop.id, drop.rect);
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
  }, [gestureActive, doc, naturalAt, cancelGesture, onDraftSettled, onMoveRectangle, syncZoom]);

  const gestures = useMemo<RectangleGestures>(
    () => ({
      beginResize: (target, handle, pointer) => {
        if (readOnly || gestureRef.current) return;
        const startPointer = naturalAt(pointer);
        if (!startPointer) return;
        const startRect = target.draft
          ? draftRef.current?.kind === "rectangle"
            ? draftRef.current.rect
            : null
          : target.rect;
        if (!startRect) return;
        gestureRef.current = {
          type: "resize",
          target: target.draft ? { draft: true } : { draft: false, id: target.id },
          handle,
          startRect,
          startPointer,
        };
        setGestureActive(true);
      },
    }),
    [readOnly, naturalAt],
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
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        const position = change.position;
        if (change.id === draftPinNodeId(domain.captureId)) {
          setDraft((current) => {
            if (current?.kind !== "pin") return current;
            const zoom = liveZoomRef.current;
            const grab = dragGrab.current ?? pinHitBox(current.tip, doc, zoom);
            return { kind: "pin", tip: tipFromPinBox(dragPinBox(position, grab, doc, zoom)) };
          });
        } else if (change.id === draftRectangleNodeId(domain.captureId)) {
          setDraft((current) =>
            current?.kind === "rectangle"
              ? { kind: "rectangle", rect: moveRect(current.rect, position, doc) }
              : current,
          );
        } else if (rectangleById.has(change.id)) {
          // A persisted rectangle: track the clamped box locally; the single
          // revisioned write fires at drag stop.
          const base = rectangleById.get(change.id)!.rect;
          const next = { id: change.id, rect: moveRect(base, position, doc) };
          rectDragRef.current = next;
          setRectDrag(next);
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
    [domain.captureId, doc, rectangleById],
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
    if (!readOnly && !gestureRef.current && (event.shiftKey || armedRef.current)) {
      // A draw begins: the press point, clamped to the frame, is one corner.
      const natural = naturalAt({ x: event.clientX, y: event.clientY });
      if (!natural) return;
      const start = clampNaturalPointToCapture(natural, doc);
      gestureRef.current = { type: "draw", start };
      setDrawing({ start, current: start });
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
        ".react-flow__node-draftPin, .react-flow__node-pin, .react-flow__node-rectangle, .react-flow__node-draftRectangle",
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
      const ordered = [...pins, ...rectangles].sort((a, b) => a.number - b.number);
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
    [pins, rectangles, selectedPinId, onSelectPin],
  );

  const onRegionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    // Never while typing, and never as part of a browser or OS shortcut.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTextEntry(event.target)) return;
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
        {readOnly ? null : (
          // Arms exactly the next drag to draw a box (the pointer equivalent
          // of holding Shift), then disarms itself; a second click or Escape
          // disarms it early.
          <button
            type="button"
            className="capture-draw-toggle"
            aria-pressed={armed}
            title="The next drag draws a box (or hold Shift while dragging)"
            onClick={() => setArmed((value) => !value)}
          >
            Draw a box
          </button>
        )}
      </p>
      <div
        className="capture-canvas"
        ref={wrapperRef}
        role="region"
        aria-label={regionName}
        // Focusable on an editable plane so the shortcuts have somewhere to
        // land; a click on the pane focuses it, and Tab reaches it.
        tabIndex={readOnly ? undefined : 0}
        aria-keyshortcuts={readOnly ? undefined : "J K N ArrowDown ArrowUp"}
        data-read-only={readOnly ? "true" : undefined}
        data-draw-armed={armed ? "true" : undefined}
        data-drawing={drawing ? "true" : undefined}
        onKeyDown={onRegionKeyDown}
        onPointerDown={onWrapperPointerDown}
        onPointerUp={onWrapperPointerUp}
      >
        <RectangleGestureContext.Provider value={readOnly ? null : gestures}>
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
              } else if (node.type === RECTANGLE_TYPE) {
                const data = node.data as RectangleNode["data"];
                dragOrigin.current = { x: data.rectX, y: data.rectY };
                rectDragRef.current = null;
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
              } else if (node.type === RECTANGLE_TYPE) {
                // Same rule for a box moved by its stroke or badge: a click
                // selects and writes nothing; a move is one write.
                const drop = rectDragRef.current;
                const origin = dragOrigin.current;
                rectDragRef.current = null;
                dragOrigin.current = null;
                setRectDrag(null);
                if (drop && drop.id === node.id) {
                  const travel = origin
                    ? Math.hypot(drop.rect.x - origin.x, drop.rect.y - origin.y) *
                      liveZoomRef.current
                    : Number.POSITIVE_INFINITY;
                  if (travel <= PLACEMENT_SLOP_SCREEN_PX) onSelectPin?.(node.id);
                  else onMoveRectangle?.(node.id, drop.rect);
                }
              } else if (
                (node.type === DRAFT_PIN_TYPE || node.type === DRAFT_RECTANGLE_TYPE) &&
                draftRef.current
              ) {
                // A draft drag commits nothing; it only re-anchors the nearby
                // context query on the final geometry.
                onDraftSettled?.(draftRef.current);
              }
              dragGrab.current = null;
            }}
            onNodeClick={(_event, node) => {
              if (node.type === PIN_TYPE || node.type === RECTANGLE_TYPE) onSelectPin?.(node.id);
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
        </RectangleGestureContext.Provider>
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
  previewRect = null,
  selectedPinId,
  onSelectPin,
  onMovePin,
  onMoveRectangle,
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
  /** The transient nearby-candidate highlight rect in natural pixels. */
  previewRect?: ContextRect | null;
  selectedPinId?: string | null;
  onSelectPin?: (annotationId: string | null) => void;
  onMovePin?: (annotationId: string, tip: NaturalPoint) => void;
  onMoveRectangle?: (annotationId: string, rect: NaturalRect) => void;
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
        previewRect={previewRect}
        selectedPinId={selectedPinId}
        onSelectPin={onSelectPin}
        onMovePin={onMovePin}
        onMoveRectangle={onMoveRectangle}
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
