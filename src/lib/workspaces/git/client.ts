import { spawn } from "node:child_process";

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr?: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

interface RunOptions {
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Any substrings (e.g. a token embedded in a remote URL) to scrub from args/stderr before they ever reach an error message, log, or UI. */
  redactSecrets?: string[];
}

function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const secrets = opts.redactSecrets ?? [];
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: opts.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => reject(new GitError(`Failed to run git: ${redact(err.message, secrets)}`)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const safeArgs = args.map((a) => redact(a, secrets)).join(" ");
        reject(new GitError(`git ${safeArgs} failed (exit ${code})`, redact(stderr.trim(), secrets)));
      }
    });
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

/**
 * Runs a git command with an explicit cwd and argv array - never through a
 * shell, so there is no command string for user-controlled input (branch
 * names, messages, shas) to be injected into. Every call site passes cwd
 * explicitly; nothing relies on process.cwd(). Pass `redactSecrets` for any
 * call whose args might carry a credential (e.g. a push URL).
 */
export function git(cwd: string, args: string[], opts: { input?: string; redactSecrets?: string[] } = {}): Promise<string> {
  return run(cwd, args, opts);
}

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "AI Builder",
  GIT_AUTHOR_EMAIL: "ai-builder@local",
  GIT_COMMITTER_NAME: "AI Builder",
  GIT_COMMITTER_EMAIL: "ai-builder@local",
};

/** Same as git(), but sets a fixed local commit identity - never the host's global gitconfig. */
export function gitCommit(cwd: string, args: string[]): Promise<string> {
  return run(cwd, args, { env: { ...process.env, ...COMMIT_ENV } });
}

/**
 * Verifies `dir` is itself the top level of a git working tree (not a
 * subdirectory of some other repo, not a symlink detour) before any
 * operation that assumes that.
 */
export async function assertIsRepoRoot(dir: string): Promise<void> {
  let top: string;
  try {
    top = await git(dir, ["rev-parse", "--show-toplevel"]);
  } catch (err) {
    throw new GitError(`${dir} is not a git repository`, (err as GitError).stderr);
  }
  const fs = await import("node:fs/promises");
  const [realTop, realDir] = await Promise.all([fs.realpath(top), fs.realpath(dir)]);
  if (realTop !== realDir) {
    throw new GitError(`Refusing to operate: git root ${realTop} does not match expected ${realDir}`);
  }
}
