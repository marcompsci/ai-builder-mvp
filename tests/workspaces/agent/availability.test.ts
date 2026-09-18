import { afterEach, describe, expect, it } from "vitest";
import { getProviderAvailability, isProviderAvailable } from "@/lib/workspaces/agent/availability";

const ORIGINAL_ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_OPENAI = process.env.OPENAI_API_KEY;

describe("provider availability", () => {
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC;
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI;
  });

  it("never includes the actual credential value in its response - only booleans and a generic reason string", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-super-secret-value";
    process.env.OPENAI_API_KEY = "sk-openai-super-secret-value";

    const providers = getProviderAvailability();
    const serialized = JSON.stringify(providers);

    expect(serialized).not.toContain("sk-ant-super-secret-value");
    expect(serialized).not.toContain("sk-openai-super-secret-value");
    for (const p of providers) {
      expect(typeof p.available).toBe("boolean");
    }
  });

  it("reports unavailable with a clear reason when a key is missing", () => {
    delete process.env.OPENAI_API_KEY;
    const codex = getProviderAvailability().find((p) => p.provider === "codex")!;
    expect(codex.available).toBe(false);
    expect(codex.reason).toMatch(/OPENAI_API_KEY/);
  });

  it("reports available (no reason) when the key is present", () => {
    process.env.OPENAI_API_KEY = "sk-openai-x";
    const codex = getProviderAvailability().find((p) => p.provider === "codex")!;
    expect(codex.available).toBe(true);
    expect(codex.reason).toBeUndefined();
  });

  it("isProviderAvailable matches the list result", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(isProviderAvailable("claude-code")).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(isProviderAvailable("claude-code")).toBe(false);
  });
});
