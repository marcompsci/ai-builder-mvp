import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { EVENT_PROPERTY_SCHEMAS, type EventProperties } from "./schema";
import type { EventName } from "./events";
import { isOptedOut } from "./optOut";

/**
 * The one function that writes a product-analytics event. Deliberately
 * best-effort: never throws, so a bug or transient failure here can never
 * break the actual product flow it's instrumenting (agent runs, GitHub
 * export, etc.) - the opposite guarantee from mcp_audit_log, which must be
 * complete. See docs/analytics.md.
 *
 * `.strip()`'d parse is the allowlist enforcement: any property not
 * declared in EVENT_PROPERTY_SCHEMAS[name] (a prompt, file content, a
 * token, an env value, free text) is silently dropped before anything is
 * ever written to disk - not redacted after the fact, never present.
 */
export function trackEvent<T extends EventName>(name: T, props: EventProperties<T>): void {
  try {
    if (isOptedOut((props as { userId: string }).userId)) return;

    const schema = EVENT_PROPERTY_SCHEMAS[name];
    const parsed = schema.strip().parse(props) as Record<string, unknown>;
    const { userId, orgId, projectId, agentRunId, provider, ...extra } = parsed;

    getDb()
      .prepare(
        `INSERT INTO product_events (id, event_name, timestamp, user_id, org_id, project_id, agent_run_id, provider, properties_json)
         VALUES (@id, @eventName, @timestamp, @userId, @orgId, @projectId, @agentRunId, @provider, @propertiesJson)`,
      )
      .run({
        id: randomUUID(),
        eventName: name,
        timestamp: new Date().toISOString(),
        userId: userId as string,
        orgId: (orgId as string | null) ?? null,
        projectId: (projectId as string | null | undefined) ?? null,
        agentRunId: (agentRunId as string | null | undefined) ?? null,
        provider: (provider as string | null | undefined) ?? null,
        propertiesJson: JSON.stringify(extra),
      });
  } catch (err) {
    console.error("analytics: failed to record event", name, err instanceof Error ? err.message : err);
  }
}
