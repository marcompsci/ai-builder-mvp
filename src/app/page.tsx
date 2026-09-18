"use client";

import { useState } from "react";
import { PromptPanel } from "@/components/PromptPanel";
import { PreviewPanel, type GenerationStatus } from "@/components/PreviewPanel";
import type { GeneratedSite, Style } from "@/lib/schema";

export default function Home() {
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [site, setSite] = useState<GeneratedSite | null>(null);
  const [style, setStyle] = useState<Style>("minimal");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<{ prompt: string; style: Style } | null>(null);

  async function runGeneration(prompt: string, requestedStyle: Style) {
    setStatus("loading");
    setStyle(requestedStyle);
    setErrorMessage(null);
    setLastRequest({ prompt, style: requestedStyle });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style: requestedStyle }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setSite(data);
      setStatus("done");
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
      setStatus("error");
    }
  }

  function retry() {
    if (lastRequest) runGeneration(lastRequest.prompt, lastRequest.style);
  }

  return (
    <main className="mx-auto grid h-[calc(100vh-57px)] max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-[380px_1fr]">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
        <PromptPanel onGenerate={runGeneration} isGenerating={status === "loading"} />
      </div>
      <PreviewPanel
        status={status}
        site={site}
        style={style}
        errorMessage={errorMessage}
        onRetry={retry}
      />
    </main>
  );
}
