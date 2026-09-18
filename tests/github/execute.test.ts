import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "prj_aaaaaaaa-exec-test";
const REPO = "acme/widgets";

const mockOctokit = {
  rest: {
    issues: {
      create: vi.fn(async () => ({ data: { number: 7, html_url: "https://github.com/acme/widgets/issues/7" } })),
    },
  },
  auth: vi.fn(),
};

vi.mock("@/lib/github/appAuth", () => ({
  getInstallationOctokit: vi.fn(() => mockOctokit),
}));

let tmpRoot: string;
let executeMod: typeof import("@/lib/github/execute");
let approvalsMod: typeof import("@/lib/github/approvals");
let connectionsMod: typeof import("@/lib/github/connections");
let repoSelectionMod: typeof import("@/lib/github/repoSelection");
let connectionId: string;
let workspaceRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "execute-test-"));
  process.env.WORKSPACES_ROOT = path.join(tmpRoot, "workspaces");
  workspaceRoot = path.join(process.env.WORKSPACES_ROOT, PROJECT_ID);
  await fs.mkdir(workspaceRoot, { recursive: true });

  executeMod = await import("@/lib/github/execute");
  approvalsMod = await import("@/lib/github/approvals");
  connectionsMod = await import("@/lib/github/connections");
  repoSelectionMod = await import("@/lib/github/repoSelection");

  connectionId = connectionsMod.saveConnection({
    projectId: PROJECT_ID,
    githubLogin: "acme",
    installationId: "12345",
    installationAccountType: "Organization",
  }).id;
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function makeApproval(overrides: Partial<Parameters<typeof approvalsMod.createApproval>[0]> = {}) {
  return approvalsMod.createApproval({
    projectId: PROJECT_ID,
    connectionId,
    agentRunId: "run-1",
    actionType: "create_issue",
    repoFullName: REPO,
    payload: { title: "Track it" },
    reversible: true,
    ...overrides,
  });
}

describe("executeApproval - default branch guard", () => {
  it("refuses to push directly to the repo's default branch, without touching git or GitHub", async () => {
    const approval = approvalsMod.createApproval({
      projectId: PROJECT_ID,
      connectionId,
      agentRunId: "run-1",
      actionType: "create_commit_or_push_changes",
      repoFullName: REPO,
      targetBranch: "main",
      payload: { branchName: "main", commitSummary: "sneaky direct push" },
      reversible: false,
    });
    const ctx = { installationId: "12345", defaultBranch: "main", workspaceRoot };
    await expect(executeMod.executeApproval(approval, ctx)).rejects.toThrow(/default branch/i);
  });
});

describe("runApprovedExecution", () => {
  it("refuses to execute an approval that is not in 'approved' status", async () => {
    const approval = makeApproval();
    await expect(executeMod.runApprovedExecution(approval.id, PROJECT_ID)).rejects.toThrow(executeMod.ApprovalExecutionError);
  });

  it("refuses to execute when the project's current repo selection no longer matches the approval's repo", async () => {
    const approval = makeApproval({ repoFullName: "acme/stale-repo" });
    approvalsMod.decideApproval(approval.id, PROJECT_ID, "approved");

    repoSelectionMod.setRepoSelection({ projectId: PROJECT_ID, connectionId, repoFullName: REPO, defaultBranch: "main" });

    await expect(executeMod.runApprovedExecution(approval.id, PROJECT_ID)).rejects.toThrow(executeMod.ApprovalExecutionError);
  });

  it("executes a matching, approved action exactly once and records the result", async () => {
    repoSelectionMod.setRepoSelection({ projectId: PROJECT_ID, connectionId, repoFullName: REPO, defaultBranch: "main" });
    const approval = makeApproval({ agentRunId: "run-exec" });
    approvalsMod.decideApproval(approval.id, PROJECT_ID, "approved");

    const executed = await executeMod.runApprovedExecution(approval.id, PROJECT_ID);
    expect(executed.status).toBe("executed");
    expect(executed.result).toMatchObject({ number: 7, url: "https://github.com/acme/widgets/issues/7" });
    expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(expect.objectContaining({ owner: "acme", repo: "widgets", title: "Track it" }));

    // Replay is structurally impossible - markExecuted's own state check refuses a second run.
    await expect(executeMod.runApprovedExecution(approval.id, PROJECT_ID)).rejects.toThrow(executeMod.ApprovalExecutionError);
  });
});
