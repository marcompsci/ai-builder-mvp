#!/usr/bin/env node
export {}; // forces module scope so requireAppRoot() below doesn't collide globally with github/server.ts's own
// Bootstrap only. This file deliberately has NO static imports of anything
// that resolves paths relative to process.cwd() (workspaces/config.ts,
// lib/db, etc.) - the subprocess spawned for this server does not reliably
// inherit this app's cwd (confirmed via live testing: WORKSPACES_ROOT and
// the SQLite DB path both resolved wrong without this). chdir happens
// FIRST, then main.ts (and everything it statically imports) is loaded via
// a dynamic import, which - unlike a static import - only runs after this
// function body executes, not before it.

function requireAppRoot(): string {
  const root = process.env.PROJECT_FILES_MCP_APP_ROOT;
  if (!root) {
    console.error("Project Files MCP: missing required env var PROJECT_FILES_MCP_APP_ROOT");
    process.exit(1);
  }
  return root;
}

process.chdir(requireAppRoot());

import("./main")
  .then((mod) => mod.main())
  .catch((err) => {
    // stderr only - never write tool output or trust context to stdout,
    // which is the MCP protocol channel.
    console.error("Project Files MCP failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
