// Own counter, deliberately not shared with Project Files MCP's - these are
// separate server processes (see docs/mcp-policy.md) and each is spawned
// fresh per run, so a module-level counter is already scoped correctly.

const MAX_CALLS_PER_RUN = 100;

let callCount = 0;

export class RateLimitError extends Error {}

export function checkRateLimit(): void {
  callCount++;
  if (callCount > MAX_CALLS_PER_RUN) {
    throw new RateLimitError(`Too many GitHub tool calls in this run (limit ${MAX_CALLS_PER_RUN}).`);
  }
}
