import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated project workspaces are separate, independently-linted
    // projects (each has its own eslint.config.mjs) - never lint their
    // build output or dependencies as part of this app's own lint run.
    "data/workspaces/**",
  ]),
]);

export default eslintConfig;
