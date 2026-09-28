import { describe, expect, it } from "vitest";
import {
  createRun,
  getRun,
  getRunEvents,
  emit,
  requestCancel,
  updateRun,
  PROVIDERS,
} from "@/lib/workspaces/agent/runStore";

describe("runStore - provider-neutral run lifecycle", () => {
  for (const provider of PROVIDERS) {
    it(`records the provider on creation (${provider})`, () => {
      const run = createRun(`run-${provider}-1`, "prj_aaaaaaaa-x", "do something", provider, "local-dev-user");
      expect(run.provider).toBe(provider);
      expect(run.phase).toBe("planning");
    });
  }

  it("getRun returns null for an unknown id", () => {
    expect(getRun("does-not-exist")).toBeNull();
  });

  it("requestCancel sets cancelRequested and is visible on the public run object", () => {
    const run = createRun("run-cancel-1", "prj_aaaaaaaa-x", "do something", "claude-code", "local-dev-user");
    expect(run.cancelRequested).toBe(false);
    requestCancel(run.id);
    expect(getRun(run.id)?.cancelRequested).toBe(true);
  });

  it("requestCancel on an unknown run id returns false and does not throw", () => {
    expect(() => requestCancel("no-such-run")).not.toThrow();
    expect(requestCancel("no-such-run")).toBe(false);
  });

  it("updateRun records a failure state (phase + error) correctly", () => {
    const run = createRun("run-fail-1", "prj_aaaaaaaa-x", "do something", "codex", "local-dev-user");
    updateRun(run.id, { phase: "failed", error: "Validation failed." });
    const updated = getRun(run.id);
    expect(updated?.phase).toBe("failed");
    expect(updated?.error).toBe("Validation failed.");
  });

  it("updateRun records a cancelled state correctly", () => {
    const run = createRun("run-cancelled-1", "prj_aaaaaaaa-x", "do something", "codex", "local-dev-user");
    updateRun(run.id, { phase: "cancelled" });
    expect(getRun(run.id)?.phase).toBe("cancelled");
  });

  it("emit() appends to the run's event log and is retrievable via getRunEvents", () => {
    const run = createRun("run-events-1", "prj_aaaaaaaa-x", "do something", "claude-code", "local-dev-user");
    emit(run.id, "run_started", { phase: "plan" });
    emit(run.id, "run_completed", { commitSha: "abc123" });
    const events = getRunEvents(run.id);
    expect(events.map((e) => e.type)).toEqual(["run_started", "run_completed"]);
  });

  it("subscribers never receive events for a run that isn't theirs (per-run isolation)", () => {
    const runA = createRun("run-iso-a", "prj_aaaaaaaa-x", "a", "claude-code", "local-dev-user");
    const runB = createRun("run-iso-b", "prj_aaaaaaaa-x", "b", "codex", "local-dev-user");
    emit(runA.id, "run_started", {});
    emit(runB.id, "run_started", {});
    expect(getRunEvents(runA.id)).toHaveLength(1);
    expect(getRunEvents(runB.id)).toHaveLength(1);
  });
});
