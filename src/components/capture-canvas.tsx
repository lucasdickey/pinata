"use client";

// The controlled React Flow canvas for one active ready capture
// (VAL-CANVAS-002).
//
// The capture is one immutable coordinate plane: a single fixed,
// unselectable screenshot parent node rendered at exactly the persisted
// document dimensions. The project/page/device/version navigation lives
// outside this canvas; only one plane is ever mounted, keyed by capture id,
// so switching captures remounts and resets the camera to the initial mode.
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
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  containCamera,
  naturalCamera,
  widthFitCamera,
} from "../lib/canvas/camera";
import {
  CAPTURE_FRAME_TYPE,
  nodesForCapture,
  type CaptureFrameData,
  type CaptureFrameDomain,
  type CaptureFrameNode,
} from "../lib/canvas/flow-model";

/** The named camera modes; "entire" is the initial view of every capture. */
export const CAMERA_MODES = [
  { id: "entire", label: "Entire page" },
  { id: "width", label: "Fit width" },
  { id: "natural", label: "Natural size" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];

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

const nodeTypes: NodeTypes = { [CAPTURE_FRAME_TYPE]: CaptureFrame };

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
}: {
  domain: CaptureFrameDomain;
  regionName: string;
}) {
  const instance = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // The controlled node array: parent frame first, annotation children
  // (later features) after it. Rebuilt only when the domain record changes.
  const nodes = useMemo(() => nodesForCapture(domain), [domain]);
  const [mode, setMode] = useState<CameraMode>("entire");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // While true, the active named mode re-applies when the stage resizes.
  // Any user pan/zoom gesture ends the follow; picking a mode resumes it.
  const autoFollow = useRef(true);
  // setViewport is a no-op until React Flow's pane machinery has mounted;
  // onInit is the reliable signal that camera writes will land.
  const initialized = useRef(false);

  const applyMode = useCallback(
    (next: CameraMode) => {
      const wrapper = wrapperRef.current;
      // A hidden or unmeasured stage (zero size) has no meaningful camera.
      if (!wrapper || wrapper.clientWidth <= 0 || wrapper.clientHeight <= 0) return;
      const viewport = { width: wrapper.clientWidth, height: wrapper.clientHeight };
      const doc = { width: domain.width, height: domain.height };
      const camera =
        next === "entire"
          ? containCamera(viewport, doc)
          : next === "width"
            ? widthFitCamera(viewport, doc)
            : naturalCamera(viewport, doc);
      setMode(next);
      autoFollow.current = true;
      void instance.setViewport({ x: camera.x, y: camera.y, zoom: camera.zoom });
    },
    [instance, domain],
  );

  // Initial camera and resize tracking: onInit applies the entire-capture
  // view as soon as the pane can accept it, and the observer re-applies the
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
        <button type="button" aria-label="Zoom out" onClick={() => void instance.zoomOut()}>
          −
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => void instance.zoomIn()}>
          +
        </button>
        <ZoomReadout />
      </p>
      <div className="capture-canvas" ref={wrapperRef} role="region" aria-label={regionName}>
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          minZoom={CANVAS_MIN_ZOOM}
          maxZoom={CANVAS_MAX_ZOOM}
          onInit={() => {
            initialized.current = true;
            applyMode(modeRef.current);
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          onMoveStart={(event) => {
            // Programmatic mode changes carry no source event; only a real
            // gesture (drag, wheel, pinch, keys) ends resize-follow.
            if (event) autoFollow.current = false;
          }}
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
}: {
  captureId: string;
  pageUrl: string;
  variant: string;
  attempt: number;
  width: number;
  height: number;
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
      <CaptureCanvasInner domain={domain} regionName={name} />
    </ReactFlowProvider>
  );
}
