import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { getProjectRoot } from "./paths";
import { trackEvent } from "../analytics/trackEvent";

export type PreviewStatus = "installing" | "starting" | "ready" | "error";

export interface PreviewState {
  status: PreviewStatus;
  url?: string;
  error?: string;
}

interface InternalPreviewState extends PreviewState {
  port?: number;
  child?: ChildProcess;
}

// In-memory only: previews are local-dev-only child processes tied to this
// server process's lifetime. Lost on server restart by design (documented
// limitation) - no persistence or process supervision is attempted here.
const registry = new Map<string, InternalPreviewState>();

function toPublicState(state: InternalPreviewState): PreviewState {
  return { status: state.status, url: state.url, error: state.error };
}

export function getPreviewStatus(id: string): PreviewState | null {
  const state = registry.get(id);
  return state ? toPublicState(state) : null;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

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

async function waitUntilResponding(port: number, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch {
      // server not accepting connections yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out waiting for the preview server to start");
}

async function runPreviewLifecycle(
  id: string,
  projectRoot: string,
  state: InternalPreviewState,
  userId: string,
) {
  const requestedAt = Date.now();
  try {
    const nodeModulesPath = path.join(projectRoot, "node_modules");
    const hasNodeModules = await fs
      .access(nodeModulesPath)
      .then(() => true)
      .catch(() => false);

    if (!hasNodeModules) {
      state.status = "installing";
      await runToCompletion("npm", ["install", "--no-audit", "--no-fund"], projectRoot);
    }

    state.status = "starting";
    const port = await findFreePort();
    const child = spawn("npx", ["next", "dev", "-p", String(port)], {
      cwd: projectRoot,
      stdio: "ignore",
    });
    state.child = child;
    state.port = port;

    child.on("exit", () => {
      if (registry.get(id) === state) registry.delete(id);
    });

    await waitUntilResponding(port);

    state.status = "ready";
    state.url = `http://localhost:${port}`;
    trackEvent("preview_started", {
      userId,
      orgId: null,
      projectId: id,
      durationToStartSeconds: (Date.now() - requestedAt) / 1000,
    });
  } catch (err) {
    state.status = "error";
    state.error = err instanceof Error ? err.message : "Failed to start the preview server.";
    state.child?.kill();
    registry.delete(id);
  }
}

/**
 * Idempotently starts (or reports the status of) a project's local preview
 * server. Returns immediately with the current status snapshot - the
 * install/start work continues in the background, and callers should poll
 * getPreviewStatus() until status is "ready" or "error".
 */
export function ensurePreviewStarted(id: string, userId: string): PreviewState {
  const existing = registry.get(id);
  if (existing) return toPublicState(existing);

  const projectRoot = getProjectRoot(id); // validates id, throws WorkspacePathError if invalid

  const state: InternalPreviewState = { status: "installing" };
  registry.set(id, state);
  void runPreviewLifecycle(id, projectRoot, state, userId);

  return toPublicState(state);
}

function killAllPreviews() {
  for (const state of registry.values()) {
    state.child?.kill();
  }
}

process.once("exit", killAllPreviews);
process.once("SIGINT", killAllPreviews);
process.once("SIGTERM", killAllPreviews);
