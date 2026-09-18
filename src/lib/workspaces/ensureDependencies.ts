import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function runToCompletion(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(" ")}" exited with code ${code}`));
    });
  });
}

/** Installs dependencies if node_modules is missing. Used before both preview and validation, so lint/typecheck/build never fail purely for lack of install. */
export async function ensureDependenciesInstalled(workspaceRoot: string): Promise<void> {
  const nodeModulesPath = path.join(workspaceRoot, "node_modules");
  const hasNodeModules = await fs
    .access(nodeModulesPath)
    .then(() => true)
    .catch(() => false);
  if (!hasNodeModules) {
    await runToCompletion("npm", ["install", "--no-audit", "--no-fund"], workspaceRoot);
  }
}
