"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  routeTargetAccent,
  routeTargetId,
  routeTargetLabel,
  type RouteTarget,
} from "./helpers";

/**
 * Sources you can park an external OUT 2/3/4 on when no input is
 * selected. Matches the values vMix's `SetOutput<N>` accepts in
 * `Value=` mode — see `setOutputSource()` in lib/vmix/commands.ts.
 */
const OUTPUT_PRESET_SOURCES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Output", value: "Output" },
  { label: "Preview", value: "Preview" },
  { label: "MultiView", value: "MultiView" },
  { label: "MultiView 2", value: "MultiView2" },
  { label: "Replay", value: "Replay" },
];

/**
 * Destination bar — multi-select "armed" destinations. Clicking any
 * destination chip toggles it in/out of the armed set; clicking an
 * input tile in the grid then broadcasts that input to every armed
 * destination at once. Right-click on OUT 2/3/4 still opens the
 * preset-source menu (Output / Preview / MultiView / Replay) so the
 * preset routing feature isn't lost when the bar switches modes.
 */
export function RouteModeBar({
  targets,
  armedIds,
  onToggle,
  onConfigureOutput,
}: {
  targets: RouteTarget[];
  armedIds: Set<string>;
  onToggle: (t: RouteTarget) => void;
  onConfigureOutput?: (outputFn: string, source: string) => void;
}) {
  const [openOutputId, setOpenOutputId] = useState<string | null>(null);
  // Menu anchor in viewport coords — we render the popover with
  // `position: fixed` so it escapes the bar's `overflow-x-auto`
  // (which used to clip it, forcing the operator to scroll the bar
  // horizontally to see the list).
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside / Escape to close. Listener registered only while a
  // menu is open so we don't trap every click on the page.
  useEffect(() => {
    if (!openOutputId) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setOpenOutputId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOutputId(null);
    };
    // Any scroll/resize while the menu is open invalidates the anchor.
    // Closing is the cheapest correct fix — the operator re-clicks.
    const onLayoutChange = () => setOpenOutputId(null);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [openOutputId]);

  return (
    <div
      // flex-wrap so the destination chips fall to a new line when
      // the viewport can't fit them all in a row, instead of being
      // hidden behind a horizontal scroll. The BROADCAST label stays
      // put as the first item; chips wrap inside the inner flex
      // container that takes whatever space is left.
      className="flex flex-wrap items-stretch"
      style={{
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        className="flex flex-col justify-center shrink-0"
        style={{
          padding: "8px 16px",
          borderRight: "1px solid var(--line)",
        }}
      >
        <span className="label" style={{ marginBottom: 2 }}>
          BROADCAST
        </span>
        <span style={{ fontSize: 10, color: "var(--mid)" }}>
          Arm destinations · click an input to send
        </span>
      </div>
      <div
        // Grid with `auto-fill, minmax(110px, 1fr)` so every cell is
        // the same width and the wrap is regular — no asymmetric
        // last row with stretched siblings above. Each button has
        // its own full border (no shared-edges collés look) because
        // grid cells don't merge borders cleanly across wraps.
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
        }}
      >
        {targets.map((t) => {
          const id = routeTargetId(t);
          const label = routeTargetLabel(t);
          const { fg, tint } = routeTargetAccent(t);
          const isArmed = armedIds.has(id);
          const isOut = t.kind === "out";
          const menuOpen = openOutputId === id;

          const handleClick = () => {
            setOpenOutputId(null);
            onToggle(t);
          };

          const handleContextMenu = (
            e: React.MouseEvent<HTMLButtonElement>
          ) => {
            if (!isOut || !onConfigureOutput) return;
            e.preventDefault();
            if (menuOpen) {
              setOpenOutputId(null);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPos({ x: rect.left, y: rect.bottom });
              setOpenOutputId(id);
            }
          };

          return (
            <button
              key={id}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              className={cn(
                "relative flex items-center justify-center font-mono uppercase transition-colors"
              )}
              style={{
                padding: "10px 12px",
                fontSize: 11,
                letterSpacing: "0.16em",
                fontWeight: 600,
                background: isArmed
                  ? tint
                  : menuOpen
                    ? "var(--amber-tint)"
                    : "transparent",
                color: isArmed
                  ? fg
                  : menuOpen
                    ? "var(--amber)"
                    : "var(--mid)",
                // Use negative margins so adjacent borders overlap into
                // a single 1 px line — the old "collés" look without
                // having to special-case the first cell of each row,
                // which the previous flex layout did manually via
                // `i === 0` (broken with grid wraps).
                border: "1px solid var(--line)",
                marginLeft: "-1px",
                marginTop: "-1px",
                transitionDuration: "80ms",
                cursor: "pointer",
              }}
              title={
                isOut
                  ? `Click to arm · right-click for ${label} preset`
                  : "Click to arm"
              }
              aria-pressed={isArmed}
              aria-haspopup={isOut && onConfigureOutput ? "menu" : undefined}
              aria-expanded={isOut && onConfigureOutput ? menuOpen : undefined}
            >
              {isArmed && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: fg,
                  }}
                />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {/* Popover menu — rendered at the bar root with `position: fixed`
          so the bar's overflow-x-auto can't clip it. Coordinates are
          captured from the source button on open. */}
      {openOutputId && menuPos && (() => {
        const t = targets.find((tt) => routeTargetId(tt) === openOutputId);
        if (!t || t.kind !== "out" || !onConfigureOutput) return null;
        return (
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: menuPos.y,
              left: menuPos.x,
              zIndex: 50,
              minWidth: 160,
              background: "var(--panel)",
              border: "1px solid var(--line-hi)",
              boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="label"
              style={{
                padding: "8px 12px 4px",
                color: "var(--muted)",
              }}
            >
              {routeTargetLabel(t)} · preset
            </div>
            {OUTPUT_PRESET_SOURCES.map((opt) => (
              <button
                key={opt.value}
                role="menuitem"
                onClick={() => {
                  onConfigureOutput(t.outputFn, opt.value);
                  setOpenOutputId(null);
                }}
                className="font-mono uppercase transition-colors w-full text-left"
                style={{
                  padding: "8px 12px",
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  background: "transparent",
                  color: "var(--ink)",
                  border: 0,
                  borderTop: "1px solid var(--line)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--card-hi)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
