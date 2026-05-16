"use client";

import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";
import { cn } from "@/lib/utils";
import type { OverlayElement } from "@/lib/web-assets/types";

const typeGlyph: Record<OverlayElement["type"], string> = {
  hole: "▢",
  text: "T",
  image: "▣",
};

export function LayersPanel() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const selectElement = useOverlayEditorStore((s) => s.selectElement);
  const updateElement = useOverlayEditorStore((s) => s.updateElement);

  if (!overlay) return null;

  const sortedElements = [...overlay.elements].sort(
    (a, b) => b.zIndex - a.zIndex
  );

  if (sortedElements.length === 0) {
    return (
      <p className="text-[11px] text-sw-muted py-2">
        Double-click canvas to add an element.
      </p>
    );
  }

  return (
    <div className="space-y-px">
      {sortedElements.map((el) => {
        const isSelected = selectedIds.includes(el.id);
        return (
          <div
            key={el.id}
            onClick={(e) =>
              selectElement(el.id, e.shiftKey || e.ctrlKey || e.metaKey)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectElement(el.id, e.shiftKey || e.ctrlKey || e.metaKey);
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`Select layer ${el.name}`}
            className={cn(
              "flex items-center gap-2 cursor-pointer group transition-colors"
            )}
            style={{
              padding: "5px 8px",
              fontSize: 11,
              background: isSelected ? "var(--amber-tint)" : "transparent",
              color: isSelected ? "var(--ink)" : "var(--mid)",
              borderLeft: isSelected
                ? "2px solid var(--amber)"
                : "2px solid transparent",
              transitionDuration: "80ms",
            }}
          >
            <span
              className="font-mono w-4 text-center shrink-0"
              style={{ fontSize: 11, color: "var(--muted)" }}
            >
              {typeGlyph[el.type]}
            </span>
            <span className="flex-1 truncate">{el.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateElement(el.id, { visible: !el.visible });
              }}
              className="opacity-0 group-hover:opacity-100"
              style={{
                fontSize: 10,
                color: "var(--muted)",
              }}
              title={el.visible ? "Hide" : "Show"}
              aria-label={el.visible ? `Hide layer ${el.name}` : `Show layer ${el.name}`}
              aria-pressed={!el.visible}
            >
              {el.visible ? "●" : "○"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateElement(el.id, { locked: !el.locked });
              }}
              style={{
                fontSize: 10,
                color: el.locked ? "var(--amber)" : "var(--muted)",
                opacity: el.locked ? 1 : 0,
              }}
              className={el.locked ? "" : "group-hover:opacity-100"}
              title={el.locked ? "Unlock" : "Lock"}
              aria-label={el.locked ? `Unlock layer ${el.name}` : `Lock layer ${el.name}`}
              aria-pressed={el.locked}
            >
              {el.locked ? "■" : "□"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
