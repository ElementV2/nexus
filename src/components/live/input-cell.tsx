"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { VmixInput } from "@/lib/vmix/types";
import { shortType } from "./helpers";

interface InputCellProps {
  input: VmixInput;
  state: "pgm" | "pvw" | "default";
  selected: boolean;
  onClick: (n: number) => void;
  /** Right-click toggles the mask state. Selection (left-click) keeps
   *  working independently so the operator can keep routing a tile
   *  that's been parked into a narrow strip — same model as vMix. */
  onToggleHide: (n: number) => void;
  /** Short labels for every destination this input is currently routed
   *  to (e.g. `["OVL1", "MIX2", "OUT3"]`). Rendered as small white chips
   *  so the operator can see at a glance where a non-PGM/non-PVW source
   *  is being used. Empty array → nothing rendered. */
  routedTo?: string[];
}

interface CollapsedInputCellProps {
  input: VmixInput;
  state: "pgm" | "pvw" | "default";
  selected: boolean;
  onClick: (n: number) => void;
  onToggleHide: (n: number) => void;
  /** Same shape as InputCell — surface routing even when masked so the
   *  operator doesn't need to expand a strip to know if a clip is live
   *  on an overlay. */
  routedTo?: string[];
}

/** Tiny white-ish chip used to flag a destination on a tile. */
function RouteChip({ label, dim }: { label: string; dim?: boolean }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "1px 4px",
        background: dim ? "transparent" : "var(--ink)",
        color: dim ? "var(--mid)" : "var(--bg)",
        border: dim ? "1px solid var(--line-hi)" : "0",
        lineHeight: 1.4,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Max destination chips shown before we collapse the rest into a
 * `+N` marker. Tuned so 4 short labels + the marker fit on a single
 * line at the standard tile width — anything more and the row wraps,
 * which would make some tiles taller than others and break the grid
 * scanability.
 */
const MAX_VISIBLE_ROUTE_CHIPS = 4;

/**
 * Collapsed tile for the Live grid. A single click selects the tile
 * AND opens the details panel — clicking the same tile again toggles
 * both off. Eye button hides the tile from the local view.
 *
 * Memoised so a poll tick that doesn't change THIS input's display
 * properties doesn't re-render it. We use a custom equality predicate
 * because the upstream `vmixState.inputs` array is rebuilt every poll
 * (every 150 ms) — by-reference equality on `input` would always fail
 * and re-render all 20+ tiles each tick. The fields below are the only
 * ones that affect the rendered tile; volume / meter / position are
 * ignored on purpose.
 */
function InputCellImpl({
  input,
  state,
  selected,
  onClick,
  onToggleHide,
  routedTo,
}: InputCellProps) {
  const isPGM = state === "pgm";
  const isPVW = state === "pvw";
  const isOffline = input.type === "Placeholder";

  return (
    <div
      onClick={() => onClick(input.number)}
      onContextMenu={(e) => {
        e.preventDefault();
        onToggleHide(input.number);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(input.number);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${input.title}${
        isPGM ? " — program" : isPVW ? " — preview" : ""
      }`}
      title="Click to select · right-click to mask"
      className={cn(
        "tile",
        isPGM && "tile--pgm",
        isPVW && "tile--pvw",
        selected && "tile--selected",
        isOffline && !isPGM && !isPVW && "tile--offline"
      )}
      // Fixed height — `minHeight` alone let chip-heavy tiles grow
      // taller than their neighbours, which broke the grid's visual
      // rhythm. With chips capped to one row above, 116 px fits the
      // header + big number + chips + title comfortably.
      style={{ height: 116, overflow: "hidden" }}
    >
      <div className="tile__header">
        <span className="tile__type">{shortType(input)}</span>
      </div>

      <div className="tile__number">
        {String(input.number).padStart(2, "0")}
      </div>
      {(() => {
        const list = routedTo ?? [];
        const visible = list.slice(0, MAX_VISIBLE_ROUTE_CHIPS);
        const overflow = list.length - visible.length;
        // Always render the row — even empty — so the big number and
        // title sit at the same Y on every tile, routed or not. Fixed
        // height matches a single chip (8 px font + 2 × 1 px padding +
        // 2 × 1 px border allowance ≈ 14 px) so the row reserves the
        // space whether or not it has content.
        return (
          <div
            className="flex items-center"
            style={{
              gap: 2,
              marginTop: 4,
              height: 14,
              minHeight: 14,
              flexWrap: "nowrap",
              overflow: "hidden",
            }}
            aria-label={
              list.length > 0
                ? `Routed to ${list.join(", ")}`
                : "Not routed"
            }
            title={list.length > 0 ? list.join(" · ") : undefined}
          >
            {visible.map((label) => (
              <RouteChip key={label} label={label} />
            ))}
            {overflow > 0 && <RouteChip label={`+${overflow}`} dim />}
          </div>
        );
      })()}
      <div className="flex items-end justify-between gap-2 mt-[2px]">
        <div className="tile__name flex-1 min-w-0" title={input.title}>
          {input.title}
        </div>
        {(isPGM || isPVW) && (
          <span
            className={cn("badge", isPGM ? "badge--pgm" : "badge--pvw")}
            style={{ marginTop: 0 }}
          >
            {isPGM ? "PGM" : "PVW"}
          </span>
        )}
      </div>
    </div>
  );
}

function sameLabels(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const InputCell = memo(InputCellImpl, (prev, next) => {
  if (prev.state !== next.state) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.onClick !== next.onClick) return false;
  if (prev.onToggleHide !== next.onToggleHide) return false;
  if (!sameLabels(prev.routedTo, next.routedTo)) return false;
  const a = prev.input;
  const b = next.input;
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.type === b.type &&
    a.shortTitle === b.shortTitle &&
    a.key === b.key
  );
});

/**
 * Collapsed/masked tile — mirrors vMix's "masked source" affordance:
 * a narrow vertical strip the operator can park a tile into without
 * losing track of it. PGM/PVW state stays visible via a left-edge
 * accent bar. Click anywhere on the strip → unmask back to a full
 * tile.
 */
function CollapsedInputCellImpl({
  input,
  state,
  selected,
  onClick,
  onToggleHide,
  routedTo,
}: CollapsedInputCellProps) {
  const isPGM = state === "pgm";
  const isPVW = state === "pvw";
  const accent = isPGM
    ? "var(--pgm)"
    : isPVW
      ? "var(--pvw)"
      : null;

  return (
    <div
      onClick={() => onClick(input.number)}
      onContextMenu={(e) => {
        e.preventDefault();
        onToggleHide(input.number);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(input.number);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${input.title} (masked)`}
      title={`${input.title} — click to select · right-click to unmask`}
      className="relative flex flex-col items-center cursor-pointer"
      style={{
        flex: "0 0 36px",
        minWidth: 36,
        maxWidth: 36,
        // Match the expanded tile so a row of mixed expanded/collapsed
        // sources stays perfectly aligned.
        height: 116,
        overflow: "hidden",
        background: isPGM
          ? "var(--pgm-tint)"
          : isPVW
            ? "var(--pvw-tint)"
            : "var(--card)",
        // Border keeps the PGM/PVW (or line) state at its natural
        // 1 px width regardless of selection — the selection is
        // overlaid via an outline so the content area never resizes
        // on click.
        border: `1px solid ${accent ?? "var(--line)"}`,
        outline: selected ? "2px solid var(--amber)" : undefined,
        outlineOffset: selected ? -2 : 0,
        boxSizing: "border-box",
        padding: "6px 2px 6px 4px",
        gap: 4,
        transition: "background 80ms ease, border-color 80ms ease",
      }}
      onMouseEnter={(e) => {
        // PGM/PVW deeper border on hover — but only when NOT
        // selected, otherwise the amber would be overwritten.
        if (selected) return;
        if (accent) {
          e.currentTarget.style.borderColor = isPGM
            ? "var(--pgm-deep)"
            : "var(--pvw-deep)";
        } else {
          e.currentTarget.style.background = "var(--card-hi)";
          e.currentTarget.style.borderColor = "var(--line-hi)";
        }
      }}
      onMouseLeave={(e) => {
        if (selected) return;
        if (accent) {
          e.currentTarget.style.borderColor = accent;
        } else {
          e.currentTarget.style.background = "var(--card)";
          e.currentTarget.style.borderColor = "var(--line)";
        }
      }}
    >
      {/* Number — bigger + bolder than before so it stays legible
          even at 36 px wide. Coloured for PGM/PVW reinforcement. */}
      <span
        className="font-mono"
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: isPGM
            ? "var(--pgm)"
            : isPVW
              ? "var(--pvw)"
              : "var(--ink)",
          lineHeight: 1,
        }}
      >
        {String(input.number).padStart(2, "0")}
      </span>
      {/* Title rotated bottom→top (writing-mode vertical-rl + 180°).
          Bolder + slightly larger for legibility. */}
      <span
        className="truncate"
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          fontSize: 11,
          fontWeight: 600,
          color: isPGM
            ? "var(--pgm)"
            : isPVW
              ? "var(--pvw)"
              : "var(--ink)",
          textOrientation: "mixed",
          flex: 1,
          minHeight: 0,
        }}
      >
        {input.title}
      </span>
      {/* Stacked white chips at the bottom — same vocabulary as the
          expanded tile so the operator can find which masked source
          is on which destination without unmasking. Capped to keep
          every collapsed strip the same height (the title is rotated
          and already eats most of the vertical space). */}
      {routedTo && routedTo.length > 0 && (() => {
        const MAX_COLLAPSED_CHIPS = 2;
        const visible = routedTo.slice(0, MAX_COLLAPSED_CHIPS);
        const overflow = routedTo.length - visible.length;
        return (
          <div
            className="flex flex-col items-center"
            style={{ gap: 2 }}
            aria-label={`Routed to ${routedTo.join(", ")}`}
            title={routedTo.join(" · ")}
          >
            {visible.map((label) => (
              <RouteChip key={label} label={label} />
            ))}
            {overflow > 0 && <RouteChip label={`+${overflow}`} dim />}
          </div>
        );
      })()}
    </div>
  );
}

export const CollapsedInputCell = memo(
  CollapsedInputCellImpl,
  (prev, next) => {
    if (prev.state !== next.state) return false;
    if (prev.selected !== next.selected) return false;
    if (prev.onClick !== next.onClick) return false;
    if (prev.onToggleHide !== next.onToggleHide) return false;
    if (!sameLabels(prev.routedTo, next.routedTo)) return false;
    const a = prev.input;
    const b = next.input;
    return (
      a.number === b.number &&
      a.title === b.title &&
      a.key === b.key
    );
  }
);
