import { NextResponse } from "next/server";
import { z } from "zod";
import { createFeedback } from "@/lib/feedback";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { checkRateLimit, RateLimitError } from "@/lib/analytics/rateLimit";
import { currentUserId } from "@/lib/identity";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

const successSchema = z.object({
  kind: z.literal("post_run_success"),
  runId: z.string().min(1).optional(),
  helped: z.enum(["yes", "somewhat", "no"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  freeText: z.string().max(2000).optional(),
  wouldUseAgain: z.enum(["yes", "no", "maybe"]).optional(),
  wantsInterview: z.boolean().optional(),
});

const failureSchema = z.object({
  kind: z.literal("post_run_failure"),
  runId: z.string().min(1).optional(),
  blockedReason: z.string().max(2000).optional(),
  freeText: z.string().max(2000).optional(),
  mayUseLogs: z.boolean().optional(),
});

const bodySchema = z.discriminatedUnion("kind", [successSchema, failureSchema]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  const { id } = await params;

  try {
    checkRateLimit(`feedback:${userId}`, 20);
  } catch (err) {
    return NextResponse.json({ error: err instanceof RateLimitError ? err.message : "Rate limited." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await assertProjectExists(id);
    const input = parsed.data;

    const entry = createFeedback({
      runId: input.runId ?? null,
      projectId: id,
      userId: userId,
      kind: input.kind,
      rating: input.kind === "post_run_success" ? (input.rating ?? null) : null,
      helped: input.kind === "post_run_success" ? (input.helped ?? null) : null,
      wouldUseAgain: input.kind === "post_run_success" ? (input.wouldUseAgain ?? null) : null,
      wantsInterview: input.kind === "post_run_success" ? (input.wantsInterview ?? null) : null,
      blockedReason: input.kind === "post_run_failure" ? (input.blockedReason ?? null) : null,
      freeText: input.freeText ?? null,
      mayUseLogs: input.kind === "post_run_failure" ? (input.mayUseLogs ?? null) : null,
    });

    trackEvent("feedback_submitted", {
      userId: userId,
      orgId: null,
      projectId: id,
      agentRunId: input.runId ?? null,
      rating: input.kind === "post_run_success" ? input.rating : undefined,
      helped: input.kind === "post_run_success" ? input.helped : undefined,
      wouldUseAgain: input.kind === "post_run_success" ? input.wouldUseAgain : undefined,
      wantsInterview: input.kind === "post_run_success" ? input.wantsInterview : undefined,
    });

    return NextResponse.json({ feedback: entry }, { status: 201 });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
