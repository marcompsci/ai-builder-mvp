"use client";

import { useEffect, useState } from "react";
import type { FunnelSnapshot } from "@/lib/analytics/funnel";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
    </div>
  );
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function seconds(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}s`;
}

export function AnalyticsFunnel() {
  const [data, setData] = useState<FunnelSnapshot | null>(null);

  useEffect(() => {
    fetch("/api/admin/analytics/funnel")
      .then((res) => res.json())
      .then((d) => setData(d.funnel))
      .catch(() => {});
  }, []);

  if (!data) return <p className="text-sm text-neutral-400 dark:text-neutral-600">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        {data.note}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Projects created" value={String(data.projectsCreated)} />
        <Stat label="First validated run rate" value={pct(data.firstValidatedRunRate)} />
        <Stat label="First successful preview rate" value={pct(data.firstSuccessfulPreviewRate)} />
        <Stat label="Plan approval rate" value={pct(data.planApprovalRate)} />
        <Stat label="Diff review rate" value={pct(data.diffReviewRate)} />
        <Stat label="GitHub export rate" value={pct(data.githubExportRate)} />
        <Stat label="Median time to first preview" value={seconds(data.medianSecondsToFirstPreview)} />
        <Stat label="Median prompt → validated build" value={seconds(data.medianSecondsPromptToValidatedBuild)} />
        <Stat label="Estimated cost / successful project" value="—" />
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">Claude Code vs. Codex</h4>
        <div className="flex flex-col gap-2">
          {data.providerBreakdown.map((p) => (
            <div key={p.provider} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{p.provider}</span>
              <span className="text-neutral-500 dark:text-neutral-400">
                {p.runsStarted} started · {p.runsCompleted} completed · {p.runsFailed} failed · success {pct(p.successRate)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">Failure reasons</h4>
        {data.failureReasonsByCategory.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-600">No failures recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {data.failureReasonsByCategory.map((f) => (
              <div key={f.category} className="flex items-center justify-between text-sm">
                <span className="text-neutral-700 dark:text-neutral-300">{f.category}</span>
                <span className="text-neutral-500 dark:text-neutral-400">{f.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Day 1 return" value={pct(data.day1ReturnRate)} />
        <Stat label="Day 7 return" value={pct(data.day7ReturnRate)} />
        <Stat label="Day 30 return" value={pct(data.day30ReturnRate)} />
      </div>
    </div>
  );
}
