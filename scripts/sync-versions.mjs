#!/usr/bin/env node
/**
 * Version policy:
 *   • The web app (root) and the launcher ship together inside one
 *     installer (Nexus-Setup-*.exe), so they share ONE "main app" version.
 *     The launcher is the source of truth — it drives the release tag.
 *   • nexus-cross (the Stream Deck satellite, Nexus-Cross-Setup-*.exe) is
 *     versioned INDEPENDENTLY: bump it only when the satellite changes, so
 *     a main-app-only release never makes Cross users re-download. Each
 *     in-app updater compares against the version embedded in its OWN
 *     installer asset name, not the shared release tag.
 *
 * This script keeps each package.json in lockstep with its sibling
 * package-lock.json `version` (top-level + `packages[""]`) — `npm ci`
 * aborts on a mismatch, a recurring release-time foot-gun. It also keeps
 * root aligned to the launcher's main-app version.
 *
 * Usage:
 *   node scripts/sync-versions.mjs            # align root + lockfiles to current versions
 *   node scripts/sync-versions.mjs 0.2.0      # set the MAIN app (root + launcher) to 0.2.0
 *   node scripts/sync-versions.mjs --check    # verify consistency; exit 1 if not
 *
 * To bump the satellite: edit nexus-cross/package.json `version`, then run
 * this script (with no version arg) to align nexus-cross's lockfile.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// "main" units share the launcher's version; "solo" units own their version.
const MAIN_DIRS = ["launcher", "."]; // launcher first = source of truth
const SOLO_DIRS = ["nexus-cross"];
const NAMES = {
  ".": "web app (root)",
  launcher: "launcher",
  "nexus-cross": "nexus-cross",
};

const args = process.argv.slice(2);
const checkMode = args.includes("--check");
const explicit = args.find((a) => !a.startsWith("--"));

const readJson = (p) => JSON.parse(readFileSync(p, "utf-8"));
const writeJson = (p, o) =>
  writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf-8");
const pkgPath = (d) => join(ROOT, d, "package.json");
const lockPath = (d) => join(ROOT, d, "package-lock.json");

// The main-app version: explicit arg, else the launcher's current version.
const mainVersion = explicit ?? readJson(pkgPath("launcher")).version;
if (!SEMVER.test(mainVersion)) {
  console.error(`✗ "${mainVersion}" is not a valid semver version.`);
  process.exit(1);
}

/** Lockfile drift problems for `dir`, expecting version `want`. */
function lockProblems(dir, want) {
  const out = [];
  let lock;
  try {
    lock = readJson(lockPath(dir));
  } catch {
    return out; // no lockfile is not this script's concern
  }
  if (lock.version && lock.version !== want) {
    out.push(
      `${NAMES[dir]} package-lock.json is ${lock.version}, expected ${want}`
    );
  }
  const inner = lock.packages?.[""]?.version;
  if (inner && inner !== want) {
    out.push(
      `${NAMES[dir]} package-lock.json packages[""] is ${inner}, expected ${want}`
    );
  }
  return out;
}

if (checkMode) {
  const problems = [];
  // Main units must all equal mainVersion (package.json + lockfile).
  for (const dir of MAIN_DIRS) {
    const v = readJson(pkgPath(dir)).version;
    if (v !== mainVersion) {
      problems.push(
        `${NAMES[dir]} package.json is ${v}, expected ${mainVersion} (main app)`
      );
    }
    problems.push(...lockProblems(dir, mainVersion));
  }
  // Solo units: only internal package.json <-> lockfile consistency.
  for (const dir of SOLO_DIRS) {
    const v = readJson(pkgPath(dir)).version;
    if (!SEMVER.test(v)) {
      problems.push(`${NAMES[dir]} package.json version "${v}" is not valid semver`);
    }
    problems.push(...lockProblems(dir, v));
  }
  if (problems.length) {
    console.error("✗ Version consistency problems:");
    for (const p of problems) console.error(`  • ${p}`);
    console.error(`\nRun "npm run version:sync" to fix.`);
    process.exit(1);
  }
  console.log(
    `✓ Main app in lockstep at ${mainVersion}; nexus-cross independent at ${readJson(pkgPath("nexus-cross")).version}.`
  );
  process.exit(0);
}

// Sync mode.
let changed = 0;
const apply = (dir, want) => {
  const pkg = readJson(pkgPath(dir));
  if (pkg.version !== want) {
    pkg.version = want;
    writeJson(pkgPath(dir), pkg);
    console.log(`• ${NAMES[dir]} package.json → ${want}`);
    changed++;
  }
  let lock;
  try {
    lock = readJson(lockPath(dir));
  } catch {
    return;
  }
  let lockChanged = false;
  if (lock.version !== want) {
    lock.version = want;
    lockChanged = true;
  }
  if (lock.packages?.[""] && lock.packages[""].version !== want) {
    lock.packages[""].version = want;
    lockChanged = true;
  }
  if (lockChanged) {
    writeJson(lockPath(dir), lock);
    console.log(`• ${NAMES[dir]} package-lock.json → ${want}`);
    changed++;
  }
};

for (const dir of MAIN_DIRS) apply(dir, mainVersion);
// Solo units keep their OWN package.json version; just align their lockfile.
for (const dir of SOLO_DIRS) apply(dir, readJson(pkgPath(dir)).version);

console.log(changed ? `✓ Synced ${changed} file(s).` : `✓ Already consistent.`);
