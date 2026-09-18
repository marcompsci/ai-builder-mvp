import { spawn } from "node:child_process";
import { VALIDATION_COMMANDS } from "./policy";
import type { ValidationCommandResult } from "./runStore";

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_CHARS = 8000;

function runCommand(cwd: string, cmd: string, args: string[]): Promise<{ passed: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ passed: false, output: `${output}\n[timed out after ${COMMAND_TIMEOUT_MS / 1000}s]`.slice(-MAX_OUTPUT_CHARS) });
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ passed: false, output: `Failed to start: ${err.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ passed: code === 0, output: output.slice(-MAX_OUTPUT_CHARS) });
    });
  });
}

/** Runs the fixed validation commands in order, stopping at the first failure. Nothing here is agent- or user-chosen. */
export async function runValidation(workspaceRoot: string): Promise<ValidationCommandResult[]> {
  const results: ValidationCommandResult[] = [];
  for (const { label, cmd, args } of VALIDATION_COMMANDS) {
    const { passed, output } = await runCommand(workspaceRoot, cmd, args);
    results.push({ label, command: `${cmd} ${args.join(" ")}`, passed, output });
    if (!passed) break;
  }
  return results;
}
