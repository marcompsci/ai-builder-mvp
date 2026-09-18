import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// WORKSPACES_ROOT is read from the environment at module-import time, so it
// must be set before the module under test is first imported. Using a
// dynamic import after stubbing the env var keeps this test file
// self-contained without needing a global setup file.
let tmpRoot: string;
let outsideDir: string;
let projectRoot: string;
let paths: typeof import("@/lib/workspaces/paths");

const VALID_ID = "prj_aaaaaaaa-test-project";

// Shared fixture, set up once: a real project directory with a nested file,
// and a symlink inside it pointing to a file outside the sandbox entirely.
// Kept alive for the whole file so describe blocks can run in any order.
beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspaces-test-"));
  process.env.WORKSPACES_ROOT = tmpRoot;
  paths = await import("@/lib/workspaces/paths");

  projectRoot = paths.getProjectRoot(VALID_ID);
  await fs.mkdir(path.join(projectRoot, "nested"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "nested", "file.txt"), "hello");

  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
  await fs.writeFile(path.join(outsideDir, "secret.txt"), "top secret");
  await fs.symlink(path.join(outsideDir, "secret.txt"), path.join(projectRoot, "escape-link.txt"));
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

describe("getProjectRoot", () => {
  it("resolves a valid id to a direct child of WORKSPACES_ROOT", () => {
    const root = paths.getProjectRoot(VALID_ID);
    expect(root).toBe(path.join(tmpRoot, VALID_ID));
  });

  it("rejects an id with path traversal", () => {
    expect(() => paths.getProjectRoot("../etc")).toThrow(paths.WorkspacePathError);
  });

  it("rejects an id that isn't a well-formed project id", () => {
    expect(() => paths.getProjectRoot("not-a-project-id")).toThrow(paths.WorkspacePathError);
  });

  it("rejects an id containing slashes even if the grammar-like prefix matches", () => {
    expect(() => paths.getProjectRoot(`${VALID_ID}/../../etc`)).toThrow(paths.WorkspacePathError);
  });
});

describe("resolveRelativePath (lexical only)", () => {
  const projectRoot = "/sandbox/prj_aaaaaaaa-test";

  it("resolves a simple nested path", () => {
    expect(paths.resolveRelativePath(projectRoot, "src/app/page.tsx")).toBe(
      path.join(projectRoot, "src/app/page.tsx"),
    );
  });

  it("allows a path that lexically stays inside despite internal '..'", () => {
    expect(paths.resolveRelativePath(projectRoot, "src/../src/app/page.tsx")).toBe(
      path.join(projectRoot, "src/app/page.tsx"),
    );
  });

  it("allows resolving to the root itself via '.'", () => {
    expect(paths.resolveRelativePath(projectRoot, ".")).toBe(projectRoot);
  });

  it("rejects simple traversal", () => {
    expect(() => paths.resolveRelativePath(projectRoot, "../../etc/passwd")).toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects traversal that nets outside even after internal segments", () => {
    expect(() => paths.resolveRelativePath(projectRoot, "src/../../outside")).toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects absolute POSIX paths", () => {
    expect(() => paths.resolveRelativePath(projectRoot, "/etc/passwd")).toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects Windows-style absolute paths", () => {
    expect(() => paths.resolveRelativePath(projectRoot, "C:\\Windows\\System32")).toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects null bytes", () => {
    expect(() => paths.resolveRelativePath(projectRoot, "file.txt\0.png")).toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects an empty path", () => {
    expect(() => paths.resolveRelativePath(projectRoot, "")).toThrow(paths.WorkspacePathError);
  });
});

describe("assertRealPathWithinRoot (filesystem + symlinks)", () => {
  it("resolves a real, existing file inside the sandbox", async () => {
    const target = path.join(projectRoot, "nested", "file.txt");
    const real = await paths.assertRealPathWithinRoot(projectRoot, target);
    expect(real).toBe(await fs.realpath(target));
  });

  it("throws WorkspaceNotFoundError for a nonexistent path", async () => {
    const target = path.join(projectRoot, "does-not-exist.txt");
    await expect(paths.assertRealPathWithinRoot(projectRoot, target)).rejects.toThrow(
      paths.WorkspaceNotFoundError,
    );
  });

  it("throws WorkspacePathError when a symlink escapes the sandbox", async () => {
    const target = path.join(projectRoot, "escape-link.txt");
    await expect(paths.assertRealPathWithinRoot(projectRoot, target)).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });
});

describe("resolveWorkspaceFilePath (full pipeline)", () => {
  const projectId = VALID_ID;

  it("resolves a valid nested file for a valid project", async () => {
    const resolved = await paths.resolveWorkspaceFilePath(projectId, "nested/file.txt");
    expect(resolved).toBe(path.join(paths.getProjectRoot(projectId), "nested/file.txt"));
  });

  it("rejects traversal attempts end-to-end", async () => {
    await expect(
      paths.resolveWorkspaceFilePath(projectId, "../../../etc/passwd"),
    ).rejects.toThrow(paths.WorkspacePathError);
  });

  it("rejects an invalid project id even with a benign path", async () => {
    await expect(paths.resolveWorkspaceFilePath("../not-a-project", "file.txt")).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects a symlink escape end-to-end", async () => {
    await expect(
      paths.resolveWorkspaceFilePath(projectId, "escape-link.txt"),
    ).rejects.toThrow(paths.WorkspacePathError);
  });
});
