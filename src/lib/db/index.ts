import path from "node:path";
import Database from "better-sqlite3";
import { WORKSPACES_ROOT } from "../workspaces/config";

// A local SQLite file, scoped to this app's own data directory - never
// derived from request input. Holds only the new GitHub-related tables;
// project metadata stays in workspaces/index.json (Phase 2A) and version
// history stays in git itself, so nothing here can drift out of sync with
// those sources of truth.
const DB_PATH = path.join(path.dirname(WORKSPACES_ROOT), "app.db");

let db: Database.Database | null = null;

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const existing = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!existing.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS github_connections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      github_login TEXT NOT NULL,
      installation_id TEXT NOT NULL,
      installation_account_type TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_github_connections_project_id
      ON github_connections(project_id);

    CREATE TABLE IF NOT EXISTS github_exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES github_connections(id),
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      commit_sha TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_github_exports_project_id
      ON github_exports(project_id);

    -- Immutable audit trail for every MCP tool call (Project Files MCP and
    -- GitHub MCP). Rows are only ever inserted, never updated or deleted,
    -- by convention - no application code should UPDATE/DELETE this table.
    -- user_id/org_id are fixed local placeholders until this app has a
    -- real auth system; the columns exist now so nothing needs to change
    -- shape later.
    CREATE TABLE IF NOT EXISTS mcp_audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      relative_path TEXT,
      decision TEXT NOT NULL,
      reason TEXT,
      content_hash_before TEXT,
      content_hash_after TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_run_id
      ON mcp_audit_log(agent_run_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_project_id
      ON mcp_audit_log(project_id);

    -- Phase 5B: the ONE repository a project is bound to. GitHub MCP tools
    -- take no repo parameter - the server reads this at spawn time, the
    -- same structural pattern as Project Files MCP's workspace scoping.
    CREATE TABLE IF NOT EXISTS github_repo_selections (
      project_id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES github_connections(id),
      repo_full_name TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Phase 5B: a write-capable GitHub MCP tool never executes directly -
    -- it creates a row here and returns "pending_approval". The actual
    -- GitHub API call only ever happens from the human-triggered approval
    -- route, against this exact stored payload, once, ever (status flips
    -- to 'executed' and stays there - never replayed).
    CREATE TABLE IF NOT EXISTS github_approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES github_connections(id),
      agent_run_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      target_branch TEXT,
      source_branch TEXT,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      reason TEXT,
      reversible INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      executed_at TEXT,
      result_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_github_approvals_project_id
      ON github_approvals(project_id);
    CREATE INDEX IF NOT EXISTS idx_github_approvals_run_id
      ON github_approvals(agent_run_id);

    -- Phase 7A: product analytics, deliberately a SEPARATE table from
    -- mcp_audit_log - see docs/analytics.md "Security audit logs vs
    -- product analytics". org_id is nullable (no real org model exists
    -- yet; ready for one), user_id is required. properties_json only ever
    -- holds fields that passed EVENT_PROPERTY_SCHEMAS[event_name] - never
    -- raw prompts, file content, secrets, tokens, or env values.
    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL,
      org_id TEXT,
      project_id TEXT,
      agent_run_id TEXT,
      provider TEXT,
      properties_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_product_events_user_id
      ON product_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_product_events_project_id
      ON product_events(project_id);
    CREATE INDEX IF NOT EXISTS idx_product_events_event_name
      ON product_events(event_name);

    -- Phase 7A: structured post-run feedback. Separate from product_events
    -- because it carries optional free text and has different access rules
    -- (admin-only inbox, exportable) - a event_name='feedback_submitted'
    -- row in product_events still exists for funnel counting, but never
    -- carries the free text itself.
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      project_id TEXT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      rating INTEGER,
      helped TEXT,
      would_use_again TEXT,
      wants_interview INTEGER,
      blocked_reason TEXT,
      free_text TEXT,
      may_use_logs INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_run_id
      ON feedback(run_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_project_id
      ON feedback(project_id);

    -- Phase 7A: a user's opt-out of OPTIONAL product analytics. Never
    -- consulted by mcp_audit_log or anything security-required - opting out
    -- only stops product_events/feedback writes.
    CREATE TABLE IF NOT EXISTS analytics_opt_out (
      user_id TEXT PRIMARY KEY,
      opted_out_at TEXT NOT NULL
    );
  `);

  // mcp_audit_log predates Phase 5B - add the GitHub-specific columns via
  // migration rather than assuming a fresh table (an existing app.db from
  // Phase 5A won't have these yet).
  ensureColumn(db, "mcp_audit_log", "repository", "TEXT");
  ensureColumn(db, "mcp_audit_log", "branch", "TEXT");
  ensureColumn(db, "mcp_audit_log", "approval_id", "TEXT");
  ensureColumn(db, "mcp_audit_log", "github_result_ref", "TEXT");

  return db;
}
