import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/**
 * Storage root for the JSON data files.
 *
 * The launcher process owns the platform-specific path logic (see
 * `launcher/src/server-manager.ts`) and passes the resolved directory
 * through the `NEXUS_DATA_DIR` env var when it spawns the Next.js
 * server. Standalone `npm run dev` (no launcher) leaves the env var
 * unset and the fallback `./.nexus-data` is used — that directory is
 * gitignored and stays out of `%APPDATA%` so dev state never pollutes
 * the installed launcher's data.
 *
 * Keeping `homedir()` / platform detection out of this module is what
 * lets Turbopack's static analyzer trace the route bundles without
 * pulling in the whole project as a "could be anywhere" precaution.
 */
export const DATA_DIR = process.env.NEXUS_DATA_DIR || ".nexus-data";

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Read a JSON file from the data dir. Returns the fallback when the file
 * doesn't exist or is unreadable / corrupt. On a parse error the bad
 * file is renamed to `<name>.bad-<ts>` before the fallback is returned,
 * so a single corrupted byte never silently nukes the user's data —
 * they can rescue it manually if they care.
 */
export function readJson<T>(name: string, fallback: T): T {
  ensureDir();
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) return fallback;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Quarantine the broken file so the user can inspect / recover it
    // instead of silently losing their prefs / overlays / etc.
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      renameSync(path, `${path}.bad-${ts}`);
    } catch {
      /* couldn't rename — best effort */
    }
    return fallback;
  }
}

/**
 * Atomic write: serialize → write to a sibling .tmp file → rename.
 * Prevents partial-file corruption if the process is killed mid-write.
 */
export function writeJson<T>(name: string, value: T): void {
  ensureDir();
  const path = join(DATA_DIR, name);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, path);
}
