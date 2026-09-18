# Architecture

High-level shape of the system. For the security reasoning behind these boundaries, see `docs/security.md`; for the coding-agent contract specifically, see `docs/agent-protocol.md`.

## Overview

```
┌───────────────────────────────────────────────────────────────────┐
│ Next.js app (App Router)                                          │
│  /            landing-page generator (single Anthropic call)      │
│  /workspaces  project workspaces UI (Files / Agent / History+GH)  │
└───────────────────────────────────────────────────────────────────┘
        │                     │                       │
        ▼                     ▼                       ▼
┌──────────────┐   ┌───────────────────────┐   ┌──────────────────┐
│ Phase 2A      │   │ Phase 2B/4             │   │ Phase 3A          │
│ workspaces/   │   │ workspaces/agent/       │   │ workspaces/git/,   │
│ paths, fsTree,│   │ pipeline, two adapters, │   │ lib/github/,       │
│ create,preview│   │ runStore                │   │ lib/db/            │
└──────────────┘   └───────────┬────────────┘   └──────────────────┘
        │                      │ spawns (stdio,           │
        │                      │ trusted env, per run)     │
        │                      ▼                            │
        │          ┌───────────────────────┐                │
        │          │ Phase 5A / 5B            │                │
        │          │ src/mcp/projectFiles/    │                │
        │          │ src/mcp/github/           │                │
        │          │ the two MCP servers both   │                │
        │          │ adapters use - files, and  │                │
        │          │ GitHub only when a repo is  │                │
        │          │ connected (apply phase only)│                │
        │          └───────────────────────┘                │
        └──────────────────────┬─────────────────────────────┘
                                ▼
        data/workspaces/<id>/  (one directory per project, each
        its own git repo, sandboxed by src/lib/workspaces/paths.ts -
        the module both the app AND Project Files MCP go through)
```

## Layers

**Project workspaces (Phase 2A)** — `src/lib/workspaces/{paths,fsTree,create,preview,sanitize,store}.ts`. Owns the filesystem sandbox every other layer builds on: project id generation/validation, path resolution with traversal/symlink defenses, the read-only file browser, and the local preview dev server.

**Coding agents (Phase 2B, generalized in Phase 4)** — `src/lib/workspaces/agent/`. One provider-neutral run system:
- `types.ts` — the `CodingAgent` interface every adapter implements.
- `runStore.ts` — in-memory run state (phase, plan, diffs, validation, events), keyed by run id, provider-tagged.
- `pipeline.ts` — the shared checkpoint → diff → validate → commit-or-preserve-failure sequence, identical regardless of provider.
- `adapters/{claudeCodeAdapter,codexAdapter}.ts` — the only provider-specific code; each drives its SDK and emits normalized `AgentEvent`s, then hands off to `pipeline.ts`.
- `policy.ts` / `codexPolicy.ts` — each provider's own tool/sandbox restrictions.
- `availability.ts` — credential-presence checks surfaced to the UI's agent selector.

