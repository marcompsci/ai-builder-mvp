@AGENTS.md

# Working in this repo

This is an AI website-builder MVP: a landing-page generator, local project
workspaces with a Claude Code / Codex editing loop backed by Project Files
MCP, per-workspace git history, optional GitHub export, and agent-proposed
GitHub actions (branches/PRs/issues) via GitHub MCP with mandatory human
approval. Read `docs/architecture.md` first for the shape of the system,
then the doc that matches what you're touching:

- `docs/security.md` - the sandbox/trust-boundary model. Read this before
  changing anything under `src/lib/workspaces/`, `src/lib/github/`,
  `src/lib/workspaces/agent/`, or `src/mcp/` - most of what looks like an
  obstacle there (path validation, disabled git hooks, tool restrictions,
  token handling, MCP mode gating, approval-binding) is intentional and
  load-bearing, not incidental.
- `docs/agent-protocol.md` - the provider-neutral `CodingAgent` interface
  and `AgentEvent` vocabulary. Adding a third provider means writing a new
  adapter against this contract, not branching the existing routes/UI.
- `docs/mcp-policy.md` - this app's standing policy on MCP servers (exactly
  two, first-party, ever, and no third - read before even considering
  adding another one, MCP-enabling a new tool, or loosening what either
  server exposes).
- `docs/project-files-mcp.md` - the local filesystem MCP server's tool
  schemas, identity model, and two real bugs that were found and fixed via
  live testing (worth reading before assuming a slow/failing agent run is
  unrelated to recent MCP changes).
- `docs/github-mcp.md` - the GitHub MCP server's tool schemas and the
  approval-binding pipeline (propose → pending row → human decide →
  execute, one-time-use by construction). Read before touching
  `src/mcp/github/`, `src/lib/github/{approvals,execute,repoSelection}.ts`,
  or the GitHub Actions panel.
- `docs/runbook.md` - local setup, required env vars, and what breaks
  (with the actual error you'll see) when a credential or dependency is
  missing.

## Ground rules specific to this codebase

- Every project workspace under `data/workspaces/<id>/` is sandboxed via
  `src/lib/workspaces/paths.ts`. No route or feature should ever build a
  workspace filesystem path itself - always go through `getProjectRoot` /
  `resolveWorkspaceFilePath`.
- Both coding-agent adapters (`src/lib/workspaces/agent/adapters/`) share
  one pipeline (`pipeline.ts`) for checkpoint → diff → validate → commit.
  Provider-specific code should only ever be the part that actually talks
  to that provider's SDK - not a second copy of the checkpoint/validate/
  commit logic.
- Validation commands (lint/typecheck/build) are always a fixed, hardcoded
  list run by our own server code - never something an agent or a user
  supplies as text.
- Secrets (Anthropic/OpenAI API keys, the GitHub App private key,
  `WORKSPACE_SECRET_KEY`) are server-side env vars only. GitHub push
  tokens are minted per-request and never persisted. Don't add a code path
  that returns, logs, or stores any of these.
- Neither coding agent touches the workspace filesystem directly - all file
  access goes through Project Files MCP (`src/mcp/projectFiles/`). If
  you're tempted to re-enable a native Read/Edit/Write tool "just for this
  one case," don't - that's exactly the thing Phase 5A removed, and the MCP
  server exists so there's one reviewed, audited path instead of two.
- No GitHub write tool ever calls the GitHub API directly. Every one of the
  5 `mcp__github__*` propose tools (`src/mcp/github/tools.ts`) only creates
  a pending `github_approvals` row and returns - the only code allowed to
  call a real GitHub write API is `runApprovedExecution()`
  (`src/lib/github/execute.ts`), and it's reachable only from the
  human-triggered decide/execute API routes, never from a tool call. Don't
  add a shortcut that lets a tool execute directly "for convenience" - that
  removes the one human-approval gate this whole feature exists to provide.
- This app trusts exactly two MCP servers, ever, and no third
  (`docs/mcp-policy.md`). Never add `mcpServers`/`mcp_servers` config
  anywhere else, never let a route or prompt accept an MCP server
  URL/command/repository/installation-id as input, and never give a coding
  agent a third MCP server without a new, explicit design and approval.
- Every file under `src/mcp/projectFiles/` and `src/mcp/github/` uses
  relative imports, not the `@/` alias - this is required, not stylistic.
  See "Why two files" in `docs/project-files-mcp.md`: `tsx` (which runs
  these servers) resolves tsconfig path aliases once at subprocess startup
  based on a `cwd` this app's own runtime `chdir` fix cannot retroactively
  correct. Adding a new file to either directory with an `@/` import will
  silently break the server the same way it already did once.
