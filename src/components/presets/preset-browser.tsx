"use client";

import { useEffect, useMemo, useState } from "react";
import { Eyebrow, MonoChip } from "@/components/sw";
import {
  KEY_FONT_FAMILY,
  KEY_FONT_WEIGHT,
  keyBackgroundCss,
} from "@/lib/streamdeck/key-face";

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
  bgcolor?: string;
  fgcolor?: string;
  options: ActionOptionDef[];
}

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
    const presetGlobalIds = new Set<string>();
    for (const p of presets) {
      presetGlobalIds.add(p.globalId);
      for (const s of p.steps) covered.add(`${p.kind}:${s.actionId}`);
    }
    const synthesized: PresetEntry[] = actions
      // Skip actions already covered by a preset step, AND any whose
      // globalId a preset already owns (a preset id == action id) — so
      // every tile's globalId stays unique (React key + drop payload).
      .filter(
        (a) => !covered.has(`${a.kind}:${a.id}`) && !presetGlobalIds.has(a.globalId)
      )
      .map((a) => ({
        globalId: a.globalId,
        kind: a.kind,
        id: a.id,
        label: a.label,
        category: a.category,
        text: a.label.toUpperCase().slice(0, 12),
        // Action-supplied tile colour (e.g. vMix carries its category
        // accent on the action since it ships no presets); neutral face
        // when the kind didn't specify one.
        bgcolor: a.bgcolor ?? "#2c2c2e",
        fgcolor: a.fgcolor ?? "#ffffff",
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
  compact,
}: {
  presets: PresetEntry[];
  filterKind: string | null;
  search: string;
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
              <PresetTile key={p.globalId} preset={p} compact={compact} />
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
  compact,
}: {
  preset: PresetEntry;
  compact: boolean;
}) {
  const bg = preset.bgcolor ?? "var(--card)";
  const fg = preset.fgcolor ?? "var(--ink)";
  const face = preset.text ?? preset.label;

  return (
    // Drag-only: tiles are dropped onto keys, never fired here. Actions are
    // tested from the key inspector's Test button so a stray click in the
    // browser can't trigger a live device action.
    <button
      type="button"
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
        background: keyBackgroundCss(bg),
        color: fg,
        border: "1px solid var(--line-hi)",
        cursor: "grab",
        fontFamily: "var(--font-mono)",
        transitionDuration: "120ms",
        whiteSpace: "pre-line",
      }}
    >
      {/* Same key font (Barlow Semi Condensed) the deck + hardware use, with
          a dark halo so the label stays legible on any face colour — so a
          preset tile reads like the key it becomes. */}
      <span
        style={{
          fontFamily: `"${KEY_FONT_FAMILY}", var(--font-sans)`,
          fontSize: compact ? 14 : 18,
          fontWeight: KEY_FONT_WEIGHT,
          letterSpacing: "0.01em",
          lineHeight: 1.05,
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
          fontFamily: "var(--font-mono)",
        }}
      >
        {preset.kind}
      </span>
    </button>
  );
}
