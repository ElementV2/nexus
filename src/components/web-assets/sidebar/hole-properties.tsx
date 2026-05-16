"use client";

import { useMemo } from "react";
import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";
import type { HoleElement } from "@/lib/web-assets/types";

export function HoleProperties() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const updateElement = useOverlayEditorStore((s) => s.updateElement);
  const pushUndo = useOverlayEditorStore((s) => s.pushUndo);

  const el = useMemo(() => {
    if (!overlay || selectedIds.length !== 1) return null;
    const found = overlay.elements.find((e) => e.id === selectedIds[0]);
    return found?.type === "hole" ? (found as HoleElement) : null;
  }, [overlay, selectedIds]);

  if (!el) return null;

  const update = (updates: Partial<HoleElement>) => {
    pushUndo();
    updateElement(el.id, updates);
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sw-field-label">Border Color</span>
        <div className="flex gap-2">
          <input
            type="color"
            className="sw-color-swatch"
            value={el.borderColor}
            onChange={(e) => update({ borderColor: e.target.value })}
          />
          <input
            className="sw-input flex-1"
            value={el.borderColor}
            onChange={(e) => update({ borderColor: e.target.value })}
            aria-label="Border colour hex value"
          />
        </div>
      </label>

      <Range
        label="Border Width"
        suffix={`${el.borderWidth}px`}
        min={0}
        max={20}
        step={1}
        value={el.borderWidth}
        onChange={(v) => update({ borderWidth: v })}
      />

      <Range
        label="Border Radius"
        suffix={`${el.borderRadius}px`}
        min={0}
        max={200}
        step={1}
        value={el.borderRadius}
        onChange={(v) => update({ borderRadius: v })}
      />
    </div>
  );
}

function Range({
  label,
  suffix,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between mb-2">
        <span className="sw-field-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <span className="font-mono text-[11px] text-sw-text">{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--pgm)" }}
      />
    </label>
  );
}
