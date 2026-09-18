import type { AgentPlan } from "@/lib/workspaces/agent/planSchema";

export function PlanReview({
  plan,
  onApprove,
  onDiscard,
  approving,
}: {
  plan: AgentPlan;
  onApprove: () => void;
  onDiscard: () => void;
  approving: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Proposed plan</h3>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{plan.intendedResult}</p>
      </div>

      <div>
        <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Files to modify</h4>
        <ul className="mt-1 list-inside list-disc text-sm text-neutral-700 dark:text-neutral-300">
          {plan.filesToModify.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>

      {plan.risks.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Risks</h4>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-400">
            {plan.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Will validate with</h4>
        <p className="mt-1 font-mono text-xs text-neutral-600 dark:text-neutral-400">
          {plan.validationCommands.join("  ·  ")}
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={approving}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {approving ? "Starting…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={approving}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
