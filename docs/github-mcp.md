# GitHub MCP

The second and final first-party MCP server (see `docs/mcp-policy.md`). Gives both coding agents 9 read-only tools against one specific repository, plus 5 tools that *propose* a write action - none of which ever executes anything by itself. Every proposed action requires a fresh human approval, and the actual GitHub API call happens only from a human-triggered route, never from a tool call. See `docs/security.md` §9/§10 for the full threat model.

## Where it lives

```
src/mcp/github/
  server.ts    - bootstrap entry point (chdir, then loads main.ts - identical pattern to Project Files MCP)
  main.ts      - actual server: builds trusted context, registers tools, connects stdio
  config.ts    - reads trusted context from env (the ONLY source of identity)
  tools.ts     - the 9 read + 5 propose tool implementations
  auditLog.ts  - writes to the same mcp_audit_log table Project Files MCP uses
  rateLimit.ts - own per-process call-count limit (100/run), independent of Project Files MCP's

src/lib/github/
  appAuth.ts       - GitHub App auth, installation Octokit (Phase 3A, reused here)
  connections.ts   - per-project GitHub App connection (Phase 3A, reused here)
  repoSelection.ts - the ONE repository a project is bound to for MCP access (Phase 5B)
  approvals.ts     - the approval-binding state machine (createApproval/decideApproval/markExecuted)
  execute.ts       - the only code that actually calls the GitHub write APIs
  auditLog.ts      - audit rows for human decide/execute actions (provider = "human")
```

It's spawned as a **stdio subprocess**, fresh per apply-phase agent run, by `src/lib/workspaces/agent/mcp/githubConfig.ts`'s `getGitHubMcpConfig()`.

## When it's spawned at all

GitHub MCP is **not** always present. `getActiveGitHubTarget()` (`src/lib/workspaces/agent/githubTarget.ts`) looks up whether the project has both a GitHub App connection (Phase 3A) *and* a repository selected for MCP access (Phase 5B, `github_repo_selections`); if either is missing, the server is simply never spawned for that run - there is nothing to disable, because there is nothing running.

It is also **apply-phase only**. Both adapters pass `includeGitHub: false` for `createPlan()` and `true` only for `executeApprovedPlan()` - the plan phase never has network or GitHub access, matching the existing "no writes during planning" posture from Phase 5A. `policy.ts`'s `PLAN_POLICY.disallowedTools` also names every `mcp__github__*` tool explicitly, as defense in depth even though the server process doesn't exist in that phase.

## How identity and repo scope are trusted (never a model/browser parameter)

Everything - including which repository - comes from environment variables set by our own server-side code at spawn time:

```
GITHUB_MCP_PROJECT_ID=prj_...
GITHUB_MCP_RUN_ID=...
GITHUB_MCP_PROVIDER=claude-code | codex
GITHUB_MCP_CONNECTION_ID=...
GITHUB_MCP_INSTALLATION_ID=...
GITHUB_MCP_REPO_FULL_NAME=owner/repo
GITHUB_MCP_DEFAULT_BRANCH=...
GITHUB_MCP_APP_ROOT=<absolute path>
```

**No tool - read or write - takes an `owner`, `repo`, or `repoFullName` parameter.** The repository is fixed for the entire process lifetime by construction; there is no argument through which a model could ask for a different one, and a dedicated test (`tests/mcp/githubMcp.test.ts`) asserts this by inspecting every registered tool's input schema. `userId`/`orgId` are the same local placeholders Project Files MCP uses - see the honest note in `docs/security.md` §5.

## Tool reference

### Read-only (always safe to call; still rate-limited and audited)

