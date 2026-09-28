import { checkpointCommit, commitAll, restoreToCommit } from "../git/checkpoint";
import { ensureDependenciesInstalled } from "../ensureDependencies";
import { diffAgainstCheckpoint } from "./diff";
import { emit, getRun, updateRun } from "./runStore";
import { extractPlanFromText } from "./planSchema";
import { runValidation } from "./validate";
import type { Provider } from "./types";
import { trackEvent } from "../../analytics/trackEvent";

function secondsSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

/**
 * The shared "one provider-neutral agent-run system" pipeline. Every
 * adapter drives the actual model/tool activity (and emits its own
 * file_read/file_write events as it happens) via the callbacks below; this
 * module owns everything else - checkpointing, diffing, validation,
 * committing, and failure/cancel handling - so behavior here is identical
 * regardless of which provider is selected.
 */

export async function runPlanPipeline(
  runId: string,
  workspaceRoot: string,
  performPlan: () => Promise<{ text: string; cancelled: boolean }>,
): Promise<void> {
  emit(runId, "run_started", { phase: "plan" });
  emit(runId, "context_loaded", { workspaceRoot });

  const run = getRun(runId);
  const trackFailed = (errorCategory: "invalid_plan" | "provider_error") =>
    run &&
    trackEvent("agent_run_failed", {
      userId: run.userId,
      orgId: null,
      projectId: run.projectId,
      agentRunId: runId,
      provider: run.provider,
      durationSeconds: secondsSince(run.createdAt),
      errorCategory,
    });

  try {
    const { text, cancelled } = await performPlan();

    if (cancelled) {
      updateRun(runId, { phase: "cancelled" });
      emit(runId, "run_cancelled", { at: "plan" });
      if (run) {
        trackEvent("agent_run_cancelled", {
          userId: run.userId,
          orgId: null,
          projectId: run.projectId,
          agentRunId: runId,
          provider: run.provider,
          phase: "plan",
        });
      }
      return;
    }

    const plan = extractPlanFromText(text);
    if (!plan) {
      updateRun(runId, {
        phase: "failed",
        error: "The agent did not return a valid plan. Try rephrasing the request.",
      });
      emit(runId, "run_failed", { reason: "invalid_plan", rawText: text.slice(0, 2000) });
      trackFailed("invalid_plan");
      return;
    }

    updateRun(runId, { phase: "awaiting_approval", plan, planRawText: text });
    emit(runId, "plan_created", { plan });
    emit(runId, "approval_required", {});
  } catch (err) {
    updateRun(runId, { phase: "failed", error: err instanceof Error ? err.message : "Plan generation failed." });
    emit(runId, "run_failed", { reason: "plan_error" });
    trackFailed("provider_error");
  }
}

export async function runApplyPipeline(
  runId: string,
  workspaceRoot: string,
  agent: Provider,
  performEdit: () => Promise<{ cancelled: boolean }>,
): Promise<void> {
  const run = getRun(runId);
  if (!run || !run.plan) return;

  emit(runId, "run_started", { phase: "apply" });
  const startedAt = new Date().toISOString();

  const trackFailed = (errorCategory: "install_failed" | "validation_failed" | "provider_error") =>
    trackEvent("agent_run_failed", {
      userId: run.userId,
      orgId: null,
      projectId: run.projectId,
      agentRunId: runId,
      provider: agent,
      durationSeconds: secondsSince(startedAt),
      errorCategory,
    });

  const checkpointSha = await checkpointCommit(workspaceRoot, `before run ${runId}`);
  updateRun(runId, { phase: "applying", checkpointSha });
  emit(runId, "snapshot_created", { sha: checkpointSha });

  let cancelled = false;
  try {
    const result = await performEdit();
    cancelled = result.cancelled;
  } catch (err) {
    await restoreToCommit(workspaceRoot, checkpointSha);
    updateRun(runId, { phase: "failed", error: err instanceof Error ? err.message : "Edit run failed." });
    emit(runId, "run_failed", { reason: "apply_error" });
    trackFailed("provider_error");
    return;
  }

  if (cancelled) {
    await restoreToCommit(workspaceRoot, checkpointSha);
    updateRun(runId, { phase: "cancelled" });
    emit(runId, "run_cancelled", { at: "apply", rolledBackTo: checkpointSha });
    trackEvent("agent_run_cancelled", {
      userId: run.userId,
      orgId: null,
      projectId: run.projectId,
      agentRunId: runId,
      provider: agent,
      phase: "apply",
    });
    return;
  }

  const diffs = await diffAgainstCheckpoint(workspaceRoot, checkpointSha);
  updateRun(runId, { diffs });
  emit(runId, "diff_ready", { files: diffs.map((d) => d.path) });

  updateRun(runId, { phase: "validating" });
  emit(runId, "validation_started", {});
  try {
    await ensureDependenciesInstalled(workspaceRoot);
  } catch (err) {
    // Same "preserve, don't auto-repair" handling as a validation failure -
    // the edit itself may be fine; the checkpoint stays available to Revert.
    updateRun(runId, {
      phase: "failed",
      error: err instanceof Error ? `Could not install dependencies: ${err.message}` : "Could not install dependencies.",
    });
    emit(runId, "run_failed", { reason: "install_failed" });
    trackFailed("install_failed");
    return;
  }

  const validationStartedAt = new Date().toISOString();
  const validation = await runValidation(workspaceRoot);
  updateRun(runId, { validation });
  emit(runId, "validation_completed", { results: validation });

  const allPassed = validation.every((v) => v.passed);
  const validationEvent = {
    userId: run.userId,
    orgId: null,
    projectId: run.projectId,
    agentRunId: runId,
    provider: agent,
    durationSeconds: secondsSince(validationStartedAt),
  };
  if (!allPassed) {
    updateRun(runId, { phase: "failed", error: "Validation failed." });
    emit(runId, "run_failed", { reason: "validation_failed" });
    trackEvent("validation_failed", {
      ...validationEvent,
      failedCommands: validation.filter((v) => !v.passed).map((v) => v.label as "lint" | "typecheck" | "build"),
    });
    trackFailed("validation_failed");
    return;
  }
  trackEvent("validation_passed", validationEvent);

  const commitSha = await commitAll(workspaceRoot, run.plan.intendedResult.slice(0, 72), {
    kind: "edit",
    request: run.request,
    agent,
    validation: "passed",
    filesChanged: diffs.map((d) => d.path),
    runId,
  });
  updateRun(runId, { phase: "complete", commitSha });
  emit(runId, "run_completed", { commitSha });
  trackEvent("agent_run_completed", {
    userId: run.userId,
    orgId: null,
    projectId: run.projectId,
    agentRunId: runId,
    provider: agent,
    durationSeconds: secondsSince(startedAt),
    validationResult: "passed",
    filesChangedCount: diffs.length,
  });
}
