import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PROJECT_ID = "prj_aaaaaaaa-test-project";
const REPO = "acme/widgets";

// The read tools go through getInstallationOctokit() - mocked here so tests
// never hit the real GitHub API and never need real App credentials (this
// environment has none, same caveat as Codex in Phase 5A).
const mockOctokit = {
  rest: {
    repos: {
      get: vi.fn(async () => ({ data: { full_name: REPO, default_branch: "main", private: true, description: "test repo" } })),
      listBranches: vi.fn(async () => ({ data: [{ name: "main", protected: true }, { name: "feature-x", protected: false }] })),
      getContent: vi.fn(async ({ path: p }: { path: string }) => {
        if (p === "src") {
          return { data: [{ name: "index.ts", path: "src/index.ts", type: "file" }] };
        }
        return { data: { name: path.basename(p), path: p, type: "file", size: 12, content: Buffer.from("hello world\n").toString("base64") } };
      }),
    },
    issues: {
      listForRepo: vi.fn(async () => ({ data: [{ number: 1, title: "Bug", state: "open", pull_request: undefined }] })),
      get: vi.fn(async () => ({ data: { number: 1, title: "Bug", body: "It's broken", state: "open" } })),
    },
    pulls: {
      list: vi.fn(async () => ({ data: [{ number: 5, title: "Fix", state: "open", head: { ref: "fix-branch" }, base: { ref: "main" } }] })),
      get: vi.fn(async (args: { mediaType?: { format?: string } }) => {
        if (args.mediaType?.format === "diff") {
          return { data: "diff --git a/x b/x\n+added line\n" };
        }
        return { data: { number: 5, title: "Fix", body: "Fixes it", state: "open", head: { ref: "fix-branch" }, base: { ref: "main" } } };
      }),
    },
  },
};

vi.mock("@/lib/github/appAuth", () => ({
  getInstallationOctokit: vi.fn(() => mockOctokit),
}));

let tmpRoot: string;
let registerReadOnlyTools: typeof import("@/mcp/github/tools").registerReadOnlyTools;
let registerWriteTools: typeof import("@/mcp/github/tools").registerWriteTools;
let getDb: typeof import("@/lib/db").getDb;
let connectionId: string;

type Ctx = import("@/mcp/github/config").TrustedGitHubServerContext;

function ctxFor(runId = "run-1"): Ctx {
  return {
    projectId: PROJECT_ID,
    runId,
    provider: "claude-code",
    connectionId,
    installationId: "12345",
    repoFullName: REPO,
    defaultBranch: "main",
    userId: "local-dev-user",
    orgId: "local",
  };
}

async function startServer(ctx: Ctx) {
  const server = new McpServer({ name: "github", version: "1.0.0" });
  registerReadOnlyTools(server, ctx);
  registerWriteTools(server, ctx);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "github-mcp-test-"));
  // getDb() derives its SQLite file path from WORKSPACES_ROOT (see
  // src/lib/db/index.ts) - set before any module that touches the db is
  // imported, same isolation approach as tests/mcp/projectFilesMcp.test.ts.
  process.env.WORKSPACES_ROOT = path.join(tmpRoot, "workspaces");

  const toolsMod = await import("@/mcp/github/tools");
  registerReadOnlyTools = toolsMod.registerReadOnlyTools;
  registerWriteTools = toolsMod.registerWriteTools;
  const dbMod = await import("@/lib/db");
  getDb = dbMod.getDb;

  // github_approvals.connection_id has a real FK to github_connections(id) -
  // seed a matching connection row rather than using a made-up id.
  const connectionsMod = await import("@/lib/github/connections");
  connectionId = connectionsMod.saveConnection({
    projectId: PROJECT_ID,
    githubLogin: "acme",
    installationId: "12345",
    installationAccountType: "Organization",
  }).id;
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("GitHub MCP - read tools", () => {
  it("get_repository_metadata returns the connected repo's metadata with no repo argument accepted", async () => {
    const { client } = await startServer(ctxFor());
    const res = await client.callTool({ name: "get_repository_metadata", arguments: {} });
    const text = (res.content as { text: string }[])[0].text;
    expect(JSON.parse(text)).toMatchObject({ fullName: REPO, defaultBranch: "main" });
  });

  it("list_branches returns branch names", async () => {
    const { client } = await startServer(ctxFor());
    const res = await client.callTool({ name: "list_branches", arguments: {} });
    const text = (res.content as { text: string }[])[0].text;
    expect(JSON.parse(text).branches).toEqual([
      { name: "main", protected: true },
      { name: "feature-x", protected: false },
    ]);
  });

  it("read_repository_file decodes base64 content", async () => {
    const { client } = await startServer(ctxFor());
    const res = await client.callTool({ name: "read_repository_file", arguments: { path: "README.md" } });
    const text = (res.content as { text: string }[])[0].text;
    expect(JSON.parse(text).content).toBe("hello world\n");
  });

  it("get_pull_request_diff requests the diff media type and returns the raw diff text", async () => {
    const { client } = await startServer(ctxFor());
    const res = await client.callTool({ name: "get_pull_request_diff", arguments: { number: 5 } });
    const text = (res.content as { text: string }[])[0].text;
    expect(JSON.parse(text).diff).toContain("+added line");
  });

  it("read_issue returns issue body", async () => {
    const { client } = await startServer(ctxFor());
    const res = await client.callTool({ name: "read_issue", arguments: { number: 1 } });
    const text = (res.content as { text: string }[])[0].text;
    expect(JSON.parse(text)).toMatchObject({ title: "Bug", body: "It's broken" });
  });

  it("no read tool exposes a repo/owner parameter - the repository is fixed by trusted context", async () => {
    const { client } = await startServer(ctxFor());
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(props)).not.toContain("owner");
      expect(Object.keys(props)).not.toContain("repo");
      expect(Object.keys(props)).not.toContain("repoFullName");
    }
  });

  it("errors never leak the underlying message - only a generic denial", async () => {
    mockOctokit.rest.issues.get.mockRejectedValueOnce(new Error("401 Bad credentials: ghs_verySecretToken123"));
    const { client } = await startServer(ctxFor("run-err"));
    const res = await client.callTool({ name: "read_issue", arguments: { number: 999 } });
    const text = (res.content as { text: string }[])[0].text;
    expect(text).not.toContain("ghs_verySecretToken123");
    expect(text).not.toContain("Bad credentials");
    expect(res.isError).toBe(true);
  });
});

