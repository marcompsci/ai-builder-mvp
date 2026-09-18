"use client";

import { useState } from "react";
import { StyleSelector } from "@/components/StyleSelector";
import type { Style } from "@/lib/schema";

export function PromptPanel({
  onGenerate,
  isGenerating,
}: {
  onGenerate: (prompt: string, style: Style) => void;
  isGenerating: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("minimal");

  const canSubmit = prompt.trim().length > 0 && !isGenerating;

  return (
    <form
      className="flex h-full flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onGenerate(prompt.trim(), style);
      }}
    >
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Describe your website
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Tell us what you&apos;re building and pick a visual style.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <label htmlFor="prompt" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          What do you want to create?
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A landing page for a specialty coffee subscription box aimed at home baristas"
          maxLength={2000}
          disabled={isGenerating}
          className="min-h-32 flex-1 resize-none rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-600"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Style</span>
        <StyleSelector value={style} onChange={setStyle} disabled={isGenerating} />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {isGenerating ? "Generating…" : "Generate Website"}
      </button>
    </form>
  );
}
