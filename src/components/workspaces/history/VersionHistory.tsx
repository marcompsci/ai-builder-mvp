"use client";

import { useState } from "react";
import type { VersionEntry } from "@/lib/workspaces/git/history";

function VersionRow({
  version,
  onRestore,
}: {
  version: VersionEntry;
  onRestore: (sha: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onRestore(version.sha);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-neutral-200 py-3 last:border-0 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{version.title}</p>
          <p className="text-xs text-neutral-400 dark:text-neutral-600">
            {new Date(version.timestamp).toLocaleString()} · {version.sha.slice(0, 8)}
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            Restore
          </button>
        ) : (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {busy ? "Restoring…" : "Confirm restore"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {(version.agent || version.request || version.validation) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {version.request && (
            <>
              <dt className="font-medium">Request</dt>
              <dd>{version.request}</dd>
            </>
          )}
          {version.agent && (
            <>
              <dt className="font-medium">Agent</dt>
              <dd>{version.agent}</dd>
            </>
          )}
          {version.validation && (
            <>
              <dt className="font-medium">Validation</dt>
              <dd>{version.validation}</dd>
            </>
          )}
          {version.filesChanged.length > 0 && (
            <>
              <dt className="font-medium">Files</dt>
              <dd>{version.filesChanged.join(", ")}</dd>
            </>
          )}
          {version.runId && (
            <>
              <dt className="font-medium">Run</dt>
              <dd className="font-mono">{version.runId}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

export function VersionHistory({
  versions,
  onRestore,
}: {
  versions: VersionEntry[];
  onRestore: (sha: string) => Promise<void>;
}) {
  if (versions.length === 0) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">No versions yet.</p>;
  }
  return (
    <div className="flex flex-col">
      {versions.map((v) => (
        <VersionRow key={v.sha} version={v} onRestore={onRestore} />
      ))}
    </div>
  );
}
