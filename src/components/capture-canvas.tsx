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
// Two explicit interaction modes keep navigation and editing separate:
// Navigate pans/zooms and never creates a mark; Place pin turns one
// deliberate click/tap into exactly one transient draft pin and disables
// drag-panning so presses cannot be mistaken for pans. Drafts are local UI
// state — draggable with the pointer's grab offset preserved, clamped
// inclusively to the frame, cleared by Escape, and dropped on any capture
// switch (the keyed remount). Persisted pins are the server-canonical
// records passed in as props: they render as numbered badges parented to
// the frame, drag with the same grab-offset/clamp math in Place pin mode
// only (a Navigate press always pans; it must never move a mark), a tap on
// one selects rather than stacking a draft, and a drag commits exactly one
// revisioned write at drag end (onMovePin). Camera work, selection, and
// intermediate drag frames never write.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  dragPinBox,
  pinHitBox,
  PLACEMENT_SLOP_SCREEN_PX,
  tipFromPinBox,
  type PinBox,
} from "../lib/canvas/geometry";
import {
  CAPTURE_FRAME_TYPE,
  DRAFT_PIN_TYPE,
  PIN_TYPE,
  draftPinNodeId,
  nodesForCapture,
  type CanvasPin,
  type CaptureFrameDomain,
  type CaptureFrameNode,
  type DraftPinNode,
  type PinNode,
} from "../lib/canvas/flow-model";

