import { randomUUID } from "node:crypto";
import { readJson, writeJson, fileMtimeMs } from "./index";
import {
  VMIX_DEFAULT_PORT,
  POLLING_INTERVAL_MS,
} from "@/lib/vmix/constants";
import type { ConnectionConfig } from "@/lib/core/types";

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

  /** OBS WebSocket host (machine running OBS Studio + obs-websocket v5) */
  obs_host: string;
  /** OBS WebSocket port (default 4455) */
  obs_port: number;
  /** Optional OBS WebSocket password — empty string when auth is off */
  obs_password: string;

  /** Recent vMix hosts the user has connected to, MRU order, cap 6. */
  vmix_recent_hosts: string[];
  /** Recent Ableton hosts the user has connected to, MRU order, cap 6. */
  ableton_recent_hosts: string[];
  /** Recent OBS hosts the user has connected to, MRU order, cap 6. */
  obs_recent_hosts: string[];

  /**
   * Multi-instance connections registry. Source of truth for which
   * devices the manager spins up at boot. Auto-populated from the
   * legacy `*_host` / `*_port` / `*_password` keys when absent so
   * existing users see no disruption on first load post-upgrade.
   *
   * Each entry's `config` shape is opaque to this module — validated
   * per-kind at the registry layer. Keep legacy keys readable in
   * parallel: the broker for kind="vmix" still pulls from
   * `vmix_host`/`vmix_port` until vMix is migrated to the registry too.
   */
  connections: ConnectionConfig[];

  /**
   * Default connection per kind: `{ vmix: "<id>", ableton: "<id>" }`.
   *
   * Two roles:
   *   1. Surfaces (Stream Deck) that fire an action without pinning a
   *      connection use this kind's default instead of "first enabled".
   *   2. The legacy single-instance pages (live / playlist / title /
   *      colour) read the `*_host`/`*_port` fields — so whenever a
   *      default changes (or the default connection's config is
   *      edited) we mirror that connection's host/port back into the
   *      legacy fields. That makes "the default vMix" the one those
   *      pages drive, exactly like a multi-instance control surface.
   */
  defaultConnections: Record<string, string>;

  /**
   * One-time migration latch. The legacy auto-seed
   * (`synthesizeLegacyConnections`) only runs while this is false AND
   * the list is empty. The first connection write (add / edit /
   * delete / save) flips it true and persists it — so an operator who
   * deletes every connection actually ends up with NONE, instead of
   * vMix being recreated on the next read. The Deck page stays in the
   * sidebar regardless (it's a static entry) so shortcuts can be
   * prepared before any device is wired.
   */
  connectionsSeeded: boolean;
}

const FILE = "preferences.json";
const RECENT_CAP = 6;

/**
 * Sentinel returned in place of stored secrets so the real value never
 * leaves the server over the (plain-HTTP, LAN) API. The connections
 * editor round-trips it back verbatim when the operator didn't touch the
 * field; the write path (`restoreConfigSecrets`) swaps it back for the
 * persisted value. A genuinely new value the operator types is never
 * equal to the sentinel, so it passes through and replaces the secret.
 */
export const REDACTED_SECRET = "••••••••";

/** Config keys treated as secrets for redaction. Matches the per-kind
 *  config field names in use (`password` for OBS / grandMA2 telnet). */
const SECRET_KEY_RE = /password|secret|token/i;

/**
 * Replace non-empty secret-like string fields of a kind config blob with
 * the redaction sentinel. Empty secrets stay empty so the editor can
 * still tell "no password set" apart from "hidden". Returns a shallow
 * copy — never mutates the input.
 */
export function redactConfigSecrets(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  const out: Record<string, unknown> = {
    ...(config as Record<string, unknown>),
  };
  for (const k of Object.keys(out)) {
    if (SECRET_KEY_RE.test(k) && typeof out[k] === "string" && out[k]) {
      out[k] = REDACTED_SECRET;
    }
  }
  return out;
}

