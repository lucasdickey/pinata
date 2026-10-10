// The Chrome extension's copy of the capture contract (D131), as source.
//
// The extension is plain JavaScript loaded unpacked from extension/, with no
// build step, so it cannot import this repository's TypeScript. Instead it
// imports extension/shared.generated.js, which is exactly the string this
// module renders: the in-page element pass the capture provider runs
// (MANIFEST_INSPECT_SOURCE, verbatim), the same limits object it runs with,
// the two device profiles, and the upload and file-format constants.
// test/extension-shared.test.ts compares the committed file with this
// rendering, so the extension can never collect elements differently from
// the provider without the gate failing; `npm run extension:build` rewrites
// the file.

import {
  EXTENSION_TOKEN_EXPIRES_HEADER,
  EXTENSION_TOKEN_HEADER,
} from "../../auth-constants";
import {
  CAPTURE_PACKAGE_FORMAT,
  CAPTURE_PACKAGE_VERSION,
  MAX_DOCUMENT_HEIGHT_PX,
  MAX_DOCUMENT_PIXELS,
  UPLOAD_IMAGE_MAX_BYTES,
} from "../../boundaries";
import { DEVICE_PROFILES } from "../captures/devices";
import { captureFunctionLimits } from "../captures/execute";
import { MANIFEST_INSPECT_SOURCE } from "../captures/manifest-source";

const constant = (name: string, value: unknown) =>
  `export const ${name} = ${JSON.stringify(value, null, 2)};\n`;

/** The full text of extension/shared.generated.js. */
export function renderExtensionShared(): string {
  return [
    "// GENERATED FILE. Do not edit.\n",
    "// Rendered from src/lib/server/extension/shared-source.ts by\n",
    "// `npm run extension:build`; test/extension-shared.test.ts fails when it is stale.\n",
    "// The capture provider's own element pass and limits (D131), so the\n",
    "// extension's captures carry exactly the element lists the provider's do.\n\n",
    "/** `(context) => inspection`, as the capture provider runs it. */\n",
    constant("INSPECT_SOURCE", MANIFEST_INSPECT_SOURCE),
    "\n/** The `context.limits` every capture runs with. */\n",
    constant("CAPTURE_LIMITS", captureFunctionLimits()),
    "\n/** The Desktop and Mobile devices: viewport, touch, and user agent. */\n",
    constant("DEVICE_PROFILES", DEVICE_PROFILES),
    "\n",
    constant("MAX_DOCUMENT_HEIGHT_PX", MAX_DOCUMENT_HEIGHT_PX),
    constant("MAX_DOCUMENT_PIXELS", MAX_DOCUMENT_PIXELS),
    constant("UPLOAD_IMAGE_MAX_BYTES", UPLOAD_IMAGE_MAX_BYTES),
    constant("CAPTURE_PACKAGE_FORMAT", CAPTURE_PACKAGE_FORMAT),
    constant("CAPTURE_PACKAGE_VERSION", CAPTURE_PACKAGE_VERSION),
    constant("EXTENSION_TOKEN_HEADER", EXTENSION_TOKEN_HEADER),
    constant("EXTENSION_TOKEN_EXPIRES_HEADER", EXTENSION_TOKEN_EXPIRES_HEADER),
  ].join("");
}
