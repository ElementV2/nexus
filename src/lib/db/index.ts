import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Resolve the directory where the JSON data store lives. Matches the
 * launcher convention so both code paths share the same files when
 * Next.js is hosted inside the Electron launcher.
 */
function getDataDir(): string {
  if (process.env.NEXUS_DATA_DIR) return process.env.NEXUS_DATA_DIR;
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Nexus");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Nexus");
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "nexus");
}

export const DATA_DIR = getDataDir();

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
