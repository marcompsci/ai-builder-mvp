// A simple in-process, per-key sliding-window counter for the two
// client-reachable analytics endpoints (view-events, feedback). Separate
// from the MCP servers' own rate limiters (src/mcp/{projectFiles,github}/rateLimit.ts)
// - those are per-subprocess-per-run; this is per-key across the app's
// lifetime, since these endpoints are reachable directly from the browser.

const WINDOW_MS = 60_000;
const counters = new Map<string, { count: number; windowStart: number }>();

export class RateLimitError extends Error {}

export function checkRateLimit(key: string, maxPerWindow: number): void {
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    counters.set(key, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
  if (entry.count > maxPerWindow) {
    throw new RateLimitError("Too many requests. Please slow down.");
  }
}
