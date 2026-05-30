#!/usr/bin/env node
/**
 * Shared by the launcher and nexus-cross builds. `npm run compile` runs
 * with the app directory as cwd, so we copy that app's static renderer
 * (src/renderer → build/renderer) — electron-builder only bundles build/.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const src = resolve(root, "src", "renderer");
const dst = resolve(root, "build", "renderer");

function copyTree(s, d) {
  mkdirSync(d, { recursive: true });
  for (const name of readdirSync(s)) {
    const sp = join(s, name);
    const dp = join(d, name);
    if (statSync(sp).isDirectory()) copyTree(sp, dp);
    else copyFileSync(sp, dp);
  }
}

copyTree(src, dst);
console.log(`Copied renderer assets to ${dst}`);
