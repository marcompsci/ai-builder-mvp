# AI Builder MVP

A Next.js + TypeScript + Tailwind starter for an AI website-builder product. It has three parts:

1. **Landing Page Generator** (`/`) — describe a website, pick a style, and get a real AI-generated landing page preview (headline, features, testimonial, color palette) from a Claude model.
2. **Project Workspaces** (`/workspaces`) — create isolated local project folders from a fixed starter template, browse their files read-only, run a local preview dev server, and request changes from a coding agent — **Claude Code or Codex, your choice** — with a review-before-apply flow. All agent file access goes through **Project Files MCP**; if the project has a repository connected, the same apply run can also propose a branch/commit/PR/issue through **GitHub MCP** — a second, separate action a human must approve before anything happens on GitHub. These are the only two first-party MCP servers this app trusts.
3. **Version History & GitHub** — every project is a real local git repo with full history, restore, and ZIP download; a one-off GitHub export and the ongoing agent-proposed GitHub Actions flow are both optional and require explicit setup and approval.

Local-development tools only: no auth, payments, production deployment, or team collaboration. Deployment and beta testing: `docs/azure-deployment.md` and `docs/beta.md`. See `docs/architecture.md` for the system overview, `docs/security.md` for the full security model, `docs/agent-protocol.md` for the provider-neutral coding-agent contract, `docs/project-files-mcp.md` / `docs/github-mcp.md` / `docs/mcp-policy.md` for the MCP layer, and `docs/runbook.md` for setup/troubleshooting.

## Setup

Requires Node.js 20+, npm, and `git` on PATH. Both MCP servers run via `npx tsx` (a devDependency already installed by `npm install` — no separate setup).

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:
- `ANTHROPIC_API_KEY` (required) — a key from https://console.anthropic.com/. Used for the landing-page generator and the Claude Code editing agent.
- `OPENAI_API_KEY` (optional) — a key from https://platform.openai.com/api-keys, only if you want the Codex editing agent available too. Neither agent key is required just to browse/preview projects; whichever is missing simply shows as unavailable in the agent selector.
- `WORKSPACE_SECRET_KEY` (required for editing runs and GitHub export) — generate with `openssl rand -base64 32`.
- GitHub export variables (optional) — see the GitHub Export section below.

See `docs/runbook.md` for the full "what needs what" table and common error messages.

```bash
npm run dev
```

Open http://localhost:3000.

> If port 3000 is already used by something else on your machine, Next.js will pick another port automatically (the terminal output shows which one) — or run `npm run dev -- -p 3001` to choose one yourself.

