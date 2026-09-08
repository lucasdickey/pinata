// ESLint (flat config) covers the plain-JavaScript surface: repository scripts
// and config files. TypeScript/TSX is covered by `npm run typecheck`; ESLint
// deliberately does not parse it here (no typescript-eslint in the approved
// dependency set — see docs/decisions D021).
export default [
  {
    ignores: [
      ".next/**",
      ".vercel/**",
      ".agents/**",
      ".claude/**",
      ".tools/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "docs/dashboard/decisions-data.js",
    ],
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-redeclare": "error",
      "no-undef": "off",
    },
  },
];
