import fs from "node:fs/promises";
import { STARTER_TEMPLATE_VERSION, WORKSPACES_ROOT } from "./config";
import { initialCommit, initRepo } from "./git/checkpoint";
import { getProjectRoot } from "./paths";
import { generateProjectId, sanitizeProjectName } from "./sanitize";
import { addProjectToIndex, type ProjectIndexEntry } from "./store";
import { copyStarterTemplate } from "./template";

const MAX_ID_ATTEMPTS = 5;

export async function createProject(rawName: unknown): Promise<ProjectIndexEntry> {
  const name = sanitizeProjectName(rawName);

  let id = "";
  let projectRoot = "";
  let attempt = 0;

  // The random segment of generateProjectId makes a collision astronomically
  // unlikely; this loop is defensive, not load-bearing.
  for (; attempt < MAX_ID_ATTEMPTS; attempt++) {
    id = generateProjectId(name);
    projectRoot = getProjectRoot(id);
    const exists = await fs
      .access(projectRoot)
      .then(() => true)
      .catch(() => false);
    if (!exists) break;
  }
  if (attempt >= MAX_ID_ATTEMPTS) {
    throw new Error("Could not allocate a unique project id. Please try again.");
  }

  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  await copyStarterTemplate(projectRoot);
  await initRepo(projectRoot);
  await initialCommit(projectRoot, STARTER_TEMPLATE_VERSION);

  const entry: ProjectIndexEntry = {
    id,
    name,
    createdAt: new Date().toISOString(),
    templateVersion: STARTER_TEMPLATE_VERSION,
  };
  await addProjectToIndex(entry);

  return entry;
}
