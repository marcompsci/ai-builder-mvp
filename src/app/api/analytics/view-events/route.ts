import { NextResponse } from "next/server";
import { z } from "zod";
import { CLIENT_VIEW_EVENT_NAMES } from "@/lib/analytics/events";
import { EVENT_PROPERTY_SCHEMAS } from "@/lib/analytics/schema";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { checkRateLimit, RateLimitError } from "@/lib/analytics/rateLimit";
import { currentUserId } from "@/lib/identity";

// The ONLY analytics endpoint reachable directly from the browser with a
// caller-supplied event name - deliberately restricted to a small fixed
// enum (CLIENT_VIEW_EVENT_NAMES), never an arbitrary string, and every
// property still goes through the same schema-allowlist trackEvent() uses
// everywhere else. Every other event is emitted from trusted server code
// at the exact point the action happens.
const bodySchema = z.object({
  eventName: z.enum(CLIENT_VIEW_EVENT_NAMES),
  projectId: z.string().min(1).optional(),
  agentRunId: z.string().min(1).optional(),
  provider: z.enum(["claude-code", "codex"]).optional(),
  filesViewedCount: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const userId = await currentUserId();
  try {
    checkRateLimit(`view-events:${userId}`, 120);
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

  const { eventName, ...rest } = parsed.data;
  const schema = EVENT_PROPERTY_SCHEMAS[eventName];
  const props = schema.strip().safeParse({ userId: userId, orgId: null, ...rest });
  if (!props.success) {
    // Still 2xx-safe to no-op rather than error - a client view beacon
    // should never block the UI it's instrumenting.
    return NextResponse.json({ ok: true });
  }

  trackEvent(eventName, props.data as never);
  return NextResponse.json({ ok: true });
}
