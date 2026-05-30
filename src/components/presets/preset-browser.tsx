"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eyebrow, MonoChip } from "@/components/sw";

/**
 * Browser of every action and preset registered across all device
 * kinds. Two tabs (Presets / Actions), filters by kind, search.
 *
 * Drop payload (both tabs): MIME `application/x-nexus-preset` carries
 * a JSON-encoded `{ globalId, kind, label, text, bgcolor, fgcolor,
 * steps }`. Surface editors (Stream Deck, Loupedeck, ...) only need
 * to listen for that one type.
 *
 * Two layout modes:
 *   • `full` (default) — page-width, generous spacing. Kept for any
 *     future standalone use; today the only caller is the deck editor.
 *   • `sidebar` — narrow column embedded in the deck editor. Tighter
 *     padding, smaller tiles, scroll-y container so the deck mockup
 *     stays visible alongside.
 */

interface PresetEntry {
  globalId: string;
  kind: string;
  id: string;
  label: string;
  category?: string;
  text?: string;
  bgcolor?: string;
  fgcolor?: string;
  steps: Array<{ actionId: string; options?: Record<string, unknown> }>;
}

interface ActionOptionDef {
  id: string;
  type: "number" | "string" | "boolean" | "dropdown";
  label: string;
  default?: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  choices?: Array<{ id: string; label: string }>;
  tooltip?: string;
}

interface ActionEntry {
  globalId: string;
  kind: string;
  id: string;
  label: string;
  description?: string;
  category?: string;
  options: ActionOptionDef[];
}

type FireState =
  | { kind: "idle" }
  | { kind: "running"; globalId: string }
  | { kind: "ok"; globalId: string }
  | { kind: "err"; globalId: string; error: string };

const FIRE_FEEDBACK_MS = 1500;
const FIRE_ERROR_MS = 3000;

type Tab = "presets" | "actions";

export interface PresetBrowserPanelProps {
  mode?: "full" | "sidebar";
}

