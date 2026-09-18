"use client";

import { useEffect, useState } from "react";

export function TopProblems() {
  const [themes, setThemes] = useState<{ theme: string; count: number }[]>([]);

  useEffect(() => {
    fetch("/api/admin/analytics/problems")
      .then((res) => res.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
  }, []);

  if (themes.length === 0) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">Not enough failure feedback yet to surface themes.</p>;
  }

  const max = Math.max(...themes.map((t) => t.count));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Keyword frequency across failed-run feedback free text - a starting signal, not a substitute for reading the feedback inbox directly.
      </p>
      {themes.map((t) => (
        <div key={t.theme} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm text-neutral-700 dark:text-neutral-300">{t.theme}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
            <div className="h-full bg-neutral-900 dark:bg-white" style={{ width: `${(t.count / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">{t.count}</span>
        </div>
      ))}
    </div>
  );
}
