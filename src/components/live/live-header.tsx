"use client";

import { useEffect, useRef, useState } from "react";
import type { VmixInput } from "@/lib/vmix/types";
import type { TransitionButton } from "./helpers";

/**
 * Live page header — NOW / NEXT on the left, transition SELECTOR on
 * the right. The transition row is no longer a "fire on click" set;
 * it's a radio that arms a transition. The next time the operator
 * clicks an input tile while a PGM or MIX destination is armed in
 * the broadcast bar, that transition is the one that gets applied.
 *
 * Right-click on a duration-bearing transition (Fade, Wipe, Slide, …)
 * opens a popover to override its ms — saved per host:port in the
 * page-level state. Cut and stingers don't accept a Duration arg, so
 * they ignore the context menu.
 */
export function LiveHeader({
  pgmInput,
  pvwInput,
  baseTransitions,
  selectedTransitionFn,
  onSelectTransition,
  durations,
  onSetDuration,
  autoSlot,
}: {
  pgmInput: VmixInput | null;
  pvwInput: VmixInput | null;
  /** Combined transition list (basic + stingers in one flow). The
   *  caller pre-merges so the buttons share a single label / wrap
   *  context. */
  baseTransitions: TransitionButton[];
  selectedTransitionFn: string;
  onSelectTransition: (t: TransitionButton) => void;
  /** Per-fn duration overrides. Falls back to TransitionButton.duration. */
  durations?: Record<string, number>;
  onSetDuration?: (fn: string, ms: number) => void;
  /** Auto-réalisation control, rendered as its own header section. Kept as a
   *  slot (not inline state) so its SSE stream re-renders only that subtree,
   *  not the whole Live page + input grid. */
  autoSlot?: React.ReactNode;
}) {
  return (
    <header
      // Wide screen → all sections in one row. Narrow → flex-wrap
      // drops each section to its own line. NOW / NEXT have a fixed
      // minWidth so they don't squeeze; TransitionRow's internal
      // buttons flex-wrap as a group when the row becomes the only
      // section on its line.
      className="flex flex-wrap items-stretch"
      style={{
        minHeight: 56,
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <NowNextSlot label="NOW" input={pgmInput} accent="red" />
      <NowNextSlot label="NEXT" input={pvwInput} accent="green" />
      {autoSlot}
      <TransitionRow
        label="TRANSITION"
        items={baseTransitions}
        selectedFn={selectedTransitionFn}
        onSelect={onSelectTransition}
        durations={durations}
        onSetDuration={onSetDuration}
      />
    </header>
  );
}

function TransitionRow({
  label,
  items,
  selectedFn,
  onSelect,
  durations,
  onSetDuration,
}: {
  label: string;
  items: TransitionButton[];
  selectedFn: string;
  onSelect: (t: TransitionButton) => void;
  durations?: Record<string, number>;
  onSetDuration?: (fn: string, ms: number) => void;
}) {
  // Right-click popover state. We track the fn being edited + the
  // anchor rect so the popover is rendered at the bar root (via
  // `position: fixed`) without being clipped by the row's flex layout.
  const [editingFn, setEditingFn] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingFn) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setEditingFn(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingFn(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [editingFn]);

  const editingItem = editingFn
    ? items.find((t) => t.fn === editingFn) ?? null
    : null;
  const editingCurrentMs = editingItem
    ? durations?.[editingItem.fn] ?? editingItem.duration ?? 0
    : 0;

  return (
    <div
      className="flex flex-col justify-center"
      style={{
        padding: "6px 12px 8px",
        borderLeft: "1px solid var(--line)",
        flex: "1 1 auto",
        minWidth: 0,
      }}
    >
      <span className="label" style={{ marginBottom: 4 }}>
        {label}
      </span>
      <div className="flex flex-wrap">
        {items.map((t, i) => {
          const armed = t.fn === selectedFn;
          const supportsDuration =
            t.duration !== undefined && !!onSetDuration;
          const effectiveMs = durations?.[t.fn] ?? t.duration;
          // Show the current ms (override or default) under the label.
          // Falls back to the static hint for transitions that don't
          // carry a duration (Cut, stingers).
          const subline = effectiveMs ? String(effectiveMs) : t.hint;

          return (
            <button
              key={`${t.fn}-${i}`}
              onClick={() => onSelect(t)}
              onContextMenu={
                supportsDuration
                  ? (e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenuPos({ x: rect.left, y: rect.bottom });
                      setEditingFn(t.fn);
                    }
                  : undefined
              }
              aria-pressed={armed}
              className="relative flex flex-col items-center justify-center transition-colors"
              style={{
                padding: "6px 12px 6px 14px",
                // Uniform 1 px line border on every side. Armed state
                // is conveyed via background fill + the 2 px left
                // amber bar painted below — never via border colour —
                // so adjacent armed/idle buttons never produce a
                // jagged 1-px misalignment at their shared seam.
                background: armed ? "var(--amber-tint)" : "var(--card)",
                color: armed ? "var(--amber)" : "var(--ink)",
                borderTop: "1px solid var(--line)",
                borderBottom: "1px solid var(--line)",
                borderRight: "1px solid var(--line)",
                borderLeft: i === 0 ? "1px solid var(--line)" : "none",
                minWidth: 56,
                transitionDuration: "80ms",
                fontWeight: armed ? 700 : 600,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!armed) e.currentTarget.style.background = "var(--card-hi)";
              }}
              onMouseLeave={(e) => {
                if (!armed) e.currentTarget.style.background = "var(--card)";
              }}
              title={
                supportsDuration
                  ? `${t.label} · ${effectiveMs} ms — right-click to change`
                  : t.label
              }
            >
              {armed && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: "var(--amber)",
                  }}
                />
              )}
              <span
                className="font-mono uppercase"
                style={{
                  fontSize: 11,
                  fontWeight: "inherit",
                  letterSpacing: "0.14em",
                }}
              >
                {t.label}
              </span>
              {subline && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 8,
                    color: armed ? "var(--amber)" : "var(--muted)",
                    letterSpacing: "0.16em",
                    marginTop: 1,
                  }}
                >
                  {subline}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {editingItem && menuPos && onSetDuration && (
        <div
          ref={menuRef}
          role="dialog"
          aria-label={`${editingItem.label} duration`}
          style={{
            position: "fixed",
            top: menuPos.y,
            left: menuPos.x,
            zIndex: 50,
            minWidth: 180,
            padding: 10,
            background: "var(--panel)",
            border: "1px solid var(--line-hi)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            className="label"
            style={{ color: "var(--muted)" }}
          >
            {editingItem.label} · duration ms
          </div>
          <div className="flex items-center" style={{ gap: 6 }}>
            <input
              ref={inputRef}
              type="number"
              defaultValue={editingCurrentMs}
              min={0}
              max={10000}
              step={50}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseInt(
                    (e.currentTarget as HTMLInputElement).value,
                    10
                  );
                  if (Number.isFinite(v) && v >= 0 && v <= 10000) {
                    onSetDuration(editingItem.fn, v);
                  }
                  setEditingFn(null);
                } else if (e.key === "Escape") {
                  setEditingFn(null);
                }
              }}
              className="font-mono"
              style={{
                flex: 1,
                padding: "4px 6px",
                fontSize: 12,
                background: "var(--card)",
                color: "var(--ink)",
                border: "1px solid var(--line-hi)",
                outline: "none",
              }}
            />
            <span
              className="font-mono"
              style={{ fontSize: 10, color: "var(--muted)" }}
            >
              ms
            </span>
          </div>
          <div className="flex" style={{ gap: 4 }}>
            {[250, 500, 1000, 2000].map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  onSetDuration(editingItem.fn, preset);
                  setEditingFn(null);
                }}
                className="font-mono uppercase"
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  fontSize: 9,
                  letterSpacing: "1.2px",
                  background: "var(--card)",
                  color: "var(--mid)",
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                  transition: "background 80ms ease, color 80ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--card-hi)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--card)";
                  e.currentTarget.style.color = "var(--mid)";
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              color: "var(--sub)",
              letterSpacing: "0.1em",
            }}
          >
            Enter to save · Esc to cancel
          </span>
        </div>
      )}
    </div>
  );
}

function NowNextSlot({
  label,
  input,
  accent,
}: {
  label: string;
  input: VmixInput | null;
  accent: "red" | "green";
}) {
  const accentColor = accent === "red" ? "var(--pgm)" : "var(--pvw)";
  return (
    <div
      className="flex flex-col justify-center min-w-0"
      style={{
        padding: "8px 16px",
        background: "var(--panel-2)",
        borderRight: "1px solid var(--line)",
        minWidth: 220,
      }}
    >
      <span className="label" style={{ marginBottom: 3 }}>
        {label}
      </span>
      <div
        className="font-bold truncate flex items-baseline gap-2"
        style={{ fontSize: 13 }}
      >
        {input ? (
          <>
            <span
              className="font-mono"
              style={{ color: accentColor, fontWeight: 700 }}
            >
              {String(input.number).padStart(2, "0")}
            </span>
            <span
              className="truncate"
              style={{ color: "var(--ink)", fontWeight: 500 }}
            >
              {input.title}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </div>
    </div>
  );
}