/**
 * Inverse of `redactConfigSecrets` for write paths: any secret field
 * still equal to the sentinel is restored from the previously-stored
 * config, so saving an unrelated field (host/port) never wipes the
 * password. A field holding any other value is a deliberate change and
 * passes through untouched.
 */
export function restoreConfigSecrets(
  incoming: unknown,
  existing: unknown
): unknown {
  if (!incoming || typeof incoming !== "object") return incoming;
  const out: Record<string, unknown> = {
    ...(incoming as Record<string, unknown>),
  };
  const ex = (
    existing && typeof existing === "object" ? existing : {}
  ) as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (SECRET_KEY_RE.test(k) && out[k] === REDACTED_SECRET) {
      out[k] = typeof ex[k] === "string" ? ex[k] : "";
    }
  }
  return out;
}

/**
 * Redact every secret a `getPreferences()` response would otherwise
 * leak: the legacy `obs_password` field and each connection's
 * per-instance config. Call ONLY on response boundaries — never before
 * persisting. Returns a copy.
 */
export function redactPreferences(prefs: AppPreferences): AppPreferences {
  return {
    ...prefs,
    obs_password: prefs.obs_password ? REDACTED_SECRET : "",
    connections: prefs.connections.map((c) => ({
      ...c,
      config: redactConfigSecrets(c.config),
    })),
  };
}

/**
 * Legacy flat preference key → per-kind connection-config key. The legacy
 * `vmix_host`/`obs_*`/`ableton_*` fields are a DERIVED mirror of each
 * kind's default connection (see `applyDefaultsToLegacy`); the connection
 * is the single source of truth. Editing a legacy field therefore has to
 * be translated into a connection-config edit (see `legacyConfigPatches`)
 * — writing the legacy field directly is a no-op because the next
 * `applyDefaultsToLegacy` re-mirrors the connection's current value over
 * it. This map is the one place that correspondence lives.
 */
const LEGACY_FIELD_MAP: Record<string, Record<string, string>> = {
  vmix: {
    vmix_host: "host",
    vmix_port: "port",
    vmix_srt_port: "srtPort",
    polling_interval: "pollingInterval",
  },
  obs: {
    obs_host: "host",
    obs_port: "port",
    obs_password: "password",
  },
  ableton: {
    ableton_host: "host",
    ableton_send_port: "sendPort",
    ableton_recv_port: "recvPort",
  },
};

/**
 * Extract, from a preferences PUT body, the per-kind config patches that
 * legacy device-field edits imply. Only keys actually present in the body
 * are included, so a `{ vmix_host }` edit yields `{ vmix: { host } }` and
 * touches nothing else. Pure.
 */
export function legacyConfigPatches(
  body: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [kind, map] of Object.entries(LEGACY_FIELD_MAP)) {
    let patch: Record<string, unknown> | null = null;
    for (const [legacyKey, cfgKey] of Object.entries(map)) {
      if (body[legacyKey] !== undefined) {
        (patch ??= {})[cfgKey] = body[legacyKey];
      }
    }
    if (patch) out[kind] = patch;
  }
  return out;
}

/**
 * Apply per-kind config patches onto each kind's DEFAULT connection,
 * returning a new connections array. Kinds with no default connection are
 * skipped (nothing to target — the edit falls back to the legacy field,
 * preserving pre-registry behaviour). Pure.
 */
export function applyLegacyPatchesToConnections(
  connections: ConnectionConfig[],
  defaults: Record<string, string>,
  patches: Record<string, Record<string, unknown>>
): ConnectionConfig[] {
  let next = connections;
  for (const [kind, patch] of Object.entries(patches)) {
    const targetId = defaults[kind];
    if (!targetId) continue;
    next = next.map((c) =>
      c.id === targetId
        ? {
            ...c,
            config: {
              ...((c.config as Record<string, unknown> | null) ?? {}),
              ...patch,
            },
          }
        : c
    );
  }
  return next;
}