## Environment variables (`.env.local`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Server-side only. Used for landing-page generation and the Claude Code editing agent. Never sent to the browser. |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5` | Overrides the model used for landing-page generation. |
| `OPENAI_API_KEY` | No | — | Server-side only. Only needed to make the Codex editing agent available. Never sent to the browser. |
| `WORKSPACES_ROOT` | No | `./data/workspaces` | Where project workspaces are stored on disk. Must stay a path this app owns — never derived from request input. |
| `WORKSPACE_SECRET_KEY` | Yes (for edit runs / GitHub) | — | HMAC key for the GitHub state token. Generate with `openssl rand -base64 32`. |
| `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | No | — | Only needed for "Connect GitHub". See GitHub Export below. |

## Landing Page Generator

Submitting the form calls `POST /api/generate`, which sends your description and style to Claude using a forced tool call that constrains the response to a fixed JSON shape (headline, subheadline, CTA, three features, a testimonial, and a 5-color palette). The response is re-validated server-side with Zod before being sent to the browser. Errors (missing API key, model failure, malformed output) surface in the UI with a retry option.

## Project Workspaces (Phase 2A)

Clicking "Create Project" calls `POST /api/workspaces`, which:

1. Sanitizes the project name and generates a unique id in the form `prj_<8-char-random>-<slugified-name>` (e.g. `prj_a1b2c3d4-my-coffee-shop`). The random segment is what actually guarantees uniqueness — the slug is cosmetic.
2. Copies the fixed, versioned starter template at `templates/nextjs-starter/v1/` into `data/workspaces/<id>/`.
3. Initializes a git repo in the new workspace and makes an initial commit (see Version History below).
4. Records the project in `data/workspaces/index.json`.

Every file-browsing/preview API route resolves paths through `src/lib/workspaces/paths.ts`, the single sandboxing module every route goes through — see `docs/security.md` §1 for the full detail (traversal/symlink defenses, extension allowlist, `O_NOFOLLOW`).

| Route | Method | Purpose |
|---|---|---|
| `/api/workspaces` | `GET` / `POST` | List / create projects. |
| `/api/workspaces/[id]/files` | `GET` | File tree for a project. |
| `/api/workspaces/[id]/file?path=...` | `GET` | Read one approved file, read-only. |
| `/api/workspaces/[id]/preview` | `GET` / `POST` | Poll / start a project's local dev server (non-blocking; statuses `idle`\|`installing`\|`starting`\|`ready`\|`error`). |

## Coding agent editing runs — Claude Code or Codex (Phase 2B, dual-provider since Phase 4)

From a project's **Request a change** tab: pick an agent (Claude Code or Codex — unavailable ones are shown grayed out with why), describe a change, get a read-only **plan** (files to modify, intended result, risks, validation commands) streamed live, then **Approve** before anything on disk changes. Full flow: plan → approve → git checkpoint → apply → diff → lint/typecheck/build → commit (if validation passed, with the request/agent/validation/files-changed recorded as commit trailers) or preserved failure state with a **Revert** button (if not).

Both agents share one run system — `src/lib/workspaces/agent/pipeline.ts` owns checkpoint/diff/validate/commit identically regardless of provider; and, as of Phase 5A, both go through **Project Files MCP** for every file operation instead of touching the workspace filesystem directly. The two providers get there through genuinely different mechanisms even so (Claude Code: its native Read/Grep/Glob/Edit/Write tools are disallowed entirely, replaced by the MCP tools; Codex: pointed at an empty scratch directory with `sandboxMode: "read-only"` always, so its native shell has nothing real to touch and the MCP tools are the only real access path) — full detail, including why, in `docs/agent-protocol.md`, `docs/project-files-mcp.md`, and `docs/security.md` §2/§6/§9. Neither provider is presented as "better" than the other.

The **Tool Activity panel** (next to the Activity log, in the Request a change tab) shows every Project Files MCP call a run made — tool, path, allowed/blocked, and why — and, when the apply run also has GitHub MCP available, every GitHub read or propose call too (marked "Created a pending approval" for propose calls, since those never execute on their own — see GitHub MCP below).

| Route | Method | Purpose |
|---|---|---|
| `/api/agents` | `GET` | List both providers with availability + reason (drives the agent selector). |
| `/api/workspaces/[id]/agent/plan` | `POST` | Start a plan run. Body: `{ "request": string, "provider": "claude-code" \| "codex" }`. Returns `{ run }`. `503` if the chosen provider's API key isn't configured. |
| `/api/workspaces/[id]/agent/runs/[runId]` | `GET` | Current run status/snapshot. |
| `/api/workspaces/[id]/agent/runs/[runId]/events` | `GET` | Server-Sent Events activity-log stream. |
| `/api/workspaces/[id]/agent/runs/[runId]/approve` | `POST` | Approve the plan and start the apply run (dispatches to whichever provider the run was started with). |
| `/api/workspaces/[id]/agent/runs/[runId]/cancel` | `POST` | Request cancellation (rolls back to the pre-run checkpoint). Codex supports a real hard interrupt; Claude Code stops consuming output and rolls back — see `docs/agent-protocol.md`. |
| `/api/workspaces/[id]/agent/runs/[runId]/revert` | `POST` | Restore the pre-run checkpoint after a failed run. |

**Requires `git` on PATH and the workspace's own dependencies installed** (the apply phase runs `npm install` automatically before validation if `node_modules` is missing).

## Project Files MCP (Phase 5A)

The first-party filesystem MCP server both coding agents use for every file operation inside a project workspace — list, read, search, get a safe project manifest, and (apply phase only) write. Spawned fresh per run, as a stdio subprocess, by our own server-side code — never configurable by the model or the browser. Full reference: `docs/project-files-mcp.md`; this app's standing policy on MCP servers generally (exactly two, ever, no third): `docs/mcp-policy.md`.

Two spawn modes decide what's possible, not a runtime flag: the plan phase's server process never has the write tool registered at all; the apply phase's process is only ever spawned after this app's own approval gate and pre-run git checkpoint have already run. Every call — allowed or blocked — is recorded in an immutable audit log (`mcp_audit_log`) with SHA-256 content hashes, never raw content.

## GitHub MCP (Phase 5B)

The second and final first-party MCP server — 9 read-only tools plus 5 tools that only ever *propose* a GitHub action (branch, push, PR, issue, PR comment) against the one repository a project has connected and selected. Spawned only during the apply phase, and only when a repository is selected — never during planning, never with a repo/owner parameter a model could redirect. Full reference: `docs/github-mcp.md`.

No propose tool ever executes anything — each one creates a pending row in the **GitHub Actions** panel (History & GitHub tab), where a human reviews the action, repo, branches, plain-language reason, and full payload before clicking **Approve** or **Reject**. Approval triggers execution immediately via the one code path allowed to call a GitHub write API (`src/lib/github/execute.ts`); the underlying approval state machine makes replaying an already-executed action structurally impossible, not just policy-forbidden. Direct pushes to the repository's default branch are hard-blocked regardless of what was approved.

## Version History & GitHub Export (Phase 3A)

Every project's git history (initial commit, pre-run checkpoints, and one descriptive commit per successful edit from *either* agent — title, request, which agent made it, validation status, and files changed, all as structured commit trailers) is browsable from the **History & GitHub** tab. The history UI has no provider-specific code at all — it just displays whatever `Agent:` trailer the commit carries.

| Route | Method | Purpose |
|---|---|---|
| `/api/workspaces/[id]/versions` | `GET` | List version history. |
| `/api/workspaces/[id]/versions/[sha]/restore` | `POST` | Restore a version. Body: `{ "confirm": true }`. Never destructive — see `docs/security.md` §3. |
| `/api/workspaces/[id]/download` | `GET` | Download the project as a ZIP (git-tracked files only). |

### GitHub Export (optional)

Uses a **GitHub App**, not OAuth — see `docs/security.md` §5 for why. To enable it:

1. Register a GitHub App at https://github.com/settings/apps/new:
   - Repository permissions: **Contents** (Read & write), **Metadata** (Read-only)
   - Optional, org accounts only: **Organization → Administration** (Read & write) — needed for "create new repository"
   - Callback URL: `http://localhost:3000/api/github/callback`
   - Webhooks can stay disabled
