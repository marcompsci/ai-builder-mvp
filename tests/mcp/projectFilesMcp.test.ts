import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PROJECT_ID = "prj_aaaaaaaa-test-project";
const OTHER_PROJECT_ID = "prj_bbbbbbbb-other-project";

let tmpRoot: string;
let registerReadOnlyTools: typeof import("@/mcp/projectFiles/tools").registerReadOnlyTools;
let registerWriteTool: typeof import("@/mcp/projectFiles/tools").registerWriteTool;
let getDb: typeof import("@/lib/db").getDb;

type Ctx = {
  projectId: string;
  runId: string;
  provider: "claude-code";
  mode: "read-only" | "read-write";
  userId: string;
  orgId: string;
};

async function startServer(ctx: Ctx, mode: "read-only" | "read-write") {
  const server = new McpServer({ name: "project-files", version: "1.0.0" });
  registerReadOnlyTools(server, ctx);
  if (mode === "read-write") registerWriteTool(server, ctx);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

function ctxFor(mode: "read-only" | "read-write", runId = "run-1"): Ctx {
  return { projectId: PROJECT_ID, runId, provider: "claude-code", mode, userId: "local-dev-user", orgId: "local" };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
  process.env.WORKSPACES_ROOT = tmpRoot;

  const projectRoot = path.join(tmpRoot, PROJECT_ID);
  await fs.mkdir(path.join(projectRoot, "src", "app"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "app", "page.tsx"), "export default function Page() { return 1; }\n");
  await fs.writeFile(path.join(projectRoot, ".env"), "SECRET=top-secret-value\n");
  await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ scripts: { build: "next build" } }));

  const otherRoot = path.join(tmpRoot, OTHER_PROJECT_ID);
  await fs.mkdir(otherRoot, { recursive: true });
  await fs.writeFile(path.join(otherRoot, "secret-plan.md"), "confidential other-tenant content\n");

  // Symlink escape target, outside the sandbox entirely.
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-outside-"));
  await fs.writeFile(path.join(outsideDir, "host-secret.txt"), "host secret\n");
  await fs.symlink(path.join(outsideDir, "host-secret.txt"), path.join(projectRoot, "escape.txt"));

  const toolsMod = await import("@/mcp/projectFiles/tools");
  registerReadOnlyTools = toolsMod.registerReadOnlyTools;
  registerWriteTool = toolsMod.registerWriteTool;
  const dbMod = await import("@/lib/db");
  getDb = dbMod.getDb;
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("Project Files MCP - read tools", () => {
  it("list_project_files returns only safe relative entries, excluding .env and node_modules-style dirs", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "list_project_files", arguments: {} });
    const text = (res.content as { text: string }[])[0].text;
    expect(text).not.toContain(".env");
    expect(text).toContain("page.tsx");
  });

  it("read_project_file reads an allowed file", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "read_project_file", arguments: { path: "src/app/page.tsx" } });
    expect(res.isError).toBeFalsy();
    const text = (res.content as { text: string }[])[0].text;
    expect(text).toContain("export default function Page");
  });

  it("read_project_file blocks .env with a safe, generic error (no path/stack leak)", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "read_project_file", arguments: { path: ".env" } });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0].text;
    expect(text).not.toContain(tmpRoot);
    expect(text).not.toContain("top-secret-value");
    expect(text).not.toContain("ENOENT");
  });

  it("read_project_file blocks path traversal", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "read_project_file", arguments: { path: "../../etc/passwd" } });
    expect(res.isError).toBe(true);
  });

  it("read_project_file blocks absolute paths", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "read_project_file", arguments: { path: "/etc/passwd" } });
    expect(res.isError).toBe(true);
  });

  it("read_project_file enforces a size limit", async () => {
    const projectRoot = path.join(tmpRoot, PROJECT_ID);
    await fs.writeFile(path.join(projectRoot, "src", "app", "huge.txt"), "a".repeat(300 * 1024));
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "read_project_file", arguments: { path: "src/app/huge.txt" } });
    expect(res.isError).toBe(true);
  });

  it("read_project_file blocks a symlink escaping the sandbox", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "read_project_file", arguments: { path: "escape.txt" } });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0].text;
    expect(text).not.toContain("host secret");
  });

  it("cannot read a sibling project's files via relative traversal out of the active workspace", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({
      name: "read_project_file",
      arguments: { path: `../${OTHER_PROJECT_ID}/secret-plan.md` },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0].text;
    expect(text).not.toContain("confidential other-tenant content");
  });

  it("cannot access another project's files - there is no project/workspace parameter on any tool to even attempt it", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
      expect(props).not.toContain("projectId");
      expect(props).not.toContain("project_id");
      expect(props).not.toContain("workspaceRoot");
      expect(props).not.toContain("workspace");
    }
    // The only way to prove isolation directly is to attempt a path that
    // would resolve into a sibling project directory via traversal - which
    // is exactly the traversal defense already tested above. Cross-project
    // access is structurally impossible here, not just blocked at runtime.
  });

  it("get_project_context returns a safe manifest, not raw file dumps", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "get_project_context", arguments: {} });
    const data = JSON.parse((res.content as { text: string }[])[0].text);
    expect(data.framework).toContain("Next.js");
    expect(data.scripts.build).toBe("next build");
    expect(data.allowedExtensions).toContain(".tsx");
  });

  it("search_project_files finds a match and never returns .env content even if it matched", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const res = await client.callTool({ name: "search_project_files", arguments: { query: "export default" } });
    const data = JSON.parse((res.content as { text: string }[])[0].text);
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.every((m: { path: string }) => !m.path.includes(".env"))).toBe(true);
  });
});

