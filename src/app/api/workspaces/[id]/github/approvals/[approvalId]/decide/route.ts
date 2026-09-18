import { NextResponse } from "next/server";
import { z } from "zod";
import { ApprovalStateError, decideApproval } from "@/lib/github/approvals";
import { ApprovalExecutionError, runApprovedExecution } from "@/lib/github/execute";
import { GitHubPushError } from "@/lib/github/push";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

const decideSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

/**
 * A human decision on one pending GitHub action. Approving immediately
 * attempts execution (the one already-approved, non-replayable action this
 * row represents) - if execution fails, the approval stays in "approved"
 * status and the standalone execute route can be used to retry without
 * asking for approval again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; approvalId: string }> }) {
  const { id, approvalId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await assertProjectExists(id);
    const decided = decideApproval(approvalId, id, parsed.data.decision);

    if (parsed.data.decision === "rejected") {
      return NextResponse.json({ approval: decided });
    }

    try {
      const executed = await runApprovedExecution(approvalId, id);
      return NextResponse.json({ approval: executed });
    } catch (err) {
      // Decided (approved) but not yet executed - report both states so
      // the UI can show "approved, execution failed - retry" rather than a
      // bare error that leaves the approval's actual status unclear.
      const message = err instanceof Error ? err.message : "Execution failed.";
      return NextResponse.json({ approval: decided, executionError: message }, { status: 502 });
    }
  } catch (err) {
    if (err instanceof ApprovalStateError || err instanceof ApprovalExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof GitHubPushError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return workspaceErrorResponse(err);
  }
}
