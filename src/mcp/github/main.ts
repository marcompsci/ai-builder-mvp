import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadTrustedContext } from "./config";
import { registerReadOnlyTools, registerWriteTools } from "./tools";

export async function main() {
  const ctx = loadTrustedContext();

  const server = new McpServer({ name: "github", version: "1.0.0" });

  registerReadOnlyTools(server, ctx);
  // Write tools are always safe to register - none of them execute a
  // GitHub action directly, each one only ever creates a pending
  // github_approvals row (see tools.ts). The actual "no GitHub actions
  // during planning" guarantee comes from this server never being spawned
  // at all during the plan phase - see mcp/githubConfig.ts and policy.ts.
  registerWriteTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
