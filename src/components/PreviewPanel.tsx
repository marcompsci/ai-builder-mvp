import { GeneratedSitePreview } from "@/components/GeneratedSitePreview";
import type { GeneratedSite, Style } from "@/lib/schema";

export type GenerationStatus = "idle" | "loading" | "done" | "error";

export function PreviewPanel({
  status,
  site,
  style,
  errorMessage,
  onRetry,
}: {
  status: GenerationStatus;
  site: GeneratedSite | null;
  style: Style;
  errorMessage: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {status === "idle" && (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
            Your generated site will appear here
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-600">
            Describe your website and click Generate Website to get started.
          </p>
        </div>
      )}

      {status === "loading" && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
          <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
            Generating your site…
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Couldn&apos;t generate your site
          </p>
          <p className="max-w-sm text-xs text-neutral-500 dark:text-neutral-400">
            {errorMessage ?? "Something went wrong. Please try again."}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            Try again
          </button>
        </div>
      )}

      {status === "done" && site && <GeneratedSitePreview site={site} style={style} />}
    </div>
  );
}
