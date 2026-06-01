"use client";

import { useState } from "react";
import type { ActionCatalogEntry, ConnectionLite } from "./types";

// ─────────────────── Connection target picker ─────────────────────────

/**
 * Dropdown that pins a binding (or a single step) to a connection
 * instance. Each connection appears EXACTLY ONCE — no separate
 * "Inherit"/"Default" row that repeats a connection's name. The
 * effective fallback (the kind default for a button, or the button's
 * target for a step) is just tagged `· default` / `· button` on its
 * own row and pre-selected. Picking that tagged row stores `undefined`
 * so the binding keeps following the fallback if it later changes.
 */
export function ConnectionSelect({
  kind,
  connections,
  value,
  fallbackId,
  onChange,
}: {
  kind: string;
  connections: ConnectionLite[];
  value: string | undefined;
  /** The connection used when `value` is undefined — the instance the
   *  step resolves to at runtime (binding pin, else first of kind). Used
   *  only to pre-select the right row; not labelled. */
  fallbackId: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const instances = connections.filter((c) => c.kind === kind);
  // "None" = no connection. At binding level (no fallback) it means the key
  // is unassigned → offline + inert. At step level (a fallback binding pin
  // exists) it just clears this step's override → inherit the button's pin.
  const NONE = "__none__";
  const selected = value ?? fallbackId ?? NONE;
  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          color: "var(--sub)",
          textTransform: "uppercase",
          fontWeight: 600,
          width: 50,
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
        }}
      >
        Conn
      </span>
      <select
        value={selected}
        onChange={(e) => {
          const picked = e.target.value;
          // "None" or the inherited fallback row → store undefined (no
          // explicit pin here). Otherwise pin the chosen id.
          onChange(picked === NONE || picked === fallbackId ? undefined : picked);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          padding: "3px 6px",
          fontSize: 11,
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          color: "var(--ink)",
          fontFamily: "var(--font-mono)",
          outline: "none",
        }}
      >
        <option value={NONE}>None — offline</option>
        {instances.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.enabled ? "" : " (off)"}
          </option>
        ))}
      </select>
    </div>
  );
}

export function StepIconButton({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 18,
        height: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--panel-2)",
        border: "1px solid var(--line-hi)",
        color: danger ? "var(--pgm)" : "var(--mid)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        fontSize: 12,
        lineHeight: 1,
        fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/**
 * "Add action" control — appends another step to the button's action
 * list. Lets the operator pick any registered action across kinds, so
 * one key can fire several things (and drive multiple devices).
 */
export function AddActionControl({
  actions,
  onAdd,
}: {
  actions: ActionCatalogEntry[] | null;
  onAdd: (entry: ActionCatalogEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState("");
  const [picked, setPicked] = useState("");

  if (!actions || actions.length === 0) return null;

  const kinds = Array.from(new Set(actions.map((a) => a.kind))).sort();
  const filtered = kindFilter
    ? actions.filter((a) => a.kind === kindFilter)
    : actions;

  const selectStyle: React.CSSProperties = {
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="font-mono uppercase"
        style={{
          width: "100%",
          padding: "6px 10px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: "var(--panel-2)",
          border: "1px dashed var(--line-hi)",
          color: "var(--mid)",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        + Add action
      </button>
    );
  }

  return (
    <div
      style={{
        padding: 8,
        background: "var(--panel-2)",
        border: "1px solid var(--line-hi)",
      }}
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <select
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.target.value);
            setPicked("");
          }}
          style={{ ...selectStyle, flex: "0 0 90px" }}
        >
          <option value="">All</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={selectStyle}
        >
          <option value="">Pick an action…</option>
          {filtered.map((a) => (
            <option key={a.globalId} value={a.globalId}>
              {kindFilter ? a.label : `${a.kind} · ${a.label}`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const entry = actions.find((a) => a.globalId === picked);
            if (entry) onAdd(entry);
            setPicked("");
            setOpen(false);
          }}
          disabled={!picked}
          className="font-mono uppercase"
          style={{
            padding: "5px 12px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: picked ? "var(--amber)" : "var(--amber-tint)",
            color: picked ? "var(--bg)" : "var(--amber)",
            border: "1px solid var(--amber)",
            cursor: picked ? "pointer" : "not-allowed",
            fontWeight: 700,
            opacity: picked ? 1 : 0.6,
          }}
        >
          Add
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setPicked("");
          }}
          className="font-mono uppercase"
          style={{
            padding: "5px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "transparent",
            border: 0,
            color: "var(--sub)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