export function PresetBrowserPanel({
  mode = "full",
}: PresetBrowserPanelProps) {
  const [tab, setTab] = useState<Tab>("presets");
  const [presets, setPresets] = useState<PresetEntry[] | null>(null);
  const [actions, setActions] = useState<ActionEntry[] | null>(null);
  const [filterKind, setFilterKind] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fire, setFire] = useState<FireState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/presets", { cache: "no-store" }).then(
        (r) => r.json() as Promise<{ presets: PresetEntry[] }>
      ),
      fetch("/api/actions", { cache: "no-store" }).then(
        (r) => r.json() as Promise<{ actions: ActionEntry[] }>
      ),
    ])
      .then(([p, a]) => {
        if (cancelled) return;
        setPresets(p.presets);
        setActions(a.actions);
      })
      .catch(() => {
        /* leave null → loading */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    presets?.forEach((p) => s.add(p.kind));
    actions?.forEach((a) => s.add(a.kind));
    return Array.from(s).sort();
  }, [presets, actions]);

  const firePreset = useCallback(async (p: PresetEntry) => {
    setFire({ kind: "running", globalId: p.globalId });
    let next: FireState;
    try {
      const res = await fetch("/api/presets/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalId: p.globalId }),
      });
      const json = (await res.json()) as {
        results: Array<{ ok: boolean; error?: string }>;
      };
      const failed = json.results.find((r) => !r.ok);
      next = failed
        ? { kind: "err", globalId: p.globalId, error: failed.error ?? "unknown" }
        : { kind: "ok", globalId: p.globalId };
    } catch (err) {
      next = {
        kind: "err",
        globalId: p.globalId,
        error: err instanceof Error ? err.message : "network",
      };
    }
    setFire(next);
    const captured = p.globalId;
    const delay = next.kind === "err" ? FIRE_ERROR_MS : FIRE_FEEDBACK_MS;
    setTimeout(() => {
      setFire((cur) =>
        cur.kind !== "idle" && cur.globalId === captured
          ? { kind: "idle" }
          : cur
      );
    }, delay);
  }, []);

  const fireAction = useCallback(
    async (a: ActionEntry, options: Record<string, unknown>) => {
      setFire({ kind: "running", globalId: a.globalId });
      let next: FireState;
      try {
        const res = await fetch("/api/actions/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ globalId: a.globalId, options }),
        });
        const json = (await res.json()) as
          | { ok: true; data: unknown }
          | { ok: false; error: string };
        next = json.ok
          ? { kind: "ok", globalId: a.globalId }
          : { kind: "err", globalId: a.globalId, error: json.error };
      } catch (err) {
        next = {
          kind: "err",
          globalId: a.globalId,
          error: err instanceof Error ? err.message : "network",
        };
      }
      setFire(next);
      const captured = a.globalId;
      const delay = next.kind === "err" ? FIRE_ERROR_MS : FIRE_FEEDBACK_MS;
      setTimeout(() => {
        setFire((cur) =>
          cur.kind !== "idle" && cur.globalId === captured
            ? { kind: "idle" }
            : cur
        );
      }, delay);
    },
    []
  );

  if (!presets || !actions) {
    return (
      <div className="text-[13px] text-sw-muted py-12 text-center">
        Loading catalog…
      </div>
    );
  }

  const sidebar = mode === "sidebar";

  return (
    <div className="flex flex-col" style={{ height: "100%", minHeight: 0 }}>
      {/* Tabs + filters */}
      <div
        className="flex items-center gap-2 sw-hairline-bottom flex-wrap"
        style={{
          padding: sidebar ? "8px 10px" : "12px 24px",
          background: "var(--panel)",
        }}
      >
        {(["presets", "actions"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="font-mono uppercase transition-colors"
            style={{
              padding: "3px 10px",
              fontSize: 10,
              letterSpacing: "1.2px",
              border: "1px solid var(--line-hi)",
              background: tab === t ? "var(--ink)" : "transparent",
              color: tab === t ? "var(--bg)" : "var(--mid)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {t}
          </button>
        ))}
        {!sidebar && (
          <>
            <span style={{ width: 1, height: 18, background: "var(--line-hi)" }} />
            <Eyebrow tone="muted">Kind</Eyebrow>
          </>
        )}
        <KindFilterChips
          kinds={kinds}
          current={filterKind}
          onPick={setFilterKind}
          compact={sidebar}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={sidebar ? "Search…" : `Search ${tab}…`}
          className="font-mono"
          style={{
            marginLeft: "auto",
            padding: "3px 8px",
            fontSize: 11,
            background: "var(--card)",
            border: "1px solid var(--line-hi)",
            color: "var(--ink)",
            width: sidebar ? "100%" : 240,
            marginTop: sidebar ? 6 : 0,
            outline: "none",
            order: sidebar ? 10 : undefined,
          }}
        />
      </div>

      {/* Body — scrollable so the tab strip stays sticky-feeling. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {tab === "presets" ? (
          <PresetsView
            presets={presets}
            filterKind={filterKind}
            search={search}
            fire={fire}
            onFire={firePreset}
            compact={sidebar}
          />
        ) : (
          <ActionsView
            actions={actions}
            filterKind={filterKind}
            search={search}
            fire={fire}
            onFire={fireAction}
            compact={sidebar}
          />
        )}
      </div>
    </div>
  );
}

function KindFilterChips({
  kinds,
  current,
  onPick,
  compact,
}: {
  kinds: string[];
  current: string | null;
  onPick: (k: string | null) => void;
  compact: boolean;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        onClick={() => onPick(null)}
        className="font-mono uppercase transition-colors"
        style={{
          padding: compact ? "2px 6px" : "4px 10px",
          fontSize: compact ? 9 : 10,
          letterSpacing: "1.2px",
          border: "1px solid var(--line-hi)",
          background: current === null ? "var(--ink)" : "transparent",
          color: current === null ? "var(--bg)" : "var(--mid)",
          cursor: "pointer",
        }}
      >
        All
      </button>
      {kinds.map((k) => (
        <button
          key={k}
          onClick={() => onPick(k === current ? null : k)}
          className="font-mono uppercase transition-colors"
          style={{
            padding: compact ? "2px 6px" : "4px 10px",
            fontSize: compact ? 9 : 10,
            letterSpacing: "1.2px",
            border: "1px solid var(--line-hi)",
            background: current === k ? "var(--ink)" : "transparent",
            color: current === k ? "var(--bg)" : "var(--mid)",
            cursor: "pointer",
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────── Presets view ────────────────────────────

function PresetsView({
  presets,
  filterKind,
  search,
  fire,
  onFire,
  compact,
}: {
  presets: PresetEntry[];
  filterKind: string | null;
  search: string;
  fire: FireState;
  onFire: (p: PresetEntry) => void;
  compact: boolean;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return presets.filter((p) => {
      if (filterKind && p.kind !== filterKind) return false;
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [presets, filterKind, search]);

  const groups = useMemo(() => {
    const map = new Map<string, PresetEntry[]>();
    for (const p of filtered) {
      const key = `${p.kind}::${p.category ?? "Misc"}`;
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    return Array.from(map.entries())
      .map(([key, items]) => {
        const [kind, category] = key.split("::");
        return { kind, category, items };
      })
      .sort((a, b) =>
        a.kind === b.kind
          ? a.category.localeCompare(b.category)
          : a.kind.localeCompare(b.kind)
      );
  }, [filtered]);

  const tileMin = compact ? 70 : 110;
  const gap = compact ? 6 : 8;

  return (
    <div
      className="space-y-4"
      style={{ padding: compact ? "8px 10px" : "16px 24px" }}
    >
      {groups.map(({ kind, category, items }) => (
        <section key={`${kind}::${category}`} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <Eyebrow>{kind}</Eyebrow>
            <span
              className="font-mono uppercase"
              style={{
                fontSize: compact ? 10 : 11,
                letterSpacing: "0.16em",
                color: "var(--ink)",
                fontWeight: 600,
              }}
            >
              {category}
            </span>
            <MonoChip>{items.length}</MonoChip>
          </div>
          <div
            className="grid"
            style={{
              gap,
              gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))`,
            }}
          >
            {items.map((p) => (
              <PresetTile
                key={p.globalId}
                preset={p}
                state={fire}
                onFire={() => onFire(p)}
                compact={compact}
              />
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 && (
        <div className="text-[12px] text-sw-muted py-8 text-center">
          No presets match the current filter.
        </div>
      )}
    </div>
  );
}

function PresetTile({
  preset,
  state,
  onFire,
  compact,
}: {
  preset: PresetEntry;
  state: FireState;
  onFire: () => void;
  compact: boolean;
}) {
  const isFiring =
    state.kind === "running" && state.globalId === preset.globalId;
  const justOk = state.kind === "ok" && state.globalId === preset.globalId;
  const justErr = state.kind === "err" && state.globalId === preset.globalId;

  const bg = preset.bgcolor ?? "var(--card)";
  const fg = preset.fgcolor ?? "var(--ink)";
  const face = preset.text ?? preset.label;

  return (
    <button
      onClick={onFire}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/x-nexus-preset",
          JSON.stringify(preset)
        );
        e.dataTransfer.setData("text/plain", preset.globalId);
      }}
      title={`${preset.kind}:${preset.id}\n${preset.steps
        .map(
          (s) =>
            `→ ${s.actionId}${
              s.options ? ` ${JSON.stringify(s.options)}` : ""
            }`
        )
        .join("\n")}`}
      className="flex flex-col items-center justify-center text-center transition-transform"
      style={{
        aspectRatio: "1 / 1",
        padding: compact ? 6 : 8,
        background: bg,
        color: fg,
        border: "1px solid var(--line-hi)",
        outline: justOk
          ? "2px solid var(--pvw)"
          : justErr
            ? "2px solid var(--pgm)"
            : "none",
        outlineOffset: 2,
        cursor: "grab",
        fontFamily: "var(--font-mono)",
        opacity: isFiring ? 0.6 : 1,
        transform: isFiring ? "scale(0.96)" : "none",
        transitionDuration: "120ms",
        whiteSpace: "pre-line",
      }}
    >
      <span
        style={{
          fontSize: compact ? 10 : 13,
          fontWeight: 700,
          letterSpacing: "0.04em",
          lineHeight: 1.1,
          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      >
        {face}
      </span>
      <span
        style={{
          marginTop: 4,
          fontSize: compact ? 7 : 8,
          letterSpacing: "0.18em",
          opacity: 0.6,
          textTransform: "uppercase",
        }}
      >
        {preset.kind}
      </span>
    </button>
  );
}

// ─────────────────────────── Actions view ────────────────────────────

function ActionsView({
  actions,
  filterKind,
  search,
  fire,
  onFire,
  compact,
}: {
  actions: ActionEntry[];
  filterKind: string | null;
  search: string;
  fire: FireState;
  onFire: (a: ActionEntry, options: Record<string, unknown>) => void;
  compact: boolean;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return actions.filter((a) => {
      if (filterKind && a.kind !== filterKind) return false;
      if (!q) return true;
      return (
        a.label.toLowerCase().includes(q) ||
        a.category?.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
      );
    });
  }, [actions, filterKind, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ActionEntry[]>();
    for (const a of filtered) {
      const key = `${a.kind}::${a.category ?? "Misc"}`;
      const arr = map.get(key);
      if (arr) arr.push(a);
      else map.set(key, [a]);
    }
    return Array.from(map.entries())
      .map(([key, items]) => {
        const [kind, category] = key.split("::");
        return { kind, category, items };
      })
      .sort((a, b) =>
        a.kind === b.kind
          ? a.category.localeCompare(b.category)
          : a.kind.localeCompare(b.kind)
      );
  }, [filtered]);

  return (
    <div
      className="space-y-4"
      style={{ padding: compact ? "8px 10px" : "16px 24px" }}
    >
      {groups.map(({ kind, category, items }) => (
        <section key={`${kind}::${category}`} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <Eyebrow>{kind}</Eyebrow>
            <span
              className="font-mono uppercase"
              style={{
                fontSize: 11,
                letterSpacing: "0.16em",
                color: "var(--ink)",
                fontWeight: 600,
              }}
            >
              {category}
            </span>
            <MonoChip>{items.length}</MonoChip>
          </div>
          <div
            className="grid"
            style={{
              gap: compact ? 6 : 8,
              gridTemplateColumns: compact
                ? "1fr"
                : "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {items.map((a) => (
              <ActionRow
                key={a.globalId}
                action={a}
                state={fire}
                onFire={(opts) => onFire(a, opts)}
                compact={compact}
              />
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 && (
        <div className="text-[12px] text-sw-muted py-8 text-center">
          No actions match the current filter.
        </div>
      )}
    </div>
  );
}

function ActionRow({
  action,
  state,
  onFire,
  compact,
}: {
  action: ActionEntry;
  state: FireState;
  onFire: (options: Record<string, unknown>) => void;
  compact: boolean;
}) {
  const [opts, setOpts] = useState<Record<string, unknown>>(() => {
    const o: Record<string, unknown> = {};
    for (const opt of action.options ?? []) {
      if (opt.default !== undefined) o[opt.id] = opt.default;
    }
    return o;
  });
  const [expanded, setExpanded] = useState(false);

  const isFiring =
    state.kind === "running" && state.globalId === action.globalId;
  const justOk = state.kind === "ok" && state.globalId === action.globalId;
  const justErr = state.kind === "err" && state.globalId === action.globalId;
  const errMsg =
    state.kind === "err" && state.globalId === action.globalId
      ? state.error
      : null;

  const dragPayload = useMemo(
    () => ({
      globalId: action.globalId,
      kind: action.kind,
      id: action.id,
      label: action.label,
      category: action.category,
      text: action.label.toUpperCase().slice(0, 12),
      bgcolor: "#2c2c2e",
      fgcolor: "#ffffff",
      steps: [{ actionId: action.id, options: opts }],
    }),
    [action, opts]
  );

  const hasOptions = (action.options?.length ?? 0) > 0;

  return (
    <div
      style={{
        padding: compact ? 8 : 10,
        background: "var(--card)",
        border: "1px solid var(--line)",
        outline: justOk
          ? "2px solid var(--pvw)"
          : justErr
            ? "2px solid var(--pgm)"
            : "none",
        outlineOffset: 1,
      }}
      className="space-y-2"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div
            className="font-mono"
            style={{
              fontSize: compact ? 11 : 12,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            {action.label}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              color: "var(--sub)",
              marginTop: 2,
            }}
          >
            {action.globalId}
          </div>
          {!compact && action.description && (
            <div
              style={{
                fontSize: 10,
                color: "var(--muted)",
                marginTop: 4,
                lineHeight: 1.3,
              }}
            >
              {action.description}
            </div>
          )}
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData(
              "application/x-nexus-preset",
              JSON.stringify(dragPayload)
            );
            e.dataTransfer.setData("text/plain", action.globalId);
          }}
          title="Drag onto a surface to bind"
          style={{
            padding: "4px 8px",
            fontSize: 9,
            letterSpacing: "0.18em",
            background: "var(--panel-2)",
            border: "1px solid var(--line-hi)",
            color: "var(--mid)",
            cursor: "grab",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          ⋮⋮ Drag
        </div>
      </div>

      {hasOptions && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="font-mono uppercase"
          style={{
            fontSize: 9,
            letterSpacing: "0.18em",
            color: "var(--mid)",
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
          }}
        >
          {expanded ? "▾" : "▸"} {action.options.length} option
          {action.options.length === 1 ? "" : "s"}
        </button>
      )}

      {expanded && hasOptions && (
        <div className="space-y-1 pt-1">
          {action.options.map((opt) => (
            <OptionField
              key={opt.id}
              def={opt}
              value={opts[opt.id]}
              onChange={(v) => setOpts((cur) => ({ ...cur, [opt.id]: v }))}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onFire(opts)}
          disabled={isFiring}
          className="font-mono uppercase transition-colors"
          style={{
            padding: "4px 12px",
            fontSize: 10,
            letterSpacing: "1.4px",
            fontWeight: 600,
            background: isFiring ? "var(--panel-2)" : "var(--ink)",
            color: "var(--bg)",
            border: 0,
            cursor: isFiring ? "wait" : "pointer",
            opacity: isFiring ? 0.7 : 1,
          }}
        >
          {isFiring ? "Firing…" : "Fire"}
        </button>
        {errMsg && (
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: "var(--pgm)",
              flex: 1,
              minWidth: 0,
            }}
            title={errMsg}
          >
            ⚠ {errMsg.slice(0, 60)}
          </span>
        )}
      </div>
    </div>
  );
}

function OptionField({
  def,
  value,
  onChange,
}: {
  def: ActionOptionDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const labelStyle = {
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--sub)",
    textTransform: "uppercase" as const,
    fontWeight: 600,
    width: 110,
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
  };
  const inputStyle = {
    flex: 1,
    minWidth: 0,
    padding: "3px 6px",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  if (def.type === "number") {
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle} title={def.tooltip}>
          {def.label}
        </span>
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={inputStyle}
        />
      </div>
    );
  }
  if (def.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle} title={def.tooltip}>
          {def.label}
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "var(--cyan)" }}
        />
      </div>
    );
  }
  if (def.type === "dropdown") {
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle} title={def.tooltip}>
          {def.label}
        </span>
        <select
          value={typeof value === "string" ? value : String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {(def.choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span style={labelStyle} title={def.tooltip}>
        {def.label}
      </span>
      <input
        type="text"
        // Legacy bindings stored numeric defaults (e.g. input: 1
        // before we relaxed to string). Coerce so the field doesn't
        // display blank for those — operator-friendly migration.
        value={
          typeof value === "string"
            ? value
            : value === undefined || value === null
              ? ""
              : String(value)
        }
        placeholder={def.placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}
