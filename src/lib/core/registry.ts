import type { DeviceKind } from "./types";

/**
 * Process-global registry of device kinds. Kinds register themselves
 * at module load time (see `src/lib/kinds/*.ts`); the registry is the
 * single source of truth for:
 *   • which kinds exist (connections panel "add" menu),
 *   • how to validate a config blob (preferences PUT validation),
 *   • how to build a broker for an enabled instance (manager startup).
 *
 * Stashed on `globalThis` so Next dev's module re-imports don't
 * duplicate registrations or drop kinds registered before HMR.
 */

const REGISTRY_KEY = "__nexus_device_kind_registry__";

interface RegistryStash {
  kinds: Map<string, DeviceKind>;
}

function getStash(): RegistryStash {
  const holder = globalThis as unknown as Record<string, unknown>;
  let stash = holder[REGISTRY_KEY] as RegistryStash | undefined;
  if (!stash) {
    stash = { kinds: new Map() };
    holder[REGISTRY_KEY] = stash;
  }
  return stash;
}

/**
 * Register a device kind. Idempotent — re-registering the same kind id
 * overwrites the previous entry. HMR is the main caller of the
 * overwrite path: an edit to a kind file re-runs its top-level
 * `registerDeviceKind(...)` and we want the new definition to win.
 */
export function registerDeviceKind(kind: DeviceKind): void {
  if (!kind.kind || !/^[a-z][a-z0-9_-]*$/.test(kind.kind)) {
    throw new Error(
      `Invalid kind id "${kind.kind}" — must be lowercase, start with a letter`
    );
  }
  getStash().kinds.set(kind.kind, kind);
}

export function getKind(id: string): DeviceKind | undefined {
  return getStash().kinds.get(id);
}

export function listKinds(): DeviceKind[] {
  return Array.from(getStash().kinds.values());
}

/**
 * Validate a raw config against a kind's schema. Returns the parsed
 * config (kind-defined shape) or a human-readable error. The preferences
 * API calls this before persisting; the manager calls it before
 * instantiating a broker.
 */
export function validateConfig(
  kindId: string,
  raw: unknown
): { ok: true; config: unknown } | { ok: false; error: string } {
  const kind = getKind(kindId);
  if (!kind) return { ok: false, error: `Unknown kind "${kindId}"` };
  return kind.parseConfig(raw);
}
