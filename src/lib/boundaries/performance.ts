// Tall-capture performance protocol and budgets (VAL-UI-004). The protocol
// is fixed so runs are comparable; budgets are the exact shared limits the
// measurements are judged against.

export interface PerformanceProtocol {
  /** Measured runs per scenario; all must pass. */
  runs: number;
  browser: string;
  /** Viewport the protocol runs at; references the desktop capture policy. */
  viewportName: string;
  machine: string;
  fixture: string;
}

export const PERFORMANCE_PROTOCOL: PerformanceProtocol = Object.freeze({
  runs: 3,
  browser: "Chromium",
  viewportName: "desktop",
  machine: "16 GB RAM / 10 logical cores",
  fixture:
    "maximum-dimension fixture annotated to the per-capture annotation maximum, evenly by kind and height",
});

/** p95 time from image response to a usable canvas. */
export const PERF_IMAGE_TO_USABLE_P95_MS = 3_000;

/** Pan/zoom cycles per run. */
export const PERF_PAN_ZOOM_CYCLES = 60;

/** Selection cycles per run. */
export const PERF_SELECTION_CYCLES = 100;

/** p95 input-to-paint latency during interaction cycles. */
export const PERF_INPUT_TO_PAINT_P95_MS = 100;

/** Longest allowed main-thread task. */
export const PERF_LONGEST_TASK_MS = 200;

/** Post-GC retained heap ceiling: 256 MiB. */
export const PERF_RETAINED_HEAP_MAX_BYTES = 268_435_456;

/** Detached DOM nodes tolerated after GC. */
export const PERF_DETACHED_NODES_MAX = 25;

/** Writes or increasing reads allowed during camera cycles. */
export const PERF_CAMERA_REQUEST_BUDGET = 0;
