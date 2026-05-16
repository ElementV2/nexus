#!/usr/bin/env node
// Remove any previously-built launcher binary from the web app's
// public/downloads/ so it doesn't get recursively bundled into the
// next build (Next would copy it into .next/standalone/public/).
import { readdirSync, unlinkSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const downloadsDir = join(repoRoot, "public", "downloads");

if (existsSync(downloadsDir)) {
  for (const f of readdirSync(downloadsDir)) {
    if (f.endsWith(".exe")) {
      unlinkSync(join(downloadsDir, f));
      console.log(`Removed ${join(downloadsDir, f)}`);
    }
  }
}
