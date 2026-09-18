"use client";

import { useEffect, useState } from "react";
import type { VersionEntry } from "@/lib/workspaces/git/history";
import { GitHubPanel } from "./GitHubPanel";
import { GitHubMcpPanel } from "../github/GitHubMcpPanel";
import { VersionHistory } from "./VersionHistory";

export function HistoryPanel({ projectId }: { projectId: string }) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  async function load() {
    setStatus("loading");
    try {
      const res = await fetch(`/api/workspaces/${projectId}/versions`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setVersions(data.versions);
      setStatus("loaded");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    fetch(`/api/workspaces/${projectId}/versions`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setVersions(data.versions);
        setStatus("loaded");
      })
      .catch(() => setStatus("error"));
  }, [projectId]);

  async function restore(sha: string) {
    await fetch(`/api/workspaces/${projectId}/versions/${sha}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Version History</h3>
        <a
          href={`/api/workspaces/${projectId}/download`}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
        >
          Download ZIP
        </a>
      </div>

      {status === "loading" && <p className="text-sm text-neutral-400 dark:text-neutral-600">Loading…</p>}
      {status === "error" && <p className="text-sm text-red-600 dark:text-red-400">Couldn&apos;t load version history.</p>}
      {status === "loaded" && <VersionHistory versions={versions} onRestore={restore} />}

      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <h3 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">GitHub Export</h3>
        <GitHubPanel projectId={projectId} />
      </div>

      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <h3 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">GitHub Actions (agent-proposed)</h3>
        <GitHubMcpPanel projectId={projectId} />
      </div>
    </div>
  );
}
