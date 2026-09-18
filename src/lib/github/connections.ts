import { randomUUID } from "node:crypto";
import { getDb } from "../db";

export interface GitHubConnection {
  id: string;
  projectId: string;
  githubLogin: string;
  installationId: string;
  installationAccountType: string | null;
  createdAt: string;
}

function rowToConnection(row: Record<string, unknown>): GitHubConnection {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    githubLogin: row.github_login as string,
    installationId: row.installation_id as string,
    installationAccountType: (row.installation_account_type as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function saveConnection(input: {
  projectId: string;
  githubLogin: string;
  installationId: string;
  installationAccountType: string | null;
}): GitHubConnection {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO github_connections (id, project_id, github_login, installation_id, installation_account_type, created_at)
     VALUES (@id, @projectId, @githubLogin, @installationId, @installationAccountType, @createdAt)`,
  ).run({ id, createdAt, ...input });
  return { id, createdAt, ...input };
}

/** Returns the connection for a project, verifying it actually belongs to that project - never trust a bare connection id. */
export function getConnectionForProject(projectId: string): GitHubConnection | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM github_connections WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(projectId) as Record<string, unknown> | undefined;
  return row ? rowToConnection(row) : null;
}

export function getConnectionById(id: string, projectId: string): GitHubConnection | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM github_connections WHERE id = ? AND project_id = ?`).get(id, projectId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToConnection(row) : null;
}

export function deleteConnection(id: string, projectId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM github_connections WHERE id = ? AND project_id = ?`).run(id, projectId);
  db.prepare(`DELETE FROM github_exports WHERE connection_id = ? AND project_id = ?`).run(id, projectId);
  // Clears the repo binding for GitHub MCP too, and any not-yet-executed
  // approvals - a disconnect should leave no residual GitHub access
  // pointing at this connection.
  db.prepare(`DELETE FROM github_repo_selections WHERE connection_id = ? AND project_id = ?`).run(id, projectId);
  db.prepare(
    `UPDATE github_approvals SET status = 'rejected', decided_at = ? WHERE connection_id = ? AND project_id = ? AND status IN ('pending', 'approved')`,
  ).run(new Date().toISOString(), id, projectId);
}

export interface GitHubExport {
  id: string;
  projectId: string;
  connectionId: string;
  repoFullName: string;
  branch: string;
  mode: "existing" | "create_new";
  status: "pending" | "pushing" | "succeeded" | "failed";
  errorMessage: string | null;
  commitSha: string | null;
  createdAt: string;
  completedAt: string | null;
}

function rowToExport(row: Record<string, unknown>): GitHubExport {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    connectionId: row.connection_id as string,
    repoFullName: row.repo_full_name as string,
    branch: row.branch as string,
    mode: row.mode as GitHubExport["mode"],
    status: row.status as GitHubExport["status"],
    errorMessage: (row.error_message as string) ?? null,
    commitSha: (row.commit_sha as string) ?? null,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) ?? null,
  };
}

export function createExport(input: {
  projectId: string;
  connectionId: string;
  repoFullName: string;
  branch: string;
  mode: "existing" | "create_new";
}): GitHubExport {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const record: GitHubExport = {
    id,
    createdAt,
    status: "pending",
    errorMessage: null,
    commitSha: null,
    completedAt: null,
    ...input,
  };
  db.prepare(
    `INSERT INTO github_exports (id, project_id, connection_id, repo_full_name, branch, mode, status, error_message, commit_sha, created_at, completed_at)
     VALUES (@id, @projectId, @connectionId, @repoFullName, @branch, @mode, @status, @errorMessage, @commitSha, @createdAt, @completedAt)`,
  ).run(record);
  return record;
}

export function updateExport(
  id: string,
  patch: Partial<Pick<GitHubExport, "status" | "errorMessage" | "commitSha" | "completedAt">>,
): void {
  const db = getDb();
  const current = db.prepare(`SELECT * FROM github_exports WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!current) return;
  const merged = { ...rowToExport(current), ...patch };
  db.prepare(
    `UPDATE github_exports SET status = @status, error_message = @errorMessage, commit_sha = @commitSha, completed_at = @completedAt WHERE id = @id`,
  ).run(merged);
}

export function getExportForProject(id: string, projectId: string): GitHubExport | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM github_exports WHERE id = ? AND project_id = ?`).get(id, projectId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToExport(row) : null;
}
