"use client";

import { useState } from "react";

export function CreateProjectDialog({
  onCreate,
}: {
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || status === "loading") return;

    setStatus("loading");
    setError(null);
    try {
      await onCreate(name.trim());
      setName("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor="project-name" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        New project name
      </label>
      <div className="flex gap-2">
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Coffee Shop"
          maxLength={60}
          disabled={status === "loading"}
          className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-600"
        />
        <button
          type="submit"
          disabled={!name.trim() || status === "loading"}
          className="whitespace-nowrap rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {status === "loading" ? "Creating…" : "Create Project"}
        </button>
      </div>
      {status === "error" && error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </form>
  );
}
