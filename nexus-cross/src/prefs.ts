/**
 * Persisted settings for the satellite. Stored next to the launcher's
 * settings under the OS app-config dir so an operator who runs both on
 * the same box finds them in the expected place.
 *
 * Defaults: server URL is empty (the operator types the Nexus host in
 * the window), id is `<hostname>` (stable across restarts), label is
 * the hostname. Env vars seed the defaults so a headless/kiosk deploy
 * can pre-bake them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";

export interface CrossSettings {
  /** Base URL of the Nexus server, e.g. `http://10.0.0.10:9088`. */
  serverUrl: string;
  /** Stable satellite id sent in announce + SSE query. */
  id: string;
  /** Friendly label shown in the Nexus UI. */
  label: string;
  /** Start hidden to the tray. */
  startMinimized: boolean;
}

/** Runtime config the agent consumes (settings + fixed reconnect bounds). */
export interface SatelliteConfig {
  serverUrl: string;
  id: string;
  label: string;
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

function defaults(): CrossSettings {
  const host = hostname() || "satellite";
  return {
    serverUrl: process.env.NEXUS_SERVER ?? "",
    id: process.env.NEXUS_ID ?? host,
    label: process.env.NEXUS_LABEL ?? host,
    startMinimized: false,
  };
}

export function settingsPath(): string {
  let base: string;
  if (platform() === "win32") {
    base = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(base, "Nexus Cross", "settings.json");
  }
  if (platform() === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Nexus Cross",
      "settings.json"
    );
  }
  base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "nexus-cross", "settings.json");
}

export function loadSettings(): CrossSettings {
  try {
    const p = settingsPath();
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      return { ...defaults(), ...raw };
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults();
}

/**
 * Normalise a user-typed server address into a full base URL.
 * Operators usually type just an IP (e.g. `192.168.1.17`) — but without
 * a scheme `undici` can't build a request URL (announce/SSE throw
 * "Invalid URL"), and without a port it never reaches the Nexus server,
 * which listens on 9088 by default. So we:
 *   • prepend `http://` when no scheme is present,
 *   • append `:9088` when no explicit port is given (anyone fronting
 *     Nexus on 80/443 behind a proxy can type the full URL themselves),
 *   • reduce to the bare origin (drop path/query/trailing slash).
 * Empty input stays empty → HID-only mode, the window prompts for a URL.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const u = new URL(withScheme);
    // Default to Nexus's port only when the operator gave no explicit
    // one. `new URL` strips default ports (80/443) from `u.port`, so we
    // detect an explicit port from the raw authority instead — otherwise
    // someone fronting Nexus on `https://host:443` would get silently
    // rewritten to `:9088` and never reach their proxy.
    const authority = withScheme.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
    if (!/:\d+$/.test(authority)) u.port = "9088";
    return u.origin;
  } catch {
    return withScheme;
  }
}

export function saveSettings(partial: Partial<CrossSettings>): CrossSettings {
  const next = { ...loadSettings(), ...partial };
  // Normalise the server URL: add scheme/port, reduce to bare origin.
  next.serverUrl = normalizeServerUrl(next.serverUrl);
  try {
    const p = settingsPath();
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  } catch {
    /* best-effort */
  }
  return next;
}

/** Build the agent runtime config from persisted settings. */
export function toSatelliteConfig(s: CrossSettings): SatelliteConfig {
  return {
    serverUrl: normalizeServerUrl(s.serverUrl),
    id: s.id,
    label: s.label,
    reconnectMinMs: 1_000,
    reconnectMaxMs: 30_000,
  };
}
