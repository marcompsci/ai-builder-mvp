/**
 * The single local placeholder identity this app uses everywhere until a
 * real auth/multi-tenant system exists (a hosted-beta concern, not yet
 * built - see docs/architecture.md). Centralized here so the many places
 * that used to inline the literal "local-dev-user" string (MCP trusted
 * context, audit log, and now product analytics) share one definition.
 */
export const LOCAL_DEV_USER_ID = "local-dev-user";
