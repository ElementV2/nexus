"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eyebrow, MonoChip } from "@/components/sw";

/**
 * Unified browser of everything you can drop on a surface. There is ONE
 * list: presets. An "action" with no curated preset is surfaced as an
 * auto-generated tile (its label + default options on a neutral face),
 * so every operation is reachable without a second tab. Per-key
 * parameters are edited in the inspector after the tile is dropped.
 *
 * Drop payload: MIME `application/x-nexus-preset` carries a JSON-encoded
 * `{ globalId, kind, label, text, bgcolor, fgcolor, steps }`. Surface
 * editors (Stream Deck, Loupedeck, ...) only listen for that one type.
 *
 * Two layout modes:
 *   • `full` (default) — page-width, generous spacing.
 *   • `sidebar` — narrow column embedded in the deck editor.
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
  /** True when synthesized from an action that had no curated preset.
   *  Fired via /api/actions/run instead of /api/presets/run. */
  synthetic?: boolean;
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

export interface PresetBrowserPanelProps {
  mode?: "full" | "sidebar";
}

/** Default option values declared by an action, as a frozen options map. */
function defaultsOf(options: ActionOptionDef[] | undefined): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const opt of options ?? []) {
    if (opt.default !== undefined) o[opt.id] = opt.default;
  }
  return o;
}

export function PresetBrowserPanel({
  mode = "full",
}: PresetBrowserPanelProps) {
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

  // The single tile list: curated presets, plus an auto-tile for every
  // action no preset already covers (so the one tab is exhaustive but
  // never duplicates a curated tile — e.g. vMix is 1:1 so adds none).
  const tiles = useMemo<PresetEntry[] | null>(() => {
    if (!presets || !actions) return null;
    const covered = new Set<string>();
    for (const p of presets) {
      for (const s of p.steps) covered.add(`${p.kind}:${s.actionId}`);
    }
    const synthesized: PresetEntry[] = actions
      .filter((a) => !covered.has(`${a.kind}:${a.id}`))
      .map((a) => ({
        globalId: a.globalId,
        kind: a.kind,
        id: a.id,
        label: a.label,
        category: a.category,
        text: a.label.toUpperCase().slice(0, 12),
        bgcolor: "#2c2c2e",
        fgcolor: "#ffffff",
        steps: [{ actionId: a.id, options: defaultsOf(a.options) }],
        synthetic: true,
      }));
    return [...presets, ...synthesized];
  }, [presets, actions]);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    tiles?.forEach((t) => s.add(t.kind));
    return Array.from(s).sort();
  }, [tiles]);

  const fireTile = useCallback(async (p: PresetEntry) => {
    setFire({ kind: "running", globalId: p.globalId });
    let next: FireState;
    try {
      // Curated presets resolve server-side by globalId; synthesized
      // action-tiles fire their single action with the frozen options.
      let failedError: string | null = null;
      if (p.synthetic) {
        const step = p.steps[0];
        const res = await fetch("/api/actions/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            globalId: `${p.kind}:${step.actionId}`,
            options: step.options ?? {},
          }),
        });
        const json = (await res.json()) as
          | { ok: true; data: unknown }
          | { ok: false; error: string };
        if (!json.ok) failedError = json.error;
      } else {
        const res = await fetch("/api/presets/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ globalId: p.globalId }),
        });
        const json = (await res.json()) as {
          results: Array<{ ok: boolean; error?: string }>;
        };
        failedError = json.results.find((r) => !r.ok)?.error ?? null;
      }
      next = failedError
        ? { kind: "err", globalId: p.globalId, error: failedError }
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

  if (!tiles) {
    return (
      <div className="text-[13px] text-sw-muted py-12 text-center">
        Loading catalog…
      </div>
    );
  }

  const sidebar = mode === "sidebar";

  return (
    <div className="flex flex-col" style={{ height: "100%", minHeight: 0 }}>
      {/* Filters (single list — no preset/action tabs). */}
      <div
        className="flex items-center gap-2 sw-hairline-bottom flex-wrap"
        style={{
          padding: sidebar ? "8px 10px" : "12px 24px",
          background: "var(--panel)",
        }}
      >
        {!sidebar && <Eyebrow tone="muted">Kind</Eyebrow>}
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
          placeholder="Search…"
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

      {/* Body — scrollable so the filter strip stays sticky-feeling. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <PresetsView
          presets={tiles}
          filterKind={filterKind}
          search={search}
          fire={fire}
          onFire={fireTile}
          compact={sidebar}
        />
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

// ─────────────────────────── Tile grid ───────────────────────────────

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
          Nothing matches the current filter.
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
        // Drop the same payload shape for curated + synthesized tiles;
        // the surface editor only reads globalId/kind/steps/style.
        const { synthetic: _omit, ...payload } = preset;
        e.dataTransfer.setData(
          "application/x-nexus-preset",
          JSON.stringify(payload)
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
