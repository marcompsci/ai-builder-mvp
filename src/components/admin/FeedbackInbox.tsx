"use client";

import { useEffect, useState } from "react";
import type { FeedbackEntry } from "@/lib/feedback";

export function FeedbackInbox() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [kindFilter, setKindFilter] = useState<"" | "post_run_success" | "post_run_failure">("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (kindFilter) params.set("kind", kindFilter);
    fetch(`/api/admin/feedback?${params.toString()}`)
      .then((res) => res.json())
      .then((d) => setEntries(d.feedback ?? []))
      .catch(() => {});
  }, [kindFilter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-950"
        >
          <option value="">All feedback</option>
          <option value="post_run_success">Successful runs</option>
          <option value="post_run_failure">Failed runs</option>
        </select>
        <a
          href="/api/admin/feedback/export"
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
        >
          Export CSV
        </a>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-600">No feedback yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{e.kind}</span>
                <span>{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-600 dark:text-neutral-400">
                {e.rating != null && <span>Rating: {e.rating}/5</span>}
                {e.helped && <span>Helped: {e.helped}</span>}
                {e.wouldUseAgain && <span>Would use again: {e.wouldUseAgain}</span>}
                {e.wantsInterview && <span>Wants interview</span>}
              </div>
              {e.blockedReason && <p className="mt-1 text-neutral-700 dark:text-neutral-300">Blocked by: {e.blockedReason}</p>}
              {e.freeText && <p className="mt-1 text-neutral-700 dark:text-neutral-300">{e.freeText}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
