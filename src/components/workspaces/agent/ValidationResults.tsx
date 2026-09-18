import type { ValidationCommandResult } from "@/lib/workspaces/agent/runStore";

export function ValidationResults({ results }: { results: ValidationCommandResult[] }) {
  return (
    <div className="flex flex-col gap-2">
      {results.map((r) => (
        <div key={r.label} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">{r.command}</span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                r.passed
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
              }`}
            >
              {r.passed ? "Passed" : "Failed"}
            </span>
          </div>
          {!r.passed && (
            <pre className="max-h-48 overflow-auto border-t border-neutral-200 p-3 text-xs text-red-700 dark:border-neutral-800 dark:text-red-400">
              {r.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
