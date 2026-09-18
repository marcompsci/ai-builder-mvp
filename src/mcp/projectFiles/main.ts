import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadTrustedContext } from "./config";
import { registerReadOnlyTools, registerWriteTool } from "./tools";

export async function main() {
  const ctx = loadTrustedContext();

  const server = new McpServer({ name: "project-files", version: "1.0.0" });

  registerReadOnlyTools(server, ctx);
  if (ctx.mode === "read-write") {
    registerWriteTool(server, ctx);
  }
  // Note: in "read-only" mode, write_project_file is never registered at
  // all - not hidden behind a runtime check, structurally absent from this
  // process's tool list. See docs/project-files-mcp.md.

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