| Tool | Input | Output |
|---|---|---|
| `get_repository_metadata` | `{}` | `{ fullName, defaultBranch, private, description }` |
| `list_branches` | `{}` | `{ branches: { name, protected }[] }` |
| `list_repository_files` | `{ path?, ref? }` | `{ entries: { name, path, type }[] }` |
| `read_repository_file` | `{ path, ref? }` | `{ path, content, size }` |
| `list_issues` | `{ state? }` | `{ issues: { number, title, state }[] }` |
| `read_issue` | `{ number }` | `{ number, title, body, state }` |
| `list_pull_requests` | `{ state? }` | `{ pullRequests: { number, title, state, head, base }[] }` |
| `read_pull_request` | `{ number }` | `{ number, title, body, state, head, base }` |
| `get_pull_request_diff` | `{ number }` | `{ diff }` (via Octokit's diff media type on `pulls.get`) |

### Propose-write (every call creates a pending approval and returns immediately - never executes anything)

| Tool | Input | Approval action type | Reversible |
|---|---|---|---|
| `create_branch` | `{ branchName, fromBranch?, reason }` | `create_branch` | yes |
| `create_commit_or_push_changes` | `{ branchName, commitSummary, reason }` | `create_commit_or_push_changes` | **no** |
| `create_pull_request` | `{ title, body?, headBranch, baseBranch?, draft?, reason }` | `create_pull_request` | yes |
| `create_issue` | `{ title, body?, reason }` | `create_issue` | yes |
| `add_pull_request_comment` | `{ pullNumber, body, reason }` | `add_pull_request_comment` | yes |

Every propose tool's response is `{ status: "pending_approval", approvalId }`. The prompt sent to the agent in the apply phase explicitly instructs it to call a propose tool only when the human's request explicitly asked for that GitHub action - not automatically alongside every file edit.

## The approval-binding pipeline

1. A propose tool call inserts one row into `github_approvals` (`src/lib/github/approvals.ts`): status `pending`, a SHA-256 hash of the exact payload (`hashPayload`), a 15-minute expiry.
2. A human reviews it in the **GitHub Actions** panel (`src/components/workspaces/github/GitHubMcpPanel.tsx`) - action type, repo, target/source branch, plain-language reason, the full payload, and whether it's reversible - and clicks **Approve** or **Reject**.
3. `POST /api/workspaces/[id]/github/approvals/[approvalId]/decide` calls `decideApproval()`, which only ever accepts a `pending → approved|rejected` transition (`ApprovalStateError` otherwise - no re-deciding, no double-approving).
4. On approval, the same route immediately calls `runApprovedExecution()` (`src/lib/github/execute.ts`), which re-derives the installation and default branch from the project's **current** connection and repo selection (never trusting anything cached on the approval row), refuses to run if the repo no longer matches (guards against a stale approval surviving a disconnect/reconnect to a different repo), and calls the one real GitHub API operation for that action type.
5. `markExecuted()` flips `approved → executed` and stores the result - and only ever accepts that exact transition, which is what makes replay structurally impossible: an already-executed or never-approved row can never be executed again, by construction, not by a runtime check that could be bypassed.
6. If execution fails (e.g. a transient GitHub API error), the approval stays in `approved` status and `POST /api/workspaces/[id]/github/approvals/[approvalId]/execute` can retry it - still gated by the same one-time-use state machine.

Two hard rules enforced in `execute.ts`, not left to GitHub's own settings:
- **No direct push to the repo's default branch, ever** (`assertNotDefaultBranch`) - the one hard-coded rule this app enforces itself rather than depending on GitHub's branch protection API being visible to the installation token.
- **Nothing here trusts a repo id, connection id, or installation id supplied by the browser** - `runApprovedExecution` always re-reads the project's own connection/selection from the database by project id, never from a request body field.

## Audit log

Both the agent-tool-call side (`src/mcp/github/auditLog.ts`, `provider` = the agent's own value) and the human decide/execute side (`src/lib/github/auditLog.ts`, `provider = "human"`) write into the **same** `mcp_audit_log` table Project Files MCP uses, with the GitHub-specific columns (`repository`, `branch`, `approval_id`, `github_result_ref`) populated and the file-specific column (`relative_path`) left null. One unified trail answers both "what did the agent propose" and "what did the human do about it."

## Errors are always generic

Same discipline as Project Files MCP: `guarded()` in `tools.ts` never echoes an underlying error's message back to the model (a GitHub API error can carry a token fragment or other sensitive detail) - only a fixed string. The real reason (`err.name`) is still recorded in the audit log.

## What this app deliberately does not build (out of scope for this phase)

No repository or branch deletion, no force push, no visibility/permission changes, no secrets/Actions/releases/webhooks/SSH-key management, no org-wide scanning, no direct writes to a protected or default branch, no automatic merges, no arbitrary GitHub API access beyond the 14 listed tools, no second repository per project, no compound "branch + push + PR" single action (each is its own tool call and its own approval).

## Local development

```bash
GITHUB_MCP_APP_ROOT="$(pwd)" \
GITHUB_MCP_PROJECT_ID=prj_xxxxxxxx-your-project \
GITHUB_MCP_RUN_ID=manual-test \
GITHUB_MCP_PROVIDER=claude-code \
GITHUB_MCP_CONNECTION_ID=conn-test \
GITHUB_MCP_INSTALLATION_ID=12345 \
GITHUB_MCP_REPO_FULL_NAME=owner/repo \
GITHUB_MCP_DEFAULT_BRANCH=main \
npx tsx src/mcp/github/server.ts
```

Requires `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` (see `.env.example`) to actually reach GitHub - without them it fails fast with a clear config error (confirmed via a manual smoke test in this environment, which has no real GitHub App credentials configured; see the honest test-coverage note below).

```bash
npm test -- tests/mcp/githubMcp.test.ts    # tool wiring, propose-vs-execute, no repo param, generic errors, rate limit
npm test -- tests/github                   # approval state machine, execute.ts guards
```

## Test coverage - what's real and what isn't

Like Codex in Phase 5A: this integration is **structurally tested, not live-verified against real GitHub or a real coding-agent run**. This environment has no `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` configured. The test suite mocks Octokit at the `getInstallationOctokit()` boundary and exercises the real MCP protocol layer (`InMemoryTransport`), the real approval state machine, and the real SQLite schema (including the `github_approvals.connection_id` foreign key) - but has not been run end-to-end against an actual GitHub repository or an actual Claude Code / Codex run proposing and a human approving a real branch/PR/issue. If you configure real credentials, the **GitHub Actions** panel in the workspace history view is the place to watch an end-to-end flow.

## Revocation / incident procedure

1. **Disconnect first**: `DELETE /api/workspaces/[id]/github/connection` (the Disconnect button in the GitHub Export panel) immediately clears the project's repo selection and flips every `pending`/`approved` approval for that connection to `rejected` - nothing further can be proposed or executed against it from this app.
2. **Revoke on GitHub's side too**: disconnecting here only forgets the connection locally: it does not revoke the GitHub App installation itself. To fully cut off access, uninstall or reconfigure the GitHub App's repository access from the GitHub organization/account settings (Settings → Applications → your App → Configure).
3. **Check the trail**: every proposed and executed action is in `mcp_audit_log` (`repository`, `branch`, `approval_id`, `github_result_ref` columns), and every approval's full lifecycle (who decided what, when, and the exact executed result) is in `github_approvals` - both are plain SQLite tables, queryable directly for an incident review.

## Privacy note for users

This app never stores a GitHub token - short-lived installation tokens are minted on demand (`getInstallationOctokit`) and live only in memory for the duration of the request that needed one. The only GitHub-related data persisted locally is: the connection's installation id and display login, the one repository name and default branch a project is bound to, and the approval/audit rows described above (action metadata and results - titles, branch names, URLs - never file content beyond what a diff or PR body already contains).