/**
 * mtime-gated cache of the fully-computed prefs. `getPreferences()` is
 * called dozens of times per request (every broker poll tick, command
 * dispatch, action run, feedback recompute) and each call otherwise
 * re-reads the file + re-runs the multi-pass sanitize/seed. We cache the
 * computed result keyed by the file's mtime so a hot path is a stat +
 * structuredClone instead of disk I/O + parse + sanitize, while still
 * picking up external writes from the launcher process (its write bumps
 * the mtime → cache miss). The clone keeps callers from mutating the
 * cached object.
 */
let prefsCache: { mtime: number | null; value: AppPreferences } | null = null;

export const DEFAULT_PREFERENCES: AppPreferences = {
  vmix_host: "localhost",
  vmix_port: VMIX_DEFAULT_PORT,
  vmix_srt_port: 5000,
  polling_interval: POLLING_INTERVAL_MS,
  ableton_host: "127.0.0.1",
  ableton_send_port: 11000,
  ableton_recv_port: 11001,
  obs_host: "127.0.0.1",
  obs_port: 4455,
  obs_password: "",
  vmix_recent_hosts: [],
  ableton_recent_hosts: [],
  obs_recent_hosts: [],
  connections: [],
  defaultConnections: {},
  connectionsSeeded: false,
};

function computePreferences(): AppPreferences {
  // Fast path: file unchanged since we last computed → return the cache.
  const mtime = fileMtimeMs(FILE);
  if (prefsCache && prefsCache.mtime === mtime) {
    return prefsCache.value;
  }
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
  merged.obs_recent_hosts = sanitizeHostList(merged.obs_recent_hosts);
  merged.connections = sanitizeConnections(merged.connections);
  merged.connectionsSeeded = merged.connectionsSeeded === true;
  // Auto-seed `connections[]` from legacy keys for users upgrading
  // from a build that only had named host/port fields. We don't write
  // back here on purpose — the synthetic entries materialize at read
  // time only and become persisted the first time the user saves any
  // connection-related field. Keeps the migration zero-touch.
  //
  // Gated on `connectionsSeeded`: once any connection write has
  // persisted, an empty list is a deliberate "no connections" state
  // (the operator deleted them all) and must NOT be re-seeded.
  if (!merged.connectionsSeeded && merged.connections.length === 0) {
    merged.connections = synthesizeLegacyConnections(merged);
  }
  merged.defaultConnections = sanitizeDefaults(
    merged.defaultConnections,
    merged.connections
  );
  prefsCache = { mtime, value: merged };
  return merged;
}

/**
 * Public read: a deep clone so callers can freely mutate the result
 * without corrupting the cache.
 */
export function getPreferences(): AppPreferences {
  return structuredClone(computePreferences());
}

/**
 * Hot-path read: the cached object WITHOUT cloning. MUST be treated as
 * strictly read-only — used by the feedback coordinator and the action
 * runner, which read on every variable tick / key press and would
 * otherwise each pay a full `structuredClone` of all prefs per call.
 * At scale (many satellite decks) that clone was the dominant per-tick
 * cost; reading the frozen cache directly removes it.
 */
export function peekPreferences(): Readonly<AppPreferences> {
  return computePreferences();
}

/**
 * Coerce the defaults map to `{ kind: connectionId }` of entries that
 * still exist, then auto-fill any kind that has connections but no
 * explicit default with its first enabled instance. The auto-fill
 * preserves the historical "first enabled" behaviour for kinds the
 * operator never touched, while letting an explicit pick win.
 */
function sanitizeDefaults(
  raw: unknown,
  connections: ConnectionConfig[]
): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = new Map(connections.map((c) => [c.id, c]));
  if (raw && typeof raw === "object") {
    for (const [kind, id] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof id !== "string") continue;
      const conn = byId.get(id);
      if (conn && conn.kind === kind) out[kind] = id;
    }
  }
  // Auto-fill: first enabled (else first) connection of each kind.
  for (const c of connections) {
    if (out[c.kind]) continue;
    const firstEnabled = connections.find((x) => x.kind === c.kind && x.enabled);
    out[c.kind] = (firstEnabled ?? c).id;
  }
  return out;
}

