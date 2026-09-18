import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

let createState: typeof import("@/lib/github/state").createState;
let verifyState: typeof import("@/lib/github/state").verifyState;
let InvalidStateError: typeof import("@/lib/github/state").InvalidStateError;

beforeAll(async () => {
  process.env.WORKSPACE_SECRET_KEY = "test-secret-key-for-state-signing";
  const mod = await import("@/lib/github/state");
  createState = mod.createState;
  verifyState = mod.verifyState;
  InvalidStateError = mod.InvalidStateError;
});

describe("GitHub OAuth/install state token (CSRF protection)", () => {
  it("round-trips the bound projectId", () => {
    const token = createState("prj_aaaaaaaa-my-project");
    expect(verifyState(token)).toBe("prj_aaaaaaaa-my-project");
  });

  it("rejects a tampered payload", () => {
    const token = createState("prj_aaaaaaaa-my-project");
    const [, sig] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ projectId: "prj_bbbbbbbb-other", expiresAt: Date.now() + 60000 })).toString(
      "base64url",
    );
    expect(() => verifyState(`${tamperedPayload}.${sig}`)).toThrow(InvalidStateError);
  });

  it("rejects a tampered signature", () => {
    const token = createState("prj_aaaaaaaa-my-project");
    const [payload] = token.split(".");
    expect(() => verifyState(`${payload}.deadbeef`)).toThrow(InvalidStateError);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyState("not-a-valid-state-token")).toThrow(InvalidStateError);
  });

  it("rejects an expired token", () => {
    const payload = Buffer.from(
      JSON.stringify({ projectId: "prj_aaaaaaaa-my-project", nonce: "x", expiresAt: Date.now() - 1000 }),
    ).toString("base64url");
    // Sign it the same way createState would, using the same secret.
    const sig = createHmac("sha256", process.env.WORKSPACE_SECRET_KEY!).update(payload).digest("base64url");
    expect(() => verifyState(`${payload}.${sig}`)).toThrow(InvalidStateError);
  });

  it("two states for the same project are not identical (nonce prevents replay-by-reuse assumptions)", () => {
    const a = createState("prj_aaaaaaaa-my-project");
    const b = createState("prj_aaaaaaaa-my-project");
    expect(a).not.toBe(b);
  });
});
