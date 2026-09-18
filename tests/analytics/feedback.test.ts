import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmpRoot: string;
let createFeedback: typeof import("@/lib/feedback").createFeedback;
let listFeedback: typeof import("@/lib/feedback").listFeedback;
let feedbackToCsv: typeof import("@/lib/feedback").feedbackToCsv;
let topProblemThemes: typeof import("@/lib/feedback").topProblemThemes;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-test-"));
  process.env.WORKSPACES_ROOT = path.join(tmpRoot, "workspaces");

  const mod = await import("@/lib/feedback");
  createFeedback = mod.createFeedback;
  listFeedback = mod.listFeedback;
  feedbackToCsv = mod.feedbackToCsv;
  topProblemThemes = mod.topProblemThemes;
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("feedback store", () => {
  it("round-trips a success entry", () => {
    const entry = createFeedback({
      userId: "u1",
      kind: "post_run_success",
      rating: 5,
      helped: "yes",
      wouldUseAgain: "yes",
      wantsInterview: true,
      freeText: "worked great",
    });
    const found = listFeedback({ kind: "post_run_success" }).find((e) => e.id === entry.id);
    expect(found).toMatchObject({ rating: 5, helped: "yes", wouldUseAgain: "yes", wantsInterview: true, freeText: "worked great" });
  });

  it("CSV export escapes commas, quotes, and newlines", () => {
    createFeedback({ userId: "u2", kind: "post_run_failure", freeText: 'blocked by "weird", multi\nline issue' });
    const csv = feedbackToCsv(listFeedback({ kind: "post_run_failure" }));
    expect(csv).toContain('"blocked by ""weird"", multi\nline issue"');
  });

  it("top problem themes never return the raw free text, only keyword/count", async () => {
    createFeedback({ userId: "u3", kind: "post_run_failure", freeText: "the preview kept crashing during preview startup" });
    const themes = topProblemThemes();
    for (const t of themes) {
      expect(t).toHaveProperty("theme");
      expect(t).toHaveProperty("count");
      expect(Object.keys(t).sort()).toEqual(["count", "theme"]);
    }
  });
});
