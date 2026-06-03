"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

/** One entry in the switcher dropdown. */
export interface PageSwitcherItem {
  id: string;
  label: string;
  /** Small suffix shown after the label, e.g. "3 cues" or "×2". */
  meta?: string;
  /** Status dot: filled = active/online, outline = known/offline, none. */
  dot?: "filled" | "outline" | "none";
}

/**
 * Compact page/scenario selector for a toolbar — a dropdown plus inline
 * rename, add and delete. Replaces a full-height left rail so the editor
 * canvas gets the horizontal space back. Shared by the Stream Deck pages
 * and the Live Show scenarios.
 */
export function PageSwitcher({
  items,
  selectedId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  addTitle = "Add",
  deleteTitle = "Delete",
  minWidth = 160,
}: {
  items: PageSwitcherItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  addTitle?: string;
  deleteTitle?: string;
  minWidth?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cur = items.find((i) => i.id === selectedId);

  const btn: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
    background: "var(--panel-2)",
    border: "1px solid var(--line-hi)",
    color: "var(--mid)",
    cursor: "pointer",
  };
  const field: React.CSSProperties = {
    minWidth,
    padding: "5px 8px",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  if (editing && cur) {
    const commit = () => {
      if (draft.trim()) onRename(cur.id, draft.trim());
      setEditing(false);
    };
    return (
      <div className="flex items-center" style={{ gap: 4 }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          style={{ ...field, border: "1px solid var(--amber)" }}
        />
        <button onClick={commit} title="Save name" style={btn}>
          <Check size={13} />
        </button>
        <button onClick={() => setEditing(false)} title="Cancel" style={btn}>
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center" style={{ gap: 4 }}>
      {/* Status dot for the current item. */}
      {cur?.dot && cur.dot !== "none" && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            flexShrink: 0,
            background: cur.dot === "filled" ? "var(--pvw)" : "transparent",
            border: `1px solid ${cur.dot === "filled" ? "var(--pvw)" : "var(--line-hi)"}`,
          }}
        />
      )}
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        style={field}
      >
        {items.map((i) => {
          const prefix =
            i.dot === "filled" ? "● " : i.dot === "outline" ? "○ " : "";
          return (
            <option key={i.id} value={i.id}>
              {prefix}
              {i.label}
              {i.meta ? ` · ${i.meta}` : ""}
            </option>
          );
        })}
      </select>
      <button
        onClick={() => {
          setDraft(cur?.label ?? "");
          setEditing(true);
        }}
        disabled={!cur}
        title="Rename"
        style={{ ...btn, opacity: cur ? 1 : 0.4 }}
      >
        <Pencil size={12} />
      </button>
      <button onClick={onAdd} title={addTitle} style={btn}>
        <Plus size={13} />
      </button>
      <button
        onClick={() => cur && onDelete(cur.id)}
        disabled={!cur || items.length <= 1}
        title={deleteTitle}
        style={{ ...btn, opacity: cur && items.length > 1 ? 1 : 0.4 }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