/**
 * Mirror each default connection's host/port config into the legacy
 * single-instance fields (`vmix_host`, `obs_*`, `ableton_*`). The
 * legacy live/playlist/title pages still read those, so this is what
 * makes "the default vMix" the connection those pages drive. Pure —
 * returns a patched copy, never writes.
 */
function applyDefaultsToLegacy(p: AppPreferences): AppPreferences {
  const next = { ...p };
  const byId = new Map(p.connections.map((c) => [c.id, c]));
  const cfgOf = (kind: string): Record<string, unknown> | null => {
    const id = p.defaultConnections[kind];
    if (!id) return null;
    const conn = byId.get(id);
    if (!conn || conn.kind !== kind) return null;
    return (conn.config ?? {}) as Record<string, unknown>;
  };
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" && v ? v : fallback;

  const vmix = cfgOf("vmix");
  if (vmix) {
    next.vmix_host = str(vmix.host, next.vmix_host);
    next.vmix_port = num(vmix.port, next.vmix_port);
    next.vmix_srt_port = num(vmix.srtPort, next.vmix_srt_port);
    next.polling_interval = num(vmix.pollingInterval, next.polling_interval);
  }
  const obs = cfgOf("obs");
  if (obs) {
    next.obs_host = str(obs.host, next.obs_host);
    next.obs_port = num(obs.port, next.obs_port);
    next.obs_password = str(obs.password, next.obs_password);
  }
  const ableton = cfgOf("ableton");
  if (ableton) {
    next.ableton_host = str(ableton.host, next.ableton_host);
    next.ableton_send_port = num(ableton.sendPort, next.ableton_send_port);
    next.ableton_recv_port = num(ableton.recvPort, next.ableton_recv_port);
  }
  return next;
}

function sanitizeHostList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Strip clearly-invalid entries from the persisted connections list.
 * A bad entry (missing kind / id) would explode in the manager loop;
 * dropping it silently is preferable to taking down the whole boot.
 * Returns a fresh array so callers can mutate freely.
 */
function sanitizeConnections(v: unknown): ConnectionConfig[] {
  if (!Array.isArray(v)) return [];
  const out: ConnectionConfig[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.kind !== "string" || !r.kind) continue;
    out.push({
      id: r.id,
      kind: r.kind,
      label: typeof r.label === "string" ? r.label : r.kind,
      enabled: r.enabled !== false,
      config: r.config ?? {},
    });
  }
  return out;
}

/**
 * Build a default `connections[]` from the legacy per-device fields.
 * Used only when the persisted list is empty so existing installs
 * upgrade in place. IDs are deterministic (`legacy-<kind>`) so a user
 * editing the synthesized entry and saving preserves the same row
 * instead of accumulating duplicates across reloads.
 *
 * Only vMix is seeded unconditionally — it's the historical core and
 * the live / playlist / title / colour pages depend on a vMix broker
 * existing. OBS and Ableton are seeded ONLY when the operator actually
 * pointed them at a non-default host in a previous build; otherwise a
 * fresh install would surface OBS / Ableton sidebar pages for gear
 * that was never connected. New OBS / Ableton connections are added
 * explicitly via the connections panel.
 */
