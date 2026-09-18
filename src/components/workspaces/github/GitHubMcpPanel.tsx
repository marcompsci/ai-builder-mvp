"use client";

import { useCallback, useEffect, useState } from "react";
import type { GitHubConnection } from "@/lib/github/connections";
import type { GitHubApproval } from "@/lib/github/approvals";
import type { RepoSelection } from "@/lib/github/repoSelection";

type RepoOption = { fullName: string; private: boolean; defaultBranch: string };

const ACTION_LABELS: Record<GitHubApproval["actionType"], string> = {
  create_branch: "Create branch",
  create_commit_or_push_changes: "Push changes",
  create_pull_request: "Open pull request",
  create_issue: "Create issue",
  add_pull_request_comment: "Comment on pull request",
};

function ApprovalCard({ approval, onDecide, busy }: { approval: GitHubApproval; onDecide: (id: string, decision: "approved" | "rejected") => void; busy: boolean }) {
  const payload = approval.payload;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{ACTION_LABELS[approval.actionType]}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            approval.status === "executed"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : approval.status === "rejected" || approval.status === "expired"
                ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                : approval.status === "approved"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
          }`}
        >
          {approval.status}
        </span>
      </div>

      <div className="text-xs text-neutral-500 dark:text-neutral-400">
        <div>
          Repository: <span className="font-mono">{approval.repoFullName}</span>
        </div>
        {approval.targetBranch && (
          <div>
            Target branch: <span className="font-mono">{approval.targetBranch}</span>
            {approval.sourceBranch && approval.sourceBranch !== approval.targetBranch ? ` (from ${approval.sourceBranch})` : ""}
          </div>
        )}
        <div>Reversible: {approval.reversible ? "yes" : "no - this cannot be automatically undone"}</div>
      </div>

      {approval.reason && (
        <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{approval.reason}</p>
      )}

      <details className="text-xs text-neutral-500 dark:text-neutral-400">
        <summary className="cursor-pointer">Details</summary>
        <pre className="mt-1 overflow-x-auto rounded-md bg-neutral-50 p-2 dark:bg-neutral-900">{JSON.stringify(payload, null, 2)}</pre>
      </details>

      {approval.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onDecide(approval.id, "approved")}
            disabled={busy}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onDecide(approval.id, "rejected")}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            Reject
          </button>
        </div>
      )}

      {approval.status === "approved" && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-amber-700 dark:text-amber-400">Approved but not yet executed.</span>
          <button
            type="button"
            onClick={() => onDecide(approval.id, "approved")}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            Retry
          </button>
        </div>
      )}

      {approval.status === "executed" && approval.result && typeof approval.result.url === "string" && (
        <a href={approval.result.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline dark:text-blue-400">
          View on GitHub
        </a>
      )}
    </div>
  );
}

/**
 * The GitHub MCP surface for a project: which repo (if any) is connected
 * for agent tool access, and every pending/decided GitHub action the agent
 * has proposed. Separate from GitHubPanel (the one-off "export to a
 * repository" flow from Phase 3A) - this is the ongoing, per-run
 * MCP-driven surface, always requiring its own approval per action.
 */
export function GitHubMcpPanel({ projectId }: { projectId: string }) {
  const [connection, setConnection] = useState<GitHubConnection | null | undefined>(undefined);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [selection, setSelection] = useState<RepoSelection | null | undefined>(undefined);
  const [approvals, setApprovals] = useState<GitHubApproval[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = useCallback(() => {
    fetch(`/api/workspaces/${projectId}/github/approvals`)
      .then((res) => res.json())
      .then((data) => setApprovals(data.approvals ?? []))
      .catch(() => {});
  }, [projectId]);

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
    fetch(`/api/workspaces/${projectId}/github/repo-selection`)
      .then((res) => res.json())
      .then((data) => setSelection(data.selection ?? null))
      .catch(() => setSelection(null));
  }, [connection, projectId]);

  useEffect(() => {
    if (!selection) return;
    loadApprovals();
    const interval = setInterval(loadApprovals, 4000);
    return () => clearInterval(interval);
  }, [selection, loadApprovals]);

  async function selectRepo(repoFullName: string) {
    if (!repoFullName) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${projectId}/github/repo-selection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not select that repository.");
        return;
      }
      setSelection(data.selection);
    } finally {
      setBusy(false);
    }
  }

  async function clearSelection() {
    setBusy(true);
    try {
      await fetch(`/api/workspaces/${projectId}/github/repo-selection`, { method: "DELETE" });
      setSelection(null);
      setApprovals([]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${projectId}/github/approvals/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok && !data.approval) {
        setError(typeof data.error === "string" ? data.error : "Could not record that decision.");
      }
      if (data.executionError) setError(data.executionError);
      loadApprovals();
    } finally {
      setBusy(false);
    }
  }

  if (connection === undefined) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">Loading…</p>;
  }

  if (!connection) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Connect GitHub below to let agents propose GitHub actions.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {!selection ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Select a repository to let agent runs propose branches, commits, pull requests, and issues here. Every action still
            requires your approval before anything happens on GitHub.
          </p>
          <select
            defaultValue=""
            onChange={(e) => selectRepo(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"
          >
            <option value="">Select a repository…</option>
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName} {r.private ? "(private)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
            <span className="text-neutral-700 dark:text-neutral-300">
              GitHub MCP is connected to <strong>{selection.repoFullName}</strong> (default branch {selection.defaultBranch})
            </span>
            <button type="button" onClick={clearSelection} disabled={busy} className="text-xs text-neutral-500 underline disabled:opacity-50">
              Unlink
            </button>
          </div>

          <div>
            <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">GitHub actions</h4>
            {approvals.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-400 dark:text-neutral-600">No GitHub actions proposed yet.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} onDecide={decide} busy={busy} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
