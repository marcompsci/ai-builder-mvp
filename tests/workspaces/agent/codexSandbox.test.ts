import { describe, expect, it } from "vitest";
import { CODEX_APPLY_OPTIONS, CODEX_PLAN_OPTIONS } from "@/lib/workspaces/agent/codexPolicy";

describe("Codex sandbox configuration", () => {
  it("plan phase is read-only (no write is possible even if attempted)", () => {
    expect(CODEX_PLAN_OPTIONS.sandboxMode).toBe("read-only");
  });

  it("apply phase is ALSO read-only (as of Phase 5A) - real writes now go exclusively through Project Files MCP's write_project_file, never Codex's native shell", () => {
    expect(CODEX_APPLY_OPTIONS.sandboxMode).toBe("read-only");
    expect(CODEX_APPLY_OPTIONS.sandboxMode).not.toBe("workspace-write");
    expect(CODEX_APPLY_OPTIONS.sandboxMode).not.toBe("danger-full-access");
    expect(CODEX_PLAN_OPTIONS.sandboxMode).not.toBe("danger-full-access");
  });

  it("network access is disabled in both phases", () => {
    expect(CODEX_PLAN_OPTIONS.networkAccessEnabled).toBe(false);
    expect(CODEX_APPLY_OPTIONS.networkAccessEnabled).toBe(false);
  });

  it("skips the git-repo requirement - intentional as of Phase 5A: workingDirectory is now an empty scratch directory (never the real workspace, which is only reachable through Project Files MCP), so it is deliberately not a git repo", () => {
    expect(CODEX_PLAN_OPTIONS.skipGitRepoCheck).toBe(true);
    expect(CODEX_APPLY_OPTIONS.skipGitRepoCheck).toBe(true);
  });

  it("neither phase declares additionalDirectories - workingDirectory is the only writable/readable root", () => {
    expect("additionalDirectories" in CODEX_PLAN_OPTIONS).toBe(false);
    expect("additionalDirectories" in CODEX_APPLY_OPTIONS).toBe(false);
  });

  it("approval policy is 'never' (headless) in both phases - the approval gate is our own plan/approve flow, not Codex's interactive prompt", () => {
    expect(CODEX_PLAN_OPTIONS.approvalPolicy).toBe("never");
    expect(CODEX_APPLY_OPTIONS.approvalPolicy).toBe("never");
  });
});