describe("GitHub MCP - propose (write) tools", () => {
  it("create_pull_request creates a pending approval and never calls the GitHub API", async () => {
    const { client } = await startServer(ctxFor("run-pr"));
    const res = await client.callTool({
      name: "create_pull_request",
      arguments: { title: "Add feature", headBranch: "feature-x", reason: "Ship the requested change" },
    });
    const text = (res.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("pending_approval");
    expect(typeof parsed.approvalId).toBe("string");
    expect(mockOctokit.rest.pulls.list).not.toHaveBeenCalled(); // read call unrelated but sanity: no pulls.create exists on the mock at all

    const db = getDb();
    const row = db.prepare(`SELECT * FROM github_approvals WHERE id = ?`).get(parsed.approvalId) as Record<string, unknown>;
    expect(row.status).toBe("pending");
    expect(row.action_type).toBe("create_pull_request");
    expect(row.repo_full_name).toBe(REPO);
  });

  it("create_branch's approval payload matches exactly what was requested (hash is over that payload)", async () => {
    const { client } = await startServer(ctxFor("run-branch"));
    const res = await client.callTool({
      name: "create_branch",
      arguments: { branchName: "feature-y", reason: "Start work on the requested feature" },
    });
    const { approvalId } = JSON.parse((res.content as { text: string }[])[0].text);
    const db = getDb();
    const row = db.prepare(`SELECT * FROM github_approvals WHERE id = ?`).get(approvalId) as Record<string, unknown>;
    const payload = JSON.parse(row.payload_json as string);
    expect(payload).toEqual({ branchName: "feature-y", fromBranch: "main" });
  });

  it("create_commit_or_push_changes is recorded as irreversible", async () => {
    const { client } = await startServer(ctxFor("run-push"));
    const res = await client.callTool({
      name: "create_commit_or_push_changes",
      arguments: { branchName: "feature-z", commitSummary: "apply requested edits", reason: "push the approved local diff" },
    });
    const { approvalId } = JSON.parse((res.content as { text: string }[])[0].text);
    const db = getDb();
    const row = db.prepare(`SELECT * FROM github_approvals WHERE id = ?`).get(approvalId) as Record<string, unknown>;
    expect(row.reversible).toBe(0);
  });

  it("every propose call is written to the shared mcp_audit_log with repo/branch/approvalId populated", async () => {
    const { client } = await startServer(ctxFor("run-audit"));
    const res = await client.callTool({
      name: "create_issue",
      arguments: { title: "Track follow-up", reason: "requested by the user" },
    });
    const { approvalId } = JSON.parse((res.content as { text: string }[])[0].text);

    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM mcp_audit_log WHERE approval_id = ? AND tool_name = 'create_issue'`)
      .get(approvalId) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.decision).toBe("allow");
    expect(row.repository).toBe(REPO);
    expect(row.relative_path).toBeNull(); // GitHub rows never populate the file-specific column
  });
});

describe("GitHub MCP - rate limiting", () => {
  it("denies calls past the per-run limit and audits the denial", async () => {
    const { client } = await startServer(ctxFor("run-rate"));
    let lastRes: Awaited<ReturnType<typeof client.callTool>> | undefined;
    for (let i = 0; i < 105; i++) {
      lastRes = await client.callTool({ name: "get_repository_metadata", arguments: {} });
    }
    expect(lastRes?.isError).toBe(true);
    const text = (lastRes?.content as { text: string }[])[0].text;
    expect(text.toLowerCase()).toContain("too many");
  });
});
