"use client";

import type { ProjectIndexEntry } from "@/lib/workspaces/store";

export function ProjectList({
  projects,
  selectedId,
  onSelect,
}: {
  projects: ProjectIndexEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-600">
        No projects yet — create one above to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {projects.map((project) => (
        <li key={project.id}>
          <button
            type="button"
            onClick={() => onSelect(project.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              project.id === selectedId
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            }`}
          >
            <div className="font-medium">{project.name}</div>
            <div
              className={`text-xs ${
                project.id === selectedId ? "opacity-80" : "text-neutral-400 dark:text-neutral-600"
              }`}
            >
              {new Date(project.createdAt).toLocaleString()}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
