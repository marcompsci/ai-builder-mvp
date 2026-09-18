import path from "node:path";
import type { Provider } from "../runStore";

export interface McpServerProcessConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The one, provider-neutral way to get Project Files MCP's stdio launch
 * config. Both adapters call this and translate the (identical-shaped)
 * result into their own SDK's mcpServers config type. This is the only
 * place that knows how the server is actually invoked (tsx + the script
 * path) and the only place that decides what trusted context gets injected
 * via env - never a tool-call parameter, never something the model or the
 * browser can influence.
 */
export function getProjectFilesMcpConfig(params: {
  projectId: string;
  runId: string;
  provider: Provider;
  mode: "read-only" | "read-write";
}): McpServerProcessConfig {
  const serverScript = path.resolve(process.cwd(), "src/mcp/projectFiles/server.ts");

  return {
    command: "npx",
    args: ["tsx", serverScript],
    env: {
      PROJECT_FILES_MCP_PROJECT_ID: params.projectId,
      PROJECT_FILES_MCP_RUN_ID: params.runId,
      PROJECT_FILES_MCP_PROVIDER: params.provider,
      PROJECT_FILES_MCP_MODE: params.mode,
      // The spawned subprocess does not reliably inherit this process's
      // cwd (confirmed via live testing - WORKSPACES_ROOT/DB_PATH resolved
      // wrong without this). Passed explicitly and applied via
      // process.chdir() before any cwd-dependent module is imported - see
      // server.ts.
      PROJECT_FILES_MCP_APP_ROOT: process.cwd(),
      // Inherit PATH etc. so `npx`/`tsx` themselves resolve correctly.
      PATH: process.env.PATH ?? "",
    },
  };
}
