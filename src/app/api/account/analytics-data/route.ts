import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { currentUserId } from "@/lib/identity";

/**
 * Deletes this user's OPTIONAL product-analytics data only - product_events
 * and feedback rows. Never touches mcp_audit_log, which is a required
 * safety mechanism, not user-deletable data - see docs/analytics.md
 * "Security audit logs vs product analytics".
 */
export async function DELETE() {
  const userId = await currentUserId();
  const db = getDb();
  const deleteEvents = db.prepare(`DELETE FROM product_events WHERE user_id = ?`).run(userId);
  const deleteFeedback = db.prepare(`DELETE FROM feedback WHERE user_id = ?`).run(userId);
  return NextResponse.json({
    deletedEvents: deleteEvents.changes,
    deletedFeedback: deleteFeedback.changes,
  });
}
