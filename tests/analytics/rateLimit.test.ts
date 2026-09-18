import { describe, expect, it } from "vitest";
import { checkRateLimit, RateLimitError } from "@/lib/analytics/rateLimit";

describe("analytics rate limiter", () => {
  it("allows calls under the limit and denies calls over it, per key", () => {
    const key = `test-key-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(() => checkRateLimit(key, 5)).not.toThrow();
    }
    expect(() => checkRateLimit(key, 5)).toThrow(RateLimitError);
  });

  it("tracks separate keys independently", () => {
    const keyA = `key-a-${Math.random()}`;
    const keyB = `key-b-${Math.random()}`;
    checkRateLimit(keyA, 1);
    expect(() => checkRateLimit(keyB, 1)).not.toThrow();
  });
});
