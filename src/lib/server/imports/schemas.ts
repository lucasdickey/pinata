// The strict shape of one capture import's `meta` part (D131). Everything
// in it is untrusted: the manifest gets the provider envelope's structural
// schema here and the same server-side bounding afterwards, and the image
// dimensions it names are checked against the decoded pixels.

import { z } from "zod";
import {
  IDEMPOTENCY_KEY_MAX_CHARS,
  IDEMPOTENCY_KEY_MIN_CHARS,
  MANIFEST_RECT_MAX_PX,
  MAX_URL_BYTES,
  PROJECT_TITLE_MAX_CHARS,
} from "../../boundaries";
import { captureManifestSchema } from "../captures/result";
import { CAPTURE_VARIANTS } from "../db/schema";

/** A stable identifier from the hierarchy: a public id or a page id. */
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const dimension = z.number().int().positive().max(MANIFEST_RECT_MAX_PX);

export const importMetaSchema = z.strictObject({
  idempotencyKey: z.string().min(IDEMPOTENCY_KEY_MIN_CHARS).max(IDEMPOTENCY_KEY_MAX_CHARS),
  /**
   * Where the capture goes: an existing project (and, optionally, one of its
   * pages), or a new project made for it.
   */
  target: z.union([
    z.strictObject({ project: identifier, page: identifier.optional() }),
    z.strictObject({
      newProject: z.strictObject({ title: z.string().max(PROJECT_TITLE_MAX_CHARS).optional() }),
    }),
  ]),
  /**
   * The captured page's address: the label that files the capture under a
   * page (D134). Required unless the target names the page.
   */
  url: z.string().min(1).max(MAX_URL_BYTES).optional(),
  variant: z.enum(CAPTURE_VARIANTS),
  /** When the screenshot was taken, epoch ms; clamped to now. */
  capturedAt: z.number().int().nonnegative().optional(),
  /** The document the screenshot shows, in CSS px; must equal its pixels. */
  document: z.strictObject({ width: dimension, height: dimension }),
  /** The page's element list, or null for a plain image. */
  manifest: captureManifestSchema.nullable(),
});

export type ImportMeta = z.infer<typeof importMetaSchema>;
