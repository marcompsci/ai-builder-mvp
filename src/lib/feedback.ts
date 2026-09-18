import { randomUUID } from "node:crypto";
import { getDb } from "./db";

export type FeedbackKind = "post_run_success" | "post_run_failure";

export interface FeedbackInput {
  runId?: string | null;
  projectId?: string | null;
  userId: string;
  kind: FeedbackKind;
  rating?: number | null;
  helped?: "yes" | "somewhat" | "no" | null;
  wouldUseAgain?: "yes" | "no" | "maybe" | null;
  wantsInterview?: boolean | null;
  blockedReason?: string | null;
  freeText?: string | null;
  mayUseLogs?: boolean | null;
}

export interface FeedbackEntry extends FeedbackInput {
  id: string;
  createdAt: string;
}

function rowToEntry(row: Record<string, unknown>): FeedbackEntry {
  return {
    id: row.id as string,
    runId: (row.run_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    userId: row.user_id as string,
    kind: row.kind as FeedbackKind,
    rating: (row.rating as number) ?? null,
    helped: (row.helped as FeedbackInput["helped"]) ?? null,
    wouldUseAgain: (row.would_use_again as FeedbackInput["wouldUseAgain"]) ?? null,
    wantsInterview: row.wants_interview === null || row.wants_interview === undefined ? null : Boolean(row.wants_interview),
    blockedReason: (row.blocked_reason as string) ?? null,
    freeText: (row.free_text as string) ?? null,
    mayUseLogs: row.may_use_logs === null || row.may_use_logs === undefined ? null : Boolean(row.may_use_logs),
    createdAt: row.created_at as string,
  };
}

export function createFeedback(input: FeedbackInput): FeedbackEntry {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO feedback (id, run_id, project_id, user_id, kind, rating, helped, would_use_again, wants_interview, blocked_reason, free_text, may_use_logs, created_at)
     VALUES (@id, @runId, @projectId, @userId, @kind, @rating, @helped, @wouldUseAgain, @wantsInterview, @blockedReason, @freeText, @mayUseLogs, @createdAt)`,
  ).run({
    id,
    runId: input.runId ?? null,
    projectId: input.projectId ?? null,
    userId: input.userId,
    kind: input.kind,
    rating: input.rating ?? null,
    helped: input.helped ?? null,
    wouldUseAgain: input.wouldUseAgain ?? null,
    wantsInterview: input.wantsInterview === null || input.wantsInterview === undefined ? null : input.wantsInterview ? 1 : 0,
    blockedReason: input.blockedReason ?? null,
    freeText: input.freeText ?? null,
    mayUseLogs: input.mayUseLogs === null || input.mayUseLogs === undefined ? null : input.mayUseLogs ? 1 : 0,
    createdAt,
  });
  return { ...input, id, createdAt };
}

export interface FeedbackFilter {
  provider?: string;
  kind?: FeedbackKind;
  rating?: number;
  projectType?: string;
  since?: string;
  until?: string;
}

/** Admin-only: lists feedback, optionally filtered. Provider/projectType filters join against product_events since feedback itself doesn't store them (kept minimal - see docs/analytics.md). */
export function listFeedback(filter: FeedbackFilter = {}): FeedbackEntry[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.kind) {
    clauses.push("kind = @kind");
    params.kind = filter.kind;
  }
  if (typeof filter.rating === "number") {
    clauses.push("rating = @rating");
    params.rating = filter.rating;
  }
  if (filter.since) {
    clauses.push("created_at >= @since");
    params.since = filter.since;
  }
  if (filter.until) {
    clauses.push("created_at <= @until");
    params.until = filter.until;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM feedback ${where} ORDER BY created_at DESC`).all(params) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

/** Renders feedback as CSV rows for admin export - never includes raw project content, only the structured fields plus free text as-submitted. */
export function feedbackToCsv(entries: FeedbackEntry[]): string {
  const header = ["id", "created_at", "kind", "rating", "helped", "would_use_again", "wants_interview", "blocked_reason", "free_text", "may_use_logs"];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = entries.map((e) =>
    [e.id, e.createdAt, e.kind, e.rating, e.helped, e.wouldUseAgain, e.wantsInterview, e.blockedReason, e.freeText, e.mayUseLogs].map(escape).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/**
 * "Top user problems": a simple keyword-frequency grouping over free-text
 * feedback - deliberately not full NLP/clustering (smallest architecture
 * for private-beta volume). Never returns the raw free text itself in the
 * grouped view - only the theme keyword and a count - so the aggregate
 * view can't become a vector for leaking project content; an admin who
 * needs the underlying text still reads it via listFeedback(), which is
 * itself admin-only.
 */
export function topProblemThemes(minLength = 4, limit = 20): { theme: string; count: number }[] {
  const db = getDb();
  const rows = db.prepare(`SELECT free_text FROM feedback WHERE free_text IS NOT NULL AND kind = 'post_run_failure'`).all() as {
    free_text: string;
  }[];

  const STOPWORDS = new Set(["that", "this", "with", "have", "from", "were", "what", "when", "your", "would", "could", "should", "about", "there"]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const words = row.free_text.toLowerCase().match(/[a-z]+/g) ?? [];
    for (const word of new Set(words)) {
      if (word.length < minLength || STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
