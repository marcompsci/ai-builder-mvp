"use client";

import { useState } from "react";
import { AnalyticsFunnel } from "@/components/admin/AnalyticsFunnel";
import { FeedbackInbox } from "@/components/admin/FeedbackInbox";
import { TopProblems } from "@/components/admin/TopProblems";

const TABS = ["funnel", "feedback", "problems"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  funnel: "Activation Funnel",
  feedback: "Feedback Inbox",
  problems: "Top User Problems",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("funnel");

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Beta Admin</h1>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          No dedicated admin authentication exists yet - this page carries the same trust assumption as the rest of the app today
          (a single trusted operator), not a new gap. See docs/analytics.md.
        </p>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === t
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "funnel" && <AnalyticsFunnel />}
      {tab === "feedback" && <FeedbackInbox />}
      {tab === "problems" && <TopProblems />}
    </div>
  );
}
