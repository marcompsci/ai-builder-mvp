import type { FileDiff } from "@/lib/workspaces/agent/runStore";

function DiffBlock({ diff }: { diff: FileDiff }) {
  const lines = diff.unifiedDiff.split("\n");
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        {diff.path}
      </div>
      <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed">
        {lines.map((line, i) => {
          const color = line.startsWith("+") && !line.startsWith("+++")
            ? "text-emerald-700 dark:text-emerald-400"
            : line.startsWith("-") && !line.startsWith("---")
              ? "text-red-700 dark:text-red-400"
              : "text-neutral-500 dark:text-neutral-500";
          return (
            <div key={i} className={color}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export function DiffViewer({ diffs }: { diffs: FileDiff[] }) {
  if (diffs.length === 0) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">No file changes.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {diffs.map((diff) => (
        <DiffBlock key={diff.path} diff={diff} />
      ))}
    </div>
  );
}
