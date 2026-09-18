# Product analytics (Phase 7A)

Instrumentation for learning whether private-beta users reach real value, where they get stuck, which coding agent they prefer, and what a successful project costs. This is measurement and feedback, not a product feature - see `docs/architecture.md` for where this fits and `docs/security.md` for the sandbox/trust model this layers onto.

## Security audit logs vs. product analytics

Two structurally separate systems, on purpose - never merge them:

| | `mcp_audit_log` (security) | `product_events` / `feedback` (analytics) |
|---|---|---|
| Purpose | Who did what, for incident response/compliance | Aggregate behavior signal for product decisions |
| Completeness | Every MCP call, no exceptions - enforced by `guarded()` in both MCP servers | Best-effort; a dropped write is fine |
| On failure | Should be loud (not yet formally alerted - a follow-up, not this phase) | Must be silent and non-blocking - `trackEvent()` never throws |
| Content | Precise identifiers for investigation (paths, tool names, decisions, content hashes) | Deliberately coarse - categories, counts, durations, never paths/content |
| User control | None - a user cannot opt out of or delete it; that would break the approval-safety guarantee | User-controllable - opt-out and deletion apply here, never to the audit log |
| Storage | `mcp_audit_log`, untouched by this phase | `product_events`/`feedback`, separate tables - the separation is structural, not just policy, so an opt-out/deletion request can never touch the security trail |

## Event taxonomy

Every event's exact allowed properties live in `src/lib/analytics/schema.ts` (`EVENT_PROPERTY_SCHEMAS`) - that file is the source of truth; this table is a summary. All events share a base shape: `userId` (required), `orgId` (nullable - no real org model exists yet, see `docs/architecture.md`), `projectId`/`agentRunId`/`provider` (nullable where not always applicable).

**Wired in this phase** (fire from real code paths):

| Event | Fires from | Extra properties |
|---|---|---|
| `project_created` | `POST /api/workspaces` | `projectType` |
| `agent_selected` | `POST .../agent/plan` | — |
| `agent_run_started` | plan route (plan) and approve route (apply) | `runType` |
| `agent_plan_viewed` | client beacon, `PlanReview` mount | — |
| `agent_plan_approved` | `POST .../approve` | `durationSeconds` |
| `agent_plan_rejected` | client beacon, "Discard" (no server call site exists for discard) | — |
| `agent_run_cancelled` | `pipeline.ts`, on confirmed rollback (not the cancel request itself) | `phase` |
| `agent_run_completed` | `pipeline.ts`, apply success | `durationSeconds`, `validationResult`, `filesChangedCount` |
| `agent_run_failed` | `pipeline.ts`, every failure branch (plan and apply) | `durationSeconds`, `errorCategory` |
| `file_diff_viewed` | client beacon, `DiffViewer` becomes visible | `filesViewedCount` |
| `validation_passed`/`validation_failed` | `pipeline.ts` | `durationSeconds`, (`failedCommands` on failure) |
| `preview_started` | `preview.ts`, when the dev server becomes ready | `durationToStartSeconds` |
| `preview_viewed` | client beacon, iframe actually rendered | — |
| `project_version_restored` | restore route | — |
| `github_connected` | GitHub App callback | `installationAccountType` |
| `github_export_started`/`completed` | export route | `mode`, (`success` on completion) |
| `mcp_tool_allowed`/`mcp_tool_denied` | both MCP servers' `guarded()` | `mcpServer`, `toolName` |
| `feedback_submitted` | feedback route | `rating`, `helped`, `wouldUseAgain`, `wantsInterview` (never the free text) |

**Forward-compatible only** (schema defined, deliberately not wired to any route): `beta_invite_sent`, `beta_invite_accepted`, `onboarding_started`, `onboarding_completed`, `project_brief_approved`. These depend on product flows (an invite system, an onboarding flow, a project-brief step) that don't exist yet - adding a schema entry is not a commitment to build them; they fire once those flows exist, in a later phase.

## Privacy boundaries

- **Allowlist, not redaction.** `trackEvent()` calls `.strip()` before writing - any property not explicitly declared in that event's schema (a prompt, source/generated content, a token, an env value, free text) is dropped before it ever reaches disk, not filtered after the fact. Enforced by `tests/analytics/schema.test.ts` and `trackEvent.test.ts`.
- **Free text lives in exactly one place**: the `feedback` table, admin-only. It is never mirrored into `product_events`, and the "Top user problems" view (`topProblemThemes()`) returns only a keyword and a count - never the underlying text - so the aggregate view itself can't become a leak vector.
- **Opt-out** (`analytics_opt_out` table, `/privacy` page): `trackEvent()` checks this before every write. Never consulted by `mcp_audit_log`.
- **Deletion** (`DELETE /api/account/analytics-data`): removes a user's `product_events` and `feedback` rows. Never touches `mcp_audit_log`.

## Retention - known limitation, stated honestly

There is no automatic retention/expiry job in this phase - `product_events` and `feedback` rows persist until a user explicitly deletes them via `/privacy`. For a private beta of a handful of invited users this is an acceptable starting point, not a final policy; a scheduled retention job (e.g. delete `product_events` older than N days) is reasonable follow-up work, not included here to keep this phase's scope to what was approved.

## Admin dashboard

`/admin` (tabbed: Activation Funnel, Feedback Inbox, Top User Problems) and the API routes under `/api/admin/**`. **No dedicated admin authentication exists yet** - that's Phase 6 scope (invite-only beta access), not this one. These routes carry the same trust assumption the rest of the app already has today (a single trusted operator), not a newly introduced gap - stated plainly in both the page and the route comments rather than implied.

Several funnel metrics are honestly `null`/unavailable in the current single-tenant environment rather than showing a misleading number: invite acceptance rate, onboarding completion rate, and Day 1/7/30 return rate all need real, distinguishable multi-user identity that doesn't exist without Phase 6. Estimated cost per successful project is also unavailable - the approved event schema has no cost field on `agent_run_completed` (out of scope for this pass; flagged rather than silently added or silently dropped).

## Files

`src/lib/analytics/{events,schema,trackEvent,optOut,rateLimit,funnel,clientTrack}.ts`, `src/lib/feedback.ts`, `src/lib/identity.ts`; API routes under `src/app/api/analytics/`, `src/app/api/workspaces/[id]/feedback/`, `src/app/api/admin/`, `src/app/api/account/`; UI under `src/components/feedback/`, `src/components/admin/`, `src/app/admin/page.tsx`, `src/app/privacy/page.tsx`; tests under `tests/analytics/`.

## Testing

```bash
npm test -- tests/analytics
```

Covers: every event has a schema and requires `userId` while accepting a null `orgId`; no event's declared shape can carry a prompt/source-code/token/env-value-shaped field; unknown properties are stripped even when the rest of the payload is valid; opted-out users never get a row written; a database failure never throws out of `trackEvent()`; the rate limiter enforces its per-key window; feedback CSV export correctly escapes commas/quotes/newlines; "top problems" never returns raw free text.
