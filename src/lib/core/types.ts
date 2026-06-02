/**
 * Core abstractions for the device-registry architecture.
 *
 * Goal: a new device kind (X32, GrandMA3, ...) is added by writing ONE
 * file under `src/lib/kinds/<kind>.ts` that calls `registerDeviceKind`.
 * No file under `src/lib/core/*` is touched per kind.
 */

import type { LucideIcon } from "lucide-react";

// ─────────────────────────── Status ───────────────────────────────────

/**
 * Lifecycle state of a connection from the manager's point of view.
 * Kinds may use richer internal status (OBS has "authenticating" between
 * connecting and connected) but only these four are exposed to the UI
 * via the generic `/api/connections` surface. The kind can stream its
 * detailed status as a regular event for kind-specific pages.
 */
export type ConnectionStatus = "offline" | "connecting" | "connected" | "error";

// ─────────────────────────── Events ───────────────────────────────────

/**
 * Synthetic events emitted by the Connection wrapper itself — every
 * SSE consumer receives these regardless of the kind. They use a
 * `__` prefix so a kind's own event types never collide.
 */
export type ConnectionMetaEvent =
  | { type: "__status"; status: ConnectionStatus; error?: string }
  | { type: "__snapshot"; payload: unknown };

/**
 * Kind-specific events. Pass-through from the broker — the manager
 * does not interpret them. The `type` field is required so an SSE
 * consumer can dispatch by tag (e.g. OBS's "scene-changed").
 */
export interface KindEvent {
  type: string;
  [key: string]: unknown;
}

export type ConnectionEvent = ConnectionMetaEvent | KindEvent;

// ─────────────────────────── Broker contract ──────────────────────────

/**
 * What a device kind's `make()` returns. The broker owns its transport
 * (socket, polling loop, HID handle) and exposes a uniform surface so
 * the Connection wrapper can wire it to the SSE bus and command API
 * without knowing anything kind-specific.
 *
 * Implementors are typically a class that wraps the existing per-device
 * broker logic (vMix XML polling, OBS WS handshake, AbletonOSC, ...).
 */
export interface BrokerImpl {
  /**
   * Subscribe to events from this broker. Called by every connected
   * SSE client. Brokers should start their transport when subscriber
   * count goes 0→1 and stop it on 1→0 — same pattern the legacy
   * singletons (vmix state-broker, ableton osc-broker) already use.
   */
  subscribe(cb: (event: KindEvent) => void): () => void;

  /**
   * Latest cached event a fresh subscriber should receive immediately
   * (e.g. the current OBS snapshot, the last vMix state). Null if no
   * data has arrived yet. NOT typed at this layer — the kind decides
   * the shape; consumers downcast based on `kind`.
   */
  getSnapshot(): unknown | null;

  /**
   * Translate a command from the UI into the kind's transport.
   * The `command` shape is kind-defined (vMix uses {Function, Input}).
   * Return value is awaited so the UI can show send failures or
   * read-back values (e.g. OBS GetVersion).
   */
  send(command: unknown): Promise<unknown>;

  /**
   * Apply a config change (host / port / password). May trigger a
   * reconnect — the broker decides whether it can hot-swap or must
   * tear down and rebuild.
   */
  updateConfig(config: unknown): void;

  /**
   * Current health from the broker's point of view. Surfaced through
   * the generic connections list endpoint without forcing the UI to
   * subscribe to events first.
   */
  getStatus(): ConnectionStatus;

  /**
   * Release everything (timers, sockets, file handles). Called when
   * the connection is removed from preferences or the dev-mode HMR
   * cycle replaces the host module.
   */
  dispose(): void;
}

// ─────────────────────────── Persisted config ─────────────────────────

/**
 * Persisted shape of one connection in `preferences.json`. The `config`
 * field is opaque at this layer — each kind validates it via
 * `parseConfig` before constructing a broker.
 */
export interface ConnectionConfig {
  /** Stable UUID. Survives label/host changes; used as the URL slug. */
  id: string;
  /** Kind id matching a registered DeviceKind (e.g. "vmix", "obs"). */
  kind: string;
  /** User-facing display name. Free text. */
  label: string;
  /** When false the manager doesn't auto-start the broker for this entry. */
  enabled: boolean;
  /** Kind-specific config blob — validated by `kind.parseConfig`. */
  config: unknown;
}

// ─────────────────────────── Device kind ──────────────────────────────

/**
 * Single option a kind declares for an action/feedback. Drives both
 * the runtime command body (what the option resolves to) and the
 * preset/action editor UI (rendered as a number input, dropdown, ...).
 * Kept intentionally small — power features (computed defaults,
 * dependent dropdowns) can grow later once a real editor exists.
 */
export type ActionOption = (
  | {
      id: string;
      type: "number";
      label: string;
      default?: number;
      min?: number;
      max?: number;
      step?: number;
      tooltip?: string;
    }
  | {
      id: string;
      type: "string";
      label: string;
      default?: string;
      placeholder?: string;
      tooltip?: string;
    }
  | {
      id: string;
      type: "boolean";
      label: string;
      default?: boolean;
      tooltip?: string;
    }
  | {
      id: string;
      type: "dropdown";
      label: string;
      default?: string;
      choices: Array<{ id: string; label: string }>;
      tooltip?: string;
    }
) & {
  /** Show this field only when another option currently equals a value
   *  (e.g. SetOutput's `Input` field is relevant only when `Value` =
   *  "Input"). Editors hide it otherwise. */
  showWhen?: { option: string; equals: string };
};

/**
 * A named operation a kind exposes to the rest of the app. Maps to
 * one or more broker commands. The action editor (and surfaces like
 * Stream Deck) browse these without knowing the kind's protocol —
 * everything kind-specific lives inside `toCommand`.
 *
 * `id` is unique within the kind; the global lookup uses `"<kind>:<id>"`.
 */
