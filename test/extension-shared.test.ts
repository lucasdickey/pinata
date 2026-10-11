// The extension's generated copy of the capture contract (D131) must be
// exactly what the server would render today. `npm run extension:build`
// rewrites the file (vitest -u); without it, a stale copy fails here.

import { expect, test } from "vitest";
import { renderExtensionShared } from "../src/lib/server/extension/shared-source";

test("extension/shared.generated.js matches the capture provider's contract", async () => {
  await expect(renderExtensionShared()).toMatchFileSnapshot("../extension/shared.generated.js");
});
