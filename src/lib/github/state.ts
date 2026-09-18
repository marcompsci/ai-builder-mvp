import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GitHubConfigError } from "./appAuth";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes - just long enough for the redirect round trip

interface StatePayload {
  projectId: string;
  nonce: string;
  expiresAt: number;
}

function secretKey(): string {
  const key = process.env.WORKSPACE_SECRET_KEY;
  if (!key) {
    throw new GitHubConfigError("WORKSPACE_SECRET_KEY is not configured. See .env.example.");
  }
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", secretKey()).update(payload).digest("base64url");
}

/** Creates a signed, project-bound, short-lived state token for the GitHub redirect flow. */
export function createState(projectId: string): string {
  const payload: StatePayload = {
    projectId,
    nonce: randomBytes(12).toString("hex"),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

/** Validates a state token's signature and expiry, returning the bound projectId. Never trust a state param otherwise. */
export function verifyState(token: string): string {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    throw new InvalidStateError("Malformed state.");
  }

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidStateError("State signature does not match.");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new InvalidStateError("Malformed state payload.");
  }

  if (typeof payload.projectId !== "string" || typeof payload.expiresAt !== "number") {
    throw new InvalidStateError("Malformed state payload.");
  }
  if (Date.now() > payload.expiresAt) {
    throw new InvalidStateError("State has expired. Please retry the connection.");
  }

  return payload.projectId;
}
