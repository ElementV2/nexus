#!/usr/bin/env node
// Copies the launcher installer into the Next.js public/downloads so it
// can be shared via /downloads/Nexus-Setup.exe.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repoRoot = resolve(root, "..");

const distDir = resolve(root, "dist");
const setupFiles = readdirSync(distDir).filter((f) =>
  /^Nexus-Setup-.+\.exe$/.test(f)
);
if (setupFiles.length === 0) {
  console.error(
    `No installer found in ${distDir}. Run \`npm run package:win\` first.`
  );
  process.exit(1);
}
// Pick the most recently produced file
const src = join(distDir, setupFiles.sort().pop());
const dest = resolve(repoRoot, "public", "downloads", "Nexus-Setup.exe");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`Copied ${src}\n     → ${dest}`);
