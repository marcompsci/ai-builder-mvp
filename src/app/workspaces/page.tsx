"use client";

import { useEffect, useState } from "react";
import { CreateProjectDialog } from "@/components/workspaces/CreateProjectDialog";
import { FileTree } from "@/components/workspaces/FileTree";
import { FileViewer } from "@/components/workspaces/FileViewer";
import { ProjectList } from "@/components/workspaces/ProjectList";
import { WorkspacePreviewPanel } from "@/components/workspaces/WorkspacePreviewPanel";
import { AgentRunPanel } from "@/components/workspaces/agent/AgentRunPanel";
import { HistoryPanel } from "@/components/workspaces/history/HistoryPanel";
import type { FileTreeNode } from "@/lib/workspaces/fsTree";
import type { ProjectIndexEntry } from "@/lib/workspaces/store";

type LoadStatus = "loading" | "loaded" | "error";
type MainTab = "files" | "agent" | "history";

export default function WorkspacesPage() {
  const [projects, setProjects] = useState<ProjectIndexEntry[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<LoadStatus>("loading");

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [treeStatus, setTreeStatus] = useState<LoadStatus>("loading");

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [fileStatus, setFileStatus] = useState<LoadStatus>("loaded");

  const [mainTab, setMainTab] = useState<MainTab>("files");

  async function loadProjects() {
    try {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProjects(data.projects);
      setProjectsStatus("loaded");
    } catch {
      setProjectsStatus("error");
    }
  }

  useEffect(() => {
    fetch("/api/workspaces")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setProjects(data.projects);
        setProjectsStatus("loaded");
      })
      .catch(() => setProjectsStatus("error"));
  }, []);

  async function handleCreate(name: string) {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Could not create the project.");
    }
    await loadProjects();
    selectProject(data.project.id);
  }

  async function selectProject(id: string) {
    setSelectedProjectId(id);
    setSelectedFilePath(null);
    setFileContent(null);
    setTreeStatus("loading");
    try {
      const res = await fetch(`/api/workspaces/${id}/files`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFileTree(data.tree);
      setTreeStatus("loaded");
    } catch {
      setFileTree([]);
      setTreeStatus("error");
    }
  }

  async function selectFile(path: string) {
    if (!selectedProjectId) return;
    setSelectedFilePath(path);
    setFileStatus("loading");
    try {
      const res = await fetch(
        `/api/workspaces/${selectedProjectId}/file?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFileContent(data);
      setFileStatus("loaded");
    } catch {
      setFileContent(null);
      setFileStatus("error");
    }
  }

  return (
    <main className="mx-auto grid h-[calc(100vh-57px)] max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-[280px_1fr_1fr]">
      <div className="flex flex-col gap-6 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Project Workspaces
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Create an isolated local project from the starter template.
          </p>
        </div>

        <CreateProjectDialog onCreate={handleCreate} />

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto border-t border-neutral-200 pt-4 dark:border-neutral-800">
          {projectsStatus === "loading" && (
            <p className="text-sm text-neutral-400 dark:text-neutral-600">Loading projects…</p>
          )}
          {projectsStatus === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">Couldn&apos;t load projects.</p>
          )}
          {projectsStatus === "loaded" && (
            <ProjectList projects={projects} selectedId={selectedProjectId} onSelect={selectProject} />
          )}
        </div>

        {selectedProjectId && (
          <div className="flex flex-1 flex-col overflow-y-auto border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <span className="px-2 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Files
            </span>
            {treeStatus === "loading" && (
              <p className="px-2 text-sm text-neutral-400 dark:text-neutral-600">Loading files…</p>
            )}
            {treeStatus === "error" && (
              <p className="px-2 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load files.</p>
            )}
            {treeStatus === "loaded" && (
              <FileTree tree={fileTree} selectedPath={selectedFilePath} onSelectFile={selectFile} />
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {selectedProjectId && (
          <div className="flex gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800">
            {(["files", "agent", "history"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMainTab(tab)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  mainTab === tab
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
                }`}
              >
                {tab === "agent" ? "Request a change" : tab === "history" ? "History & GitHub" : tab}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!selectedProjectId ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <p className="text-sm text-neutral-400 dark:text-neutral-600">
                Select or create a project to browse its files.
              </p>
            </div>
          ) : mainTab === "agent" ? (
            <div className="p-4">
              <AgentRunPanel key={selectedProjectId} projectId={selectedProjectId} />
            </div>
          ) : mainTab === "history" ? (
            <div className="p-4">
              <HistoryPanel key={selectedProjectId} projectId={selectedProjectId} />
            </div>
          ) : fileStatus === "loading" ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <p className="text-sm text-neutral-400 dark:text-neutral-600">Loading file…</p>
            </div>
          ) : fileStatus === "error" ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">Couldn&apos;t load that file.</p>
            </div>
          ) : (
            <FileViewer file={fileContent} />
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {selectedProjectId ? (
          <WorkspacePreviewPanel key={selectedProjectId} projectId={selectedProjectId} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-sm text-neutral-400 dark:text-neutral-600">
              Select or create a project to preview it.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
