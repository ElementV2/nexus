"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Monitor,
  Music2,
  Video,
  Sliders,
  Lightbulb,
  Plus,
  Trash2,
  X,
  Eye,
  EyeOff,
  Plug,
  Star,
  type LucideIcon,
} from "lucide-react";
import { MonoInput, StatusPill, useConfirm } from "@/components/sw";
import {
  useConnections,
  type ConnectionRow,
  type KindRow,
} from "@/hooks/use-connections";

/**
 * Generic connections editor — drives every persisted connection
 * through the same UI, regardless of kind. One card per connection;
 * `+ Add connection` at the top opens a kind picker.
 *
 * Per-card surface:
 *   • Header — kind icon, editable label, status pill, delete button.
 *   • Body — config fields auto-generated from the kind's
 *     `defaultConfig` shape (numbers → number inputs, keys containing
 *     "password" → masked input, everything else → text).
 *   • Footer — Save (PUT /api/connections/[id]) + Test (POST
 *     /api/connections/[id]/command with {action:"test"}) +
 *     Enable/Disable toggle.
 *
 * No more bespoke per-kind components. Adding a 6th device =
 * registering its kind. This panel automatically gets the new
 * "+ Add" tile and a working editor.
 */

// ────────────────────────── kind icon registry ─────────────────────────

// Lucide icons can't cross JSON, so we map them locally. New kinds
// register their icon here; unknown kinds fall back to the generic
// plug. Same approach the sidebar uses.
const KIND_ICONS: Record<string, LucideIcon> = {
  vmix: Monitor,
  obs: Video,
  ableton: Music2,
  x32: Sliders,
  grandma3: Lightbulb,
  grandma2: Lightbulb,
};

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

// ────────────────────────── top-level panel ────────────────────────────

