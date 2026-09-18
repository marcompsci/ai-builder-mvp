import { getDb } from "../db";

export interface RepoSelection {
  projectId: string;
  connectionId: string;
  repoFullName: string;
  defaultBranch: string;
  createdAt: string;
}

function rowToSelection(row: Record<string, unknown>): RepoSelection {
  return {
    projectId: row.project_id as string,
    connectionId: row.connection_id as string,
    repoFullName: row.repo_full_name as string,
    defaultBranch: row.default_branch as string,
    createdAt: row.created_at as string,
  };
}

export function setRepoSelection(input: {
  projectId: string;
  connectionId: string;
  repoFullName: string;
  defaultBranch: string;
}): RepoSelection {
  const db = getDb();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO github_repo_selections (project_id, connection_id, repo_full_name, default_branch, created_at)
     VALUES (@projectId, @connectionId, @repoFullName, @defaultBranch, @createdAt)
     ON CONFLICT(project_id) DO UPDATE SET
       connection_id = excluded.connection_id,
       repo_full_name = excluded.repo_full_name,
       default_branch = excluded.default_branch,
       created_at = excluded.created_at`,
  ).run({ ...input, createdAt });
  return { ...input, createdAt };
}

/** The one repository a project is bound to, if any - never trust a repo name from anywhere else. */
export function getRepoSelection(projectId: string): RepoSelection | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM github_repo_selections WHERE project_id = ?`).get(projectId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToSelection(row) : null;
}

export function clearRepoSelection(projectId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM github_repo_selections WHERE project_id = ?`).run(projectId);
}
