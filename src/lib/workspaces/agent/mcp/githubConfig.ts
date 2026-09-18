import path from "node:path";
import type { Provider } from "../runStore";
import type { McpServerProcessConfig } from "./config";

/**
 * The one, provider-neutral way to get GitHub MCP's stdio launch config.
 * Mirrors getProjectFilesMcpConfig exactly (see config.ts in this
 * directory) - same trusted-context-via-env-injection pattern, same
 * chdir-bootstrap requirement. Only ever called when a repo connection has
 * actually been selected for the project (see docs/github-mcp.md); when
 * there is none, this server is simply never spawned.
 */
export function getGitHubMcpConfig(params: {
  projectId: string;
  runId: string;
  provider: Provider;
  connectionId: string;
  installationId: string;
  repoFullName: string;
  defaultBranch: string;
}): McpServerProcessConfig {
  const serverScript = path.resolve(process.cwd(), "src/mcp/github/server.ts");

  return {
    command: "npx",
    args: ["tsx", serverScript],
    env: {
      GITHUB_MCP_PROJECT_ID: params.projectId,
      GITHUB_MCP_RUN_ID: params.runId,
      GITHUB_MCP_PROVIDER: params.provider,
      GITHUB_MCP_CONNECTION_ID: params.connectionId,
      GITHUB_MCP_INSTALLATION_ID: params.installationId,
      GITHUB_MCP_REPO_FULL_NAME: params.repoFullName,
      GITHUB_MCP_DEFAULT_BRANCH: params.defaultBranch,
      GITHUB_MCP_APP_ROOT: process.cwd(),
      PATH: process.env.PATH ?? "",
    },
  };
}
