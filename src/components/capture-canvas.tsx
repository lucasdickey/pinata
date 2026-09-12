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
// Keyboard, on the canvas region when focus is not in a text field: J or
// ArrowDown selects the next saved pin, K or ArrowUp the previous, N drops
// a draft at the viewport center (clamped to the frame). Inside the
// composer, Enter saves, Shift+Enter inserts a newline, Escape cancels.
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
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { MIN_HIT_TARGET_CSS_PX } from "../lib/boundaries";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
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
  PIN_TYPE,
  draftPinNodeId,
  nodesForCapture,
  type CanvasPin,
  type CaptureFrameDomain,
  type CaptureFrameNode,
  type ContextPreviewNode,
  type ContextRect,
  type DraftPinNode,
  type PinNode,
} from "../lib/canvas/flow-model";
import { placePopover, popoverBounds, type ScreenSize } from "../lib/canvas/popover";
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

const nodeTypes: NodeTypes = {
  [CAPTURE_FRAME_TYPE]: CaptureFrame,
  [PIN_TYPE]: Pin,
  [DRAFT_PIN_TYPE]: DraftPin,
  [CONTEXT_PREVIEW_TYPE]: ContextPreview,
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
 * the transformed plane, not a child: the draft tip is projected to client
 * coordinates on every camera change (useViewport re-renders this on each
 * pan and zoom frame), on window scroll, and on resize, and the pure
 * placement math flips or clamps the box so it stays inside the visible
 * part of the canvas frame (or, when that is too small, the browser
 * viewport).
 */
function DraftComposerPopover({
  tip,
  frameRef,
  children,
}: {
  tip: NaturalPoint;
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

  const anchor = instance.flowToScreenPosition(tip);
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
  const badge = Math.min(MIN_HIT_TARGET_CSS_PX, size.height);
  const placed = placePopover({ anchor, badge, size, bounds });

  return (
    <div
      ref={ref}
      className="pin-composer"
      role="dialog"
      aria-label="New pin"
      data-testid="pin-composer"
      data-side={placed.side}
      style={{ left: placed.left, top: placed.top }}
    >
      {children}
    </div>
  );
}

function CaptureCanvasInner({
  domain,
  regionName,
  readOnly,
  pins,
  previewRect,
  selectedPinId,
  onSelectPin,
  onMovePin,
  savedCamera,
  onCameraChange,
  onDraftChange,
  onDraftSettled,
  draftResetSignal,
  composer,
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
  savedCamera?: CaptureCameraState | null;
  onCameraChange?: (state: CaptureCameraState) => void;
  onDraftChange?: (tip: NaturalPoint | null) => void;
  /**
   * Fires only when a draft's position is final for now — the placement
   * click, the N shortcut, and the end of a draft drag — so the workspace
   * can resolve nearby context once per gesture instead of per drag frame.
   * Never a write.
   */
  onDraftSettled?: (tip: NaturalPoint) => void;
  /** Increments when a draft was saved; the canvas drops the unsaved draft. */
  draftResetSignal?: number;
  /** The draft composer's state and callbacks; shown beside the draft badge. */
  composer?: PinComposerProps | null;
}) {
  const instance = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const doc = useMemo(() => ({ width: domain.width, height: domain.height }), [domain]);
  // The canonical draft state is the pin tip in screenshot-natural pixels.
  // The node array is a disposable view derived from it; the hit-box sizes
  // of drafts and persisted pins follow the live zoom, tracked on every
  // camera change so badges stay screen-sized without their tips moving.
  const [draft, setDraft] = useState<NaturalPoint | null>(null);
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
  const effectivePins = useMemo<CanvasPin[]>(
    () =>
      pins.map((pin) => ({
        ...pin,
        tip: pinDrag?.id === pin.id ? pinDrag.tip : pin.tip,
        selected: pin.id === selectedPinId,
      })),
    [pins, pinDrag, selectedPinId],
  );
  const nodes = useMemo(() => {
    const built = nodesForCapture(domain, effectivePins, draft, liveZoom, previewRect ?? null);
    // The adapter marks pins draggable; only a read-only plane turns that
    // off. There is no mode that could.
    if (!readOnly) return built;
    return built.map((node) => (node.type === PIN_TYPE ? { ...node, draggable: false } : node));
  }, [domain, effectivePins, draft, liveZoom, previewRect, readOnly]);

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

  const reportCamera = useCallback(
    (camera: CanvasCamera) => {
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

  // Escape clears only the transient draft. It never fires while typing in
  // an editable element (the composer handles its own Escape and stops it
  // here), and it never touches persisted state.
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isTextEntry(event.target)) return;
      setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  // Pin dragging (draft and persisted alike): React Flow emits the node's
  // new top-left position; the pure adapter re-derives the clamped canonical
  // tip from it. The grab offset (where inside the box the tip sits) is
  // captured once at drag start and held for the whole gesture: re-deriving
  // it per change from a frame-clamped box would corrupt it, and React
  // Flow's drag-end position re-emission would then advance the tip with no
  // pointer movement at all. All movement is local state — the persisted
  // commit happens exactly once, at drag end, in onNodeDragStop.
  const dragGrab = useRef<Pick<PinBox, "tipOffsetX" | "tipOffsetY"> | null>(null);
  // Where a saved pin's tip was when its drag began: drag end compares the
  // final tip against it to tell a click from a move.
  const dragOrigin = useRef<NaturalPoint | null>(null);
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        const position = change.position;
        if (change.id === draftPinNodeId(domain.captureId)) {
          setDraft((current) => {
            if (!current) return current;
            const zoom = liveZoomRef.current;
            const grab = dragGrab.current ?? pinHitBox(current, doc, zoom);
            return tipFromPinBox(dragPinBox(position, grab, doc, zoom));
          });
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
    [domain.captureId, doc],
  );

  // Put the one draft at a natural point and let the workspace resolve
  // nearby context for it. Exactly one draft per plane: a second click or
  // press of N moves the same draft rather than stacking marks.
  const placeDraft = useCallback(
    (natural: NaturalPoint) => {
      setDraft(natural);
      onDraftSettled?.(natural);
      const zoom = instance.getViewport().zoom;
      liveZoomRef.current = zoom;
      setLiveZoom(zoom);
    },
    [instance, onDraftSettled],
  );

  // A click on the screenshot: a press/release pair with no more than the
  // placement slop of travel. It lands on the wrapper so both the pane and
  // the frame image behave identically; releases on a pin or on the draft
  // itself are theirs (select, or the end of a drag), and releases outside
  // the screenshot do nothing.
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  /** N: a draft at the visible center of the canvas, clamped to the frame. */
  const dropAtViewportCenter = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const center = {
      x: rect.left + wrapper.clientWidth / 2,
      y: rect.top + wrapper.clientHeight / 2,
    };
    const natural = instance.screenToFlowPosition(center);
    if (!Number.isFinite(natural.x) || !Number.isFinite(natural.y)) return;
    onSelectPin?.(null);
    placeDraft(clampNaturalPointToCapture(natural, doc));
  }, [instance, doc, onSelectPin, placeDraft]);

  /** J/K: the next or previous saved pin in number order, wrapping around. */
  const stepSelection = useCallback(
    (direction: 1 | -1) => {
      const ordered = [...pins].sort((a, b) => a.number - b.number);
      if (ordered.length === 0) return;
      const index = ordered.findIndex((pin) => pin.id === selectedPinId);
      const next =
        index === -1
          ? direction === 1
            ? 0
            : ordered.length - 1
          : (index + direction + ordered.length) % ordered.length;
      onSelectPin?.(ordered[next]!.id);
    },
    [pins, selectedPinId, onSelectPin],
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
        stepSelection(1);
        return;
      case "k":
      case "K":
      case "ArrowUp":
        event.preventDefault();
        stepSelection(-1);
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
        onKeyDown={onRegionKeyDown}
        onPointerDown={(event) => {
          // isPrimary is undefined on some synthetic event surfaces; only an
          // explicit non-primary pointer is ignored.
          if (event.isPrimary !== false)
            pressStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = pressStart.current;
          pressStart.current = null;
          if (readOnly || !start || event.isPrimary === false) return;
          const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
          // Past the slop it was a pan (or a pin drag), never a placement.
          if (travel > PLACEMENT_SLOP_SCREEN_PX) return;
          const target = event.target as HTMLElement | null;
          // A click on an existing mark is selection, not placement: a draft
          // stacked on a saved pin would be invisible and confusing.
          if (target?.closest(".react-flow__node-draftPin, .react-flow__node-pin")) return;
          const natural = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          // Placement is only meaningful on the screenshot itself.
          if (
            !Number.isFinite(natural.x) ||
            !Number.isFinite(natural.y) ||
            natural.x < 0 ||
            natural.y < 0 ||
            natural.x > doc.width ||
            natural.y > doc.height
          ) {
            return;
          }
          placeDraft(natural);
        }}
      >
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
              void instance.setViewport({
                x: saved.camera.x,
                y: saved.camera.y,
                zoom: clampCanvasZoom(saved.camera.zoom),
              });
            } else {
              applyMode(modeRef.current);
            }
          }}
          onNodesChange={handleNodesChange}
          onNodeDragStart={(_event, node) => {
            if (node.type === DRAFT_PIN_TYPE && draftRef.current) {
              dragGrab.current = pinHitBox(draftRef.current, doc, liveZoomRef.current);
            } else if (node.type === PIN_TYPE) {
              // The rendered box's recorded offsets are the grab: the tip's
              // position inside the box at drag start, held for the gesture.
              const data = node.data as PinNode["data"];
              dragGrab.current = { tipOffsetX: data.tipOffsetX, tipOffsetY: data.tipOffsetY };
              dragOrigin.current = { x: data.tipX, y: data.tipY };
              pinDragRef.current = null;
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
            } else if (node.type === DRAFT_PIN_TYPE && draftRef.current) {
              // A draft drag commits nothing; it only re-anchors the nearby
              // context query on the final position.
              onDraftSettled?.(draftRef.current);
            }
            dragGrab.current = null;
          }}
          onNodeClick={(_event, node) => {
            if (node.type === PIN_TYPE) onSelectPin?.(node.id);
          }}
          onPaneClick={() => onSelectPin?.(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
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
      </div>
      {/* The composer sits beside the draft badge but outside the transformed
          plane, so it never scales with the zoom and never leaves the
          visible frame. A read-only plane has no drafts and no composer. */}
      {draft && composer && !readOnly ? (
        <DraftComposerPopover tip={draft} frameRef={wrapperRef}>
          <PinComposer {...composer} />
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
  previewRect = null,
  selectedPinId,
  onSelectPin,
  onMovePin,
  savedCamera,
  onCameraChange,
  onDraftChange,
  onDraftSettled,
  draftResetSignal,
  composer,
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
  /** The transient nearby-candidate highlight rect in natural pixels. */
  previewRect?: ContextRect | null;
  selectedPinId?: string | null;
  onSelectPin?: (annotationId: string | null) => void;
  onMovePin?: (annotationId: string, tip: NaturalPoint) => void;
  savedCamera?: CaptureCameraState | null;
  onCameraChange?: (state: CaptureCameraState) => void;
  onDraftChange?: (tip: NaturalPoint | null) => void;
  onDraftSettled?: (tip: NaturalPoint) => void;
  draftResetSignal?: number;
  /** The draft composer's state and callbacks; rendered beside the draft. */
  composer?: PinComposerProps | null;
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
        previewRect={previewRect}
        selectedPinId={selectedPinId}
        onSelectPin={onSelectPin}
        onMovePin={onMovePin}
        savedCamera={savedCamera}
        onCameraChange={onCameraChange}
        onDraftChange={onDraftChange}
        onDraftSettled={onDraftSettled}
        draftResetSignal={draftResetSignal}
        composer={composer}
      />
    </ReactFlowProvider>
  );
}
