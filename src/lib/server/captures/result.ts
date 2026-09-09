// The Browserless result envelope, validated before anything is believed.
//
// Everything in the provider response is untrusted input: it crossed a
// network, it was produced by code running against a page we do not control,
// and a provider error can arrive with a 200. So the envelope is parsed
// strictly, every number must be finite, and the manifest is re-measured
// server-side rather than trusted from the `truncated` flag.

import { z } from "zod";
import {
  MANIFEST_ELEMENT_KINDS,
  MANIFEST_SCHEMA_VERSION,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
} from "../../boundaries";
import { CAPTURE_FUNCTION_FAILURE_CODES, CAPTURE_RESULT_SCHEMA_VERSION } from "./function-source";

const finite = z.number().finite();
const nonNegative = finite.min(0);
const positiveInt = z.number().int().positive();

const rectSchema = z.object({
  x: finite,
  y: finite,
  width: nonNegative,
  height: nonNegative,
});

const elementSchema = z.object({
  id: z.string().max(16),
  kind: z.enum(MANIFEST_ELEMENT_KINDS as [string, ...string[]]),
  tag: z.string().max(32),
  role: z.string().max(64),
  text: z.string(),
  accessibleName: z.string(),
  hints: z.object({
    id: z.string(),
    classes: z.array(z.string()),
    alt: z.string(),
    title: z.string(),
    testId: z.string(),
  }),
  path: z.array(z.string().max(64)),
  rect: rectSchema,
});

export const captureManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  truncated: z.boolean(),
  elements: z.array(elementSchema).max(MAX_MANIFEST_ELEMENTS),
});

export type CaptureManifest = z.infer<typeof captureManifestSchema>;

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
    title: z.string().max(200),
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
 * Serialize a manifest to the exact UTF-8 JSON that will be persisted, and
 * refuse it if that text exceeds the published cap. The provider computed the
 * same bound in-page; this is the check that actually gates the write.
 */
export function serializeManifest(
  manifest: CaptureManifest,
): { ok: true; json: string; bytes: number } | { ok: false; bytes: number } {
  const json = JSON.stringify(manifest);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_MANIFEST_BYTES) return { ok: false, bytes };
  return { ok: true, json, bytes };
}
