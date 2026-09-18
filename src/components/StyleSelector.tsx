"use client";

import { STYLES, type Style } from "@/lib/schema";

const STYLE_LABELS: Record<Style, { label: string; hint: string }> = {
  minimal: { label: "Minimal", hint: "Clean, neutral, understated" },
  premium: { label: "Premium", hint: "Polished, confident, exclusive" },
  playful: { label: "Playful", hint: "Bright, friendly, energetic" },
  bold: { label: "Bold", hint: "High-contrast, loud, punchy" },
};

export function StyleSelector({
  value,
  onChange,
  disabled,
}: {
  value: Style;
  onChange: (style: Style) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {STYLES.map((style) => {
        const isSelected = style === value;
        return (
          <button
            key={style}
            type="button"
            disabled={disabled}
            onClick={() => onChange(style)}
            aria-pressed={isSelected}
            className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isSelected
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:border-neutral-600"
            }`}
          >
            <div className="text-sm font-medium">{STYLE_LABELS[style].label}</div>
            <div
              className={`mt-0.5 text-xs ${
                isSelected ? "opacity-80" : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {STYLE_LABELS[style].hint}
            </div>
          </button>
        );
      })}
    </div>
  );
}
