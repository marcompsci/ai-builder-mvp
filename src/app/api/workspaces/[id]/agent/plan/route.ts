import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdapter } from "@/lib/workspaces/agent/adapters/registry";
import { isProviderAvailable } from "@/lib/workspaces/agent/availability";
import { agentErrorResponse, assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { createRun, PROVIDERS } from "@/lib/workspaces/agent/runStore";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { currentUserId } from "@/lib/identity";

const bodySchema = z.object({
  request: z.string().trim().min(1, "Describe the change you want.").max(2000),
  provider: z.enum(PROVIDERS),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  const { id } = await params;

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

  if (!isProviderAvailable(parsed.data.provider)) {
    return NextResponse.json(
      { error: `${parsed.data.provider} is not available. Check its API key is configured.` },
      { status: 503 },
    );
  }

  try {
    const workspaceRoot = await assertProjectExists(id);
    const runId = randomUUID();
    const run = createRun(runId, id, parsed.data.request, parsed.data.provider, userId);
    trackEvent("agent_selected", { userId: userId, orgId: null, projectId: id, provider: parsed.data.provider });
    trackEvent("agent_run_started", {
      userId: userId,
      orgId: null,
      projectId: id,
      agentRunId: runId,
      provider: parsed.data.provider,
      runType: "plan",
    });
    const adapter = getAdapter(parsed.data.provider);
    void adapter.createPlan({ runId, projectId: id, workspaceRoot, request: parsed.data.request });
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
