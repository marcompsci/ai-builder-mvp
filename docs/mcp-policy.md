# MCP policy

This app's standing policy on Model Context Protocol servers - what's allowed, what isn't, and why. Read this before adding or changing anything MCP-related; the tool-level detail for each server is in `docs/project-files-mcp.md` and `docs/github-mcp.md`.

## The policy, in one sentence

**Exactly two first-party MCP servers are trusted, ever: Project Files MCP and GitHub MCP.** No other MCP server - third-party, dynamically configured, or agent-supplied - is ever connected to a coding-agent run in this app, and no third first-party server is planned.

## What this means concretely

- Every agent run's `mcpServers` (Claude Code) / `config.mcp_servers` (Codex) configuration is built by exactly two functions - `getProjectFilesMcpConfig()` and `getGitHubMcpConfig()` (`src/lib/workspaces/agent/mcp/config.ts` and `githubConfig.ts`) - and contains at most those two entries: `project-files` (always) and `github` (only when the project has a repository connected and selected, and only during the apply phase - see `docs/github-mcp.md`). No route, adapter, or UI surface constructs its own MCP server list.
- Both SDKs are explicitly told to ignore whatever MCP configuration might otherwise exist on the host machine - Claude Code's `mcpServers` option fully replaces (not merges with) any global/project config; Codex's `config: { mcp_servers: {...} }` does the same for `~/.codex/config.toml`. A developer's personal MCP setup on their own machine never leaks into a workspace run.
- The model can never configure its own MCP endpoint, add a server, change which tools are exposed, or request a different one. There is no tool, prompt, or code path that accepts an MCP server URL/command, a repository, or an installation id from the model or the browser.
- No MCP marketplace, no "install this MCP server" flow, no per-project MCP configuration UI.

## Why two servers, not "MCP servers, generically"

Every MCP server a coding agent can reach is effectively part of its trust boundary - a malicious or misconfigured server can misdescribe its own tools, and the model has no independent way to verify what a tool call actually does before calling it (see the threat-model section in `docs/security.md`). Limiting this app to servers we author and review ourselves - never arbitrary or agent-chosen ones - is what makes "the MCP server enforces the sandbox" a meaningful security claim rather than "some MCP server, possibly untrusted, enforces the sandbox."

Project Files MCP and GitHub MCP are kept as two separate server processes, not one, so a bug or compromise in one server's tool surface doesn't expand the other's: Project Files MCP can only ever touch the local workspace sandbox, and GitHub MCP can only ever touch the one repository baked into its trusted context at spawn time, and even then only by creating a pending approval a human must act on for every write.

## No third MCP server

This is the final count. If a future integration seems to need a third server, that is a new phase requiring its own explicit design and approval - not an extension of this policy.
