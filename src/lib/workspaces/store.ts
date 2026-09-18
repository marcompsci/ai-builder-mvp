import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACES_ROOT } from "./config";

export interface ProjectIndexEntry {
  id: string;
  name: string;
  createdAt: string;
  templateVersion: string;
}

const INDEX_PATH = path.join(WORKSPACES_ROOT, "index.json");

async function readIndex(): Promise<Record<string, ProjectIndexEntry>> {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    return JSON.parse(raw) as Record<string, ProjectIndexEntry>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeIndex(index: Record<string, ProjectIndexEntry>): Promise<void> {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  const tmpPath = `${INDEX_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(index, null, 2), "utf8");
  await fs.rename(tmpPath, INDEX_PATH);
}

export async function addProjectToIndex(entry: ProjectIndexEntry): Promise<void> {
  const index = await readIndex();
  index[entry.id] = entry;
  await writeIndex(index);
}

export async function listProjects(): Promise<ProjectIndexEntry[]> {
  const index = await readIndex();
  return Object.values(index).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProjectEntry(id: string): Promise<ProjectIndexEntry | null> {
  const index = await readIndex();
  return index[id] ?? null;
}
