"use client";

import { useMemo, useState } from "react";
import type { ActionCatalogEntry } from "./types";
import { ACTION_DND_MIME } from "./types";

/**
 * Draggable catalogue of every action. Drag a tile onto a track lane to
 * drop a clip there. Grouped by kind, filterable, mirroring the deck
 * editor's preset browser but emitting a timeline-specific payload.
 */
export function ActionPalette({
  actions,
}: {
  actions: ActionCatalogEntry[] | null;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  const kinds = useMemo(
    () => Array.from(new Set((actions ?? []).map((a) => a.kind))).sort(),
    [actions]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (actions ?? []).filter(
      (a) =>
        (!kindFilter || a.kind === kindFilter) &&
        (!q ||
          a.label.toLowerCase().includes(q) ||
          a.globalId.toLowerCase().includes(q))
    );
  }, [actions, query, kindFilter]);

  if (!actions) {
    return (
      <div
        className="font-mono"
        style={{ padding: 12, fontSize: 10, color: "var(--sub)" }}
      >
        Loading actions…
      </div>
    );
  }

  const selStyle: React.CSSProperties = {
    padding: "3px 6px",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  return (
    <div className="flex flex-col" style={{ minHeight: 0, flex: 1 }}>
      <div className="flex gap-2" style={{ padding: 8 }}>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          style={{ ...selStyle, flex: "0 0 88px" }}
        >
          <option value="">All</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          style={{ ...selStyle, flex: 1, minWidth: 0 }}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
          }}
        >
          {filtered.map((a) => (
            <div
              key={a.globalId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ACTION_DND_MIME, a.globalId);
                e.dataTransfer.setData("text/plain", a.label);
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={`${a.kind} · ${a.label} — drag onto a track`}
              className="font-mono"
              style={{
                padding: "6px 8px",
                background: a.bgcolor ?? "#3a3a3c",
                color: a.fgcolor ?? "#fff",
                border: "1px solid rgba(0,0,0,0.4)",
                cursor: "grab",
                fontSize: 10,
                lineHeight: 1.25,
                overflow: "hidden",
                userSelect: "none",
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  opacity: 0.7,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {a.kind}
              </div>
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontWeight: 600,
                }}
              >
                {a.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
