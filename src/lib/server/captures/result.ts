// The Browserless result envelope, validated before anything is believed.
//
// Everything in the provider response is untrusted input: it crossed a
// network, it was produced by code running against a page we do not control,
// and a provider error can arrive with a 200. So the envelope is parsed
// strictly, every number must be finite, and the manifest is re-measured
// server-side rather than trusted from the `truncated` flag.

import { z } from "zod";
import {
  MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
  MANIFEST_ELEMENT_KINDS,
  MANIFEST_HINT_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_TEXT_MAX_CHARS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
} from "../../boundaries";
import { CAPTURE_FUNCTION_FAILURE_CODES, CAPTURE_RESULT_SCHEMA_VERSION } from "./function-source";
import { DOCUMENT_TITLE_MAX_CHARS } from "./manifest";

const finite = z.number().finite();
const nonNegative = finite.min(0);
const positiveInt = z.number().int().positive();

const rectSchema = z
  .object({
    x: finite,
    y: finite,
    width: nonNegative,
    height: nonNegative,
  })
  .strict();

/**
 * String slack over the published character caps. The parse stage owns
 * structure — exact keys, enums, counts, finite numbers — while `boundManifest`
 * owns content, so a page that finds a gap in the in-page cleaner is trimmed
 * rather than failing an otherwise good capture. The slack is still bounded:
 * an unbounded field would let one element eat the whole response.
 */
const SLACK = 8;

const elementSchema = z
  .object({
    id: z.string().max(16),
    kind: z.enum(MANIFEST_ELEMENT_KINDS as [string, ...string[]]),
    tag: z.string().max(32),
    role: z.string().max(MANIFEST_HINT_MAX_CHARS * SLACK),
    text: z.string().max(MANIFEST_TEXT_MAX_CHARS * SLACK),
    accessibleName: z.string().max(MANIFEST_ACCESSIBLE_NAME_MAX_CHARS * SLACK),
    hints: z
      .object({
        id: z.string().max(MANIFEST_HINT_MAX_CHARS * SLACK),
        classes: z
          .array(z.string().max(MANIFEST_HINT_MAX_CHARS * SLACK))
          .max(MANIFEST_MAX_CLASSES * SLACK),
        alt: z.string().max(MANIFEST_ACCESSIBLE_NAME_MAX_CHARS * SLACK),
        title: z.string().max(MANIFEST_ACCESSIBLE_NAME_MAX_CHARS * SLACK),
        testId: z.string().max(MANIFEST_HINT_MAX_CHARS * SLACK),
      })
      .strict(),
    path: z.array(z.string().max(MANIFEST_HINT_MAX_CHARS)).max(MANIFEST_PATH_MAX_DEPTH * SLACK),
    rect: rectSchema,
  })
  .strict();

export const captureManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    truncated: z.boolean(),
    elements: z.array(elementSchema).max(MAX_MANIFEST_ELEMENTS),
  })
  .strict();

export type CaptureManifest = z.infer<typeof captureManifestSchema>;
export type CaptureManifestElement = z.infer<typeof elementSchema>;

const successSchema = z.object({
  schemaVersion: z.literal(CAPTURE_RESULT_SCHEMA_VERSION),
  ok: z.literal(true),
  variant: z.enum(["desktop", "mobile"]),
  layoutNonce: z.string().min(8).max(64),
  requestedUrl: z.string().url().max(4096),
  finalUrl: z.string().url().max(4096),
  viewport: z.object({
    innerWidth: positiveInt,
    innerHeight: positiveInt,
    devicePixelRatio: finite.positive(),
    maxTouchPoints: nonNegative,
    pointerCoarse: z.boolean(),
    hoverNone: z.boolean(),
    prefersReducedMotion: z.boolean(),
    userAgent: z.string().max(256),
  }),
  document: z.object({
    width: positiveInt,
    height: positiveInt,
    title: z.string().max(DOCUMENT_TITLE_MAX_CHARS),
    scrollX: finite,
    scrollY: finite,
    scrollSteps: nonNegative,
  }),
  stabilization: z.object({
    animationsPaused: nonNegative,
    videos: nonNegative,
    videosPaused: nonNegative,
    animatedImagesFrozen: nonNegative,
    canvasCount: nonNegative,
    stickyCount: nonNegative,
    anchorsMeasured: nonNegative,
    maxAnchorShiftPx: nonNegative,
  }),
  manifest: captureManifestSchema,
  image: z.object({
    contentType: z.string().max(64),
    base64: z.string().min(1),
  }),
  warnings: z.array(z.string().max(64)).max(16),
  blocked: z
    .array(z.object({ topLevel: z.boolean(), reason: z.string().max(32) }))
    .max(32),
});

const failureSchema = z.object({
  schemaVersion: z.literal(CAPTURE_RESULT_SCHEMA_VERSION),
  ok: z.literal(false),
  code: z.enum(CAPTURE_FUNCTION_FAILURE_CODES),
  layoutNonce: z.string().max(64).optional(),
  warnings: z.array(z.string().max(64)).max(16).default([]),
  blocked: z
    .array(z.object({ topLevel: z.boolean(), reason: z.string().max(32) }))
    .max(32)
    .default([]),
});

export const captureResultSchema = z.union([successSchema, failureSchema]);

/**
 * The provider's own transport envelope. A Function API response is always
 * `{ data, type }`; the capture envelope is what the function put in `data`.
 */
const providerEnvelopeSchema = z.object({
  data: z.unknown(),
  type: z.string().max(128),
});

export type CaptureSuccessResult = z.infer<typeof successSchema>;
export type CaptureFailureResult = z.infer<typeof failureSchema>;
export type CaptureResult = z.infer<typeof captureResultSchema>;

/**
 * Parse a raw provider response body into a validated capture result.
 * Returns null for anything else — a provider error page, a truncated body,
 * an unexpected envelope, or a capture envelope that fails validation.
 */
export function parseCaptureResponse(body: Uint8Array): CaptureResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return null;
  }
  const transport = providerEnvelopeSchema.safeParse(parsed);
  if (!transport.success) return null;
  if (!transport.data.type.startsWith("application/json")) return null;
  const envelope = captureResultSchema.safeParse(transport.data.data);
  return envelope.success ? envelope.data : null;
}

/**
 * True when a manifest's exact persisted UTF-8 JSON is inside the published
 * cap. `boundManifest` guarantees this; this is the assertion that says so.
 */
export function manifestFits(manifest: CaptureManifest): boolean {
  return Buffer.byteLength(JSON.stringify(manifest), "utf8") <= MAX_MANIFEST_BYTES;
}
