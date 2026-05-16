import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Shared preferences file: both this launcher and the Next.js server
 * read/write the same JSON. The server (running as a child process)
 * inherits NEXUS_DATA_DIR so they target the same location.
 *
 * IMPORTANT: this type must stay aligned with `AppPreferences` in
 * `src/lib/db/preferences.ts`. The launcher currently only edits a
 * subset (port + srt_port), but the runtime load/save pattern below
 * preserves every key it finds in the file. Keeping the type
 * complete prevents a future launcher edit from accidentally
 * stripping fields the web UI relies on (Ableton config, MRU host
 * lists, etc.).
 */
export interface VmixPrefs {
  vmix_host: string;
  vmix_port: number;
  vmix_srt_port: number;
  polling_interval: number;
  ableton_host: string;
  ableton_send_port: number;
  ableton_recv_port: number;
  vmix_recent_hosts: string[];
  ableton_recent_hosts: string[];
}

const DEFAULTS: VmixPrefs = {
  vmix_host: "localhost",
  vmix_port: 8088,
  vmix_srt_port: 5000,
  polling_interval: 150,
  ableton_host: "127.0.0.1",
  ableton_send_port: 11000,
  ableton_recv_port: 11001,
  vmix_recent_hosts: [],
  ableton_recent_hosts: [],
};

export function getDataDir(): string {
  if (process.env.NEXUS_DATA_DIR) return process.env.NEXUS_DATA_DIR;
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Nexus");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Nexus");
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "nexus"
  );
}

function prefsPath(): string {
  return join(getDataDir(), "preferences.json");
}

export function loadVmixPrefs(): VmixPrefs {
  const path = prefsPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<VmixPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveVmixPrefs(partial: Partial<VmixPrefs>): VmixPrefs {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next = { ...loadVmixPrefs(), ...partial };
  const path = prefsPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
  renameSync(tmp, path);
  return next;
}
