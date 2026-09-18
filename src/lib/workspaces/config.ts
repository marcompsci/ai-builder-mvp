import path from "node:path";

// The workspaces root is resolved once from server configuration at import
// time. It is never influenced by request data - every workspace path must
// resolve underneath this directory.
//
// turbopackIgnore: this is intentionally an env-configurable local dev path,
// not a build-time asset reference, so Turbopack's output-tracing heuristic
// for dynamic fs access doesn't apply.
export const WORKSPACES_ROOT = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.WORKSPACES_ROOT || "./data/workspaces",
);

export const STARTER_TEMPLATE_DIR = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  "templates/nextjs-starter/v1",
);

export const STARTER_TEMPLATE_VERSION = "v1";

// Files a client is allowed to read. Deliberately excludes dotfiles (.env*,
// .git*), lockfiles, and anything outside common source/text extensions.
export const READABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".md",
  ".mdx",
  ".txt",
  ".html",
  ".yml",
  ".yaml",
]);

// Files a client (or MCP tool) is allowed to create/modify. Identical to
// READABLE_EXTENSIONS today - kept as a separate export so the two can
// diverge later (e.g. a file type we want visible but never writable)
// without conflating the two concerns at every call site.
export const WRITABLE_EXTENSIONS = new Set(READABLE_EXTENSIONS);

// Directories never walked or exposed via the file tree / preview.
export const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", ".next"]);

// Filenames/patterns that are never readable or writable even if their
// extension would otherwise be allowed - defense in depth alongside the
// existing "no dotfiles" rule (env files, keys, and git/platform config are
// all dotfiles already, but this catches non-dotfile sensitive names too).
export const SENSITIVE_FILENAME_PATTERNS: RegExp[] = [
  /^\.env/i,
  /credentials/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /token/i,
  /secret/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
];

export const MCP_MAX_READ_BYTES = 256 * 1024;
export const MCP_MAX_WRITE_BYTES = 256 * 1024;
export const MCP_MAX_SEARCH_RESULTS = 50;
