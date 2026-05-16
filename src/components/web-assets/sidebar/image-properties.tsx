"use client";

import { useMemo } from "react";
import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";
import type { ImageElement } from "@/lib/web-assets/types";

export function ImageProperties() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const updateElement = useOverlayEditorStore((s) => s.updateElement);
  const pushUndo = useOverlayEditorStore((s) => s.pushUndo);

  const el = useMemo(() => {
    if (!overlay || selectedIds.length !== 1) return null;
    const found = overlay.elements.find((e) => e.id === selectedIds[0]);
    return found?.type === "image" ? (found as ImageElement) : null;
  }, [overlay, selectedIds]);

  if (!el) return null;

  const update = (updates: Partial<ImageElement>) => {
    pushUndo();
    updateElement(el.id, updates);
  };

  return (
    <div className="space-y-3">
      <Field label="Source URL">
        <input
          className="sw-input"
          value={el.src}
          onChange={(e) => update({ src: e.target.value })}
          placeholder="https://…"
        />
      </Field>

      <Field label="Object Fit">
        <select
          className="sw-select"
          value={el.objectFit}
          onChange={(e) =>
            update({ objectFit: e.target.value as ImageElement["objectFit"] })
          }
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
          <option value="none">None</option>
        </select>
      </Field>

      <RangeField
        label="Opacity"
        suffix={el.opacity.toFixed(2)}
        min={0}
        max={1}
        step={0.01}
        value={el.opacity}
        onChange={(v) => update({ opacity: v })}
      />

      <RangeField
        label="Border Radius"
        suffix={`${el.borderRadius}px`}
        min={0}
        max={200}
        step={1}
        value={el.borderRadius}
        onChange={(v) => update({ borderRadius: v })}
      />

      <Field label="Border Color">
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
          />
        </div>
      </Field>

      <RangeField
        label="Border Width"
        suffix={`${el.borderWidth}px`}
        min={0}
        max={20}
        step={1}
        value={el.borderWidth}
        onChange={(v) => update({ borderWidth: v })}
      />
    </div>
  );
}

// Implicit <label> nesting associates the label with the first
// interactive child — see canvas-properties.tsx for the rationale.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="sw-field-label">{label}</span>
      {children}
    </label>
  );
}

function RangeField({
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
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="sw-field-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <span className="font-mono text-[11px] text-sw-text">{suffix}</span>
      </div>
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
    </div>
  );
}