export interface ActionDefinition {
  /** Kind-unique id. URL-safe (lowercase, no spaces). */
  id: string;
  /** Short display name shown in the action picker. */
  label: string;
  /** Optional sentence under the label in pickers. */
  description?: string;
  /** Grouping in the preset browser (e.g. "Transitions", "Audio"). */
  category?: string;
  /** Optional tile colours used when the unified browser synthesizes a
   *  draggable tile from this action (i.e. the kind ships no separate
   *  curated preset for it). Hex or CSS colour. Falls back to a neutral
   *  face when unset. */
  bgcolor?: string;
  fgcolor?: string;
  /** Editor schema — array, not object, so the UI can preserve order. */
  options?: ActionOption[];
  /**
   * Translate the resolved option values into a kind-specific command
   * body that the broker's `send()` understands. Pure function — no
   * side effects, no network. Throw on validation failure; the runner
   * surfaces the message to the caller.
   */
  toCommand(options: Record<string, unknown>): unknown;
}

/**
 * Variable a kind publishes. Variables surface in button text via
 * `$(<connection-label-or-id>:<var-id>)` substitution and feed
 * feedbacks.
 *
 * Phase 1 declaration only — the value pipeline (broker pushes,
 * VariableBus storage, expression evaluator) ships later. Declaring
 * variables now lets surfaces render placeholders + the editor
 * suggest completions.
 */
export interface VariableDefinition {
  id: string;
  label: string;
  description?: string;
  /** Hint for the formatter (`number` → align right, `time` → mono). */
  hint?: "string" | "number" | "boolean" | "time";
}

/**
 * Pre-baked button template a kind ships. Drag-droppable in the
 * Stream Deck editor (and any other surface). Each preset bundles
 * one or more action ids with frozen option values + a default
 * visual style.
 */
export interface PresetDefinition {
  /** Kind-unique id. */
  id: string;
  /** Display label in the preset browser. */
  label: string;
  /** Grouping in the preset browser. */
  category?: string;
  /** Default button face — text shown when dropped on a surface. */
  text?: string;
  /** Hex (e.g. "#ff3b30") or CSS color. */
  bgcolor?: string;
  /** Foreground / text color. */
  fgcolor?: string;
  /** Sequence of actions fired on press. Most presets are one action;
   *  multi-step (e.g. "cut to mix 1 + mute mic" presets) chain more. */
  steps: Array<{ actionId: string; options?: Record<string, unknown> }>;
}

/**
 * What `registerDeviceKind(...)` accepts. Drives:
 *   • the connections panel UI (one card per registered kind),
 *   • config validation (preferences API uses `parseConfig` before save),
 *   • sidebar pages (each active connection contributes nav items),
 *   • broker instantiation (manager calls `make(config, id, label)` once
 *     per enabled instance),
 *   • the preset / action browser (kind contributes its catalog).
 */
export interface DeviceKind {
  /** Stable kind id. URL-safe (lowercase letters, no spaces). */
  readonly kind: string;

  /** Human label for the connections panel. */
  readonly displayName: string;

  /** Lucide icon used in the sidebar and connection cards. */
  readonly icon: LucideIcon;

  /** Short subtitle for the connections panel card. */
  readonly tagline?: string;

  /**
   * True for fire-and-forget transports that get NO reply (grandMA3 OSC is
   * send-only over UDP). The "connected" status for these is optimistic —
   * the link can't be verified — so the UI labels them "direct send, status
   * not verified" instead of implying a confirmed connection.
   */
  readonly sendOnly?: boolean;

  /**
   * Validate a raw config object loaded from preferences or POSTed by
   * the UI. Returns a typed config or a human-readable error. The
   * config shape is whatever the kind needs (host/port/password for
   * OBS, host/sendPort/recvPort for Ableton, ...).
   */
  parseConfig(raw: unknown): { ok: true; config: unknown } | { ok: false; error: string };

  /** Default config used by "Add connection" → fresh card. */
  defaultConfig(): unknown;

  /**
   * Sidebar pages this kind contributes when at least one instance is
   * configured. The `:id` placeholder is replaced with the connection
   * UUID by the sidebar builder.
   */
  pages?: Array<{
    /** Relative path, e.g. "/connections/:id/obs" or "/obs". */
    href: string;
    /** Sidebar label. */
    label: string;
    /** Lucide icon name (string, looked up in the sidebar). */
    icon: LucideIcon;
  }>;

  /**
   * Catalog of operations the kind exposes. Surfaced through
   * `/api/actions` and shown in the action picker / preset editor.
   * Empty/omitted = no actions registered (kind is read-only).
   */
  actions?: ActionDefinition[];

  /** Variables this kind publishes — see VariableDefinition for the
   *  Phase 1 declaration-only constraint. */
  variables?: VariableDefinition[];

  /** Drag-droppable preset tiles for the browser. */
  presets?: PresetDefinition[];

  /**
   * Construct a new broker for one instance. Called by the manager
   * when the connection is enabled. The broker is responsible for its
   * own lifecycle (subscribe-driven start/stop) and HMR safety.
   */
  make(opts: { id: string; label: string; config: unknown }): BrokerImpl;
}

// ─────────────────────────── Public Connection ────────────────────────

/**
 * Public-facing wrapper the ConnectionManager hands out. Combines a
 * broker with the identity fields the routing layer needs. Mostly a
 * passthrough — the broker still owns subscription bookkeeping so each
 * kind can decide its own pub/sub semantics.
 */
export interface Connection {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly broker: BrokerImpl;
}
