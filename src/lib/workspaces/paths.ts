import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACES_ROOT } from "./config";
import { isValidProjectId } from "./sanitize";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNotFoundError";
  }
}

/**
 * Resolves a project's sandbox root directory from its id. Throws unless the
 * id matches the strict project-id grammar AND the resulting path is a
 * direct child of WORKSPACES_ROOT - never trust the id string alone.
 */
export function getProjectRoot(id: string): string {
  if (!isValidProjectId(id)) {
    throw new WorkspacePathError("Invalid project id");
  }
  const root = path.resolve(WORKSPACES_ROOT, id);
  if (path.dirname(root) !== WORKSPACES_ROOT) {
    throw new WorkspacePathError("Invalid project id");
  }
  return root;
}

/**
 * Resolves a client-supplied relative path against a project's sandbox root
 * using purely lexical checks (no filesystem access). Rejects absolute
 * paths, null bytes, and any traversal that would escape the root.
 *
 * This is intentionally synchronous and side-effect free so it can be
 * exhaustively unit tested without touching the real filesystem. It is the
 * first line of defense; assertRealPathWithinRoot() is the second, applied
 * right before any actual file read.
 */
export function resolveRelativePath(projectRoot: string, relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new WorkspacePathError("Path is required");
  }
  if (relativePath.includes("\0")) {
    throw new WorkspacePathError("Invalid path");
  }
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new WorkspacePathError("Path must be relative");
  }

  const resolved = path.resolve(projectRoot, relativePath);
  const relativeToRoot = path.relative(projectRoot, resolved);

  const escapesRoot =
    relativeToRoot !== "" &&
    (relativeToRoot.startsWith(`..${path.sep}`) || relativeToRoot === ".." || path.isAbsolute(relativeToRoot));

  if (escapesRoot) {
    throw new WorkspacePathError("Path escapes the project workspace");
  }

  return resolved;
}

/**
 * Second line of defense: resolves symlinks for both the project root and
 * the target path and verifies the target's real location is still inside
 * the project's real root. Catches symlink escapes that pure lexical
 * resolution above cannot (a symlinked file or an intermediate symlinked
 * directory pointing outside the sandbox).
 *
 * Requires the target to exist on disk; throws WorkspaceNotFoundError if it
 * doesn't (callers should map that to a 404).
 */
export async function assertRealPathWithinRoot(projectRoot: string, targetPath: string): Promise<string> {
  let realRoot: string;
  let realTarget: string;
  try {
    [realRoot, realTarget] = await Promise.all([fs.realpath(projectRoot), fs.realpath(targetPath)]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkspaceNotFoundError("Path not found");
    }
    throw err;
  }

  if (realTarget !== realRoot) {
    const relative = path.relative(realRoot, realTarget);
    const escapes = relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative);
    if (escapes) {
      throw new WorkspacePathError("Path escapes the project workspace");
    }
  }

  return realTarget;
}

/**
 * Full validation pipeline used by every route that touches a workspace
 * file: validates the project id, resolves the relative path lexically,
 * then verifies the real (symlink-resolved) path is still inside the
 * project's real root.
 */
export async function resolveWorkspaceFilePath(id: string, relativePath: string): Promise<string> {
  const projectRoot = getProjectRoot(id);
  const lexicallyResolved = resolveRelativePath(projectRoot, relativePath);
  await assertRealPathWithinRoot(projectRoot, lexicallyResolved);
  return lexicallyResolved;
}

/**
 * Validation pipeline for a write target, which - unlike a read - may not
 * exist on disk yet (create vs. update). Lexically resolves the path, then:
 *  - if the target already exists, runs the same real-path symlink check as
 *    a read (it must not itself be a symlink escaping the root);
 *  - if it doesn't exist yet, walks up to the nearest existing ancestor
 *    directory and runs the real-path check on THAT instead, so an
 *    intermediate symlinked directory can't be used to create a file
 *    outside the sandbox.
 * Never creates any directory itself - the caller does that only after this
 * resolves successfully.
 */
export async function resolveWorkspaceWritePath(id: string, relativePath: string): Promise<string> {
  const projectRoot = getProjectRoot(id);
  const lexicallyResolved = resolveRelativePath(projectRoot, relativePath);

  try {
    const stat = await fs.lstat(lexicallyResolved);
    if (stat.isDirectory()) {
      throw new WorkspacePathError("Cannot write: path is a directory");
    }
    // Exists as a file (or symlink) - verify it doesn't escape via realpath.
    await assertRealPathWithinRoot(projectRoot, lexicallyResolved);
    return lexicallyResolved;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Doesn't exist yet - validate the nearest existing ancestor directory.
  let ancestor = path.dirname(lexicallyResolved);
  while (true) {
    try {
      await assertRealPathWithinRoot(projectRoot, ancestor);
      break;
    } catch (err) {
      if (!(err instanceof WorkspaceNotFoundError)) throw err;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      // Reached filesystem root without finding an existing ancestor inside
      // projectRoot - projectRoot itself doesn't exist, which shouldn't
      // happen for a real project, but fail closed rather than proceed.
      throw new WorkspaceNotFoundError("Project workspace not found");
    }
    ancestor = parent;
  }

  return lexicallyResolved;
}