function synthesizeLegacyConnections(p: AppPreferences): ConnectionConfig[] {
  const out: ConnectionConfig[] = [
    {
      id: "legacy-vmix",
      kind: "vmix",
      label: "vMix",
      enabled: true,
      config: {
        host: p.vmix_host,
        port: p.vmix_port,
        pollingInterval: p.polling_interval,
        srtPort: p.vmix_srt_port,
      },
    },
  ];
  if (p.obs_host && p.obs_host !== DEFAULT_PREFERENCES.obs_host) {
    out.push({
      id: "legacy-obs",
      kind: "obs",
      label: "OBS Studio",
      enabled: true,
      config: {
        host: p.obs_host,
        port: p.obs_port,
        password: p.obs_password,
      },
    });
  }
  if (
    p.ableton_host &&
    p.ableton_host !== DEFAULT_PREFERENCES.ableton_host
  ) {
    out.push({
      id: "legacy-ableton",
      kind: "ableton",
      label: "Ableton Live",
      enabled: true,
      config: {
        host: p.ableton_host,
        sendPort: p.ableton_send_port,
        recvPort: p.ableton_recv_port,
      },
    });
  }
  return out;
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
  if (typeof cleaned.obs_host === "string") {
    cleaned.obs_host = cleaned.obs_host.trim();
  }

  const next: AppPreferences = { ...current, ...cleaned };
  // Any persisted write latches the migration: from here on an empty
  // connections list is honoured as-is and never re-seeded.
  next.connectionsSeeded = true;

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
  if (
    cleaned.obs_host !== undefined &&
    cleaned.obs_host !== current.obs_host
  ) {
    next.obs_recent_hosts = bumpRecent(
      current.obs_recent_hosts ?? [],
      cleaned.obs_host
    );
  }

  // Sanitize an incoming connections list — if the caller passes
  // something malformed we still write a clean array (instead of
  // corrupting the file).
  if (cleaned.connections !== undefined) {
    next.connections = sanitizeConnections(cleaned.connections);
  }

  // Keep the defaults map honest against the (possibly new) connection
  // list, then mirror the default connections' config into the legacy
  // single-instance fields so the live/playlist/title pages always
  // track the chosen default.
  next.defaultConnections = sanitizeDefaults(
    cleaned.defaultConnections ?? next.defaultConnections,
    next.connections
  );
  const synced = applyDefaultsToLegacy(next);

  writeJson(FILE, synced);
  // Prime the cache with the just-written value so the inevitable
  // post-write `getPreferences()` (reconcile, response body) is a clone,
  // not a full recompute. Keyed by the fresh mtime.
  prefsCache = { mtime: fileMtimeMs(FILE), value: synced };
  return structuredClone(synced);
}

/**
 * Set (or clear, with `null`) the default connection for a kind. The
 * write path mirrors the new default's host/port into the legacy
 * fields so the single-instance pages follow it immediately.
 */
export function setDefaultConnection(
  kind: string,
  connectionId: string | null
): AppPreferences {
  const current = getPreferences();
  const nextDefaults = { ...current.defaultConnections };
  if (connectionId) {
    nextDefaults[kind] = connectionId;
  } else {
    delete nextDefaults[kind];
  }
  return setPreferences({ defaultConnections: nextDefaults });
}

// ───────────────────────── Connection helpers ─────────────────────────

/**
 * Append a fresh connection row with a random UUID. The caller is
 * responsible for validating `config` against the kind's schema — this
 * helper only does persistence. Returns the new id so the UI can
 * navigate to the new connection's page.
 */
export function addConnection(
  kind: string,
  label: string,
  config: unknown
): { id: string; prefs: AppPreferences } {
  const id = randomUUID();
  const current = getPreferences();
  const prefs = setPreferences({
    connections: [
      ...current.connections,
      { id, kind, label, enabled: true, config },
    ],
  });
  return { id, prefs };
}

/**
 * Update a specific connection by id. Returns the updated prefs.
 * No-op (still returns prefs) when id is unknown so callers don't
 * have to special-case the not-found path.
 */
export function updateConnection(
  id: string,
  patch: Partial<Omit<ConnectionConfig, "id" | "kind">>
): AppPreferences {
  const current = getPreferences();
  return setPreferences({
    connections: current.connections.map((c) =>
      c.id === id ? { ...c, ...patch } : c
    ),
  });
}

/** Remove a connection by id. Idempotent. */
export function removeConnection(id: string): AppPreferences {
  const current = getPreferences();
  return setPreferences({
    connections: current.connections.filter((c) => c.id !== id),
  });
}
