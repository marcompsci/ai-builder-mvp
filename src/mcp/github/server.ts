#!/usr/bin/env node
export {}; // forces module scope so requireAppRoot() below doesn't collide globally with projectFiles/server.ts's own
// Bootstrap only - mirrors src/mcp/projectFiles/server.ts exactly, for the
// same reason: the subprocess spawned for this server does not reliably
// inherit this app's cwd, and tsx resolves tsconfig path aliases once at
// startup based on the subprocess's INITIAL cwd, which a later chdir()
// cannot retroactively fix for tsx's alias resolution (only for
// process.cwd()-dependent code). chdir happens FIRST; main.ts (and every
// module it statically imports, all using relative imports - never "@/")
// is loaded via a dynamic import so it only runs after this executes.

function requireAppRoot(): string {
  const root = process.env.GITHUB_MCP_APP_ROOT;
  if (!root) {
    console.error("GitHub MCP: missing required env var GITHUB_MCP_APP_ROOT");
    process.exit(1);
  }
  return root;
}

process.chdir(requireAppRoot());

import("./main")
  .then((mod) => mod.main())
  .catch((err) => {
    console.error("GitHub MCP failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
