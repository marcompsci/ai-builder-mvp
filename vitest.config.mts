import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests that spawn real child processes (git, npm) are unreliable under
    // the default worker_threads pool - use process forks instead.
    pool: "forks",
  },
});
