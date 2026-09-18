import { query } from "@anthropic-ai/claude-agent-sdk";
import { getProjectFilesMcpConfig } from "../mcp/config";
import { getGitHubMcpConfig } from "../mcp/githubConfig";
import { getActiveGitHubTarget } from "../githubTarget";
import { emit, getRun, requestCancel } from "../runStore";
import { APPLY_POLICY, PLAN_POLICY } from "../policy";
import { PLAN_PROMPT_SUFFIX } from "../planSchema";
import { runApplyPipeline, runPlanPipeline } from "../pipeline";
import type { CodingAgent, CreatePlanContext, ExecuteApprovedPlanContext } from "../types";

const READ_TOOLS = new Set([
  "mcp__project-files__list_project_files",
  "mcp__project-files__read_project_file",
  "mcp__project-files__search_project_files",
  "mcp__project-files__get_project_context",
]);
const WRITE_TOOLS = new Set(["mcp__project-files__write_project_file"]);

// GitHub MCP tools never execute anything directly - the 9 read tools hit
// the GitHub API read-only, and the 5 "propose" tools only ever create a
// pending github_approvals row (see src/mcp/github/tools.ts). Both kinds
// are tracked here purely so Tool Activity events are emitted for them.
const GITHUB_READ_TOOLS = new Set([
  "mcp__github__get_repository_metadata",
  "mcp__github__list_branches",
  "mcp__github__list_repository_files",
  "mcp__github__read_repository_file",
  "mcp__github__list_issues",
  "mcp__github__read_issue",
  "mcp__github__list_pull_requests",
  "mcp__github__read_pull_request",
  "mcp__github__get_pull_request_diff",
]);
const GITHUB_PROPOSE_TOOLS = new Set([
  "mcp__github__create_branch",
  "mcp__github__create_commit_or_push_changes",
  "mcp__github__create_pull_request",
  "mcp__github__create_issue",
  "mcp__github__add_pull_request_comment",
]);

function toolInputPath(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.path === "string") return obj.path;
    if (typeof obj.subdirectory === "string") return obj.subdirectory;
    if (typeof obj.query === "string") return undefined; // search has no single path
  }
  return undefined;
}

/**
 * Drains a query() stream, emitting normalized AgentEvents for tool_use
 * activity, and returns the final concatenated assistant text (used to
 * extract the plan JSON in the plan phase).
 *
 * Cancellation here is best-effort: query() is used in single-prompt (not
 * streaming-input) mode, which the SDK's own interrupt() control request
 * does not support. We stop consuming further output and roll the
 * workspace back to its pre-run checkpoint (see pipeline.ts) - that
 * guarantees no partial/inconsistent output ever reaches the user, even
 * though the underlying CLI subprocess isn't guaranteed to be killed
 * mid-flight. Codex's adapter can do a true hard cancel via AbortSignal;
 * this is a real, documented difference between the two providers.
 */
