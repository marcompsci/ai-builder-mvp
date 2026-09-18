import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildProjectZip } from "@/lib/workspaces/git/download";
import { git } from "@/lib/workspaces/git/client";

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zip-export-test-"));
  await git(tmpRoot, ["init", "--initial-branch=main"]);
  await git(tmpRoot, ["config", "user.name", "x"]);
  await git(tmpRoot, ["config", "user.email", "x@x"]);

  await fs.writeFile(path.join(tmpRoot, "tracked.txt"), "tracked content");
  await fs.writeFile(path.join(tmpRoot, ".gitignore"), "node_modules\n.next\nsecret.local\n");
  await fs.mkdir(path.join(tmpRoot, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, "node_modules", "pkg", "index.js"), "module.exports = {}");
  await fs.writeFile(path.join(tmpRoot, "secret.local"), "should never be zipped");

  await git(tmpRoot, ["add", "-A"]);
  await git(tmpRoot, ["commit", "-m", "init"]);
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function listZipEntries(buf: Buffer): string[] {
  // Minimal local-file-header scan - good enough to assert membership
  // without pulling in a zip-reading dependency just for tests.
  const names: string[] = [];
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) === 0x04034b50) {
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const name = buf.toString("utf8", offset + 30, offset + 30 + nameLen);
      names.push(name);
      offset += 30 + nameLen + extraLen;
    } else {
      offset++;
    }
  }
  return names;
}

describe("buildProjectZip", () => {
  it("includes only git-tracked files", async () => {
    const zip = await buildProjectZip(tmpRoot);
    const entries = listZipEntries(zip);
    expect(entries).toContain("tracked.txt");
    expect(entries).toContain(".gitignore");
  });

  it("excludes gitignored files (node_modules, secrets) even though they exist on disk", async () => {
    const zip = await buildProjectZip(tmpRoot);
    const entries = listZipEntries(zip);
    expect(entries.some((e) => e.includes("node_modules"))).toBe(false);
    expect(entries).not.toContain("secret.local");
  });

  it("produces a non-trivial, valid-looking zip buffer", async () => {
    const zip = await buildProjectZip(tmpRoot);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local file header signature
  });
});
