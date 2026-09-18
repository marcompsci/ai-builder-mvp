"use client";

import { useEffect, useState } from "react";

export default function PrivacyPage() {
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState<{ deletedEvents: number; deletedFeedback: number } | null>(null);

  useEffect(() => {
    fetch("/api/account/analytics-opt-out")
      .then((res) => res.json())
      .then((d) => setOptedOut(Boolean(d.optedOut)))
      .catch(() => setOptedOut(false));
  }, []);

  async function toggleOptOut() {
    if (optedOut === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/analytics-opt-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optedOut: !optedOut }),
      });
      const data = await res.json();
      setOptedOut(Boolean(data.optedOut));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMyAnalyticsData() {
    setBusy(true);
    try {
      const res = await fetch("/api/account/analytics-data", { method: "DELETE" });
      const data = await res.json();
      setDeleted(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Beta privacy notice</h1>

      <div className="flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <p>
          During the private beta, this app records a small set of product-analytics events - things like when a project is created,
          an agent plan is approved, a build validates, or a preview loads - so we can learn whether the product actually works for
          you and where it doesn&apos;t.
        </p>
        <p>
          These events never include your prompts, source code, generated file content, API keys, tokens, environment variable
          values, or private GitHub content. They record categories, counts, and durations - for example &ldquo;a build
          validated in 42 seconds,&rdquo; never the code that was built.
        </p>
        <p>
          Optional feedback you submit after a run (ratings, short free-text answers) is stored separately and is only visible to
          internal admins reviewing the beta.
        </p>
        <p>
          Product analytics is separate from the security audit log that records every MCP tool call for safety review - that
          log is required for the approval workflow&apos;s guarantees to hold and is not something you can opt out of or delete;
          it never contains file content either, only which tool was called, on what path, and whether it was allowed.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Your controls</h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Product analytics</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {optedOut === null ? "Loading…" : optedOut ? "You are opted out." : "You are opted in (default)."}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleOptOut}
            disabled={busy || optedOut === null}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {optedOut ? "Opt back in" : "Opt out"}
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Delete my analytics data</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Removes your product-events and feedback rows. Never affects the required security audit log.
            </p>
          </div>
          <button
            type="button"
            onClick={deleteMyAnalyticsData}
            disabled={busy}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400"
          >
            Delete
          </button>
        </div>
        {deleted && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Deleted {deleted.deletedEvents} event(s) and {deleted.deletedFeedback} feedback entr{deleted.deletedFeedback === 1 ? "y" : "ies"}.
          </p>
        )}
      </div>
    </div>
  );
}
