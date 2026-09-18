import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "@/lib/workspaces/git/client";
import { checkpointCommit, commitAll, initialCommit, initRepo, resolveCommit, restoreToCommit } from "@/lib/workspaces/git/checkpoint";
import { listVersions } from "@/lib/workspaces/git/history";

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-git-test-"));
  await fs.writeFile(path.join(tmpRoot, "page.tsx"), "export default function Page() { return 1; }\n");
  await initRepo(tmpRoot);
  await initialCommit(tmpRoot, "v1");
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("initRepo", () => {
  it("disables git hooks so a planted hook can never execute", async () => {
    const hooksPath = await git(tmpRoot, ["config", "core.hooksPath"]);
    expect(hooksPath).not.toBe("");
    // Simulate a hostile pre-commit hook written by an agent's Write tool
    // into the *real* .git/hooks, and confirm it does NOT run.
    const realHooks = path.join(tmpRoot, ".git", "hooks");
    await fs.mkdir(realHooks, { recursive: true });
    const marker = path.join(tmpRoot, "HOOK_RAN");
    await fs.writeFile(path.join(realHooks, "pre-commit"), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });

    await commitAll(tmpRoot, "test commit after hostile hook planted", { kind: "checkpoint" });

    const hookRan = await fs.access(marker).then(() => true).catch(() => false);
    expect(hookRan).toBe(false);
  });

  it("uses a fixed local identity, not the host's global gitconfig", async () => {
    const name = await git(tmpRoot, ["config", "user.name"]);
    const email = await git(tmpRoot, ["config", "user.email"]);
    expect(name).toBe("AI Builder");
    expect(email).toBe("ai-builder@local");
  });
});

describe("commitAll / history", () => {
  it("records structured trailers that round-trip through listVersions", async () => {
    await fs.writeFile(path.join(tmpRoot, "page.tsx"), "export default function Page() { return 2; }\n");
    await commitAll(tmpRoot, "Shorten hero headline", {
      kind: "edit",
      request: "Make the headline shorter",
      agent: "claude-code",
      validation: "passed",
      filesChanged: ["page.tsx"],
      runId: "run-123",
    });

    const versions = await listVersions(tmpRoot);
    const entry = versions[0];
    expect(entry.title).toBe("Shorten hero headline");
    expect(entry.request).toBe("Make the headline shorter");
    expect(entry.agent).toBe("claude-code");
    expect(entry.validation).toBe("passed");
    expect(entry.filesChanged).toEqual(["page.tsx"]);
    expect(entry.runId).toBe("run-123");
    expect(entry.kind).toBe("edit");
  });

  it("version history works identically for a Codex-authored commit - same trailer contract, no provider-specific parsing", async () => {
    await fs.writeFile(path.join(tmpRoot, "page.tsx"), "export default function Page() { return 3; }\n");
    await commitAll(tmpRoot, "Rename CTA button", {
      kind: "edit",
      request: "Rename the button to 'Join the Club'",
      agent: "codex",
      validation: "passed",
      filesChanged: ["page.tsx"],
      runId: "run-456",
    });

    const versions = await listVersions(tmpRoot);
    const entry = versions[0];
    expect(entry.agent).toBe("codex");
    expect(entry.request).toBe("Rename the button to 'Join the Club'");
    expect(entry.runId).toBe("run-456");
  });
});

describe("resolveCommit", () => {
  it("rejects a sha that doesn't exist", async () => {
    await expect(resolveCommit(tmpRoot, "deadbeef")).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    await expect(resolveCommit(tmpRoot, "not a sha; rm -rf /")).rejects.toThrow();
  });

  it("resolves a real commit", async () => {
    const sha = await git(tmpRoot, ["rev-parse", "HEAD"]);
    const resolved = await resolveCommit(tmpRoot, sha.slice(0, 10));
    expect(resolved).toBe(sha);
  });
});

describe("restoreToCommit", () => {
  it("restores content, takes a backup checkpoint first, and keeps all history reachable", async () => {
    const versionsBefore = await listVersions(tmpRoot);
    const firstCommit = versionsBefore[versionsBefore.length - 1].sha; // initial commit

    const { backupSha, restoreSha } = await restoreToCommit(tmpRoot, firstCommit);

    const content = await fs.readFile(path.join(tmpRoot, "page.tsx"), "utf8");
    expect(content).toContain("return 1;");

    const versionsAfter = await listVersions(tmpRoot);
    // Nothing was removed from history - only new commits were added.
    expect(versionsAfter.length).toBe(versionsBefore.length + 2); // backup + restore
    const shas = versionsAfter.map((v) => v.sha);
    expect(shas).toContain(backupSha);
    expect(shas).toContain(restoreSha);
    for (const v of versionsBefore) {
      expect(shas).toContain(v.sha);
    }
  });

  it("checkpointCommit creates a commit even with no working-tree changes", async () => {
    const before = (await listVersions(tmpRoot)).length;
    await checkpointCommit(tmpRoot, "manual checkpoint");
    const after = (await listVersions(tmpRoot)).length;
    expect(after).toBe(before + 1);
  });
});