**Git & GitHub (Phase 3A, extended in 5B)** — `src/lib/workspaces/git/` (per-workspace git: init, checkpoint, restore, history, ZIP export) and `src/lib/github/` (GitHub App auth, CSRF-safe connect flow, one-off export push, plus Phase 5B's `repoSelection.ts`/`approvals.ts`/`execute.ts` for the ongoing MCP-driven flow). `src/lib/db/` holds the SQLite tables this app needs (`github_connections`, `github_exports`, `mcp_audit_log`, and - as of Phase 5B - `github_repo_selections`/`github_approvals`) — everything else (project metadata, version history) lives in flat files or git itself, not a database.

**Project Files MCP (Phase 5A)** — `src/mcp/projectFiles/` (the server: bootstrap, tool implementations, audit log, rate limit, secret redaction) and `src/lib/workspaces/agent/mcp/config.ts` (the provider-neutral launch-config builder both adapters call). Reuses `src/lib/workspaces/paths.ts`/`fsTree.ts` rather than reimplementing path validation. See `docs/project-files-mcp.md`.

**GitHub MCP (Phase 5B)** — `src/mcp/github/` (same bootstrap shape as Project Files MCP: 9 read tools + 5 propose-only write tools, scoped to one repository baked into its trusted context) and `src/lib/workspaces/agent/mcp/githubConfig.ts` (the launch-config builder). Spawned only in the apply phase, only when `getActiveGitHubTarget()` finds a connected+selected repo. Every propose tool creates a `github_approvals` row instead of executing; the only code that ever calls a GitHub write API is `src/lib/github/execute.ts`, reachable only from the human-triggered decide/execute routes. See `docs/github-mcp.md`.

Project Files MCP and GitHub MCP are the two, and only two, first-party MCP servers this app trusts - see `docs/mcp-policy.md`.

**UI** — `src/app/workspaces/page.tsx` is the shell with a project sidebar and a three-tab main area (Files, Request a change, History & GitHub); `src/components/workspaces/{agent,history,github}/` hold the tab contents, including the Tool Activity panel (`agent/ToolActivityPanel.tsx`) and the GitHub Actions approval panel (`github/GitHubMcpPanel.tsx`).

## Data flow: one edit request

1. UI → `POST /api/workspaces/[id]/agent/plan` with `{ request, provider }`.
2. Route validates the project, checks `isProviderAvailable(provider)`, creates a run (`runStore.createRun`), and calls `getAdapter(provider).createPlan(...)` without awaiting it - the response returns immediately with the run id.
3. The adapter spawns Project Files MCP in **read-only** mode (trusted project id/run id/provider injected via env, never a tool argument) and streams the model's exploration, emitting normalized `AgentEvent`s (`file_read`, ...) the UI receives over `GET .../events` (SSE) and renders in both the Activity log and the Tool Activity panel; on completion it extracts and validates a structured plan and moves the run to `awaiting_approval`.
4. UI → `POST .../approve`. The route looks up `run.provider` and calls that adapter's `executeApprovedPlan`.
5. `pipeline.ts` takes over: git checkpoint → the adapter spawns a **fresh** Project Files MCP process in **read-write** mode and drives the edit (emitting `file_write`/`command_*` events, each with an allow/deny outcome) → `diffAgainstCheckpoint` → install deps if needed → run lint/typecheck/build → commit with structured trailers (request, agent, validation, files changed) if all passed, or preserve the failed state for the UI to show + offer Revert.
6. Every Project Files MCP tool call along the way - both phases - writes one row to `mcp_audit_log`, independent of what the UI shows.
7. The resulting commit (or, for a restore, the new forward-moving commit) is immediately visible in the History & GitHub tab, with zero provider-specific code in the history/version UI.
8. If the project has a repository connected and selected, and the request explicitly asked for a GitHub action, step 5's apply run also has GitHub MCP available and may call one propose tool - creating a `github_approvals` row, never executing anything. That row shows up in the GitHub Actions panel for a human to approve or reject; approving triggers `runApprovedExecution` immediately, which is the only code path that ever reaches the real GitHub write APIs. See `docs/github-mcp.md`.

## Why so few "phase" boundaries survive in the code

The phase numbers in this document and the git history are planning artifacts, not architecture. In the actual code there's no `phase2b/` or `phase3a/` directory - `src/lib/workspaces/agent/pipeline.ts`, for instance, is Phase 2B in origin but is exactly as much Phase 4's foundation, and `src/lib/workspaces/git/checkpoint.ts` is Phase 3A in origin but is the snapshot mechanism Phase 2B's pipeline actually calls. Phase 5A followed the same pattern in reverse: it didn't add a new checkpoint/diff/validate flow, it replaced *how* the existing pipeline's file access happens, in both adapters, without pipeline.ts itself changing at all. Organize new work by what it does, not by which phase introduced the neighboring code.
