"use client";

import { useState } from "react";

interface Props {
  projectId: string;
  runId: string;
  variant: "success" | "failure";
}

export function PostRunFeedback({ projectId, runId, variant }: Props) {
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [helped, setHelped] = useState<"yes" | "somewhat" | "no" | "">("");
  const [rating, setRating] = useState<number | "">("");
  const [wouldUseAgain, setWouldUseAgain] = useState<"yes" | "no" | "maybe" | "">("");
  const [wantsInterview, setWantsInterview] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [mayUseLogs, setMayUseLogs] = useState<boolean | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body =
        variant === "success"
          ? {
              kind: "post_run_success" as const,
              runId,
              helped: helped || undefined,
              rating: rating === "" ? undefined : rating,
              wouldUseAgain: wouldUseAgain || undefined,
              wantsInterview,
              freeText: freeText.trim() || undefined,
            }
          : {
              kind: "post_run_failure" as const,
              runId,
              blockedReason: blockedReason.trim() || undefined,
              freeText: freeText.trim() || undefined,
              mayUseLogs: mayUseLogs ?? undefined,
            };

      const res = await fetch(`/api/workspaces/${projectId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not submit feedback.");
        return;
      }
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return <p className="rounded-lg border border-neutral-200 p-3 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">Thanks for the feedback.</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Quick feedback (optional)</h4>

      {variant === "success" ? (
        <>
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">Did this result help you move forward?</p>
            <div className="flex gap-2 text-xs">
              {(["yes", "somewhat", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setHelped(v)}
                  className={`rounded-md border px-3 py-1 ${helped === v ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">How would you rate this result? (1-5)</p>
            <div className="flex gap-1 text-xs">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRating(v)}
                  className={`h-7 w-7 rounded-md border ${rating === v ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
            What was confusing, missing, or wrong? (optional)
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              maxLength={2000}
              className="min-h-16 resize-none rounded-lg border border-neutral-200 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>

          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">Would you use this again next week?</p>
            <div className="flex gap-2 text-xs">
              {(["yes", "no", "maybe"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setWouldUseAgain(v)}
                  className={`rounded-md border px-3 py-1 ${wouldUseAgain === v ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={wantsInterview} onChange={(e) => setWantsInterview(e.target.checked)} />
            May we contact you for a 20-minute interview?
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
            What were you trying to accomplish?
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              maxLength={2000}
              className="min-h-16 resize-none rounded-lg border border-neutral-200 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
            What blocked you?
            <textarea
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              maxLength={2000}
              className="min-h-16 resize-none rounded-lg border border-neutral-200 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>

          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">May we use anonymized logs to investigate?</p>
            <div className="flex gap-2 text-xs">
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setMayUseLogs(opt.value)}
                  className={`rounded-md border px-3 py-1 ${mayUseLogs === opt.value ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}
