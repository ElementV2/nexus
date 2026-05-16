"use client";

import { useMemo } from "react";
import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";
import type { OverlayElement } from "@/lib/web-assets/types";

export function ElementProperties() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const updateElement = useOverlayEditorStore((s) => s.updateElement);
  const pushUndo = useOverlayEditorStore((s) => s.pushUndo);

  const el = useMemo(() => {
    if (!overlay || selectedIds.length !== 1) return null;
    return overlay.elements.find((e) => e.id === selectedIds[0]) || null;
  }, [overlay, selectedIds]);

  if (!el) return null;

  const update = (updates: Partial<OverlayElement>) => {
    pushUndo();
    updateElement(el.id, updates);
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sw-field-label">Name</span>
        <input
          className="sw-input"
          value={el.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={Math.round(el.x)} onChange={(v) => update({ x: v })} />
        <NumField label="Y" value={Math.round(el.y)} onChange={(v) => update({ y: v })} />
        <NumField
          label="W"
          value={Math.round(el.width)}
          onChange={(v) => update({ width: Math.max(10, v) })}
        />
        <NumField
          label="H"
          value={Math.round(el.height)}
          onChange={(v) => update({ height: Math.max(10, v) })}
        />
      </div>

      <NumField
        label="Rotation"
        value={el.rotation}
        onChange={(v) => update({ rotation: v })}
        suffix="°"
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between mb-1.5">
        <span className="sw-field-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        {suffix && (
          <span className="font-mono text-[10px] text-sw-muted">{suffix}</span>
        )}
      </span>
      <input
        type="number"
        className="sw-input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