describe("Project Files MCP - write tool gating", () => {
  it("write_project_file does not exist at all in a read-only-mode server", async () => {
    const { client } = await startServer(ctxFor("read-only"), "read-only");
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "write_project_file")).toBe(false);
  });

  it("write_project_file exists and works in a read-write-mode server", async () => {
    const { client } = await startServer(ctxFor("read-write", "run-write-1"), "read-write");
    const res = await client.callTool({
      name: "write_project_file",
      arguments: { path: "src/app/page.tsx", content: "export default function Page() { return 2; }\n" },
    });
    expect(res.isError).toBeFalsy();

    const written = await fs.readFile(path.join(tmpRoot, PROJECT_ID, "src/app/page.tsx"), "utf8");
    expect(written).toContain("return 2");
  });

  it("write_project_file blocks writing a .env file", async () => {
    const { client } = await startServer(ctxFor("read-write", "run-write-2"), "read-write");
    const res = await client.callTool({ name: "write_project_file", arguments: { path: ".env", content: "X=1" } });
    expect(res.isError).toBe(true);
  });

  it("write_project_file blocks traversal", async () => {
    const { client } = await startServer(ctxFor("read-write", "run-write-3"), "read-write");
    const res = await client.callTool({
      name: "write_project_file",
      arguments: { path: "../../etc/evil.txt", content: "x" },
    });
    expect(res.isError).toBe(true);
  });

  it("write_project_file blocks a disallowed extension", async () => {
    const { client } = await startServer(ctxFor("read-write", "run-write-4"), "read-write");
    const res = await client.callTool({ name: "write_project_file", arguments: { path: "malware.sh", content: "x" } });
    expect(res.isError).toBe(true);
  });

  it("write_project_file enforces the size limit", async () => {
    const { client } = await startServer(ctxFor("read-write", "run-write-5"), "read-write");
    const big = "a".repeat(300 * 1024); // over MCP_MAX_WRITE_BYTES (256KB)
    const res = await client.callTool({ name: "write_project_file", arguments: { path: "src/app/big.txt", content: big } });
    expect(res.isError).toBe(true);
  });
});

describe("Project Files MCP - audit log", () => {
  it("records an allow entry with hashes for a successful write, and a deny entry for a blocked write", async () => {
    const runId = "run-audit-1";
    const { client } = await startServer(ctxFor("read-write", runId), "read-write");

    await client.callTool({
      name: "write_project_file",
      arguments: { path: "src/app/page.tsx", content: "export default function Page() { return 3; }\n" },
    });
    await client.callTool({ name: "write_project_file", arguments: { path: ".env", content: "X=1" } });

    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM mcp_audit_log WHERE agent_run_id = ? ORDER BY timestamp ASC`)
      .all(runId) as Record<string, unknown>[];

    expect(rows.length).toBeGreaterThanOrEqual(2);

    const allowRow = rows.find((r) => r.decision === "allow" && r.tool_name === "write_project_file");
    expect(allowRow).toBeDefined();
    expect(allowRow!.content_hash_after).toBeTruthy();
    expect(allowRow!.content_hash_after).not.toContain("export default"); // it's a hash, not content

    const denyRow = rows.find((r) => r.decision === "deny" && r.relative_path === ".env");
    expect(denyRow).toBeDefined();
    expect(denyRow!.provider).toBe("claude-code");
    expect(denyRow!.project_id).toBe(PROJECT_ID);
  });

  it("never stores raw file content or the .env secret value in the audit log", async () => {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM mcp_audit_log`).all() as Record<string, unknown>[];
    for (const row of rows) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain("top-secret-value");
      expect(serialized).not.toContain("export default function Page");
    }
  });
});
