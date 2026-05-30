"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/sw";
import { Plus, Trash2 } from "lucide-react";
import type { DeckLayout } from "@/lib/db/streamdeck";
import type { DevicesResponse } from "./types";

/**
 * Left rail listing every page (layout). Click to switch, double-click
 * a name to rename, trash to delete, "+" to add. A dot shows pairing:
 * filled green = paired to a connected deck, hollow = paired serial not
 * currently present.
 */
export function PagesRail({
  layouts,
  selectedId,
  hw,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  layouts: DeckLayout[];
  selectedId: string;
  hw: DevicesResponse | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  return (
    <div
      className="flex flex-col"
      style={{
        width: 188,
        flexShrink: 0,
        borderRight: "1px solid var(--line)",
        background: "var(--panel)",
        minHeight: 0,
      }}
    >
      <div
        className="flex items-center justify-between sw-hairline-bottom"
        style={{ padding: "10px 12px" }}
      >
        <Eyebrow tone="muted">Pages</Eyebrow>
        <button
          onClick={onAdd}
          title="Add a page"
          className="flex items-center justify-center"
          style={{
            padding: 3,
            background: "var(--panel-2)",
            border: "1px solid var(--line-hi)",
            color: "var(--mid)",
            cursor: "pointer",
          }}
        >
          <Plus size={12} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {layouts.map((l) => {
          const isSel = l.id === selectedId;
          // A page can be paired to several decks; count how many of them
          // are currently connected.
          const pairedTotal = l.deviceSerials.length;
          const pairedOnline = l.deviceSerials.filter((s) =>
            hw?.devices.some((d) => d.serialNumber === s)
          ).length;
          const anyOnline = pairedOnline > 0;
          const count = Object.keys(l.bindings).length;
          return (
            <div
              key={l.id}
              onClick={() => onSelect(l.id)}
              className="group relative flex items-center gap-2"
              style={{
                padding: "8px 10px",
                cursor: "pointer",
                background: isSel ? "var(--card)" : "transparent",
                borderBottom: "1px solid var(--line)",
                borderLeft: isSel
                  ? "2px solid var(--amber)"
                  : "2px solid transparent",
              }}
            >
              {/* Pairing dot: filled when at least one paired deck is
                  online, outlined when paired-but-offline, empty when
                  unpaired. */}
              <span
                title={
                  pairedTotal === 0
                    ? "Not paired"
                    : `Paired · ${pairedTotal} deck${pairedTotal > 1 ? "s" : ""} (${pairedOnline} online)\n${l.deviceSerials.join(", ")}`
                }
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  flexShrink: 0,
                  background:
                    pairedTotal > 0 && anyOnline ? "var(--pvw)" : "transparent",
                  border: `1px solid ${
                    pairedTotal > 0 ? "var(--pvw)" : "var(--line-hi)"
                  }`,
                }}
              />
              {pairedTotal > 1 && (
                <span
                  title={`Paired to ${pairedTotal} decks`}
                  className="font-mono"
                  style={{
                    fontSize: 9,
                    color: "var(--pvw)",
                    flexShrink: 0,
                    letterSpacing: "0.04em",
                  }}
                >
                  ×{pairedTotal}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingId === l.id ? (
                  <input
                    autoFocus
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => {
                      if (draftLabel.trim()) onRename(l.id, draftLabel.trim());
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (draftLabel.trim()) onRename(l.id, draftLabel.trim());
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    className="font-mono"
                    style={{
                      width: "100%",
                      padding: "2px 4px",
                      fontSize: 11,
                      background: "var(--panel-2)",
                      border: "1px solid var(--amber)",
                      color: "var(--ink)",
                      outline: "none",
                    }}
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(l.id);
                      setDraftLabel(l.label);
                    }}
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      fontWeight: isSel ? 700 : 500,
                      color: isSel ? "var(--ink)" : "var(--mid)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`${l.label} · double-click to rename`}
                  >
                    {l.label}
                  </div>
                )}
                <div
                  className="font-mono"
                  style={{ fontSize: 9, color: "var(--sub)", marginTop: 1 }}
                >
                  {count} key{count !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(l.id);
                }}
                title="Delete page"
                className="opacity-0 group-hover:opacity-100"
                style={{
                  padding: 3,
                  background: "transparent",
                  border: 0,
                  color: "var(--sub)",
                  cursor: "pointer",
                  transition: "opacity 120ms",
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
