import { headers } from "next/headers";

/**
 * The single local placeholder identity this app uses when nothing better is
 * available - local development, background work that has no request to read,
 * and tests. Every call site that can resolve a real user should go through
 * `currentUserId()` instead.
 */
export const LOCAL_DEV_USER_ID = "local-dev-user";

/**
 * Azure Container Apps' built-in authentication runs as a sidecar in front of
 * this container. Once a request passes it, the sidecar injects the signed-in
 * user's identity as request headers - and, critically, *overwrites* any copy
 * a client tried to send, which is what makes them trustworthy.
 *
 * That guarantee only holds when the sidecar is actually in front of us. With
 * auth disabled (local dev, or a container reachable directly) anyone could
 * set these headers by hand and become any user they liked. So we refuse to
 * read them unless the deployment explicitly says the proxy is there:
 * TRUST_AUTH_HEADERS=1, set only by infra/provision.sh.
 *
 * Fail closed, not open: an unset flag means everyone is LOCAL_DEV_USER_ID,
 * which is exactly the single-user behavior this app had before.
 */
const PRINCIPAL_ID_HEADER = "x-ms-client-principal-id";
const PRINCIPAL_NAME_HEADER = "x-ms-client-principal-name";

function authHeadersTrusted(): boolean {
  return process.env.TRUST_AUTH_HEADERS === "1";
}

/**
 * The stable identifier for the signed-in user, suitable as an analytics
 * `userId`, a rate-limit key, and a row owner.
 *
 * Prefers the Entra object id over the email: object ids never change, while
 * an email can be reassigned to a different person. Prefixed so a real
 * identity can never collide with the local placeholder.
 */
export async function currentUserId(): Promise<string> {
  if (!authHeadersTrusted()) return LOCAL_DEV_USER_ID;
  try {
    const h = await headers();
    const oid = h.get(PRINCIPAL_ID_HEADER)?.trim();
    if (oid) return `entra:${oid}`;
    const name = h.get(PRINCIPAL_NAME_HEADER)?.trim();
    if (name) return `entra:${name.toLowerCase()}`;
  } catch {
    // Called outside a request scope (background work, a cached render).
    // The placeholder is the correct answer there, not an error.
  }
  return LOCAL_DEV_USER_ID;
}

/**
 * A human-readable label - an email, usually - for showing "signed in as" and
 * for the admin feedback inbox. Never use this as a key: it can change.
 * Returns null rather than a fake name when there is no real identity.
 */
export async function currentUserLabel(): Promise<string | null> {
  if (!authHeadersTrusted()) return null;
  try {
    const h = await headers();
    return h.get(PRINCIPAL_NAME_HEADER)?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether the current request may see the admin surfaces - the feedback inbox
 * (which holds free text testers wrote), the funnel, and the CSV export.
 *
 * Deliberately asymmetric:
 *   - Local dev (no trusted proxy): allowed, exactly as before. Nothing is
 *     exposed that was not already exposed on localhost.
 *   - Deployed (TRUST_AUTH_HEADERS=1): allowed only for ids listed in
 *     ADMIN_USER_IDS. An unset list denies everyone, so forgetting to
 *     configure it locks you out rather than opening the inbox to every
 *     beta tester who signs in.
 *
 * Set ADMIN_USER_IDS to the full id `currentUserId()` returns, including the
 * `entra:` prefix; comma-separate several.
 */
export async function isAdmin(): Promise<boolean> {
  if (!authHeadersTrusted()) return true;
  const allowed = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes((await currentUserId()).toLowerCase());
}
