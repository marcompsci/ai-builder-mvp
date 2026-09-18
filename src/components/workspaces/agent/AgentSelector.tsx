"use client";

import { useEffect, useState } from "react";

interface ProviderAvailability {
  provider: "claude-code" | "codex";
  label: string;
  description: string;
  available: boolean;
  reason?: string;
}

export function AgentSelector({
  value,
  onChange,
  disabled,
}: {
  value: "claude-code" | "codex";
  onChange: (provider: "claude-code" | "codex") => void;
  disabled?: boolean;
}) {
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => setProviders(data.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Agent</span>
      <div className="grid grid-cols-2 gap-2">
        {providers.map((p) => {
          const isSelected = p.provider === value;
          return (
            <button
              key={p.provider}
              type="button"
              disabled={disabled || !p.available}
              onClick={() => onChange(p.provider)}
              aria-pressed={isSelected}
              title={p.available ? undefined : p.reason}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isSelected
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:border-neutral-600"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                {!p.available && (
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    unavailable
                  </span>
                )}
              </div>
              <div className={`mt-0.5 text-xs ${isSelected ? "opacity-80" : "text-neutral-500 dark:text-neutral-400"}`}>
                {p.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
