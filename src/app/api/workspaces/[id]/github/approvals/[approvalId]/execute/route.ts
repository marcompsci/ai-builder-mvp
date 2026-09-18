import { NextResponse } from "next/server";
import { ApprovalExecutionError } from "@/lib/github/execute";
import { runApprovedExecution } from "@/lib/github/execute";
import { GitHubPushError } from "@/lib/github/push";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

/**
 * Retries execution of an already-approved action (e.g. after a transient
 * GitHub API failure). Never approves anything itself - only reachable for
 * a row already in "approved" status; markExecuted's own state check makes
 * a second successful call on an already-executed row impossible.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; approvalId: string }> }) {
  const { id, approvalId } = await params;
  try {
    await assertProjectExists(id);
    const executed = await runApprovedExecution(approvalId, id);
    return NextResponse.json({ approval: executed });
  } catch (err) {
    if (err instanceof ApprovalExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof GitHubPushError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return workspaceErrorResponse(err);
  }
}
