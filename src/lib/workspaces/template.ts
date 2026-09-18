import fs from "node:fs/promises";
import { STARTER_TEMPLATE_DIR } from "./config";

// Copies the fixed, versioned starter template into a freshly created
// project directory. The template itself is a read-only source checked into
// this repo - it is never written to, and destination must not exist yet.
export async function copyStarterTemplate(destinationDir: string): Promise<void> {
  await fs.cp(STARTER_TEMPLATE_DIR, destinationDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
