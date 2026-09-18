import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT_A = "prj_aaaaaaaa-project-a";
const PROJECT_B = "prj_bbbbbbbb-project-b";

let tmpRoot: string;
let approvalsMod: typeof import("@/lib/github/approvals");
let connectionsMod: typeof import("@/lib/github/connections");
let getDb: typeof import("@/lib/db").getDb;
let connectionId: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "approvals-test-"));
  process.env.WORKSPACES_ROOT = path.join(tmpRoot, "workspaces");

  approvalsMod = await import("@/lib/github/approvals");
  connectionsMod = await import("@/lib/github/connections");
  const dbMod = await import("@/lib/db");
  getDb = dbMod.getDb;

  connectionId = connectionsMod.saveConnection({
    projectId: PROJECT_A,
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
    projectId: PROJECT_A,
    connectionId,
    agentRunId: "run-1",
    actionType: "create_issue",
    repoFullName: "acme/widgets",
    payload: { title: "Bug" },
    reason: "found while implementing the request",
    reversible: true,
    ...overrides,
  });
}

describe("hashPayload", () => {
  it("is deterministic for the same payload shape", () => {
    const a = approvalsMod.hashPayload({ title: "x", body: "y" });
    const b = approvalsMod.hashPayload({ title: "x", body: "y" });
    expect(a).toBe(b);
  });

  it("differs when the payload differs", () => {
    const a = approvalsMod.hashPayload({ title: "x" });
    const b = approvalsMod.hashPayload({ title: "y" });
    expect(a).not.toBe(b);
  });
});

describe("createApproval / getApproval", () => {
  it("creates a pending approval with a payload hash and a future expiry", () => {
    const approval = makeApproval();
    expect(approval.status).toBe("pending");
    expect(approval.payloadHash).toBe(approvalsMod.hashPayload({ title: "Bug" }));
    expect(new Date(approval.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("never returns an approval scoped to a different project, even with the right id", () => {
    const approval = makeApproval();
    expect(approvalsMod.getApproval(approval.id, PROJECT_B)).toBeNull();
    expect(approvalsMod.getApproval(approval.id, PROJECT_A)).not.toBeNull();
  });
});

describe("decideApproval state machine", () => {
  it("moves pending -> approved", () => {
    const approval = makeApproval();
    const decided = approvalsMod.decideApproval(approval.id, PROJECT_A, "approved");
    expect(decided.status).toBe("approved");
    expect(decided.decidedAt).not.toBeNull();
  });

  it("moves pending -> rejected", () => {
    const approval = makeApproval();
    const decided = approvalsMod.decideApproval(approval.id, PROJECT_A, "rejected");
    expect(decided.status).toBe("rejected");
  });

  it("refuses to re-decide an approval that is no longer pending", () => {
    const approval = makeApproval();
    approvalsMod.decideApproval(approval.id, PROJECT_A, "approved");
    expect(() => approvalsMod.decideApproval(approval.id, PROJECT_A, "rejected")).toThrow(approvalsMod.ApprovalStateError);
  });

  it("refuses to decide an approval scoped to a different project", () => {
    const approval = makeApproval();
    expect(() => approvalsMod.decideApproval(approval.id, PROJECT_B, "approved")).toThrow(approvalsMod.ApprovalStateError);
  });
});

describe("markExecuted - the anti-replay guarantee", () => {
  it("refuses to execute a pending (not yet approved) approval", () => {
    const approval = makeApproval();
    expect(() => approvalsMod.markExecuted(approval.id, PROJECT_A, { ok: true })).toThrow(approvalsMod.ApprovalStateError);
  });

  it("executes an approved approval exactly once - the second attempt throws", () => {
    const approval = makeApproval();
    approvalsMod.decideApproval(approval.id, PROJECT_A, "approved");
    const executed = approvalsMod.markExecuted(approval.id, PROJECT_A, { number: 42, url: "https://github.com/acme/widgets/issues/42" });
    expect(executed.status).toBe("executed");
    expect(executed.result).toEqual({ number: 42, url: "https://github.com/acme/widgets/issues/42" });

    expect(() => approvalsMod.markExecuted(approval.id, PROJECT_A, { number: 42 })).toThrow(approvalsMod.ApprovalStateError);
  });

  it("refuses to execute a rejected approval", () => {
    const approval = makeApproval();
    approvalsMod.decideApproval(approval.id, PROJECT_A, "rejected");
    expect(() => approvalsMod.markExecuted(approval.id, PROJECT_A, {})).toThrow(approvalsMod.ApprovalStateError);
  });
});

describe("TTL expiry", () => {
  it("flips a stale pending approval to expired on read, and it can no longer be decided", () => {
    const approval = makeApproval();
    const db = getDb();
    // Backdate expires_at without going through the public API - simulates time passing.
    db.prepare(`UPDATE github_approvals SET expires_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), approval.id);

    const read = approvalsMod.getApproval(approval.id, PROJECT_A);
    expect(read?.status).toBe("expired");
    expect(() => approvalsMod.decideApproval(approval.id, PROJECT_A, "approved")).toThrow(approvalsMod.ApprovalStateError);
  });
});

describe("listApprovalsForProject / listApprovalsForRun", () => {
  it("only returns approvals for the given project, newest first", () => {
    const other = connectionsMod.saveConnection({
      projectId: PROJECT_B,
      githubLogin: "acme",
      installationId: "67890",
      installationAccountType: "Organization",
    });
    approvalsMod.createApproval({
      projectId: PROJECT_B,
      connectionId: other.id,
      agentRunId: "run-b",
      actionType: "create_issue",
      repoFullName: "acme/other",
      payload: { title: "unrelated" },
      reversible: true,
    });
    makeApproval({ agentRunId: "run-2" });

    const forA = approvalsMod.listApprovalsForProject(PROJECT_A);
    expect(forA.every((a) => a.projectId === PROJECT_A)).toBe(true);
    expect(forA.length).toBeGreaterThan(0);
  });

  it("scopes by run id too", () => {
    makeApproval({ agentRunId: "run-scoped" });
    const forRun = approvalsMod.listApprovalsForRun("run-scoped", PROJECT_A);
    expect(forRun).toHaveLength(1);
    expect(forRun[0].agentRunId).toBe("run-scoped");
  });
});
