import { readJson, writeJson } from "./index";
import {
  VMIX_DEFAULT_PORT,
  POLLING_INTERVAL_MS,
} from "@/lib/vmix/constants";

export interface AppPreferences {
  /** vMix HTTP API host (where vMix is running) */
  vmix_host: string;
  /** vMix HTTP API port (default 8088) */
  vmix_port: number;
  /** vMix SRT publisher port (default 5000) */
  vmix_srt_port: number;
  /** How often the UI polls the vMix XML state (ms) */
  polling_interval: number;
  /** Optional shared PIN — not enforced yet */
  pin?: string;

  /** AbletonOSC host (the machine running Live + AbletonOSC) */
  ableton_host: string;
  /** Port AbletonOSC listens on (default 11000) */
  ableton_send_port: number;
  /** Port AbletonOSC replies to (default 11001) */
  ableton_recv_port: number;

  /** Recent vMix hosts the user has connected to, MRU order, cap 6. */
  vmix_recent_hosts: string[];
  /** Recent Ableton hosts the user has connected to, MRU order, cap 6. */
  ableton_recent_hosts: string[];
}

const FILE = "preferences.json";
const RECENT_CAP = 6;

export const DEFAULT_PREFERENCES: AppPreferences = {
  vmix_host: "localhost",
  vmix_port: VMIX_DEFAULT_PORT,
  vmix_srt_port: 5000,
  polling_interval: POLLING_INTERVAL_MS,
  ableton_host: "127.0.0.1",
  ableton_send_port: 11000,
  ableton_recv_port: 11001,
  vmix_recent_hosts: [],
  ableton_recent_hosts: [],
};

export function getPreferences(): AppPreferences {
  const merged = {
    ...DEFAULT_PREFERENCES,
    ...readJson<Partial<AppPreferences>>(FILE, {}),
  };
  // A hand-edited or partially-corrupted prefs file could leave
  // `*_recent_hosts` as a non-array (null, string, object). Anything
  // downstream that calls `.filter` / `.map` on it would crash. Coerce
  // back to a clean array of strings.
  merged.vmix_recent_hosts = sanitizeHostList(merged.vmix_recent_hosts);
  merged.ableton_recent_hosts = sanitizeHostList(merged.ableton_recent_hosts);
  return merged;
}

function sanitizeHostList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Prepend a host to the MRU list, deduping (case-insensitive) and
 * capping length. Returns the new list. No-op for empty / falsy hosts.
 */
function bumpRecent(list: string[], host: string | undefined): string[] {
  const trimmed = host?.trim();
  if (!trimmed) return list;
  const lower = trimmed.toLowerCase();
  const filtered = list.filter((h) => h.toLowerCase() !== lower);
  return [trimmed, ...filtered].slice(0, RECENT_CAP);
}

export function setPreferences(
  partial: Partial<AppPreferences>
): AppPreferences {
  const current = getPreferences();

  // Trim host strings before merging so a pasted "  10.0.0.5  " is
  // stored canonical and the MRU dedup (which is case-insensitive but
  // strict on whitespace) actually fires across consecutive saves.
  const cleaned: Partial<AppPreferences> = { ...partial };
  if (typeof cleaned.vmix_host === "string") {
    cleaned.vmix_host = cleaned.vmix_host.trim();
  }
  if (typeof cleaned.ableton_host === "string") {
    cleaned.ableton_host = cleaned.ableton_host.trim();
  }

  const next: AppPreferences = { ...current, ...cleaned };

  // Auto-track recent hosts whenever the active host actually changes.
  // The UI never needs to manage the MRU list — it just edits the host
  // field and we record the history server-side.
  if (
    cleaned.vmix_host !== undefined &&
    cleaned.vmix_host !== current.vmix_host
  ) {
    next.vmix_recent_hosts = bumpRecent(
      current.vmix_recent_hosts ?? [],
      cleaned.vmix_host
    );
  }
  if (
    cleaned.ableton_host !== undefined &&
    cleaned.ableton_host !== current.ableton_host
  ) {
    next.ableton_recent_hosts = bumpRecent(
      current.ableton_recent_hosts ?? [],
      cleaned.ableton_host
    );
  }

  writeJson(FILE, next);
  return next;
}
