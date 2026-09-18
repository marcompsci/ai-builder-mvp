import fs from "node:fs/promises";
import path from "node:path";
import { git } from "../git/client";
import type { FileDiff } from "./runStore";

/**
 * Diffs the current (possibly uncommitted) working tree against the given
 * checkpoint commit, using git's own diff machinery rather than a hand-rolled
 * algorithm. Covers modified, added, and deleted tracked files.
 */
export async function diffAgainstCheckpoint(workspaceRoot: string, checkpointSha: string): Promise<FileDiff[]> {
  const statusOutput = await git(workspaceRoot, ["diff", "--name-status", checkpointSha, "--"]);
  if (!statusOutput) return [];

  const entries = statusOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, filePath] = line.split("\t");
      return { status: status[0], filePath };
    });

  const diffs: FileDiff[] = [];
  for (const entry of entries) {
    const unifiedDiff = await git(workspaceRoot, ["diff", checkpointSha, "--", entry.filePath]);

    let before: string | null = null;
    if (entry.status !== "A") {
      try {
        before = await git(workspaceRoot, ["show", `${checkpointSha}:${entry.filePath}`]);
      } catch {
        before = null;
      }
    }

    let after: string | null = null;
    if (entry.status !== "D") {
      try {
        after = await fs.readFile(path.join(workspaceRoot, entry.filePath), "utf8");
      } catch {
        after = null;
      }
    }

    diffs.push({ path: entry.filePath, before, after, unifiedDiff });
  }
  return diffs;
}
