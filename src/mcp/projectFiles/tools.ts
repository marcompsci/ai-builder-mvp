import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Relative imports, not the "@/" alias, throughout this server's own module
// graph: tsx resolves tsconfig path aliases once at process startup based
// on the subprocess's initial cwd, which our runtime process.chdir() (see
// server.ts) cannot retroactively fix - confirmed via live testing.
// Relative imports have no such dependency.
import {
  MCP_MAX_READ_BYTES,
  MCP_MAX_SEARCH_RESULTS,
  MCP_MAX_WRITE_BYTES,
  WRITABLE_EXTENSIONS,
} from "../../lib/workspaces/config";
import { buildFileTree, readWorkspaceFile, searchWorkspaceFiles, writeWorkspaceFile } from "../../lib/workspaces/fsTree";
import { getProjectRoot } from "../../lib/workspaces/paths";
import { recordAuditEntry } from "./auditLog";
import { checkRateLimit, RateLimitError } from "./rateLimit";
import { redactSecrets } from "./secretRedaction";
import type { TrustedServerContext } from "./config";
import { trackEvent } from "../../lib/analytics/trackEvent";

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function deniedResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Every tool goes through this: rate limit, run the handler, audit log the
 * outcome (allow or deny), and turn any thrown error into a safe, generic
 * message - never a raw path, stack trace, or the underlying error's own
 * message (which could echo back attacker-supplied path text).
 */
function trackMcpEvent(ctx: TrustedServerContext, toolName: string, decision: "allow" | "deny") {
  trackEvent(decision === "allow" ? "mcp_tool_allowed" : "mcp_tool_denied", {
    userId: ctx.userId,
    orgId: null,
    projectId: ctx.projectId,
    agentRunId: ctx.runId,
    provider: ctx.provider,
    mcpServer: "project-files",
    toolName,
  });
}

async function guarded(
  ctx: TrustedServerContext,
  toolName: string,
  relativePath: string | undefined,
  fn: () => Promise<{ result: ReturnType<typeof textResult>; auditReason?: string; hashBefore?: string; hashAfter?: string }>,
) {
  try {
    checkRateLimit();
  } catch (err) {
    recordAuditEntry(ctx, { toolName, relativePath, decision: "deny", reason: "rate_limited" });
    trackMcpEvent(ctx, toolName, "deny");
    return deniedResult(err instanceof RateLimitError ? err.message : "Rate limit exceeded.");
  }

  try {
    const { result, auditReason, hashBefore, hashAfter } = await fn();
    recordAuditEntry(ctx, {
      toolName,
      relativePath,
      decision: "allow",
      reason: auditReason,
      contentHashBefore: hashBefore,
      contentHashAfter: hashAfter,
    });
    trackMcpEvent(ctx, toolName, "allow");
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.name : "error";
    recordAuditEntry(ctx, { toolName, relativePath, decision: "deny", reason });
    trackMcpEvent(ctx, toolName, "deny");
    // Deliberately generic - never surface err.message (could contain a
    // real filesystem path or other internal detail) or a stack trace.
    return deniedResult("That request could not be completed - the path, file type, or size was not allowed.");
  }
}

export function registerReadOnlyTools(server: McpServer, ctx: TrustedServerContext) {
  server.registerTool(
    "list_project_files",
    {
      description: "List files and folders within the active project workspace. Returns safe, relative paths only.",
      inputSchema: { subdirectory: z.string().optional() },
    },
    async () =>
      guarded(ctx, "list_project_files", undefined, async () => {
        const tree = await buildFileTree(ctx.projectId);
        return { result: textResult({ entries: tree }) };
      }),
  );

  server.registerTool(
    "read_project_file",
    {
      description: "Read an approved text file inside the active workspace. Requires a safe relative path.",
      inputSchema: { path: z.string() },
    },
    async ({ path: relPath }) =>
      guarded(ctx, "read_project_file", relPath, async () => {
        const file = await readWorkspaceFile(ctx.projectId, relPath);
        const size = Buffer.byteLength(file.content, "utf8");
        if (size > MCP_MAX_READ_BYTES) {
          throw new Error("file_too_large");
        }
        return { result: textResult({ path: file.path, content: file.content, size }) };
      }),
  );

  server.registerTool(
    "search_project_files",
    {
      description: "Search text only within the active workspace. Results and file sizes are limited.",
      inputSchema: { query: z.string().min(1).max(200), maxResults: z.number().int().min(1).max(MCP_MAX_SEARCH_RESULTS).optional() },
    },
    async ({ query, maxResults }) =>
      guarded(ctx, "search_project_files", undefined, async () => {
        const matches = await searchWorkspaceFiles(
          ctx.projectId,
          query,
          Math.min(maxResults ?? MCP_MAX_SEARCH_RESULTS, MCP_MAX_SEARCH_RESULTS),
          MCP_MAX_READ_BYTES,
        );
        const redacted = matches.map((m) => ({ ...m, snippet: redactSecrets(m.snippet) }));
        return { result: textResult({ matches: redacted }) };
      }),
  );

  server.registerTool(
    "get_project_context",
    {
      description: "Return a safe, minimal project manifest: framework, scripts, source directories, design tokens, allowed files.",
      inputSchema: {},
    },
    async () =>
      guarded(ctx, "get_project_context", undefined, async () => {
        const root = getProjectRoot(ctx.projectId);
        let scripts: Record<string, string> = {};
        try {
          const pkgRaw = await fs.readFile(path.join(root, "package.json"), "utf8");
          const pkg = JSON.parse(pkgRaw);
          if (pkg && typeof pkg.scripts === "object") scripts = pkg.scripts;
        } catch {
          // no package.json or unreadable - report empty scripts rather than fail the tool
        }

        const candidateDirs = ["src/app", "src/components", "src/lib"];
        const sourceDirectories: string[] = [];
        for (const dir of candidateDirs) {
          try {
            const stat = await fs.stat(path.join(root, dir));
            if (stat.isDirectory()) sourceDirectories.push(dir);
          } catch {
            // doesn't exist - skip
          }
        }

        return {
          result: textResult({
            framework: "Next.js (App Router) + TypeScript + Tailwind CSS v4",
            scripts,
            sourceDirectories,
            designTokens: "Tailwind v4 theme tokens defined in src/app/globals.css (@theme block)",
            allowedExtensions: Array.from(WRITABLE_EXTENSIONS),
          }),
        };
      }),
  );
}

export function registerWriteTool(server: McpServer, ctx: TrustedServerContext) {
  server.registerTool(
    "write_project_file",
    {
      description: "Create or update an approved text file inside the active workspace.",
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path: relPath, content }) =>
      guarded(ctx, "write_project_file", relPath, async () => {
        const size = Buffer.byteLength(content, "utf8");
        if (size > MCP_MAX_WRITE_BYTES) {
          throw new Error("file_too_large");
        }

        let hashBefore: string | undefined;
        try {
          const existing = await readWorkspaceFile(ctx.projectId, relPath);
          hashBefore = hash(existing.content);
        } catch {
          hashBefore = undefined; // file doesn't exist yet - creating, not updating
        }

        await writeWorkspaceFile(ctx.projectId, relPath, content);
        const hashAfter = hash(content);

        return {
          result: textResult({ path: relPath, bytesWritten: size }),
          hashBefore,
          hashAfter,
        };
      }),
  );
}
