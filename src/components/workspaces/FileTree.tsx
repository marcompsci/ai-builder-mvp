"use client";

import { useState } from "react";
import type { FileTreeNode } from "@/lib/workspaces/fsTree";

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelectFile,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === "directory") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className="flex w-full items-center gap-1.5 rounded py-1 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
        >
          <span className="text-xs">{expanded ? "▾" : "▸"}</span>
          {node.name}
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = node.path === selectedPath;
  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
      className={`block w-full truncate rounded py-1 text-left text-sm ${
        isSelected
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
      }`}
    >
      {node.name}
    </button>
  );
}

export function FileTree({
  tree,
  selectedPath,
  onSelectFile,
}: {
  tree: FileTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  if (tree.length === 0) {
    return <p className="p-3 text-sm text-neutral-400 dark:text-neutral-600">No files found.</p>;
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}
