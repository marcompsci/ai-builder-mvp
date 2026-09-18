import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportRequestSchema } from "@/lib/github/exportRequestSchema";
import { git, GitError } from "@/lib/workspaces/git/client";

describe("exportRequestSchema (push approval gate)", () => {
  const base = { mode: "existing" as const, repoFullName: "someone/repo", branch: "main" };

  it("rejects a request missing confirm", () => {
    const result = exportRequestSchema.safeParse(base);
    expect(result.success).toBe(false);
  });

  it("rejects confirm: false", () => {
    const result = exportRequestSchema.safeParse({ ...base, confirm: false });
    expect(result.success).toBe(false);
  });

  it("accepts confirm: true with a valid existing-repo request", () => {
    const result = exportRequestSchema.safeParse({ ...base, confirm: true });
    expect(result.success).toBe(true);
  });

  it("accepts confirm: true with a valid create_new request", () => {
    const result = exportRequestSchema.safeParse({
      confirm: true,
      mode: "create_new",
      newRepoName: "my-new-repo",
      branch: "main",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a repo name with shell metacharacters", () => {
    const result = exportRequestSchema.safeParse({
      confirm: true,
      mode: "create_new",
      newRepoName: "repo; rm -rf /",
      branch: "main",
    });
    expect(result.success).toBe(false);
  });
});

describe("git client secret redaction", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "redact-test-"));
    await git(tmpRoot, ["init", "--initial-branch=main"]);
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("never includes a redacted secret in the thrown error's message or stderr", async () => {
    const fakeToken = "ghs_super_secret_token_value_12345";
    // Port 1 on localhost: nothing listens there, so this fails fast
    // (connection refused) instead of depending on real network access.
    const badUrl = `https://x-access-token:${fakeToken}@127.0.0.1:1/owner/repo.git`;

    let caught: GitError | null = null;
    try {
      await git(tmpRoot, ["push", badUrl, "HEAD:refs/heads/main"], { redactSecrets: [fakeToken] });
    } catch (err) {
      caught = err as GitError;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain(fakeToken);
    expect(caught!.stderr ?? "").not.toContain(fakeToken);
    // The redaction marker should appear in place of the secret, proving
    // the substitution actually ran rather than the URL just being absent.
    expect(caught!.message).toContain("[redacted]");
  });

  it("without redactSecrets, the token would otherwise appear (sanity check the test itself is meaningful)", async () => {
    const fakeToken = "ghs_another_token_98765";
    const badUrl = `https://x-access-token:${fakeToken}@127.0.0.1:1/owner/repo.git`;

    let caught: GitError | null = null;
    try {
      await git(tmpRoot, ["push", badUrl, "HEAD:refs/heads/main"]);
    } catch (err) {
      caught = err as GitError;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain(fakeToken);
  });
});
