import type { CSSProperties } from "react";
import type { GeneratedSite, Style } from "@/lib/schema";

const STYLE_CHROME: Record<
  Style,
  { heading: string; button: string; card: string; section: string }
> = {
  minimal: {
    heading: "font-normal tracking-tight",
    button: "rounded-md",
    card: "rounded-md border",
    section: "py-16",
  },
  premium: {
    heading: "font-semibold tracking-tight",
    button: "rounded-sm",
    card: "rounded-sm border",
    section: "py-20",
  },
  playful: {
    heading: "font-bold tracking-tight",
    button: "rounded-full",
    card: "rounded-2xl shadow-md",
    section: "py-14",
  },
  bold: {
    heading: "font-black uppercase tracking-tight",
    button: "rounded-none",
    card: "rounded-none border-2",
    section: "py-16",
  },
};

export function GeneratedSitePreview({ site, style }: { site: GeneratedSite; style: Style }) {
  const chrome = STYLE_CHROME[style];
  const { colorPalette } = site;

  const vars = {
    "--gp-primary": colorPalette.primary,
    "--gp-secondary": colorPalette.secondary,
    "--gp-accent": colorPalette.accent,
    "--gp-background": colorPalette.background,
    "--gp-text": colorPalette.text,
  } as CSSProperties;

  return (
    <div
      style={vars}
      className="h-full w-full overflow-y-auto bg-[var(--gp-background)] text-[var(--gp-text)]"
    >
      <nav className="flex items-center justify-between border-b border-black/5 px-8 py-4">
        <span className={`text-lg ${chrome.heading}`}>Your Site</span>
        <span
          className={`px-4 py-1.5 text-xs font-medium text-white ${chrome.button}`}
          style={{ backgroundColor: "var(--gp-primary)" }}
        >
          {site.cta}
        </span>
      </nav>

      <header className={`px-8 text-center ${chrome.section}`}>
        <h1 className={`mx-auto max-w-2xl text-4xl ${chrome.heading}`}>{site.headline}</h1>
        <p className="mx-auto mt-4 max-w-xl text-base opacity-80">{site.subheadline}</p>
        <button
          type="button"
          className={`mt-8 px-6 py-3 text-sm font-medium text-white ${chrome.button}`}
          style={{ backgroundColor: "var(--gp-primary)" }}
        >
          {site.cta}
        </button>
      </header>

      <section className={`px-8 ${chrome.section}`} style={{ backgroundColor: "var(--gp-secondary)" }}>
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          {site.features.map((feature, i) => (
            <div
              key={i}
              className={`bg-white/90 p-5 text-neutral-900 ${chrome.card}`}
              style={{ borderColor: "var(--gp-accent)" }}
            >
              <h3 className="text-sm font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-neutral-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={`px-8 text-center ${chrome.section}`}>
        <blockquote className="mx-auto max-w-xl text-lg italic opacity-90">
          &ldquo;{site.testimonial.quote}&rdquo;
        </blockquote>
        <p className="mt-3 text-sm font-medium opacity-70">— {site.testimonial.author}</p>
      </section>

      <footer
        className="px-8 py-6 text-center text-xs opacity-70"
        style={{ backgroundColor: "var(--gp-accent)" }}
      >
        © {new Date().getFullYear()} Your Site. All rights reserved.
      </footer>
    </div>
  );
}
