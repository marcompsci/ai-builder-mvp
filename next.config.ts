import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root explicitly - avoids Turbopack walking up to
  // unrelated lockfiles in parent directories (e.g. the home directory).
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