async function drainQuery(
  runId: string,
  projectId: string,
  cwd: string,
  prompt: string,
  mode: "read-only" | "read-write",
  options: Parameters<typeof query>[0]["options"],
  includeGitHub: boolean,
): Promise<{ text: string; cancelled: boolean }> {
  let text = "";
  let cancelled = false;

  const mcpConfig = getProjectFilesMcpConfig({ projectId, runId, provider: "claude-code", mode });
  const mcpServers: NonNullable<Parameters<typeof query>[0]["options"]>["mcpServers"] = {
    "project-files": {
      type: "stdio",
      command: mcpConfig.command,
      args: mcpConfig.args,
      env: mcpConfig.env,
      // Without this, tool loading can be deferred behind tool search,
      // meaning our MCP tools may not be present on the very first
      // prompt even though they're the ONLY tools this run has -
      // alwaysLoad forces the connect to finish (5s cap) before the
      // turn-1 prompt is built, per the SDK's own documented behavior.
      alwaysLoad: true,
    },
  };

  // GitHub MCP is only ever spawned in the apply phase, and only when the
  // project actually has a repo connected and selected (see
  // getActiveGitHubTarget) - never conditioned on anything the model or
  // browser supplied.
  if (includeGitHub) {
    const target = getActiveGitHubTarget(projectId);
    if (target) {
      const githubConfig = getGitHubMcpConfig({
        projectId,
        runId,
        provider: "claude-code",
        connectionId: target.connectionId,
        installationId: target.installationId,
        repoFullName: target.repoFullName,
        defaultBranch: target.defaultBranch,
      });
      mcpServers.github = {
        type: "stdio",
        command: githubConfig.command,
        args: githubConfig.args,
        env: githubConfig.env,
        alwaysLoad: true,
      };
    }
  }

  const stream = query({
    prompt,
    options: {
      ...options,
      cwd,
      mcpServers,
    },
  });

  // Tracks tool_use blocks by id so the corresponding tool_result (which
  // only carries tool_use_id, not the tool name) can be matched back up -
  // the activity event is emitted once we know the actual allow/deny
  // outcome, not optimistically at request time.
  const pendingCalls = new Map<string, { name: string; path?: string }>();

  for await (const message of stream) {
    const run = getRun(runId);
    if (run?.cancelRequested) {
      cancelled = true;
      break;
    }

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (
          block.type === "tool_use" &&
          (READ_TOOLS.has(block.name) ||
            WRITE_TOOLS.has(block.name) ||
            GITHUB_READ_TOOLS.has(block.name) ||
            GITHUB_PROPOSE_TOOLS.has(block.name))
        ) {
          pendingCalls.set(block.id, { name: block.name, path: toolInputPath(block.input) });
        }
      }
    } else if (message.type === "user") {
      const content = message.message.content;
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block.type !== "tool_result") continue;
        const pending = pendingCalls.get(block.tool_use_id);
        if (!pending) continue;
        pendingCalls.delete(block.tool_use_id);

        const eventType = WRITE_TOOLS.has(pending.name)
          ? "file_write"
          : GITHUB_PROPOSE_TOOLS.has(pending.name)
            ? "github_propose_action"
            : GITHUB_READ_TOOLS.has(pending.name)
              ? "github_read"
              : "file_read";
        const resultText = Array.isArray(block.content)
          ? block.content.find((c): c is { type: "text"; text: string } => c.type === "text")?.text
          : typeof block.content === "string"
            ? block.content
            : undefined;

        emit(runId, eventType, {
          tool: pending.name,
          path: pending.path,
          decision: block.is_error ? "deny" : "allow",
          reason: block.is_error ? resultText : undefined,
        });
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        text = text || message.result;
      }
    }
  }

  return { text, cancelled };
}

export const claudeCodeAdapter: CodingAgent = {
  provider: "claude-code",

  async createPlan({ runId, projectId, workspaceRoot, request }: CreatePlanContext) {
    await runPlanPipeline(runId, workspaceRoot, () =>
      drainQuery(runId, projectId, workspaceRoot, request + PLAN_PROMPT_SUFFIX, "read-only", PLAN_POLICY, false),
    );
  },

  async executeApprovedPlan({ runId, projectId, workspaceRoot }: ExecuteApprovedPlanContext) {
    const run = getRun(runId);
    if (!run || !run.plan) return;

    const applyPrompt =
      `${run.request}\n\nApproved plan (from a prior read-only planning pass):\n` +
      `${JSON.stringify(run.plan, null, 2)}\n\n` +
      "Make exactly these changes using the project-files MCP tools. Do not modify files outside this plan's intent. " +
      "If (and only if) github MCP tools are available and the request explicitly asks to push, branch, or open a " +
      "pull request, you may call the relevant github propose tool once - it only creates a pending approval, it " +
      "does not execute anything. Never call a github propose tool unless the request explicitly asked for that. " +
      "When finished, stop without running any commands or asking further questions.";

    await runApplyPipeline(runId, workspaceRoot, "claude-code", () =>
      drainQuery(runId, projectId, workspaceRoot, applyPrompt, "read-write", APPLY_POLICY, true),
    );
  },

  cancelRun(runId: string) {
    requestCancel(runId);
  },

  getRunStatus(runId: string) {
    return getRun(runId);
  },
};
