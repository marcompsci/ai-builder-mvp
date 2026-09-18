export function FileViewer({
  file,
}: {
  file: { path: string; content: string } | null;
}) {
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-neutral-400 dark:text-neutral-600">
          Select a file in the tree to view it (read-only).
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {file.path}
      </div>
      <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-neutral-800 dark:text-neutral-200">
        <code>{file.content}</code>
      </pre>
    </div>
  );
}
