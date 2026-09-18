// Simple in-process counter. This server process is spawned fresh per run
// (see config.ts), so a module-level counter is already scoped correctly -
// no cross-process state needed.

const MAX_CALLS_PER_RUN = 200;

let callCount = 0;

export class RateLimitError extends Error {}

export function checkRateLimit(): void {
  callCount++;
  if (callCount > MAX_CALLS_PER_RUN) {
    throw new RateLimitError(`Too many tool calls in this run (limit ${MAX_CALLS_PER_RUN}).`);
  }
}
