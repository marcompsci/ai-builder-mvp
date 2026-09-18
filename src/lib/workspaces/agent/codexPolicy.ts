import type { ThreadOptions } from "@openai/codex-sdk";

// Codex's core edit mechanism is shell command execution - there is no
// separate "Edit" tool to remove the way Claude Code has one. As of Phase
// 5A, rather than relying on sandboxMode alone to bound what a shell
// command can touch, Codex is pointed at an empty scratch directory (see
// the adapter's workingDirectory) and given NO real filesystem access at
// all - sandboxMode is now "read-only" in both phases, always, regardless
// of plan vs apply, since apply-phase file writes now happen exclusively
// through the Project Files MCP server's write_project_file tool. Native
// shell commands can still run (for things unrelated to file I/O), but
// have nothing real to read or write against.
export const CODEX_PLAN_OPTIONS: Partial<ThreadOptions> = {
  sandboxMode: "read-only",
  approvalPolicy: "never", // headless - no human to answer an interactive prompt
  networkAccessEnabled: false,
  skipGitRepoCheck: true, // the scratch directory is not a git repo, and never will be
};

export const CODEX_APPLY_OPTIONS: Partial<ThreadOptions> = {
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  skipGitRepoCheck: true,
};

export const CODEX_RUN_TIMEOUT_MS = 10 * 60 * 1000;
