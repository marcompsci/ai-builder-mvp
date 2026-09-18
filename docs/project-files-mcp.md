# Project Files MCP

The one, first-party filesystem MCP server both coding agents use for every file operation inside a project workspace. See `docs/mcp-policy.md` for why this is the *only* MCP server this app trusts, and `docs/security.md` §2/§6 for the full threat model.

## Where it lives

```
src/mcp/projectFiles/
  server.ts    - bootstrap entry point (chdir, then loads main.ts - see "Why two files")
  main.ts      - actual server: builds trusted context, registers tools, connects stdio
  config.ts    - reads trusted context from env (the ONLY source of identity - see below)
  tools.ts     - the five tool implementations
  auditLog.ts  - writes to mcp_audit_log
  rateLimit.ts - per-process call-count limit
  secretRedaction.ts - best-effort redaction of search-result snippets
```

It's spawned as a **stdio subprocess**, fresh per agent run, by `src/lib/workspaces/agent/mcp/config.ts`'s `getProjectFilesMcpConfig()` - the one function both adapters call to get the (identical-shaped) launch config.

## How identity is trusted (never a model/browser parameter)

The project id, run id, provider, and mode are injected as **environment variables** at spawn time, by our own server-side pipeline code - never as a tool argument. Concretely:

```
PROJECT_FILES_MCP_PROJECT_ID=prj_...
PROJECT_FILES_MCP_RUN_ID=...
PROJECT_FILES_MCP_PROVIDER=claude-code | codex
PROJECT_FILES_MCP_MODE=read-only | read-write
PROJECT_FILES_MCP_APP_ROOT=<absolute path> (see "Why two files")
```

**None of the five tool schemas has a `project_id`, `workspace`, or `path`-outside-the-workspace parameter.** There is no argument through which a model could ask for a different project - the server is single-tenant for its entire process lifetime by construction. `userId`/`orgId` are currently fixed local placeholders (`local-dev-user` / `local`) - this app has no real auth system yet; see the honest note in `docs/security.md` §5.

## Two spawn modes - not a runtime flag

- **`read-only`**: spawned for the plan phase. Registers `list_project_files`, `read_project_file`, `search_project_files`, `get_project_context`. `write_project_file` is **never registered** in this process - not hidden behind a check, structurally absent from the tool list a client discovers.
- **`read-write`**: spawned only inside `executeApprovedPlan` - i.e. only after this app's own approval gate and pre-run git checkpoint have already run. All five tools registered.

## Tool reference

| Tool | Mode | Input | Output |
|---|---|---|---|
| `list_project_files` | both | `{ subdirectory?: string }` | `{ entries: FileTreeNode[] }` |
| `read_project_file` | both | `{ path: string }` | `{ path, content, size }` |
| `search_project_files` | both | `{ query: string, maxResults?: number }` | `{ matches: { path, line, snippet }[] }` |
| `get_project_context` | both | `{}` | `{ framework, scripts, sourceDirectories, designTokens, allowedExtensions }` |
| `write_project_file` | read-write only | `{ path: string, content: string }` | `{ path, bytesWritten }` |

All paths are relative and validated through the **same** sandbox module Phase 2A already uses (`src/lib/workspaces/paths.ts` - traversal/absolute-path/symlink-escape defenses, now extended with `resolveWorkspaceWritePath` for the create-vs-update case a write introduces). Nothing here reimplements path validation.

**Limits** (`src/lib/workspaces/config.ts`): reads and writes capped at 256KB (`MCP_MAX_READ_BYTES`/`MCP_MAX_WRITE_BYTES`), search capped at 50 results (`MCP_MAX_SEARCH_RESULTS`), 200 tool calls per run (`rateLimit.ts`).

**Blocked regardless of extension**: any path with a hidden segment (dotfiles/dotdirs) or matching `SENSITIVE_FILENAME_PATTERNS` (`.env*`, `credentials`, `id_rsa`/`id_ed25519`, `*.pem`, `*.key`, anything with `token`/`secret` in the name, `.npmrc`, `.netrc`).

## Errors are always generic

Every tool call is wrapped by `guarded()` in `tools.ts`: on failure, the client gets a fixed, generic message ("That request could not be completed...") - never the underlying error's own message, a filesystem path, or a stack trace. The specific reason is still recorded in the audit log (`err.name`, e.g. `WorkspacePathError`), just not echoed back to the model/UI verbatim.

## Audit log

Every call - allow or deny - writes one row to `mcp_audit_log` (`src/lib/db/index.ts`) via `recordAuditEntry()`: timestamp, user/org id (placeholders today), project id, run id, provider, tool name, relative path, decision, reason, and - for writes - SHA-256 content hashes before/after. **Never raw content.** Rows are insert-only; no code path updates or deletes them.

## Why two files (`server.ts` + `main.ts`) - a real bug this fixes

Found via live testing, not by inspection: the subprocess spawned for this server does **not** reliably inherit this app's `cwd`, and `WORKSPACES_ROOT`/the SQLite DB path (both derived from `process.cwd()`) resolved incorrectly as a result. `server.ts` is a minimal bootstrap with no static imports of anything cwd-dependent - it reads `PROJECT_FILES_MCP_APP_ROOT` from env and calls `process.chdir()` *before* dynamically importing `main.ts` (a dynamic `import()` runs after the calling code, unlike a static `import`, which is hoisted and evaluated before any of the importing module's own code - chdir-ing after a static import of cwd-dependent code would be too late).

**A related, separate fix**: every file inside `src/mcp/projectFiles/` uses **relative imports**, not this app's `@/` path alias. `tsx` (used to run this TypeScript file directly - see below) resolves tsconfig path aliases once at process startup based on the subprocess's *initial* cwd, which the runtime `chdir` above cannot retroactively fix. Relative imports have no such dependency and were confirmed to work correctly when the server is invoked from a different working directory than this app's own.

## Local development

Run the server standalone (useful for debugging without spinning up a full agent run):

```bash
PROJECT_FILES_MCP_APP_ROOT="$(pwd)" \
PROJECT_FILES_MCP_PROJECT_ID=prj_xxxxxxxx-your-project \
PROJECT_FILES_MCP_RUN_ID=manual-test \
PROJECT_FILES_MCP_PROVIDER=claude-code \
PROJECT_FILES_MCP_MODE=read-write \
npx tsx src/mcp/projectFiles/server.ts
```

It speaks MCP over stdio - pipe newline-delimited JSON-RPC requests to it, or drive it from a small script using `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport`. The test suite (`tests/mcp/projectFilesMcp.test.ts`) does this in-process via `InMemoryTransport.createLinkedPair()`, which is the easier pattern to copy for ad hoc debugging - see that file for a working example of registering the tools and calling them through the real MCP protocol layer without spawning a subprocess at all.

```bash
npm test -- tests/mcp          # path traversal, symlink escape, cross-project, size limits, audit log
npm test -- tests/mcp/rateLimit.test.ts   # rate limiting, isolated (module-level counter)
```

## Testing this against a real coding-agent run

Both adapters wire this server in automatically - there's no separate "enable MCP" step. To confirm end-to-end behavior against a real model (requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), submit a request from the **Request a change** tab and watch the new **Tool Activity** panel: every `list_project_files`/`read_project_file`/`write_project_file`/`search_project_files`/`get_project_context` call the agent makes shows up there with its allow/deny outcome.
