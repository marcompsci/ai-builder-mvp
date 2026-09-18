import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmpRoot: string;
let outsideDir: string;
let projectRoot: string;
let fsTree: typeof import("@/lib/workspaces/fsTree");
let paths: typeof import("@/lib/workspaces/paths");

const PROJECT_ID = "prj_bbbbbbbb-test-project";

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspaces-fileaccess-"));
  process.env.WORKSPACES_ROOT = tmpRoot;
  fsTree = await import("@/lib/workspaces/fsTree");
  paths = await import("@/lib/workspaces/paths");

  projectRoot = paths.getProjectRoot(PROJECT_ID);
  await fs.mkdir(path.join(projectRoot, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "node_modules", "some-pkg"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "weird-dir.ts"), { recursive: true });

  await fs.writeFile(path.join(projectRoot, "src", "app", "page.tsx"), "export default function Page() {}\n");
  await fs.writeFile(path.join(projectRoot, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(projectRoot, ".env"), "SECRET=should-never-be-readable\n");
  await fs.writeFile(path.join(projectRoot, "node_modules", "some-pkg", "index.js"), "module.exports = {};\n");

  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "fileaccess-outside-"));
  await fs.writeFile(path.join(outsideDir, "secret.ts"), "export const secret = true;\n");
  await fs.symlink(path.join(outsideDir, "secret.ts"), path.join(projectRoot, "escape.ts"));
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

describe("buildFileTree", () => {
  it("lists readable files and directories", async () => {
    const tree = await fsTree.buildFileTree(PROJECT_ID);
    const names = tree.map((n) => n.name);
    expect(names).toContain("src");
    expect(names).toContain("image.png");
  });

  it("excludes node_modules entirely", async () => {
    const tree = await fsTree.buildFileTree(PROJECT_ID);
    const names = tree.map((n) => n.name);
    expect(names).not.toContain("node_modules");
  });

  it("excludes dotfiles like .env", async () => {
    const tree = await fsTree.buildFileTree(PROJECT_ID);
    const names = tree.map((n) => n.name);
    expect(names).not.toContain(".env");
  });

  it("excludes symlinked entries", async () => {
    const tree = await fsTree.buildFileTree(PROJECT_ID);
    const names = tree.map((n) => n.name);
    expect(names).not.toContain("escape.ts");
  });

  it("nests children under directories", async () => {
    const tree = await fsTree.buildFileTree(PROJECT_ID);
    const src = tree.find((n) => n.name === "src");
    expect(src?.type).toBe("directory");
    expect(src?.children?.[0].name).toBe("app");
    expect(src?.children?.[0].children?.[0].name).toBe("page.tsx");
  });

  it("throws WorkspaceNotFoundError for a project that doesn't exist", async () => {
    await expect(fsTree.buildFileTree("prj_cccccccc-nope")).rejects.toThrow(
      paths.WorkspaceNotFoundError,
    );
  });
});

describe("readWorkspaceFile (authorization)", () => {
  it("reads an allowlisted source file", async () => {
    const file = await fsTree.readWorkspaceFile(PROJECT_ID, "src/app/page.tsx");
    expect(file.content).toContain("export default function Page");
  });

  it("rejects a disallowed file extension", async () => {
    await expect(fsTree.readWorkspaceFile(PROJECT_ID, "image.png")).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects reading a dotfile like .env even with no extension check bypass", async () => {
    await expect(fsTree.readWorkspaceFile(PROJECT_ID, ".env")).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects reading a nonexistent file", async () => {
    await expect(fsTree.readWorkspaceFile(PROJECT_ID, "src/app/missing.tsx")).rejects.toThrow(
      paths.WorkspaceNotFoundError,
    );
  });

  it("rejects reading a path that is actually a directory", async () => {
    await expect(fsTree.readWorkspaceFile(PROJECT_ID, "weird-dir.ts")).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects reading a symlink that escapes the sandbox, even with an allowed extension", async () => {
    await expect(fsTree.readWorkspaceFile(PROJECT_ID, "escape.ts")).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });

  it("rejects path traversal attempts", async () => {
    await expect(
      fsTree.readWorkspaceFile(PROJECT_ID, "../../../../etc/passwd"),
    ).rejects.toThrow(paths.WorkspacePathError);
  });

  it("rejects an invalid project id", async () => {
    await expect(fsTree.readWorkspaceFile("../not-a-project", "src/app/page.tsx")).rejects.toThrow(
      paths.WorkspacePathError,
    );
  });
});
