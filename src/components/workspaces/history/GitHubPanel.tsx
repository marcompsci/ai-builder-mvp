"use client";

import { useEffect, useState } from "react";
import type { GitHubConnection, GitHubExport } from "@/lib/github/connections";

type RepoOption = { fullName: string; private: boolean; defaultBranch: string };

export function GitHubPanel({ projectId }: { projectId: string }) {
  const [connection, setConnection] = useState<GitHubConnection | null | undefined>(undefined);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [mode, setMode] = useState<"existing" | "create_new">("existing");
  const [repoFullName, setRepoFullName] = useState("");
  const [newRepoName, setNewRepoName] = useState("");
  const [branch, setBranch] = useState("main");
  const [confirming, setConfirming] = useState(false);
  const [exportRecord, setExportRecord] = useState<GitHubExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workspaces/${projectId}/github/connection`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => setConnection(ok ? data.connection : null))
      .catch(() => setConnection(null));
  }, [projectId]);

  useEffect(() => {
    if (!connection) return;
    fetch(`/api/workspaces/${projectId}/github/repos`)
      .then((res) => res.json())
      .then((data) => setRepos(data.repos ?? []))
      .catch(() => setRepos([]));
  }, [connection, projectId]);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch(`/api/workspaces/${projectId}/github/connection`, { method: "DELETE" });
      setConnection(null);
      setRepos([]);
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${projectId}/github/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          mode,
          repoFullName: mode === "existing" ? repoFullName : undefined,
          newRepoName: mode === "create_new" ? newRepoName : undefined,
          branch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not start the export.");
        return;
      }
      setExportRecord(data.export);
      setConfirming(false);
      poll(data.export.id);
    } finally {
      setBusy(false);
    }
  }

  function poll(exportId: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/workspaces/${projectId}/github/export/${exportId}`);
      if (!res.ok) return;
      const data = await res.json();
      setExportRecord(data.export);
      if (data.export.status === "succeeded" || data.export.status === "failed") {
        clearInterval(interval);
      }
    }, 1500);
  }

  if (connection === undefined) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">Loading…</p>;
  }

  if (!connection) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Connect GitHub to export this project to a repository you authorize.
        </p>
        <a
          href={`/api/workspaces/${projectId}/github/connect`}
          className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Connect GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
        <span className="text-neutral-700 dark:text-neutral-300">
          Connected as <strong>{connection.githubLogin}</strong>
        </span>
        <button type="button" onClick={disconnect} disabled={busy} className="text-xs text-neutral-500 underline disabled:opacity-50">
          Disconnect
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} />
            Existing repository
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "create_new"} onChange={() => setMode("create_new")} />
            Create new
          </label>
        </div>

        {mode === "existing" ? (
          <select
            value={repoFullName}
            onChange={(e) => setRepoFullName(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"
          >
            <option value="">Select a repository…</option>
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName} {r.private ? "(private)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={newRepoName}
            onChange={(e) => setNewRepoName(e.target.value)}
            placeholder="new-repo-name"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"
          />
        )}

        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="branch"
          className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"
        />

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={mode === "existing" ? !repoFullName : !newRepoName.trim()}
            className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            Push to GitHub
          </button>
        ) : (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p className="text-amber-800 dark:text-amber-300">
              {mode === "create_new"
                ? `This will create a new private repository "${newRepoName}" and push to it.`
                : `This will push to ${repoFullName} on branch "${branch}".`}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={runExport}
                disabled={busy}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {busy ? "Starting…" : "Confirm and push"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {exportRecord && (
          <div className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <p className="font-medium text-neutral-700 dark:text-neutral-300">Export status: {exportRecord.status}</p>
            {exportRecord.status === "succeeded" && (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Pushed {exportRecord.repoFullName}@{exportRecord.branch} ({exportRecord.commitSha?.slice(0, 8)})
              </p>
            )}
            {exportRecord.status === "failed" && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{exportRecord.errorMessage}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
