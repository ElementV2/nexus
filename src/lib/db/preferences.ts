import { randomUUID } from "node:crypto";
import { readJson, writeJson, fileMtimeMs } from "./index";
import {
  VMIX_DEFAULT_PORT,
  POLLING_INTERVAL_MS,
} from "@/lib/vmix/constants";
import type { ConnectionConfig } from "@/lib/core/types";

export interface AppPreferences {
  /** Optional shared PIN — not enforced yet */
  pin?: string;

  /**
   * Multi-instance connections registry — the SINGLE source of truth for
   * which devices the manager spins up at boot. Each entry's `config` shape
   * is opaque here (validated per-kind at the registry layer). The legacy
   * single-instance pages (live / playlist / title / colour) and the SRT
   * route read the DEFAULT connection's config directly (see
   * `defaultConnectionConfig`) — there are no flat `*_host` mirror fields
   * anymore.
   */
  connections: ConnectionConfig[];

  /**
   * Default connection per kind: `{ vmix: "<id>", ableton: "<id>" }`.
   * Surfaces (Stream Deck) that fire without an explicit pin, and the legacy
   * single-instance pages, target this kind's default.
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
 * Redact every secret a `getPreferences()` response would otherwise leak —
 * each connection's per-instance config (OBS / grandMA2 password). Call ONLY
 * on response boundaries — never before persisting. Returns a copy.
 */
export function redactPreferences(prefs: AppPreferences): AppPreferences {
  return {
    ...prefs,
    connections: prefs.connections.map((c) => ({
      ...c,
      config: redactConfigSecrets(c.config),
    })),
  };
}

/**
 * Config blob of the DEFAULT connection for a kind, or null. The single
 * source of truth that the legacy single-instance pages + the SRT route read
 * instead of the old flat `*_host`/`*_port` mirror fields.
 */
export function defaultConnectionConfig(
  kind: string
): Record<string, unknown> | null {
  const p = peekPreferences();
  const id = p.defaultConnections[kind];
  if (!id) return null;
  const conn = p.connections.find((c) => c.id === id);
  if (!conn || conn.kind !== kind) return null;
  return (conn.config ?? {}) as Record<string, unknown>;
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
  const raw = readJson<Record<string, unknown>>(FILE, {});
  // Pick ONLY the known fields — never spread `raw` wholesale, or a
  // pre-registry file's flat `*_host` keys would leak back onto the typed
  // shape and get re-persisted. The seed reads the flat keys defensively.
  const merged: AppPreferences = {
    ...DEFAULT_PREFERENCES,
    ...(typeof raw.pin === "string" ? { pin: raw.pin } : {}),
    connections: sanitizeConnections(raw.connections),
    connectionsSeeded: raw.connectionsSeeded === true,
  };
  // Auto-seed `connections[]` for a fresh install, or migrate a pre-registry
  // file that only had flat `*_host`/`*_port` keys. Materialised at read time
  // only; persisted on the first connection write.
  //
  // Gated on `connectionsSeeded`: once any connection write has persisted, an
  // empty list is a deliberate "no connections" state (the operator deleted
  // them all) and must NOT be re-seeded.
  if (!merged.connectionsSeeded && merged.connections.length === 0) {
    merged.connections = synthesizeLegacyConnections(raw);
  }
  merged.defaultConnections = sanitizeDefaults(
    raw.defaultConnections,
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
 * Seed `connections[]` when the persisted list is empty: a default vMix
 * connection (the historical core — the live / playlist / title / colour
 * pages need a vMix broker), plus OBS / Ableton ONLY if a PRE-REGISTRY file
 * pointed them at a non-default host. The legacy flat `*_host`/`*_port` keys
 * are read defensively from the raw JSON (`raw`) so an upgrading install
 * migrates in place; a fresh install just gets vMix on its default host.
 * Deterministic ids (`legacy-<kind>`) so editing + saving preserves the row.
 */
function synthesizeLegacyConnections(
  raw: Record<string, unknown>
): ConnectionConfig[] {
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  const out: ConnectionConfig[] = [
    {
      id: "legacy-vmix",
      kind: "vmix",
      label: "vMix",
      enabled: true,
      config: {
        host: str(raw.vmix_host) || "localhost",
        port: num(raw.vmix_port, VMIX_DEFAULT_PORT),
        pollingInterval: num(raw.polling_interval, POLLING_INTERVAL_MS),
        srtPort: num(raw.vmix_srt_port, 5000),
      },
    },
  ];
  const obsHost = str(raw.obs_host);
  if (obsHost && obsHost !== "127.0.0.1") {
    out.push({
      id: "legacy-obs",
      kind: "obs",
      label: "OBS Studio",
      enabled: true,
      config: {
        host: obsHost,
        port: num(raw.obs_port, 4455),
        password: str(raw.obs_password),
      },
    });
  }
  const abletonHost = str(raw.ableton_host);
  if (abletonHost && abletonHost !== "127.0.0.1") {
    out.push({
      id: "legacy-ableton",
      kind: "ableton",
      label: "Ableton Live",
      enabled: true,
      config: {
        host: abletonHost,
        sendPort: num(raw.ableton_send_port, 11000),
        recvPort: num(raw.ableton_recv_port, 11001),
      },
    });
  }
  return out;
}

export function setPreferences(
  partial: Partial<AppPreferences>
): AppPreferences {
  const current = getPreferences();
  const next: AppPreferences = { ...current, ...partial };
  // Any persisted write latches the migration: from here on an empty
  // connections list is honoured as-is and never re-seeded.
  next.connectionsSeeded = true;

  // Sanitize an incoming connections list — if the caller passes something
  // malformed we still write a clean array (instead of corrupting the file).
  if (partial.connections !== undefined) {
    next.connections = sanitizeConnections(partial.connections);
  }

  // Keep the defaults map honest against the (possibly new) connection list.
  next.defaultConnections = sanitizeDefaults(
    partial.defaultConnections ?? next.defaultConnections,
    next.connections
  );

  writeJson(FILE, next);
  // Prime the cache with the just-written value so the inevitable post-write
  // `getPreferences()` (reconcile, response body) is a clone, not a full
  // recompute. Keyed by the fresh mtime.
  prefsCache = { mtime: fileMtimeMs(FILE), value: next };
  return structuredClone(next);
}

/**
 * Set (or clear, with `null`) the default connection for a kind. The legacy
 * single-instance pages read the default connection's config directly, so
 * they follow the new default immediately.
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
