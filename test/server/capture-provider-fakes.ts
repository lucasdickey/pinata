// Deterministic Browserless and Blob doubles for focused capture tests.
//
// These exist so failure paths can be exercised without touching the real
// provider configuration, which mission rules forbid. They prove adapter and
// lifecycle behaviour only: the real-provider proof lives in
// test/integration/browserless-capture.integration.test.ts.

import type {
  BlobObjectInfo,
  BlobResult,
  ScreenshotStore,
} from "../../src/lib/server/providers/blob";
import type {
  BrowserlessClient,
  BrowserlessRunRequest,
  BrowserlessRunResult,
} from "../../src/lib/server/providers/browserless";
import { encodeSolidPng } from "../helpers/png";

export const FIXTURE_DOC = { width: 400, height: 300 };
export const FIXTURE_PNG = encodeSolidPng({ ...FIXTURE_DOC, rgb: [200, 220, 240] });
export const FIXTURE_NONCE = "layout_00112233445566";
export const FIXTURE_URL = "https://fixture.example/page";

export interface EnvelopeOverrides {
  document?: Partial<typeof FIXTURE_DOC>;
  layoutNonce?: string;
  variant?: string;
  finalUrl?: string;
  image?: { contentType?: string; base64?: string };
  warnings?: string[];
  manifest?: unknown;
}

/** The layout-nonce entry every honest manifest carries (VAL-CAPTURE-005). */
function nonceElement(nonce: string) {
  return {
    id: "nonce",
    kind: "text",
    tag: "div",
    role: "",
    text: nonce,
    accessibleName: nonce,
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["html:1", "body:1", "div:1"],
    rect: { x: 0, y: 0, width: 148, height: 20 },
  };
}

/** Wrap a capture envelope the way the Function API transport does. */
function transport(data: unknown): string {
  return JSON.stringify({ data, type: "application/json" });
}

/** A well-formed successful provider envelope, minus whatever a test breaks. */
export function successEnvelope(overrides: EnvelopeOverrides = {}): string {
  const document = { ...FIXTURE_DOC, ...overrides.document };
  const layoutNonce = overrides.layoutNonce ?? FIXTURE_NONCE;
  return transport({
    schemaVersion: 1,
    ok: true,
    variant: overrides.variant ?? "desktop",
    layoutNonce,
    requestedUrl: FIXTURE_URL,
    finalUrl: overrides.finalUrl ?? FIXTURE_URL,
    viewport: {
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 1,
      maxTouchPoints: 0,
      pointerCoarse: false,
      hoverNone: false,
      prefersReducedMotion: true,
      userAgent: "HeadlessChrome/999",
    },
    document: { ...document, title: "Fixture", scrollX: 0, scrollY: 0, scrollSteps: 3 },
    stabilization: {
      animationsPaused: 2,
      videos: 1,
      videosPaused: 1,
      animatedImagesFrozen: 1,
      canvasCount: 1,
      stickyCount: 1,
      anchorsMeasured: 12,
      maxAnchorShiftPx: 0,
    },
    manifest: overrides.manifest ?? {
      schemaVersion: 1,
      truncated: false,
      elements: [
        nonceElement(layoutNonce),
        {
          id: "e2",
          kind: "heading",
          tag: "h1",
          role: "",
          text: "Fixture heading",
          accessibleName: "Fixture heading",
          hints: { id: "top", classes: ["hero"], alt: "", title: "", testId: "" },
          path: ["html:1", "body:1", "h1:1"],
          rect: { x: 0, y: 40, width: 400, height: 40 },
        },
      ],
    },
    image: {
      contentType: overrides.image?.contentType ?? "image/png",
      base64: overrides.image?.base64 ?? Buffer.from(FIXTURE_PNG).toString("base64"),
    },
    warnings: overrides.warnings ?? ["motion-unsupported-warn:canvas-js"],
    blocked: [],
  });
}

/** Bounded failure envelope with one of the function's published codes. */
export function failureEnvelope(code: string): string {
  return transport({
    schemaVersion: 1,
    ok: false,
    code,
    layoutNonce: FIXTURE_NONCE,
    warnings: [],
    blocked: [],
  });
}

export interface RecordingClient {
  client: BrowserlessClient;
  requests: BrowserlessRunRequest[];
}

/**
 * A client that answers with one JSON body, one transport failure, or a
 * caller-supplied handler, recording every request it received.
 */
export function recordingClient(
  answer: string | BrowserlessRunResult | ((request: BrowserlessRunRequest) => Promise<string>),
): RecordingClient {
  const requests: BrowserlessRunRequest[] = [];
  const toBody = (body: string): BrowserlessRunResult => ({
    ok: true,
    status: 200,
    body: new Uint8Array(Buffer.from(body, "utf8")),
  });
  return {
    requests,
    client: {
      async runFunction(request) {
        requests.push(request);
        if (typeof answer === "function") return toBody(await answer(request));
        return typeof answer === "string" ? toBody(answer) : answer;
      },
    },
  };
}

/**
 * A client that answers each request with an envelope derived from the
 * context it was handed, so tests need not know the per-execution nonce.
 */
export function echoClient(overrides: EnvelopeOverrides = {}): RecordingClient {
  return recordingClient(async (request) => {
    const context = request.context as {
      targetUrl: string;
      variant: string;
      layoutNonce: string;
    };
    return successEnvelope({
      variant: context.variant,
      layoutNonce: context.layoutNonce,
      finalUrl: context.targetUrl,
      ...overrides,
    });
  });
}

export interface RecordingStore {
  store: ScreenshotStore;
  puts: { pathname: string; bytes: Uint8Array; contentType: string }[];
  deletes: string[];
}

/** A store that records writes and deletes, with overridable operations. */
export function recordingStore(overrides: Partial<ScreenshotStore> = {}): RecordingStore {
  const puts: RecordingStore["puts"] = [];
  const deletes: string[] = [];
  const ok = <T>(value: T): BlobResult<T> => ({ ok: true, value });
  return {
    puts,
    deletes,
    store: {
      async put(pathname, bytes, contentType) {
        puts.push({ pathname, bytes, contentType });
        return ok<BlobObjectInfo>({ pathname, contentType, bytes: bytes.byteLength });
      },
      async head(pathname) {
        return ok<BlobObjectInfo>({
          pathname,
          contentType: "image/png",
          bytes: FIXTURE_PNG.byteLength,
        });
      },
      async get() {
        return ok(FIXTURE_PNG);
      },
      async del(pathname) {
        deletes.push(pathname);
        return ok(null);
      },
      ...overrides,
    },
  };
}
