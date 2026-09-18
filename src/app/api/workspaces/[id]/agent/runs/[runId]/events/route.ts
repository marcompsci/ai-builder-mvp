import { agentErrorResponse, assertProjectExists, loadOwnedRun } from "@/lib/workspaces/agent/routeHelpers";
import { getRunEvents, subscribe } from "@/lib/workspaces/agent/runStore";

const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed", "run_cancelled"]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;

  try {
    await assertProjectExists(id);
    loadOwnedRun(id, runId);
  } catch (err) {
    return agentErrorResponse(err);
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const pastEvents = getRunEvents(runId);
      for (const event of pastEvents) send(event);

      const alreadyDone = pastEvents.some((event) => TERMINAL_EVENT_TYPES.has(event.type));
      if (alreadyDone) {
        controller.close();
        return;
      }

      unsubscribe = subscribe(runId, (event) => {
        send(event);
        if (TERMINAL_EVENT_TYPES.has(event.type)) {
          controller.close();
        }
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
