import { describe, expect, it } from "vitest";
import { checkRateLimit, RateLimitError } from "@/mcp/projectFiles/rateLimit";

describe("Project Files MCP rate limiting", () => {
  it("allows calls under the limit and throws once the limit is exceeded", () => {
    // The limit is 200 per process (one process per run in production).
    for (let i = 0; i < 200; i++) {
      expect(() => checkRateLimit()).not.toThrow();
    }
    expect(() => checkRateLimit()).toThrow(RateLimitError);
  });
});