export function ConnectionsPanel() {
  // Shared connections source (one poller, visibility/diff-gated) — no
  // private fetch loop here. `refresh()` forces an immediate refetch
  // after a mutation.
  const { data, refresh: refreshShared } = useConnections();
  const refresh = useCallback(async () => {
    refreshShared();
  }, [refreshShared]);
  const [addingKind, setAddingKind] = useState<string | null>(null);

  const addConnection = useCallback(
    async (kindId: string) => {
      const kind = data?.kinds.find((k) => k.kind === kindId);
      if (!kind) return;
      // Auto-number when more than one of a kind exists so instances
      // are distinguishable in lists out of the box (vMix, vMix 2, …).
      // The operator can rename freely afterward via the card header.
      const sameKind = (data?.connections ?? []).filter(
        (c) => c.kind === kindId
      ).length;
      const label =
        sameKind === 0 ? kind.displayName : `${kind.displayName} ${sameKind + 1}`;
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: kindId,
          label,
          config: kind.defaultConfig,
        }),
      });
      if (res.ok) {
        setAddingKind(null);
        await refresh();
      }
    },
    [data, refresh]
  );

  const removeConnection = useCallback(
    async (id: string) => {
      const res = await fetch(
        `/api/connections/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (res.ok) await refresh();
    },
    [refresh]
  );

  const setDefault = useCallback(
    async (kind: string, connectionId: string) => {
      const res = await fetch("/api/connections/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, connectionId }),
      });
      if (res.ok) await refresh();
    },
    [refresh]
  );

  if (!data) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--muted)" }}>
        Loading connections…
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toolbar: counts + add button + (when adding) kind picker. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 10,
            letterSpacing: "1.4px",
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          {data.connections.length} configured ·{" "}
          {data.kinds.length} device types
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => setAddingKind((cur) => (cur === "__menu__" ? null : "__menu__"))}
            className="font-mono uppercase inline-flex items-center transition-colors"
            style={{
              gap: 6,
              padding: "6px 12px",
              fontSize: 10,
              letterSpacing: "1.4px",
              fontWeight: 700,
              background:
                addingKind === "__menu__" ? "var(--ink)" : "var(--amber-tint)",
              color: addingKind === "__menu__" ? "var(--bg)" : "var(--amber)",
              border: "1px solid var(--amber)",
              cursor: "pointer",
              transitionDuration: "80ms",
            }}
          >
            {addingKind === "__menu__" ? (
              <>
                <X size={11} /> Cancel
              </>
            ) : (
              <>
                <Plus size={11} /> Add connection
              </>
            )}
          </button>
        </div>
      </div>

      {addingKind === "__menu__" && (
        <KindPicker kinds={data.kinds} onPick={addConnection} />
      )}

      {/* Connection grid */}
      {data.connections.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 12,
          }}
        >
          {data.connections.map((conn) => {
            const kind = data.kinds.find((k) => k.kind === conn.kind);
            if (!kind) {
              return (
                <OrphanCard
                  key={conn.id}
                  conn={conn}
                  onDelete={() => removeConnection(conn.id)}
                />
              );
            }
            // Only worth showing the "default" affordance when more
            // than one connection of this kind exists — with a single
            // instance it's trivially the default.
            const siblings = data.connections.filter(
              (c) => c.kind === conn.kind
            ).length;
            return (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                kind={kind}
                isDefault={data.defaults?.[conn.kind] === conn.id}
                showDefault={siblings > 1}
                onSetDefault={() => setDefault(conn.kind, conn.id)}
                onChanged={refresh}
                onDelete={() => removeConnection(conn.id)}
              />
            );
          })}
        </div>
      ) : (
        <div
          style={{
            padding: 24,
            background: "var(--card)",
            border: "1px dashed var(--line-hi)",
            color: "var(--muted)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          No connections yet — click{" "}
          <span style={{ color: "var(--amber)", fontWeight: 600 }}>+ Add connection</span>{" "}
          to wire your first device.
        </div>
      )}
    </div>
  );
}

// ────────────────────────── kind picker ────────────────────────────────

function KindPicker({
  kinds,
  onPick,
}: {
  kinds: KindRow[];
  onPick: (kind: string) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "var(--panel-2)",
        border: "1px solid var(--line-hi)",
      }}
    >
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 10,
          letterSpacing: "1.4px",
          color: "var(--mid)",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Pick a device type
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 8,
        }}
      >
        {kinds.map((k) => {
          const Icon = KIND_ICONS[k.kind] ?? Plug;
          return (
            <button
              key={k.kind}
              onClick={() => onPick(k.kind)}
              className="flex items-start gap-3 transition-colors"
              style={{
                padding: 12,
                background: "var(--card)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                cursor: "pointer",
                textAlign: "left",
                transitionDuration: "80ms",
              }}
              title={`Create a new ${k.displayName} connection`}
            >
              <Icon
                size={20}
                strokeWidth={1.6}
                style={{ flexShrink: 0, color: "var(--amber)", marginTop: 2 }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                  }}
                >
                  {k.displayName}
                </div>
                {k.tagline && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      marginTop: 2,
                      lineHeight: 1.3,
                    }}
                  >
                    {k.tagline}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────── orphan card ────────────────────────────────

/**
 * A persisted connection whose kind is no longer registered (e.g.
 * the user disabled a plugin, or rolled back the app and the new
 * kind is gone). The only action available is delete — keeping
 * orphan rows around forever would just confuse the operator.
 */
function OrphanCard({
  conn,
  onDelete,
}: {
  conn: ConnectionRow;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--card)",
        border: "1px solid var(--pgm)",
      }}
    >
      <div className="flex items-center gap-2">
        <Plug size={16} style={{ color: "var(--pgm)" }} />
        <span className="font-mono" style={{ fontSize: 12, fontWeight: 700 }}>
          {conn.label}
        </span>
        <StatusPill role="red">orphan</StatusPill>
        <button
          onClick={onDelete}
          title="Remove this connection"
          style={{
            marginLeft: "auto",
            padding: 6,
            background: "transparent",
            border: 0,
            color: "var(--pgm)",
            cursor: "pointer",
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        Kind <code>{conn.kind}</code> is no longer registered. Configuration
        kept on disk in case the kind comes back; delete the row to drop it.
      </div>
    </div>
  );
}

// ────────────────────────── connection card ────────────────────────────

function ConnectionCard({
  conn,
  kind,
  isDefault,
  showDefault,
  onSetDefault,
  onChanged,
  onDelete,
}: {
  conn: ConnectionRow;
  kind: KindRow;
  isDefault: boolean;
  showDefault: boolean;
  onSetDefault: () => void;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  const [label, setLabel] = useState(conn.label);
  const [config, setConfig] = useState<Record<string, unknown>>(
    () => (conn.config as Record<string, unknown>) ?? {}
  );
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  // Reset local draft when the upstream connection changes outside
  // our edits — caught via JSON identity, cheap for our config sizes.
  const [lastSeen, setLastSeen] = useState({
    label: conn.label,
    config: JSON.stringify(conn.config),
  });
  const stamp = JSON.stringify(conn.config);
  if (lastSeen.label !== conn.label || lastSeen.config !== stamp) {
    setLastSeen({ label: conn.label, config: stamp });
    setLabel(conn.label);
    setConfig((conn.config as Record<string, unknown>) ?? {});
  }

  const dirty =
    label !== conn.label ||
    JSON.stringify(config) !== JSON.stringify(conn.config);

  const save = useCallback(async () => {
    const res = await fetch(
      `/api/connections/${encodeURIComponent(conn.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, config }),
      }
    );
    if (res.ok) {
      onChanged();
      setTest({ kind: "idle" });
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setTest({ kind: "err", message: err.error ?? `HTTP ${res.status}` });
    }
  }, [conn.id, label, config, onChanged]);

  const runTest = useCallback(async () => {
    setTest({ kind: "running" });
    try {
      const res = await fetch(
        `/api/connections/${encodeURIComponent(conn.id)}/command`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test" }),
        }
      );
      const json = (await res.json()) as
        | { ok: true; data: unknown }
        | { ok: false; error: string };
      if (!json.ok) {
        setTest({ kind: "err", message: json.error });
        return;
      }
      // Some kinds return a nested envelope `{ ok, version, ... }`,
      // others return whatever the broker hands back. Try to extract
      // a friendly summary; fall back to "Connected".
      const summary = summariseTestResult(json.data);
      setTest({ kind: "ok", message: summary });
    } catch (err) {
      setTest({
        kind: "err",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [conn.id]);

  const toggleEnabled = useCallback(async () => {
    await fetch(`/api/connections/${encodeURIComponent(conn.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !conn.enabled }),
    });
    onChanged();
  }, [conn.id, conn.enabled, onChanged]);

  const Icon = KIND_ICONS[kind.kind] ?? Plug;

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        opacity: conn.enabled ? 1 : 0.6,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Icon size={16} strokeWidth={1.6} style={{ color: "var(--amber)" }} />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="font-mono flex-1"
          style={{
            background: "transparent",
            border: 0,
            color: "var(--ink)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.02em",
            padding: 0,
            outline: "none",
            minWidth: 0,
          }}
        />
        <StatusBadge status={conn.status} />
        {kind.sendOnly && (
          <span
            title="One-way OSC over UDP — the console never replies, so the link can't be verified. The status is optimistic; a press is sent blind."
            style={{
              fontSize: 9,
              letterSpacing: "0.04em",
              color: "var(--sub)",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              border: "1px solid var(--line-hi)",
              borderRadius: 3,
              padding: "1px 5px",
              whiteSpace: "nowrap",
            }}
          >
            direct send · unverified
          </span>
        )}
        {(showDefault || isDefault) && (
          <button
            onClick={onSetDefault}
            disabled={isDefault}
            title={
              isDefault
                ? `Default ${kind.displayName} — controlled by the live / playlist / title pages and un-pinned deck actions`
                : `Make this the default ${kind.displayName} (the one the live / playlist / title pages drive)`
            }
            className="flex items-center justify-center"
            style={{
              padding: 4,
              background: isDefault ? "var(--amber-tint)" : "transparent",
              border: isDefault
                ? "1px solid var(--amber)"
                : "1px solid var(--line-hi)",
              color: isDefault ? "var(--amber)" : "var(--sub)",
              cursor: isDefault ? "default" : "pointer",
            }}
          >
            <Star
              size={12}
              fill={isDefault ? "var(--amber)" : "none"}
            />
          </button>
        )}
        <button
          onClick={toggleEnabled}
          title={conn.enabled ? "Disable this connection" : "Enable this connection"}
          className="font-mono uppercase"
          style={{
            padding: "3px 8px",
            fontSize: 9,
            letterSpacing: "1.2px",
            background: conn.enabled ? "var(--panel-2)" : "var(--ink)",
            color: conn.enabled ? "var(--mid)" : "var(--bg)",
            border: "1px solid var(--line-hi)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {conn.enabled ? "On" : "Off"}
        </button>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Delete connection "${conn.label}"?`,
              message: `Removes the ${kind.displayName} connection and disposes its broker. Persisted layouts that pair this device stay intact.`,
              dangerous: true,
              confirmLabel: "Delete",
            });
            if (ok) onDelete();
          }}
          title="Delete this connection"
          style={{
            padding: 4,
            background: "transparent",
            border: 0,
            color: "var(--sub)",
            cursor: "pointer",
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Eyebrow: kind + id */}
      <div
        style={{
          padding: "6px 12px",
          fontSize: 10,
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        {kind.displayName}
        {/* Prefer the broker's LIVE transport label (vMix: TCP vs HTTP) so the
            operator sees how it's actually connected; else the static tagline. */}
        {conn.statusLabel
          ? ` · ${conn.statusLabel}`
          : kind.tagline
            ? ` · ${kind.tagline}`
            : ""}
        <span style={{ marginLeft: 6, color: "var(--sub)" }}>{conn.id}</span>
      </div>

      {/* Config fields */}
      <div
        style={{
          padding: "8px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <ConfigForm config={config} onChange={setConfig} />
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          onClick={runTest}
          disabled={test.kind === "running"}
          className="font-mono uppercase"
          style={{
            padding: "5px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "var(--panel-2)",
            color: "var(--mid)",
            border: "1px solid var(--line-hi)",
            cursor: test.kind === "running" ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {test.kind === "running" ? "Probing…" : "Test"}
        </button>
        <button
          onClick={save}
          disabled={!dirty}
          className="font-mono uppercase"
          style={{
            padding: "5px 12px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: dirty ? "var(--amber)" : "var(--amber-tint)",
            color: dirty ? "var(--bg)" : "var(--amber)",
            border: "1px solid var(--amber)",
            cursor: dirty ? "pointer" : "default",
            fontWeight: 700,
            opacity: dirty ? 1 : 0.6,
          }}
        >
          Save
        </button>
        <div style={{ marginLeft: "auto" }}>
          <TestLine state={test} />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────── config form ────────────────────────────────

/**
 * Render an input row per top-level key of `config`. The widget type
 * follows the value's current shape — works for every kind today
 * (host/port/password/pollingInterval/...). A future kind that needs
 * richer widgets (dropdowns, color pickers) can opt out by exporting
 * a `configFields` schema; for now defaultConfig + JS typeof is enough.
 */
function ConfigForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  // Drive ordering by the keys present — the kind's defaultConfig
  // determines the natural order via JS object insertion order.
  const keys = useMemo(() => Object.keys(config), [config]);
  if (keys.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        No configuration required.
      </div>
    );
  }
  return (
    <>
      {keys.map((k) => (
        <ConfigField
          key={k}
          field={k}
          value={config[k]}
          onChange={(v) => onChange({ ...config, [k]: v })}
        />
      ))}
    </>
  );
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const label = humanLabel(field);
  const isPassword = /password|secret|token|pin/i.test(field);
  const isNumber = typeof value === "number";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        className="label"
        style={{
          width: 120,
          flexShrink: 0,
          fontSize: 10,
          color: "var(--sub)",
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <MonoInput
          type={
            isPassword
              ? showPassword
                ? "text"
                : "password"
              : isNumber
                ? "number"
                : "text"
          }
          value={
            value === null || value === undefined
              ? ""
              : isNumber
                ? String(value)
                : String(value)
          }
          onChange={(e) => {
            if (isNumber) {
              const n = parseFloat(e.target.value);
              onChange(Number.isFinite(n) ? n : 0);
            } else {
              onChange(e.target.value);
            }
          }}
          spellCheck={false}
          autoComplete="off"
          style={isPassword ? { paddingRight: 28 } : undefined}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide" : "Show"}
            style={{
              position: "absolute",
              right: 4,
              top: 0,
              bottom: 0,
              width: 24,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: 0,
              color: "var(--mid)",
              cursor: "pointer",
            }}
          >
            {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

// ────────────────────────── helpers ────────────────────────────────────

function StatusBadge({ status }: { status: ConnectionRow["status"] }) {
  switch (status) {
    case "connected":
      return (
        <StatusPill role="green" variant="solid">
          Connected
        </StatusPill>
      );
    case "connecting":
      return <StatusPill role="amber">Connecting</StatusPill>;
    case "error":
      return <StatusPill role="red">Error</StatusPill>;
    default:
      return <StatusPill role="muted">Offline</StatusPill>;
  }
}

function TestLine({ state }: { state: TestState }) {
  if (state.kind === "ok") {
    return (
      <span
        className="font-mono"
        style={{ fontSize: 10, color: "var(--pvw)" }}
      >
        ✓ {state.message}
      </span>
    );
  }
  if (state.kind === "err") {
    return (
      <span
        className="font-mono"
        style={{ fontSize: 10, color: "var(--pgm)" }}
        title={state.message}
      >
        ✗ {state.message.slice(0, 80)}
      </span>
    );
  }
  return null;
}

/**
 * Convert a config field key into a human label. `obs_password` →
 * `Obs password`, `sendPort` → `Send port`, `pollingInterval` →
 * `Polling interval`. Good enough for every key shape in use today;
 * a kind can override by exporting a field-label map later.
 */
function humanLabel(key: string): string {
  // Insert space before each capital that follows a lowercase.
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Best-effort summary of a test() command response across kinds.
 * Returns "Connected" when nothing more specific is available.
 */
function summariseTestResult(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.ok === false && typeof d.error === "string") {
      return d.error;
    }
    if (typeof d.version === "string") {
      const parts = [`v${d.version}`];
      if (typeof d.edition === "string") parts.push(d.edition);
      if (typeof d.webSocketVersion === "string")
        parts.push(`ws ${d.webSocketVersion}`);
      if (typeof d.model === "string") parts.push(d.model);
      if (typeof d.name === "string" && d.name) parts.push(d.name);
      return parts.join(" · ");
    }
    if (typeof d.sent === "boolean") {
      return "Sent (push-only protocol)";
    }
  }
  return "Connected";
}
