"use client";

import { useMemo } from "react";
import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";
import type { TextElement } from "@/lib/web-assets/types";
import { Eyebrow } from "@/components/sw";

const FONT_FAMILIES = [
  "Inter, sans-serif",
  "Arial, sans-serif",
  "Helvetica, sans-serif",
  "Georgia, serif",
  "Times New Roman, serif",
  "Courier New, monospace",
  "Verdana, sans-serif",
  "Impact, sans-serif",
];

const FONT_WEIGHTS = [
  { label: "Light", value: 300 },
  { label: "Normal", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semi Bold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Extra Bold", value: 800 },
  { label: "Black", value: 900 },
];

export function TextProperties() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const updateElement = useOverlayEditorStore((s) => s.updateElement);
  const pushUndo = useOverlayEditorStore((s) => s.pushUndo);

  const el = useMemo(() => {
    if (!overlay || selectedIds.length !== 1) return null;
    const found = overlay.elements.find((e) => e.id === selectedIds[0]);
    return found?.type === "text" ? (found as TextElement) : null;
  }, [overlay, selectedIds]);

  if (!el) return null;

  const update = (updates: Partial<TextElement>) => {
    pushUndo();
    updateElement(el.id, updates);
  };

  return (
    <div className="space-y-3">
      <Field label="Content">
        <input
          className="sw-input"
          value={el.content}
          onChange={(e) => update({ content: e.target.value })}
        />
      </Field>

      <Field label="Font Family">
        <select
          className="sw-select"
          value={el.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.split(",")[0]}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Size">
          <input
            type="number"
            className="sw-input"
            value={el.fontSize}
            onChange={(e) =>
              update({ fontSize: Math.max(1, Number(e.target.value)) })
            }
          />
        </Field>
        <Field label="Weight">
          <select
            className="sw-select"
            value={String(el.fontWeight)}
            onChange={(e) => update({ fontWeight: Number(e.target.value) })}
          >
            {FONT_WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ColorField
        label="Color"
        value={el.color}
        onChange={(v) => update({ color: v })}
      />
      <ColorField
        label="Background"
        value={el.backgroundColor}
        onChange={(v) => update({ backgroundColor: v })}
        placeholder="transparent"
      />

      <Field label="Align">
        <select
          className="sw-select"
          value={el.textAlign}
          onChange={(e) =>
            update({ textAlign: e.target.value as "left" | "center" | "right" })
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </Field>

      <Range
        label="Line Height"
        suffix={el.lineHeight.toFixed(1)}
        min={0.8}
        max={3}
        step={0.1}
        value={el.lineHeight}
        onChange={(v) => update({ lineHeight: v })}
      />

      <div className="pt-2">
        <Eyebrow tone="muted" className="mb-3">Shadow</Eyebrow>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Blur">
            <input
              type="number"
              className="sw-input"
              value={el.shadowBlur}
              min={0}
              onChange={(e) =>
                update({ shadowBlur: Math.max(0, Number(e.target.value)) })
              }
            />
          </Field>
          <Field label="Color">
            <input
              type="color"
              className="sw-color-swatch"
              style={{ width: "100%", height: 32 }}
              value={el.shadowColor.startsWith("rgba") ? "#000000" : el.shadowColor}
              onChange={(e) => update({ shadowColor: e.target.value })}
            />
          </Field>
          <Field label="Offset X">
            <input
              type="number"
              className="sw-input"
              value={el.shadowOffsetX}
              onChange={(e) =>
                update({ shadowOffsetX: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Offset Y">
            <input
              type="number"
              className="sw-input"
              value={el.shadowOffsetY}
              onChange={(e) =>
                update({ shadowOffsetY: Number(e.target.value) })
              }
            />
          </Field>
        </div>
      </div>

      <div className="pt-2">
        <Eyebrow tone="muted" className="mb-3">Stroke</Eyebrow>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width">
            <input
              type="number"
              className="sw-input"
              value={el.strokeWidth}
              min={0}
              onChange={(e) =>
                update({ strokeWidth: Math.max(0, Number(e.target.value)) })
              }
            />
          </Field>
          <Field label="Color">
            <input
              type="color"
              className="sw-color-swatch"
              style={{ width: "100%", height: 32 }}
              value={el.strokeColor}
              onChange={(e) => update({ strokeColor: e.target.value })}
            />
          </Field>
        </div>
      </div>
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

function ColorField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          type="color"
          className="sw-color-swatch"
          value={value === "transparent" ? "#000000" : value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="sw-input flex-1"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value || placeholder || "")}
        />
      </div>
    </Field>
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
