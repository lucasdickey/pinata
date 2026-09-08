import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps "jsx": "preserve" for Next.js; Vitest's oxc transform needs
  // real JSX output for component tests.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    include: ["test/**/*.test.{mjs,ts,tsx}"],
    environment: "node",
  },
});
