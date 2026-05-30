#!/usr/bin/env node
/**
 * Keep the version in lockstep across the three packages that ship as one
 * release: the web app (root), the launcher, and the Stream Deck satellite
 * (nexus-cross). The launcher version is the source of truth — it drives
 * the release tag in .github/workflows/release.yml.
 *
 * Crucially this also rewrites each package-lock.json `version` (top-level
 * and `packages[""]`), because `npm ci` aborts when the lockfile version
 * disagrees with package.json — a recurring release-time foot-gun.
 *
 * Usage:
 *   node scripts/sync-versions.mjs            # sync everything to launcher's version
 *   node scripts/sync-versions.mjs 0.2.0      # set launcher (+ all) to 0.2.0
 *   node scripts/sync-versions.mjs --check    # verify all in sync; exit 1 if not
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each unit: a package.json and its sibling lockfile. */
const UNITS = [
  { name: "web app (root)", dir: "." },
  { name: "launcher", dir: "launcher" },
  { name: "nexus-cross", dir: "nexus-cross" },
];
const SOURCE = "launcher"; // canonical version owner

const args = process.argv.slice(2);
const checkMode = args.includes("--check");
const explicit = args.find((a) => !a.startsWith("--"));

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, obj) {
  // Preserve the trailing newline npm writes so diffs stay minimal.
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function pkgPath(dir) {
  return join(ROOT, dir, "package.json");
}
function lockPath(dir) {
  return join(ROOT, dir, "package-lock.json");
}

// Determine the target version.
let target = explicit;
if (!target) {
  const src = UNITS.find((u) => u.dir === SOURCE);
  target = readJson(pkgPath(src.dir)).version;
}
if (!SEMVER.test(target)) {
  console.error(`✗ "${target}" is not a valid semver version.`);
  process.exit(1);
}

if (checkMode) {
  const mismatches = [];
  for (const u of UNITS) {
    const pkgV = readJson(pkgPath(u.dir)).version;
    if (pkgV !== target) {
      mismatches.push(`${u.name} package.json is ${pkgV}, expected ${target}`);
    }
    let lock;
    try {
      lock = readJson(lockPath(u.dir));
    } catch {
      continue; // a missing lockfile is not this script's concern
    }
    if (lock.version && lock.version !== target) {
      mismatches.push(
        `${u.name} package-lock.json is ${lock.version}, expected ${target}`
      );
    }
    const inner = lock.packages?.[""]?.version;
    if (inner && inner !== target) {
      mismatches.push(
        `${u.name} package-lock.json packages[""] is ${inner}, expected ${target}`
      );
    }
  }
  if (mismatches.length) {
    console.error("✗ Versions are out of sync:");
    for (const m of mismatches) console.error(`  • ${m}`);
    console.error(
      `\nRun "npm run version:sync" to align everything to ${target}.`
    );
    process.exit(1);
  }
  console.log(`✓ All packages are in sync at ${target}.`);
  process.exit(0);
}

// Sync mode: write the target version everywhere.
let changed = 0;
for (const u of UNITS) {
  const pkg = readJson(pkgPath(u.dir));
  if (pkg.version !== target) {
    pkg.version = target;
    writeJson(pkgPath(u.dir), pkg);
    console.log(`• ${u.name} package.json → ${target}`);
    changed++;
  }
  let lock;
  try {
    lock = readJson(lockPath(u.dir));
  } catch {
    continue;
  }
  let lockChanged = false;
  if (lock.version !== target) {
    lock.version = target;
    lockChanged = true;
  }
  if (lock.packages?.[""] && lock.packages[""].version !== target) {
    lock.packages[""].version = target;
    lockChanged = true;
  }
  if (lockChanged) {
    writeJson(lockPath(u.dir), lock);
    console.log(`• ${u.name} package-lock.json → ${target}`);
    changed++;
  }
}
console.log(
  changed
    ? `✓ Synced ${changed} file(s) to ${target}.`
    : `✓ Already in sync at ${target}.`
);
