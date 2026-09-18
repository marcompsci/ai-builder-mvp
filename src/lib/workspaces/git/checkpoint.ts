import fs from "node:fs/promises";
import path from "node:path";
import { assertIsRepoRoot, git, gitCommit, GitError } from "./client";

// Per-workspace serialization so concurrent checkpoint/restore/commit calls
// against the same repo can't race each other.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** Initializes a fresh git repo with hooks disabled and no host gitconfig inheritance. */
export async function initRepo(workspaceRoot: string): Promise<void> {
  await withLock(workspaceRoot, async () => {
    await git(workspaceRoot, ["init", "--initial-branch=main"]);
    // Lives inside .git/ itself (never a trackable working-tree path) so
    // `git add -A` can never accidentally pick it up.
    const hooksDir = path.join(workspaceRoot, ".git", "hooks-disabled");
    // Point core.hooksPath at an empty directory outside .git/hooks so a
    // hook file written by the coding agent's unrestricted Write tool can
    // never execute when our own code later runs `git commit` here.
    await fs.mkdir(hooksDir, { recursive: true });
    await git(workspaceRoot, ["config", "core.hooksPath", hooksDir]);
    await git(workspaceRoot, ["config", "commit.gpgsign", "false"]);
    await git(workspaceRoot, ["config", "user.name", "AI Builder"]);
    await git(workspaceRoot, ["config", "user.email", "ai-builder@local"]);
  });
}

export interface CommitTrailers {
  request?: string;
  agent?: string;
  validation?: string;
  filesChanged?: string[];
  runId?: string;
  kind: "initial" | "checkpoint" | "edit" | "restore";
}

function buildMessage(title: string, trailers: CommitTrailers): string {
  const lines = [title, ""];
  if (trailers.request) lines.push(`Request: ${trailers.request.replace(/\n/g, " ")}`);
  if (trailers.agent) lines.push(`Agent: ${trailers.agent}`);
  if (trailers.validation) lines.push(`Validation: ${trailers.validation}`);
  if (trailers.filesChanged) lines.push(`Files-Changed: ${trailers.filesChanged.join(", ") || "(none)"}`);
  if (trailers.runId) lines.push(`Run-Id: ${trailers.runId}`);
  lines.push(`Kind: ${trailers.kind}`);
  return lines.join("\n");
}

/** Unlocked implementation - only call this from within a function that already holds the workspace's lock. */
async function commitAllUnlocked(workspaceRoot: string, title: string, trailers: CommitTrailers): Promise<string> {
  await assertIsRepoRoot(workspaceRoot);
  await git(workspaceRoot, ["add", "-A"]);
  const message = buildMessage(title, trailers);
  try {
    await gitCommit(workspaceRoot, ["commit", "--allow-empty", "-m", message]);
  } catch (err) {
    throw new GitError("Failed to create commit", (err as GitError).stderr);
  }
  return git(workspaceRoot, ["rev-parse", "HEAD"]);
}

/** Stages everything and commits, even if there is nothing to commit (creates an empty commit as a marker). */
export async function commitAll(workspaceRoot: string, title: string, trailers: CommitTrailers): Promise<string> {
  return withLock(workspaceRoot, () => commitAllUnlocked(workspaceRoot, title, trailers));
}

export async function initialCommit(workspaceRoot: string, templateVersion: string): Promise<string> {
  return commitAll(workspaceRoot, "Initial commit from starter template", {
    kind: "initial",
    agent: `starter-template:${templateVersion}`,
  });
}

/** Checkpoint taken immediately before an approved mutating run. */
export async function checkpointCommit(workspaceRoot: string, label: string): Promise<string> {
  return commitAll(workspaceRoot, `[checkpoint] ${label}`, { kind: "checkpoint" });
}

/** Validates that `sha` is a real, reachable commit in this repo (never trust a client-supplied sha otherwise). */
export async function resolveCommit(workspaceRoot: string, sha: string): Promise<string> {
  await assertIsRepoRoot(workspaceRoot);
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new GitError("Invalid commit reference");
  }
  try {
    const full = await git(workspaceRoot, ["rev-parse", "--verify", `${sha}^{commit}`]);
    // Confirm it's actually reachable from HEAD's history, not some
    // dangling/unrelated object id that happens to resolve.
    await git(workspaceRoot, ["merge-base", "--is-ancestor", full, "HEAD"]);
    return full;
  } catch {
    throw new GitError("Commit not found in this project's history");
  }
}

/**
 * Safely restores the working tree to `sha`'s content. Never rewrites or
 * discards history: takes a backup checkpoint first, then overlays the old
 * content and commits it as a new, forward-moving commit. Every prior
 * version stays reachable in `git log` afterwards.
 */
export async function restoreToCommit(workspaceRoot: string, sha: string): Promise<{ backupSha: string; restoreSha: string }> {
  return withLock(workspaceRoot, async () => {
    const resolvedSha = await resolveCommit(workspaceRoot, sha);
    const backupSha = await commitAllUnlocked(workspaceRoot, "[checkpoint] before restore", { kind: "checkpoint" });

    await git(workspaceRoot, ["checkout", resolvedSha, "--", "."]);
    // Remove files that exist now but didn't at the restored commit.
    const wanted = new Set(
      (await git(workspaceRoot, ["ls-tree", "-r", "--name-only", resolvedSha])).split("\n").filter(Boolean),
    );
    const current = (await git(workspaceRoot, ["ls-files"])).split("\n").filter(Boolean);
    for (const file of current) {
      if (!wanted.has(file)) {
        await git(workspaceRoot, ["rm", "-f", "--", file]);
      }
    }

    const restoreSha = await commitAllUnlocked(workspaceRoot, `Restore to ${resolvedSha.slice(0, 8)}`, {
      kind: "restore",
    });
    return { backupSha, restoreSha };
  });
}