2. Set `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, and `GITHUB_APP_PRIVATE_KEY` in `.env.local` (see `.env.example` for the exact format).
3. From a project's **History & GitHub** tab, click **Connect GitHub**, install the app, then select or create a repository, choose a branch, and confirm the push.

No GitHub token is ever persisted — installation tokens are minted on demand at push time and discarded immediately after. Repository creation and pushes always require an explicit confirmation step in the UI before anything happens.

| Route | Method | Purpose |
|---|---|---|
| `/api/workspaces/[id]/github/connect` | `GET` | Redirects to the GitHub App installation flow. |
| `/api/github/callback` | `GET` | GitHub redirects here after installation; not project-scoped in the URL — the project id round-trips through a signed `state` param. |
| `/api/workspaces/[id]/github/connection` | `GET` / `DELETE` | Connection status / disconnect. |
| `/api/workspaces/[id]/github/repos` | `GET` | List repositories accessible to the connected installation. |
| `/api/workspaces/[id]/github/export` | `POST` | Push to GitHub. Body requires `confirm: true`. |
| `/api/workspaces/[id]/github/export/[exportId]` | `GET` | Poll export status. |
| `/api/workspaces/[id]/github/repo-selection` | `GET` / `PUT` / `DELETE` | The one repository a project is bound to for GitHub MCP access. `PUT` verifies the repo is actually accessible to the installation before saving it. |
| `/api/workspaces/[id]/github/approvals` | `GET` | List an agent-proposed GitHub actions for the project (optionally `?runId=`). |
| `/api/workspaces/[id]/github/approvals/[approvalId]` | `GET` | One approval's full detail. |
| `/api/workspaces/[id]/github/approvals/[approvalId]/decide` | `POST` | Body: `{ "decision": "approved" \| "rejected" }`. Approving executes immediately. |
| `/api/workspaces/[id]/github/approvals/[approvalId]/execute` | `POST` | Retries execution of an already-approved action (e.g. after a transient failure). |

### Database

A local SQLite file at `data/app.db` (via `better-sqlite3`) holds `github_connections`, `github_exports`, `mcp_audit_log`, `github_repo_selections`, and `github_approvals` — project metadata stays in `data/workspaces/index.json` and version history stays in git itself, so there's nothing to keep in sync across stores. Never committed (see `.gitignore`).

### Known limitations (documented, not solved, in this phase)

- Preview, agent-run, and export processes are tracked in memory only; they don't survive an app restart and can be orphaned if the app crashes rather than shutting down cleanly.
- No disk quota or automatic cleanup of old projects.
- Cancelling a running Claude Code turn stops the app from consuming further output and rolls the workspace back to its checkpoint, but doesn't guarantee the underlying CLI subprocess is killed mid-flight (its single-prompt mode doesn't support the SDK's hard interrupt — see the code comment in `src/lib/workspaces/agent/adapters/claudeCodeAdapter.ts`). Codex's cancel is a real hard interrupt (`AbortSignal`). Either way, the rollback guarantees no partial/inconsistent output ever reaches the user.
- Both coding-agent keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are this app's own shared, development-mode credentials — not per-user. See `.env.example` for the documented bring-your-own-key design this should move to before real multi-user usage.
- GitHub Apps can't create repositories under a personal account (a GitHub API limitation, not a bug here) — "create new repository" requires an organization installation; the app surfaces this as a clear error.
- `user_id`/`org_id` in `mcp_audit_log` are fixed local placeholders — this app has no real authentication system yet. The columns are ready for one; the enforcement isn't real multi-tenant security today, since there's only one implicit local user.
- Project Files MCP's Codex integration is structurally verified (interface conformance, sandbox-config assertions, the full protocol layer via an in-memory MCP client) but has not been exercised against a real Codex run in this environment (no `OPENAI_API_KEY` available while building it) — unlike the Claude Code path, which was live-tested end to end and caught two real bugs along the way (see `docs/project-files-mcp.md`).
- GitHub MCP is structurally tested (real MCP protocol layer, real approval state machine, real SQLite schema including the `github_approvals` foreign key) but has not been exercised against a real GitHub repository or a real coding-agent run in this environment (no `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` configured while building it) — same honest caveat as Codex above. Tests mock Octokit at the `getInstallationOctokit()` boundary. See `docs/github-mcp.md`.
- A pending GitHub approval expires 15 minutes after being proposed, with no proactive reminder — it just shows as `expired` next time the panel loads.
- No automatic retention/expiry job for product analytics yet — `product_events`/`feedback` rows persist until a user explicitly deletes them via `/privacy`. See `docs/analytics.md`.
- The `/admin` dashboard and `/api/admin/**` routes have no dedicated admin authentication yet (that's Phase 6 scope) — same single-trusted-operator assumption the rest of the app already has, not a new gap.

## Product analytics (Phase 7A)

A small set of privacy-conscious events (project creation, agent runs, plan approval, validation, preview, GitHub export, MCP allow/deny, feedback) are recorded to a local `product_events` table via `src/lib/analytics/trackEvent.ts` — an explicit per-event property allowlist (never a prompt, source/generated content, a token, or an env value), non-blocking on failure, and structurally separate from the `mcp_audit_log` security trail. An internal `/admin` dashboard shows the activation funnel, a feedback inbox, and recurring failure themes; `/privacy` explains what's collected and lets a user opt out or delete their analytics data. Full reference: `docs/analytics.md`.

## Testing

```bash
npm test
```

- `tests/workspaces/{sanitize,paths,fileAccess}.test.ts` — Phase 2A path sandboxing and file-access authorization.
- `tests/workspaces/{agentGit,agentPolicy}.test.ts` — the git checkpoint/restore module (including a real hostile-hook-plant test, a real symlink-escape test, and version history round-tripping for both agents) and the Claude Code permission policy / plan-JSON extraction.
- `tests/workspaces/zipExport.test.ts` — ZIP export only includes git-tracked files.
- `tests/workspaces/agent/adapterConformance.test.ts` — both adapters satisfy the same `CodingAgent` interface shape.
- `tests/workspaces/agent/codexSandbox.test.ts` — the Codex sandbox configuration (never `danger-full-access`, network disabled, no `additionalDirectories`, always read-only as of Phase 5A).
- `tests/workspaces/agent/runStore.test.ts` — provider-tagged run creation, cancel/failure/cancelled state recording, per-run event isolation.
- `tests/workspaces/agent/availability.test.ts` — provider availability never leaks the actual credential value.
- `tests/mcp/projectFilesMcp.test.ts` — Project Files MCP through the real MCP protocol layer (`InMemoryTransport` + a real `Client`): path traversal, symlink escape, cross-project access via traversal, blocked sensitive files, size limits (read and write), write-tool absence in read-only mode, and audit-log correctness (allow/deny rows, real hashes, never raw content or the test `.env` secret value).
- `tests/mcp/rateLimit.test.ts` — the per-process call-count limit, isolated in its own file to avoid cross-test counter pollution.
- `tests/github/state.test.ts` — the CSRF-protection state token (tamper/expiry/malformed rejection).
- `tests/github/pushApproval.test.ts` — the export approval gate (`confirm: true` required) and token-redaction in git error output.
- `tests/mcp/githubMcp.test.ts` — GitHub MCP through the real MCP protocol layer: no tool exposes a repo/owner parameter, read tools return correctly-shaped data (Octokit mocked at the `getInstallationOctokit()` boundary), propose tools only ever create a pending approval and never call GitHub, every propose call is written to the shared audit log with `approval_id` populated, errors never leak the underlying message, and the rate limit denies calls past its cap.
- `tests/github/approvals.test.ts` — the approval state machine: `hashPayload` determinism, project-scoped lookups, `pending → approved/rejected` and `approved → executed` transitions, the anti-replay guarantee (a second `markExecuted` call always throws), and TTL expiry flipping a stale pending row to `expired` on read.
- `tests/github/execute.test.ts` — `execute.ts`'s two hard guards: refusing a direct push to the default branch (without touching git or GitHub at all), and refusing to execute when the project's current repo selection no longer matches the approval's repo — plus a full successful execute-and-record-result path.
- `tests/analytics/schema.test.ts` — every event has a schema requiring `userId` and accepting a null `orgId`, and no event's declared shape can carry a prompt/source-code/token/env-value-shaped field.
- `tests/analytics/trackEvent.test.ts` — the allowlist strips anything undeclared, opted-out users get no row written, a database failure never throws out of `trackEvent()`, and a malformed enum value is dropped rather than crashing.
- `tests/analytics/rateLimit.test.ts`, `tests/analytics/feedback.test.ts` — the per-key rate limiter, and feedback CSV export/CSV-escaping/"top problems" never leaking raw free text.

None of the above require an API key. Exercising a real model call (landing-page generation, or either coding agent) or a real GitHub API call requires the corresponding key/App credentials and isn't part of the automated suite — see `docs/runbook.md`.

## Other scripts

```bash
npm run build   # production build
npm run lint    # eslint
npx tsc --noEmit  # typecheck
```
