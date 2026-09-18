import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { CODEX_APPLY_OPTIONS, CODEX_PLAN_OPTIONS, CODEX_RUN_TIMEOUT_MS } from "../codexPolicy";
import { getProjectFilesMcpConfig } from "../mcp/config";
import { getGitHubMcpConfig } from "../mcp/githubConfig";
import { getActiveGitHubTarget } from "../githubTarget";
import { PLAN_PROMPT_SUFFIX } from "../planSchema";
import { runApplyPipeline, runPlanPipeline } from "../pipeline";
import { emit, getRun, requestCancel } from "../runStore";
import type { CodingAgent, CreatePlanContext, ExecuteApprovedPlanContext } from "../types";

const GITHUB_PROPOSE_TOOL_NAMES = new Set([
  "create_branch",
  "create_commit_or_push_changes",
  "create_pull_request",
  "create_issue",
  "add_pull_request_comment",
]);
const GITHUB_READ_TOOL_NAMES = new Set([
  "get_repository_metadata",
  "list_branches",
  "list_repository_files",
  "read_repository_file",
  "list_issues",
  "read_issue",
  "list_pull_requests",
  "read_pull_request",
  "get_pull_request_diff",
]);

export class CodexConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexConfigError";
  }
}

function getCodex(
  mcpConfig: { command: string; args: string[]; env: Record<string, string> },
  githubMcpConfig: { command: string; args: string[]; env: Record<string, string> } | null,
): Codex {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new CodexConfigError("OPENAI_API_KEY is not configured. See .env.example.");
  }
  // Project Files (always) and GitHub (only when a repo is connected, and
  // only in the apply phase - see getActiveGitHubTarget) are the ONLY MCP
  // servers ever configured here - this object fully replaces whatever the
  // host machine's own ~/.codex/config.toml might otherwise supply for
  // mcp_servers, so nothing from a developer's personal Codex setup leaks
  // into a workspace run.
  const mcp_servers: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {
    "project-files": { command: mcpConfig.command, args: mcpConfig.args, env: mcpConfig.env },
  };
  if (githubMcpConfig) {
    mcp_servers.github = { command: githubMcpConfig.command, args: githubMcpConfig.args, env: githubMcpConfig.env };
  }
  return new Codex({ apiKey, config: { mcp_servers } });
}

// Per-run AbortController registry so cancelRun() can request a real,
// immediate interrupt - unlike the Claude adapter, Codex's runStreamed()
// accepts a genuine AbortSignal.
const controllers = new Map<string, AbortController>();

async function drainThread(
  runId: string,
  projectId: string,
  prompt: string,
  mode: "read-only" | "read-write",
  threadOptions: Parameters<Codex["startThread"]>[0],
  includeGitHub: boolean,
): Promise<{ text: string; cancelled: boolean }> {
  const mcpConfig = getProjectFilesMcpConfig({ projectId, runId, provider: "codex", mode });

  const target = includeGitHub ? getActiveGitHubTarget(projectId) : null;
  const githubMcpConfig = target
    ? getGitHubMcpConfig({
        projectId,
        runId,
        provider: "codex",
        connectionId: target.connectionId,
        installationId: target.installationId,
        repoFullName: target.repoFullName,
        defaultBranch: target.defaultBranch,
      })
    : null;
  const codex = getCodex(mcpConfig, githubMcpConfig);

  // Codex's native shell/file tools are pointed at an empty scratch
  // directory, not the real workspace - all real file access goes through
  // the Project Files MCP server (scoped to the real workspace via its own
  // trusted env, independent of this directory). See docs/agent-protocol.md.
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-scratch-"));

  try {
    const thread = codex.startThread({ ...threadOptions, workingDirectory: scratchDir });

    const controller = new AbortController();
    controllers.set(runId, controller);
    const timeout = setTimeout(() => controller.abort(), CODEX_RUN_TIMEOUT_MS);

    let text = "";
    let cancelled = false;

    try {
      const { events } = await thread.runStreamed(prompt, { signal: controller.signal });

      for await (const event of events as AsyncGenerator<ThreadEvent>) {
        const run = getRun(runId);
        if (run?.cancelRequested) {
          controller.abort();
          cancelled = true;
          break;
        }

        if (event.type === "item.completed" || event.type === "item.started") {
          const item = event.item;
          if (item.type === "agent_message") {
            text = item.text;
          } else if (item.type === "mcp_tool_call") {
            const args = item.arguments as Record<string, unknown> | undefined;
            const relPath = typeof args?.path === "string" ? args.path : undefined;
            const isGitHubPropose = GITHUB_PROPOSE_TOOL_NAMES.has(item.tool);
            const isGitHubRead = GITHUB_READ_TOOL_NAMES.has(item.tool);
            const eventType = isGitHubPropose
              ? "github_propose_action"
              : isGitHubRead
                ? "github_read"
                : item.tool === "write_project_file"
                  ? "file_write"
                  : "file_read";
            const mcpServerName = isGitHubPropose || isGitHubRead ? "github" : "project-files";
            emit(runId, eventType, {
              tool: `mcp__${mcpServerName}__${item.tool}`,
              path: relPath,
              decision: item.status === "failed" ? "deny" : event.type === "item.completed" ? "allow" : undefined,
              reason: item.error?.message,
            });
          } else if (item.type === "command_execution") {
            emit(runId, event.type === "item.started" ? "command_started" : "command_completed", {
              command: item.command,
              status: item.status,
            });
          }
        } else if (event.type === "turn.failed") {
          throw new Error(event.error.message);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      if (controller.signal.aborted && cancelled) {
        // Expected: we aborted this ourselves in response to a cancel request.
      } else if (controller.signal.aborted) {
        throw new Error(`Codex run timed out after ${CODEX_RUN_TIMEOUT_MS / 1000}s.`);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
      controllers.delete(runId);
    }

    return { text, cancelled };
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}

export const codexAdapter: CodingAgent = {
  provider: "codex",

  async createPlan({ runId, projectId, workspaceRoot, request }: CreatePlanContext) {
    await runPlanPipeline(runId, workspaceRoot, () =>
      drainThread(runId, projectId, request + PLAN_PROMPT_SUFFIX, "read-only", CODEX_PLAN_OPTIONS, false),
    );
  },

  async executeApprovedPlan({ runId, projectId, workspaceRoot }: ExecuteApprovedPlanContext) {
    const run = getRun(runId);
    if (!run || !run.plan) return;

    const applyPrompt =
      `${run.request}\n\nApproved plan (from a prior read-only planning pass):\n` +
      `${JSON.stringify(run.plan, null, 2)}\n\n` +
      "Make exactly these changes using the project-files MCP tools (list_project_files, read_project_file, " +
      "write_project_file, search_project_files, get_project_context) - your local shell has no real access to " +
      "the project. If (and only if) github MCP tools are available and the request explicitly asks to push, " +
      "branch, or open a pull request, you may call the relevant github tool once - it only creates a pending " +
      "approval, it does not execute anything. Never call a github propose tool unless the request explicitly " +
      "asked for that. When finished, stop without asking further questions.";

    await runApplyPipeline(runId, workspaceRoot, "codex", () =>
      drainThread(runId, projectId, applyPrompt, "read-write", CODEX_APPLY_OPTIONS, true),
    );
  },

  cancelRun(runId: string) {
    requestCancel(runId);
    controllers.get(runId)?.abort();
  },

  getRunStatus(runId: string) {
    return getRun(runId);
  },
};
