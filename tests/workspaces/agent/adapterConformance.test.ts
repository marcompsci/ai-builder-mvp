import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "@/lib/workspaces/agent/adapters/claudeCodeAdapter";
import { codexAdapter } from "@/lib/workspaces/agent/adapters/codexAdapter";
import { getAdapter } from "@/lib/workspaces/agent/adapters/registry";
import { PROVIDERS } from "@/lib/workspaces/agent/runStore";
import type { CodingAgent } from "@/lib/workspaces/agent/types";

const adapters: CodingAgent[] = [claudeCodeAdapter, codexAdapter];

describe("CodingAgent interface conformance", () => {
  for (const adapter of adapters) {
    describe(adapter.provider, () => {
      it("declares its own provider id", () => {
        expect(PROVIDERS).toContain(adapter.provider);
      });

      it("implements createPlan as a function", () => {
        expect(typeof adapter.createPlan).toBe("function");
      });

      it("implements executeApprovedPlan as a function", () => {
        expect(typeof adapter.executeApprovedPlan).toBe("function");
      });

      it("implements cancelRun as a function", () => {
        expect(typeof adapter.cancelRun).toBe("function");
      });

      it("implements getRunStatus as a function", () => {
        expect(typeof adapter.getRunStatus).toBe("function");
      });

      it("getRunStatus returns null for an unknown run id without throwing", () => {
        expect(adapter.getRunStatus("no-such-run-id")).toBeNull();
      });

      it("cancelRun on an unknown run id does not throw", () => {
        expect(() => adapter.cancelRun("no-such-run-id")).not.toThrow();
      });
    });
  }

  it("every declared provider has exactly one adapter, and every adapter's provider matches its registry key", () => {
    for (const provider of PROVIDERS) {
      const adapter = getAdapter(provider);
      expect(adapter).toBeDefined();
      expect(adapter.provider).toBe(provider);
    }
  });

  it("both adapters are distinct implementations", () => {
    expect(claudeCodeAdapter).not.toBe(codexAdapter);
  });
});
