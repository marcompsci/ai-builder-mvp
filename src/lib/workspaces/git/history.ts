import { assertIsRepoRoot, git } from "./client";

export interface VersionEntry {
  sha: string;
  timestamp: string;
  title: string;
  request: string | null;
  agent: string | null;
  validation: string | null;
  filesChanged: string[];
  runId: string | null;
  kind: string | null;
}

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

function parseTrailers(body: string): Omit<VersionEntry, "sha" | "timestamp" | "title"> {
  const lines = body.split("\n");
  const result = {
    request: null as string | null,
    agent: null as string | null,
    validation: null as string | null,
    filesChanged: [] as string[],
    runId: null as string | null,
    kind: null as string | null,
  };
  for (const line of lines) {
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    switch (key) {
      case "Request":
        result.request = value;
        break;
      case "Agent":
        result.agent = value;
        break;
      case "Validation":
        result.validation = value;
        break;
      case "Files-Changed":
        result.filesChanged = value === "(none)" ? [] : value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "Run-Id":
        result.runId = value;
        break;
      case "Kind":
        result.kind = value;
        break;
    }
  }
  return result;
}

export async function listVersions(workspaceRoot: string, limit = 100): Promise<VersionEntry[]> {
  await assertIsRepoRoot(workspaceRoot);
  const format = `%H${FIELD_SEP}%aI${FIELD_SEP}%B${RECORD_SEP}`;
  let raw: string;
  try {
    raw = await git(workspaceRoot, ["log", `--max-count=${limit}`, `--format=${format}`]);
  } catch {
    return [];
  }

  const records = raw.split(RECORD_SEP).map((r) => r.trim()).filter(Boolean);
  return records.map((record) => {
    const [sha, timestamp, ...bodyParts] = record.split(FIELD_SEP);
    const body = bodyParts.join(FIELD_SEP);
    const title = body.split("\n")[0] ?? "";
    return { sha, timestamp, title, ...parseTrailers(body) };
  });
}
