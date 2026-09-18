import { getDb } from "../db";

/** Never consulted by mcp_audit_log or anything security-required - this only gates optional product analytics (product_events/feedback). */
export function isOptedOut(userId: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM analytics_opt_out WHERE user_id = ?`).get(userId);
  return Boolean(row);
}

export function setOptedOut(userId: string, optedOut: boolean): void {
  const db = getDb();
  if (optedOut) {
    db.prepare(`INSERT INTO analytics_opt_out (user_id, opted_out_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING`).run(
      userId,
      new Date().toISOString(),
    );
  } else {
    db.prepare(`DELETE FROM analytics_opt_out WHERE user_id = ?`).run(userId);
  }
}
