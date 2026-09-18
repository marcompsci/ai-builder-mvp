# Agent protocol

The contract every coding-agent provider implements, and the normalized event vocabulary the UI consumes. This is what makes "add a third provider" mean "write a new adapter," not "add another branch to every route."

## The `CodingAgent` interface

`src/lib/workspaces/agent/types.ts`:

```ts
interface CodingAgent {
  readonly provider: "claude-code" | "codex";
  createPlan(ctx: { runId: string; workspaceRoot: string; request: string }): Promise<void>;
  executeApprovedPlan(ctx: { runId: string; workspaceRoot: string }): Promise<void>;
  cancelRun(runId: string): void;
  getRunStatus(runId: string): AgentRun | null;
}
```

`createPlan`/`executeApprovedPlan` don't return the plan or the result directly - they drive the shared pipeline (`pipeline.ts`), which writes everything (plan, diffs, validation, commit sha, phase, error) onto the run record in `runStore.ts` and emits events as it goes. Callers (the API routes) read the outcome back via `getRunStatus` / `GET .../runs/[runId]`, not via the promise's return value.

`cancelRun` and `getRunStatus` are typically thin wrappers around the shared `runStore` - cancellation and status are our own bookkeeping, not provider session state. The two adapters differ meaningfully in how `cancelRun` behaves internally:
- **Codex**: `runStreamed()` accepts a real `AbortSignal`, so `cancelRun` triggers an actual hard interrupt of the in-flight SDK call.
- **Claude Code**: `query()` is used in single-prompt (not streaming-input) mode, which doesn't support the SDK's `interrupt()` control request. `cancelRun` sets the shared `cancelRequested` flag; the adapter's drain loop checks it between messages and stops consuming further output. Either way, `pipeline.ts` then restores the workspace to its pre-run checkpoint - so a cancelled run never leaves partial/inconsistent output visible to the user, even though the underlying Claude Code CLI subprocess isn't guaranteed to be killed mid-flight.

## The `AgentEvent` vocabulary

`src/lib/workspaces/agent/events.ts` - a fixed, closed set of event types, chosen to fit both providers even though they produce activity through different primitives:

| Event | Emitted by | Notes |
|---|---|---|
| `run_started` | pipeline | Once per plan run and once per apply run |
| `context_loaded` | pipeline | Plan phase only |
| `plan_created` | pipeline | After the plan JSON is extracted and schema-validated |
| `approval_required` | pipeline | Immediately after `plan_created` |
| `file_read` | adapter | Claude Code: `Read`/`Grep`/`Glob` tool_use. Codex: not emitted during `read-only` sandbox mode exploration today - its read activity isn't itemized as discrete file events the way Claude's tool calls are; see the Behavioral differences section |
| `file_write` | adapter | Claude Code: `Edit`/`Write` tool_use. Codex: `file_change` thread items, one event per changed file |
| `command_started` / `command_completed` | adapter | **Codex only.** Codex's core edit mechanism is shell command execution (`command_execution` thread items) - there is no separate "Edit" tool to itemize the way Claude Code has one. Claude Code's adapter never emits these because its policy removes `Bash` entirely (see below) |
| `validation_started` / `validation_completed` | pipeline | Always the same three fixed commands, regardless of provider |
| `diff_ready` | pipeline | After `diffAgainstCheckpoint` runs |
| `snapshot_created` | pipeline | The pre-run git checkpoint |
| `run_completed` / `run_failed` / `run_cancelled` | pipeline | Terminal events; `run_failed` carries a `reason` (see below) |

## Behavioral differences between the two adapters (documented, not hidden)

The two providers achieve "confined to this workspace, no network, no unrestricted host access" through genuinely different mechanisms - this is worth understanding, not something the shared interface papers over:

- **Claude Code**: `disallowedTools` removes `Bash`/`WebFetch`/`WebSearch`/`Task`/`NotebookEdit` from the model's tool context entirely. There is no shell available at all, in either phase.
- **Codex**: has no equivalent "remove the tool" lever - shell command execution *is* its file-editing mechanism. The boundary instead comes from `sandboxMode` (`read-only` for planning, `workspace-write` for applying - an OS-level restriction on what a command can touch) plus `networkAccessEnabled: false` and never setting `additionalDirectories`. Codex can run arbitrary shell commands; what it cannot do is write outside `workingDirectory` or reach the network while doing so.

Both satisfy "restrict writable roots to the workspace" and "no unrestricted network access." Neither is "more secure" in general - they're different points on the same requirement, and the UI's agent selector deliberately doesn't claim one is universally better.

## `run_failed` reason codes

Shared across both adapters (via `pipeline.ts`), so the UI doesn't need provider-specific error handling:

| Reason | Meaning |
|---|---|
| `plan_error` | The plan run itself threw (SDK/network/auth error) |
| `invalid_plan` | The agent's final answer didn't contain a schema-valid plan JSON block |
| `apply_error` | The apply run threw; workspace was rolled back to the checkpoint |
| `install_failed` | `npm install` failed before validation could run |
| `validation_failed` | One or more of lint/typecheck/build failed; workspace is left as-is (not rolled back) with a Revert option |

Provider-specific failures (missing credentials, provider unavailable) are caught earlier, at the route level (`503`), before a run is even created - see `docs/runbook.md`.

## Adding a third provider

1. Add the provider id to `PROVIDERS` in `runStore.ts`.
2. Write `adapters/<name>Adapter.ts` implementing `CodingAgent`, calling `runPlanPipeline`/`runApplyPipeline` from `pipeline.ts` with a callback that drives your SDK and emits the events from the table above as they naturally occur.
3. Register it in `adapters/registry.ts`.
4. Add an availability check in `availability.ts`.
5. Add it to `AgentSelector.tsx`'s description list (`GET /api/agents` already picks up new entries automatically).

Nothing in `pipeline.ts`, the API routes, `runStore.ts`, the diff/validate modules, or the History/Version UI should need to change.
