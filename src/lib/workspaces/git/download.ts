import path from "node:path";
import { ZipArchive } from "archiver";
import { git } from "./client";

/**
 * Builds a ZIP of every git-tracked file (respects the project's own
 * .gitignore, so node_modules/.next/.git are never included). Never trusts
 * a client-supplied file list - the file set always comes from `git
 * ls-files` against the real, sandboxed workspace root.
 */
export async function buildProjectZip(workspaceRoot: string): Promise<Buffer> {
  const output = (await git(workspaceRoot, ["ls-files"])).split("\n").filter(Boolean);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  for (const relativePath of output) {
    archive.file(path.join(workspaceRoot, relativePath), { name: relativePath });
  }
  await archive.finalize();
  await done;

  return Buffer.concat(chunks);
}
