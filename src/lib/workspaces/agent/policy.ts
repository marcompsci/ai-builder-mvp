import type { Options } from "@anthropic-ai/claude-agent-sdk";

// The project-level permission policy (requirement: "strict project-level
// permission policy, documented"). Every agent run - plan or apply - goes
// through one of these two option sets. No route or caller builds its own.
//
// Bash, WebFetch, WebSearch, Task, and NotebookEdit are denied in BOTH
// phases, always - not because the agent shouldn't use them for this task,
// but because this app never wants a shell, network access, or sub-agent
// spawning available to a workspace run at all. `disallowedTools` removes
// these from the model's tool context entirely (per the installed SDK's
// types) - it is not a permission prompt the model could route around.
//
// As of Phase 5A, the SDK's own native Read/Grep/Glob/Edit/Write tools are
// ALSO disallowed - all file access goes through the Project Files MCP
// server instead (see mcp/config.ts and docs/project-files-mcp.md). This is
// the one first-party MCP server this app trusts; mcpServers is otherwise
// still {} by default and only ever set to the Project Files config built
// by getProjectFilesMcpConfig().
//
// IMPORTANT, found via live testing: permissionMode "plan" blocks ALL tool
// execution, not just writes - it has no way to know a given MCP tool
// (ours or anyone else's) is read-only, so it blocks every mcp__* call
// uniformly, including our own read-only ones. The actual "no writes during
// planning" guarantee therefore comes entirely from (a) the plan-phase MCP
// server process never having write_project_file registered at all, and
// (b) disallowedTools still explicitly naming it below as defense in depth
// - not from permissionMode. Both phases use "acceptEdits" accordingly.

const COMMON_DISALLOWED = [
  "Bash",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
];

const READ_ONLY_MCP_TOOLS = [
  "mcp__project-files__list_project_files",
  "mcp__project-files__read_project_file",
  "mcp__project-files__search_project_files",
  "mcp__project-files__get_project_context",
];

const WRITE_MCP_TOOL = "mcp__project-files__write_project_file";

// GitHub MCP tools - only ever relevant in the apply phase, and only when
// the project actually has a repo connected (see githubTarget.ts; when it
// doesn't, the server is never spawned and these names are simply unused).
// The 5 "propose" tools never execute a GitHub action directly - each one
// only creates a pending approval row - so there is no separate "GitHub
// write" gate the way there is for project-files.
const GITHUB_TOOLS = [
  "mcp__github__get_repository_metadata",
  "mcp__github__list_branches",
  "mcp__github__list_repository_files",
  "mcp__github__read_repository_file",
  "mcp__github__list_issues",
  "mcp__github__read_issue",
  "mcp__github__list_pull_requests",
  "mcp__github__read_pull_request",
  "mcp__github__get_pull_request_diff",
  "mcp__github__create_branch",
  "mcp__github__create_commit_or_push_changes",
  "mcp__github__create_pull_request",
  "mcp__github__create_issue",
  "mcp__github__add_pull_request_comment",
];

export const PLAN_POLICY: Pick<Options, "permissionMode" | "allowedTools" | "disallowedTools" | "maxTurns"> = {
  // NOT "plan" - see the note above. "acceptEdits" lets the read-only MCP
  // tool calls actually execute; write_project_file is unreachable both
  // because the plan-phase server never registers it and because it's
  // explicitly disallowed here too.
  permissionMode: "acceptEdits",
  allowedTools: READ_ONLY_MCP_TOOLS,
  disallowedTools: [...COMMON_DISALLOWED, WRITE_MCP_TOOL, ...GITHUB_TOOLS],
  maxTurns: 15,
};

export const APPLY_POLICY: Pick<Options, "permissionMode" | "allowedTools" | "disallowedTools" | "maxTurns"> = {
  // "acceptEdits" auto-accepts tool calls without a permission prompt (there
  // is no human to answer one in a headless server process) but, unlike
  // "bypassPermissions", does not require the allowDangerouslySkipPermissions
  // escape hatch. The actual boundary is disallowedTools + the Project
  // Files MCP server's own sandboxing, not this mode.
  permissionMode: "acceptEdits",
  allowedTools: [...READ_ONLY_MCP_TOOLS, WRITE_MCP_TOOL, ...GITHUB_TOOLS],
  disallowedTools: COMMON_DISALLOWED,
  maxTurns: 30,
};

export const VALIDATION_COMMANDS: { label: string; cmd: string; args: string[] }[] = [
  { label: "lint", cmd: "npm", args: ["run", "lint"] },
  { label: "typecheck", cmd: "npx", args: ["tsc", "--noEmit"] },
  { label: "build", cmd: "npm", args: ["run", "build"] },
];
