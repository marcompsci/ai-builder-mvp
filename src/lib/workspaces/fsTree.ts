import { constants as fsConstants } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  EXCLUDED_DIR_NAMES,
  READABLE_EXTENSIONS,
  SENSITIVE_FILENAME_PATTERNS,
  WRITABLE_EXTENSIONS,
} from "./config";
import {
  getProjectRoot,
  resolveWorkspaceFilePath,
  resolveWorkspaceWritePath,
  WorkspaceNotFoundError,
  WorkspacePathError,
} from "./paths";

export interface FileTreeNode {
  name: string;
  path: string; // relative, POSIX-style, from the project root
  type: "file" | "directory";
  children?: FileTreeNode[];
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function isSensitiveName(name: string): boolean {
  return SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

async function walk(root: string, dir: string): Promise<FileTreeNode[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    // Never traverse symlinks, dotfiles/dotdirs, or excluded directories
    // (node_modules, .git, .next) when building the tree exposed to clients.
    if (entry.isSymbolicLink() || isHidden(entry.name)) continue;
    if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        children: await walk(root, fullPath),
      });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relPath, type: "file" });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function buildFileTree(id: string): Promise<FileTreeNode[]> {
  const root = getProjectRoot(id);
  try {
    await fsp.access(root);
  } catch {
    throw new WorkspaceNotFoundError("Project not found");
  }
  return walk(root, root);
}

export async function readWorkspaceFile(
  id: string,
  relativePath: string,
): Promise<{ path: string; content: string }> {
  const segments = relativePath.split(/[/\\]/);
  if (segments.some(isHidden)) {
    throw new WorkspacePathError("Cannot read hidden files");
  }
  if (segments.some(isSensitiveName)) {
    throw new WorkspacePathError("This file is not readable");
  }

  const ext = path.extname(relativePath).toLowerCase();
  if (!READABLE_EXTENSIONS.has(ext)) {
    throw new WorkspacePathError("File type is not readable");
  }

  const resolved = await resolveWorkspaceFilePath(id, relativePath);

  // Open with O_NOFOLLOW as a last-instant guard against a symlink being
  // swapped in between the validation above and the read (TOCTOU).
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new WorkspacePathError("Refusing to follow a symlink");
    if (code === "ENOENT") throw new WorkspaceNotFoundError("File not found");
    throw err;
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new WorkspacePathError("Not a file");
    }
    const content = await handle.readFile("utf8");
    return { path: relativePath, content };
  } finally {
    await handle.close();
  }
}

/**
 * Creates or overwrites a single text file inside a project workspace.
 * Caller is responsible for size-limit enforcement (this function has no
 * opinion on size - see the MCP layer, which applies MCP_MAX_WRITE_BYTES
 * before calling this).
 */
export async function writeWorkspaceFile(id: string, relativePath: string, content: string): Promise<{ path: string; bytesWritten: number }> {
  const segments = relativePath.split(/[/\\]/);
  if (segments.some(isHidden)) {
    throw new WorkspacePathError("Cannot write hidden files");
  }
  if (segments.some(isSensitiveName)) {
    throw new WorkspacePathError("This file is not writable");
  }

  const ext = path.extname(relativePath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    throw new WorkspacePathError("File type is not writable");
  }

  const resolved = await resolveWorkspaceWritePath(id, relativePath);
  await fsp.mkdir(path.dirname(resolved), { recursive: true });

  const buffer = Buffer.from(content, "utf8");

  // O_NOFOLLOW: refuse to write through a symlink even if one was swapped
  // in between validation and this open (TOCTOU). O_CREAT|O_TRUNC: create
  // if missing, replace contents if present - never appends.
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(
      resolved,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
      0o644,
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new WorkspacePathError("Refusing to follow a symlink");
    throw err;
  }

  try {
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }

  return { path: relativePath, bytesWritten: buffer.byteLength };
}

function flattenFiles(nodes: FileTreeNode[]): string[] {
  const files: string[] = [];
  for (const node of nodes) {
    if (node.type === "file") files.push(node.path);
    else if (node.children) files.push(...flattenFiles(node.children));
  }
  return files;
}

export interface SearchMatch {
  path: string;
  line: number;
  snippet: string;
}

/**
 * Plain, case-insensitive substring search across readable, non-sensitive
 * files in a workspace. Never uses the query as a regex (a malicious/odd
 * query string can't cause catastrophic backtracking); files over
 * maxFileBytes are skipped rather than partially scanned.
 */
export async function searchWorkspaceFiles(
  id: string,
  query: string,
  maxResults: number,
  maxFileBytes: number,
): Promise<SearchMatch[]> {
  const tree = await buildFileTree(id);
  const candidates = flattenFiles(tree).filter((relPath) => {
    const segments = relPath.split("/");
    if (segments.some(isSensitiveName)) return false;
    return READABLE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
  });

  const needle = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const relPath of candidates) {
    if (matches.length >= maxResults) break;
    let file: { path: string; content: string };
    try {
      file = await readWorkspaceFile(id, relPath);
    } catch {
      continue; // skip anything that fails to read cleanly (e.g. size/symlink edge case)
    }
    if (Buffer.byteLength(file.content, "utf8") > maxFileBytes) continue;

    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({ path: relPath, line: i + 1, snippet: lines[i].trim().slice(0, 200) });
      }
    }
  }

  return matches;
}
