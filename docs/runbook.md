# Runbook

Local setup, required credentials, and what actually breaks (with the real error text) when something's missing or misconfigured.

## Prerequisites

- Node.js 20+, npm, `git` on `PATH`.
- At least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` if you want to use the coding-agent editing flow. Neither is required just to browse/preview projects.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then edit `.env.local` - see the table below for what each feature actually needs.

## What each feature requires

| Feature | Required env vars | What happens if missing |
|---|---|---|
| Landing page generator (`/`) | `ANTHROPIC_API_KEY` | `POST /api/generate` returns `502` with `"ANTHROPIC_API_KEY is not set..."` |
| Project workspaces, preview | none | Works with no configuration |
| Claude Code editing runs | `ANTHROPIC_API_KEY` | The agent selector shows Claude Code as **unavailable**; `POST .../agent/plan` with `provider: "claude-code"` returns `503` before a run is even created |
| Codex editing runs | `OPENAI_API_KEY` | Same pattern: selector shows Codex unavailable; plan route returns `503` |
| Claude Code / Codex editing runs (either) | `WORKSPACE_SECRET_KEY`, `git` on `PATH` | Missing `git` fails project creation itself (workspace init requires it); `WORKSPACE_SECRET_KEY` is only strictly required once GitHub export is also in use, but generate it upfront - see `.env.example` |
| GitHub export | `WORKSPACE_SECRET_KEY`, `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | "Connect GitHub" returns `503` with a message naming the specific missing variable |
| Version history, restore, ZIP download | none (beyond `git`) | Works with no configuration |
| Project Files MCP | none beyond whichever coding-agent key you're using | Not separately configured - both adapters spawn it automatically. If `npx`/`tsx` can't run (very unusual - `tsx` is a normal devDependency installed by `npm install`), the agent run fails with a generic error and an audit-log-adjacent stderr line naming the missing piece; see `docs/project-files-mcp.md` for standalone debugging |
| GitHub MCP (agent-proposed branches/PRs/issues) | same as GitHub export, plus a repository selected in the GitHub Actions panel | Not separately configured beyond the connect + repo-select step. If no repo is selected, the server simply isn't spawned - no error, the agent just has no GitHub tools that run. If credentials are missing, selecting a repo fails at the "Connect GitHub" step first, before this ever matters; see `docs/github-mcp.md` |

## Common errors and what they mean

- **`"<provider> is not available. Check its API key is configured."` (503, from `/api/workspaces/[id]/agent/plan`)** — expected, not a bug: the relevant API key isn't in `.env.local`. Check `GET /api/agents` to see both providers' status and reason strings at once.
- **`"Could not install dependencies: ..."` (a run's `error` field, reason `install_failed`)** — the apply phase auto-runs `npm install` in the workspace before validation if `node_modules` is missing; this surfaces if that install itself fails (network issue, registry problem). The run is preserved as `failed` with the checkpoint available to Revert - nothing is auto-retried.
- **`"The agent did not return a valid plan. Try rephrasing the request."` (reason `invalid_plan`)** — the model's final answer didn't end with a schema-valid fenced JSON plan block. Usually resolved by rephrasing the request to be more concrete; this is a plan-quality issue, not a config issue.
- **`git ... failed (exit N)` from any workspace git operation** — check `git` is installed and on `PATH` for the process running `npm run dev`. Every workspace is its own repo at `data/workspaces/<id>/`; you can inspect one directly with `git -C data/workspaces/<id> log` if something looks wrong.
- **Codex run fails immediately with an auth-shaped error even though `OPENAI_API_KEY` is set** — the key is passed explicitly (`new Codex({ apiKey })`), not inferred from an SDK-internal env var name, so a typo'd/expired key surfaces as a normal API error from OpenAI rather than a "key not found" error from this app.
- **A GitHub export fails with `"This GitHub connection is on a personal account. GitHub Apps can't create repositories there..."`** — not a bug: GitHub Apps genuinely cannot create repositories under a personal account via an installation token. Either create the repo manually on GitHub and select it as "existing," or connect an organization installation instead.
- **Port 3000 already in use** — Next.js auto-picks another port and prints it, or run `npm run dev -- -p 3001`.
- **An agent run's activity shows an MCP tool call as blocked with no obvious reason** — check the Tool Activity panel's reason text first; if that's not enough, the full detail (including `err.name`, e.g. `WorkspacePathError`) is in `mcp_audit_log` (`data/app.db`), never in anything sent back to the model - by design, per `docs/project-files-mcp.md`, tool-facing errors are always generic.
- **An agent run seems to hang for a long time on its first tool call** — if it's still slow after a few minutes, see the two real, previously-hit bugs documented in `docs/project-files-mcp.md` ("Why two files"): a `permissionMode` misconfiguration made every MCP tool call get silently blocked, and a `cwd`/path-alias issue made the MCP server resolve the wrong workspace. Both are fixed in this codebase as shipped; if you're modifying `policy.ts`, `codexPolicy.ts`, or anything under `src/mcp/projectFiles/` or `src/mcp/github/`, re-read that section before assuming a slow run is just slow.
- **A GitHub action proposed by the agent never shows up as executed, even after clicking Approve** — check the `executionError` the decide response returns (surfaced under the approval card in the GitHub Actions panel): the approval row itself is still marked `approved` (not lost), and `POST .../approvals/[approvalId]/execute` retries it. This is expected for a transient GitHub API failure, not a bug in the approval state machine - see `docs/github-mcp.md`.
- **The GitHub Actions panel shows no repository option to select** — the connected installation has no repositories accessible to it, or the installation only covers repos this project's GitHub App connection doesn't include; check the same "Connect GitHub" repo list the export flow uses (`GET .../github/repos`), which both features share.

## Verifying a local setup end-to-end

```bash
npm test          # 174 tests as of this writing; should all pass with zero env vars set
npx tsc --noEmit
npm run lint
npm run build
```

None of the above require any API key - they cover path sandboxing, git checkpoint/restore, the agent policy/sandbox configuration, both MCP servers through the real MCP protocol layer (with GitHub MCP's Octokit calls mocked at the `getInstallationOctokit()` boundary), the GitHub approval state machine, ZIP export, and the GitHub CSRF/approval/redaction logic entirely through structural tests and real (but credential-free) git/MCP operations. Exercising an actual model call or a real GitHub API call (landing-page generation, either coding-agent provider including a live run through either MCP server, or an actual branch/PR/issue via GitHub MCP) requires the corresponding API key/App credentials and is not part of the automated suite.

## Operational limitations (by design, not yet solved)

- Preview servers, agent runs, and GitHub exports are tracked in memory only - they don't survive an app restart.
- No disk quota or automatic cleanup of old projects.
- No "stop preview" endpoint - a preview server keeps running until the app process exits.
- A pending GitHub approval expires after 15 minutes with no separate reminder - the UI shows it as `expired` on next load, but nothing proactively notifies anyone before that happens.
