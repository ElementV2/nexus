#!/usr/bin/env node
import { mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
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
