import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let tmpRoot: string;
let trackEvent: typeof import("@/lib/analytics/trackEvent").trackEvent;
let getDb: typeof import("@/lib/db").getDb;
let setOptedOut: typeof import("@/lib/analytics/optOut").setOptedOut;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "analytics-test-"));
  process.env.WORKSPACES_ROOT = path.join(tmpRoot, "workspaces");

  trackEvent = (await import("@/lib/analytics/trackEvent")).trackEvent;
  getDb = (await import("@/lib/db")).getDb;
  setOptedOut = (await import("@/lib/analytics/optOut")).setOptedOut;
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("trackEvent", () => {
  it("writes a row with only the allowlisted properties, never anything else passed in", () => {
    trackEvent("project_created", {
      userId: "u-track-1",
      orgId: null,
      projectId: "prj_aaaaaaaa-test",
      projectType: "v1",
      // Deliberately passing disallowed fields to prove they're dropped at runtime.
      prompt: "do something with my secret",
      apiKey: "sk-leak",
    });

    const db = getDb();
    const row = db.prepare(`SELECT * FROM product_events WHERE user_id = 'u-track-1'`).get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.event_name).toBe("project_created");
    const props = JSON.parse(row.properties_json as string);
    expect(props).toEqual({ projectType: "v1" });
    expect(row.properties_json).not.toContain("secret");
    expect(row.properties_json).not.toContain("sk-leak");
  });

  it("never writes when the user has opted out", () => {
    setOptedOut("u-track-optout", true);
    trackEvent("project_created", { userId: "u-track-optout", orgId: null, projectId: "prj_aaaaaaaa-test", projectType: "v1" });

    const db = getDb();
    const row = db.prepare(`SELECT * FROM product_events WHERE user_id = 'u-track-optout'`).get();
    expect(row).toBeUndefined();
  });

  it("never throws, even when the db write fails - analytics must be non-blocking", async () => {
    const dbMod = await import("@/lib/db");
    const spy = vi.spyOn(dbMod, "getDb").mockImplementation(() => {
      throw new Error("simulated db outage");
    });
    expect(() =>
      trackEvent("project_created", { userId: "u-track-3", orgId: null, projectId: "prj_aaaaaaaa-test", projectType: "v1" }),
    ).not.toThrow();
    spy.mockRestore();
  });

  it("rejects a malformed enum value by simply dropping the event (schema validation), not throwing", () => {
    expect(() =>
      trackEvent("agent_run_started", {
        userId: "u-track-4",
        orgId: null,
        // Invalid runType on purpose - proves zod rejects it at runtime.
        runType: "not-a-real-phase",
      }),
    ).not.toThrow();

    const db = getDb();
    const row = db.prepare(`SELECT * FROM product_events WHERE user_id = 'u-track-4'`).get();
    expect(row).toBeUndefined();
  });
});