/** The named camera modes; "entire" is the initial view of every capture. */
export const CAMERA_MODES = [
  { id: "entire", label: "Entire page" },
  { id: "width", label: "Fit width" },
  { id: "natural", label: "Natural size" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];

/** The named interaction modes: navigation can never create a mark. */
export const INTERACTION_MODES = [
  { id: "navigate", label: "Navigate" },
  { id: "pin", label: "Place pin" },
] as const;

export type InteractionMode = (typeof INTERACTION_MODES)[number]["id"];

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

const nodeTypes: NodeTypes = {
  [CAPTURE_FRAME_TYPE]: CaptureFrame,
  [PIN_TYPE]: Pin,
  [DRAFT_PIN_TYPE]: DraftPin,
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

function CaptureCanvasInner({
  domain,
  regionName,
  pins,
  selectedPinId,
  onSelectPin,
  onMovePin,
  savedCamera,
  onCameraChange,
  onDraftChange,
  draftResetSignal,
}: {
  domain: CaptureFrameDomain;
  regionName: string;
  /** This plane's persisted pins (server is canonical; never RF state). */
  pins: Omit<CanvasPin, "selected">[];
  selectedPinId?: string | null;
  onSelectPin?: (annotationId: string | null) => void;
  /** The single commit at the end of a pin drag: one clamped tip, one write. */
  onMovePin?: (annotationId: string, tip: NaturalPoint) => void;
  savedCamera?: CaptureCameraState | null;
  onCameraChange?: (state: CaptureCameraState) => void;
  onDraftChange?: (tip: NaturalPoint | null) => void;
  /** Increments when a draft was saved; the canvas drops the unsaved draft. */
  draftResetSignal?: number;
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
  // The interaction mode gates persisted-pin dragging: a press in Navigate
  // mode always pans (it must never move a mark — an accidental drag would
  // commit a real write), while Place pin mode owns mark manipulation.
  // Draft pins stay draggable in either mode: a draft only exists because
  // pin mode created it, and adjusting it after switching back to navigate
  // is the shipped placement flow. The adapter marks pins draggable-capable;
  // this layer enforces the mode.
  const [interaction, setInteraction] = useState<InteractionMode>("navigate");
  // A persisted pin being dragged: movement is local state, re-derived
  // through the pure clamping adapter; the commit at drag end is one write.
  const [pinDrag, setPinDrag] = useState<{ id: string; tip: NaturalPoint } | null>(null);
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
    const built = nodesForCapture(domain, effectivePins, draft, liveZoom);
    if (interaction === "pin") return built;
    return built.map((node) => (node.type === PIN_TYPE ? { ...node, draggable: false } : node));
  }, [domain, effectivePins, draft, liveZoom, interaction]);

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

  // Report the draft to the screen-fixed panel (and clear it there) whenever
  // it changes; the panel lives outside the transformed canvas. The initial
  // null mount is not a change and is never reported.
  const draftReported = useRef(false);
  useEffect(() => {
    if (!draftReported.current) {
      draftReported.current = true;
      if (draft === null) return;
    }
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

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
  // an editable element, and it never touches persisted state.
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
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
          setPinDrag((current) => {
            const zoom = liveZoomRef.current;
            const grab = dragGrab.current;
            if (!grab) return current;
            const tip = tipFromPinBox(dragPinBox(position, grab, doc, zoom));
            return { id: change.id, tip };
          });
        }
      }
    },
    [domain.captureId, doc],
  );

  // Placement taps: a press/release pair with less than the placement slop
  // of travel is one deliberate action. It lands on the wrapper so both the
  // pane and the frame image behave identically; taps on the draft itself
  // (its drag handles) and taps outside the screenshot do nothing.
  const pressStart = useRef<{ x: number; y: number } | null>(null);

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
      <p className="capture-camera" role="group" aria-label="Canvas tools">
        {INTERACTION_MODES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            aria-pressed={interaction === candidate.id}
            onClick={() => setInteraction(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </p>
      <div
        className="capture-canvas"
        ref={wrapperRef}
        role="region"
        aria-label={regionName}
        data-interaction={interaction}
        onPointerDown={(event) => {
          // isPrimary is undefined on some synthetic event surfaces; only an
          // explicit non-primary pointer is ignored.
          if (event.isPrimary !== false)
            pressStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = pressStart.current;
          pressStart.current = null;
          if (!start || interaction !== "pin" || event.isPrimary === false) return;
          const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
          if (travel > PLACEMENT_SLOP_SCREEN_PX) return;
          const target = event.target as HTMLElement | null;
          // Taps on an existing mark are selection, not placement: a draft
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
          // Exactly one draft per plane: a second deliberate tap moves the
          // same draft to the new target rather than stacking marks.
          setDraft(natural);
          const zoom = instance.getViewport().zoom;
          liveZoomRef.current = zoom;
          setLiveZoom(zoom);
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
            }
          }}
          onNodeDragStop={(_event, node) => {
            if (node.type === PIN_TYPE) {
              // The one write of a drag: the final clamped natural tip.
              // Intermediate frames were local state only.
              setPinDrag((current) => {
                if (current && current.id === node.id) onMovePin?.(node.id, current.tip);
                return null;
              });
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
          zoomOnDoubleClick={false}
          panOnDrag={interaction === "navigate"}
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
  pins = [],
  selectedPinId,
  onSelectPin,
  onMovePin,
  savedCamera,
  onCameraChange,
  onDraftChange,
  draftResetSignal,
}: {
  captureId: string;
  pageUrl: string;
  variant: string;
  attempt: number;
  width: number;
  height: number;
  /** This plane's persisted pins; empty until they load or when none exist. */
  pins?: Omit<CanvasPin, "selected">[];
  selectedPinId?: string | null;
  onSelectPin?: (annotationId: string | null) => void;
  onMovePin?: (annotationId: string, tip: NaturalPoint) => void;
  savedCamera?: CaptureCameraState | null;
  onCameraChange?: (state: CaptureCameraState) => void;
  onDraftChange?: (tip: NaturalPoint | null) => void;
  draftResetSignal?: number;
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
        pins={pins}
        selectedPinId={selectedPinId}
        onSelectPin={onSelectPin}
        onMovePin={onMovePin}
        savedCamera={savedCamera}
        onCameraChange={onCameraChange}
        onDraftChange={onDraftChange}
        draftResetSignal={draftResetSignal}
      />
    </ReactFlowProvider>
  );
}
