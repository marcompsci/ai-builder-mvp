// The ONLY source of trust for this server's identity: environment
// variables injected by our own pipeline code at process-spawn time (see
// src/lib/workspaces/agent/mcp/config.ts). None of these are ever exposed
// as a tool parameter - a model connected to this server has no argument
// through which it could ask for a different project, run, or mode.

export type McpMode = "read-only" | "read-write";

export interface TrustedServerContext {
  projectId: string;
  runId: string;
  provider: "claude-code" | "codex";
  mode: McpMode;
  userId: string;
  orgId: string;
}

class ServerConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ServerConfigError(`Project Files MCP: missing required env var ${name}`);
  }
  return value;
}

export function loadTrustedContext(): TrustedServerContext {
  const mode = requireEnv("PROJECT_FILES_MCP_MODE");
  if (mode !== "read-only" && mode !== "read-write") {
    throw new ServerConfigError(`Project Files MCP: invalid PROJECT_FILES_MCP_MODE "${mode}"`);
  }
  const provider = requireEnv("PROJECT_FILES_MCP_PROVIDER");
  if (provider !== "claude-code" && provider !== "codex") {
    throw new ServerConfigError(`Project Files MCP: invalid PROJECT_FILES_MCP_PROVIDER "${provider}"`);
  }

  return {
    // The workspace root is deliberately NOT passed as its own env var -
    // it's re-derived from projectId via the same trusted getProjectRoot()
    // every other part of this app uses, so there is exactly one source of
    // truth for id -> path resolution, not two that could drift apart.
    projectId: requireEnv("PROJECT_FILES_MCP_PROJECT_ID"),
    runId: requireEnv("PROJECT_FILES_MCP_RUN_ID"),
    provider,
    mode,
    // Fixed local placeholders - see the note on mcp_audit_log in
    // src/lib/db/index.ts. Read from env (not hardcoded) so a future real
    // auth system only has to change the spawning code, not this server.
    userId: process.env.PROJECT_FILES_MCP_USER_ID || "local-dev-user",
    orgId: process.env.PROJECT_FILES_MCP_ORG_ID || "local",
  };
}
