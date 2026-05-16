"use client";

import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";

const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
];

export function CanvasProperties() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const updateOverlay = useOverlayEditorStore((s) => s.updateOverlay);

  if (!overlay) return null;

  const update = (updates: Record<string, unknown>) =>
    updateOverlay(overlay.id, updates);

  return (
    <div className="space-y-3">
      <Field label="Name">
        <input
          className="sw-input"
          value={overlay.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>

      <Field label="Background">
        <div className="flex gap-2">
          {/* First input picks up Field's <label> via implicit
              nesting; the second needs an explicit aria-label since
              <label> only points at one. */}
          <input
            type="color"
            className="sw-color-swatch"
            value={overlay.backgroundColor}
            onChange={(e) => update({ backgroundColor: e.target.value })}
          />
          <input
            className="sw-input flex-1"
            value={overlay.backgroundColor}
            onChange={(e) => update({ backgroundColor: e.target.value })}
            aria-label="Background colour hex value"
          />
        </div>
      </Field>

      <Field label="Background Image">
        <input
          className="sw-input"
          value={overlay.backgroundImageUrl || ""}
          placeholder="https://…"
          onChange={(e) =>
            update({
              backgroundImageUrl: e.target.value || null,
              backgroundType: e.target.value ? "image" : "color",
            })
          }
        />
      </Field>

      <Field label="Texture URL">
        <input
          className="sw-input"
          value={overlay.textureUrl || ""}
          placeholder="https://…"
          onChange={(e) => update({ textureUrl: e.target.value || null })}
        />
      </Field>

      <Field label="Blend Mode">
        <select
          className="sw-select"
          value={overlay.blendMode}
          onChange={(e) => update({ blendMode: e.target.value })}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="sw-field-label" style={{ marginBottom: 0 }}>
            Texture Opacity
          </span>
          <span className="font-mono text-[11px] text-sw-text">
            {overlay.textureOpacity.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={overlay.textureOpacity}
          onChange={(e) => update({ textureOpacity: parseFloat(e.target.value) })}
          className="w-full"
          style={{ accentColor: "var(--pgm)" }}
          aria-label="Texture opacity"
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // <label> nesting implicitly associates the label text with the
  // FIRST interactive child (input / select / textarea) — no
  // htmlFor/id wiring needed. Multi-input fields (e.g. Background's
  // color picker + text input) get their own aria-label below for
  // the secondary input.
  return (
    <label className="block">
      <span className="sw-field-label">{label}</span>
      {children}
    </label>
  );
}
