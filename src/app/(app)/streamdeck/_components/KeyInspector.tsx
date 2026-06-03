"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/sw";
import { X, Copy } from "lucide-react";
import type { DeckBinding, DeckStep } from "@/lib/db/streamdeck";
import { useActionCatalog, useVmixInputSuggestions } from "./action-catalog";
import type {
  ActionCatalogEntry,
  ConnectionLite,
  FireState,
} from "./types";
import { ColorField, FaceField, InspectorOptionField } from "./inspector-fields";
import { KeyFacePreview } from "./KeyFacePreview";
import {
  AddActionControl,
  ConnectionSelect,
  StepIconButton,
} from "./inspector-actions";

export function KeyInspector({
  keyIndex,
  binding,
  connections,
  onChange,
  onTest,
  onClear,
  onClose,
  onPickBrowser,
  onCopy,
  onPaste,
  canPaste,
  fire,
}: {
  keyIndex: number | null;
  binding: DeckBinding | undefined;
  connections: ConnectionLite[];
  onChange: (next: DeckBinding) => void;
  onTest: () => void;
  onClear: () => void;
  onClose: () => void;
  onPickBrowser: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
  fire: FireState;
}) {
  const actions = useActionCatalog();
  // Quick-pick suggestions for fields the operator typically picks
  // from a live list. Today: vMix input names (Camera 1, Lower Third,
  // …). Add more dataSource → fetcher mappings as we wire other
  // kinds' snapshots.
  const kind = binding?.preset.kind ?? null;
  const inputSuggestions = useVmixInputSuggestions(kind === "vmix");
  // Index of the step currently being dragged (HTML5 DnD reorder).
  const [dragStep, setDragStep] = useState<number | null>(null);

  if (keyIndex === null) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: 24, height: "100%" }}>
        <Eyebrow tone="muted">No selection</Eyebrow>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            marginTop: 8,
            lineHeight: 1.4,
            maxWidth: 240,
          }}
        >
          Click a key in the deck to edit its face and options. Drop a preset from the{" "}
          <button
            onClick={onPickBrowser}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--amber)",
              textDecoration: "underline",
              cursor: "pointer",
              padding: 0,
              fontSize: "inherit",
              fontFamily: "inherit",
            }}
          >
            browser tab
          </button>{" "}
          to bind an empty key.
        </div>
      </div>
    );
  }

  if (!binding) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: 24, height: "100%" }}>
        <Eyebrow tone="muted">Key {keyIndex + 1}</Eyebrow>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            marginTop: 8,
          }}
        >
          Empty key. Drop a preset on it to start.
        </div>
        <button
          onClick={onPickBrowser}
          className="font-mono uppercase"
          style={{
            marginTop: 12,
            padding: "5px 12px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "var(--amber-tint)",
            border: "1px solid var(--amber)",
            color: "var(--amber)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Open browser
        </button>
        {canPaste && (
          <button
            onClick={onPaste}
            title="Paste the copied key here (Ctrl/Cmd+V)"
            className="font-mono uppercase"
            style={{
              marginTop: 8,
              padding: "5px 12px",
              fontSize: 10,
              letterSpacing: "1.4px",
              background: "var(--panel-2)",
              border: "1px solid var(--line-hi)",
              color: "var(--mid)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Paste here
          </button>
        )}
        <button
          onClick={onClose}
          className="font-mono uppercase"
          style={{
            marginTop: 6,
            padding: "4px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "transparent",
            border: 0,
            color: "var(--sub)",
            cursor: "pointer",
          }}
        >
          Deselect
        </button>
      </div>
    );
  }

  // Local mirrors for live editing — pushed up via onChange so the
  // deck mockup and hardware re-render on every keystroke.
  const preset = binding.preset;
  const isFiring = fire.kind === "running" && fire.keyIndex === keyIndex;

  const patchPreset = (patch: Partial<typeof preset>) => {
    onChange({ ...binding, preset: { ...preset, ...patch } });
  };
  // Mutate the binding's own fields (connectionId = the button's target
  // connection). `undefined` = None → the key is unassigned (offline + inert).
  const patchBinding = (patch: Partial<DeckBinding>) => {
    onChange({ ...binding, ...patch });
  };
  const patchStepOptions = (
    stepIdx: number,
    patch: Record<string, unknown>
  ) => {
    const nextSteps = preset.steps.map((s, i) =>
      i === stepIdx
        ? { ...s, options: { ...(s.options ?? {}), ...patch } }
        : s
    );
    onChange({ ...binding, preset: { ...preset, steps: nextSteps } });
  };
  // Mutate a step's own fields (connectionId, kind, …).
  const patchStep = (stepIdx: number, patch: Partial<DeckStep>) => {
    const nextSteps = preset.steps.map((s, i) =>
      i === stepIdx ? { ...s, ...patch } : s
    );
    onChange({ ...binding, preset: { ...preset, steps: nextSteps } });
  };
  const removeStep = (stepIdx: number) => {
    const nextSteps = preset.steps.filter((_, i) => i !== stepIdx);
    onChange({ ...binding, preset: { ...preset, steps: nextSteps } });
  };
  // Duplicate a step in place (inserted right after the original) so a
  // tweaked copy is one click away.
  const duplicateStep = (stepIdx: number) => {
    const s = preset.steps[stepIdx];
    if (!s) return;
    const copy: DeckStep = {
      ...s,
      options: s.options ? { ...s.options } : undefined,
    };
    const nextSteps = [...preset.steps];
    nextSteps.splice(stepIdx + 1, 0, copy);
    onChange({ ...binding, preset: { ...preset, steps: nextSteps } });
  };
  // Drag-reorder: move a step from one position to another (insert, not
  // swap) so dragging across several slots feels natural.
  const moveStepTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const nextSteps = [...preset.steps];
    const [moved] = nextSteps.splice(from, 1);
    nextSteps.splice(to, 0, moved);
    onChange({ ...binding, preset: { ...preset, steps: nextSteps } });
  };
  const addAction = (entry: ActionCatalogEntry) => {
    const seeded: Record<string, unknown> = {};
    for (const o of entry.options) {
      if (o.default !== undefined) seeded[o.id] = o.default;
    }
    const nextStep: DeckStep = {
      actionId: entry.globalId,
      kind: entry.kind,
      options: seeded,
    };
    onChange({
      ...binding,
      preset: { ...preset, steps: [...preset.steps, nextStep] },
    });
  };
  // The kind a step dispatches to (its own > global-id prefix > the
  // binding's preset kind). Used to scope the per-step target picker.
  const stepKindOf = (step: DeckStep): string =>
    step.kind ??
    (step.actionId.includes(":")
      ? step.actionId.slice(0, step.actionId.indexOf(":"))
      : preset.kind);
  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Face preview + meta — painted by the shared key-face drawer so it
          matches the physical deck exactly. */}
      <div className="flex items-start gap-3">
        <KeyFacePreview
          bg={preset.bgcolor ?? "#0a0a0a"}
          fg={preset.fgcolor ?? "#ffffff"}
          face={preset.text ?? preset.label}
          size={88}
          style={{
            flexShrink: 0,
            border: "1px solid var(--line-hi)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Eyebrow tone="muted">Key {keyIndex + 1}</Eyebrow>
          <div
            className="font-mono"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--ink)",
              marginTop: 2,
            }}
            title={preset.globalId}
          >
            {preset.kind}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              color: "var(--sub)",
              marginTop: 2,
              wordBreak: "break-all",
            }}
          >
            {preset.id}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Deselect"
          style={{
            padding: 4,
            background: "transparent",
            border: 0,
            color: "var(--sub)",
            cursor: "pointer",
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Connection — which device this button targets. "None" leaves the key
          unassigned: it shows the offline marker and a press does nothing. */}
      {connections.some((c) => c.kind === preset.kind) && (
        <section className="space-y-2">
          <Eyebrow tone="muted">Connection</Eyebrow>
          <ConnectionSelect
            kind={preset.kind}
            connections={connections}
            value={binding.connectionId}
            fallbackId={undefined}
            onChange={(v) => patchBinding({ connectionId: v })}
          />
        </section>
      )}

      {/* Face customisation */}
      <section className="space-y-2">
        <Eyebrow tone="muted">Face</Eyebrow>
        <FaceField
          label="Label"
          value={preset.label}
          onChange={(v) => patchPreset({ label: v })}
        />
        <FaceField
          label="Text"
          value={preset.text ?? ""}
          placeholder="Same as label"
          multiline
          onChange={(v) =>
            patchPreset({ text: v.trim() ? v : undefined })
          }
        />
        <div className="flex gap-2">
          <ColorField
            label="BG"
            value={preset.bgcolor ?? "#000000"}
            onChange={(v) => patchPreset({ bgcolor: v })}
          />
          <ColorField
            label="FG"
            value={preset.fgcolor ?? "#ffffff"}
            onChange={(v) => patchPreset({ fgcolor: v })}
          />
        </div>
      </section>

      {/* Steps + options. Connection is chosen PER ACTION (a single
          button can drive two different vMix instances), so there's no
          button-wide target — each action card carries its own CONN
          picker when its kind has more than one instance. */}
      <section className="space-y-2">
        <Eyebrow tone="muted">
          Actions · {preset.steps.length}
          {preset.steps.length === 1 ? " step" : " steps"}
        </Eyebrow>
        {preset.steps.map((step, idx) => {
          const sKind = stepKindOf(step);
          const globalId = step.actionId.includes(":")
            ? step.actionId
            : `${sKind}:${step.actionId}`;
          const def = actions?.find((a) => a.globalId === globalId);
          const stepInstances = connections.filter((c) => c.kind === sKind);
          const multi = preset.steps.length > 1;
          const stepActive = step.enabled !== false;
          return (
            <div
              key={idx}
              onDragOver={(e) => {
                if (dragStep !== null && dragStep !== idx) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragStep !== null) moveStepTo(dragStep, idx);
                setDragStep(null);
              }}
              style={{
                padding: 8,
                background: "var(--card)",
                border:
                  dragStep !== null && dragStep !== idx
                    ? "1px dashed var(--amber)"
                    : "1px solid var(--line)",
                opacity: dragStep === idx ? 0.5 : stepActive ? 1 : 0.5,
              }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                {/* Drag handle — reorder steps by dragging (multi-step only).
                    Only the handle is draggable so option inputs stay
                    selectable. */}
                {multi && (
                  <span
                    draggable
                    onDragStart={() => setDragStep(idx)}
                    onDragEnd={() => setDragStep(null)}
                    title="Drag to reorder"
                    style={{
                      cursor: "grab",
                      color: "var(--sub)",
                      fontSize: 12,
                      lineHeight: 1,
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                  >
                    ⠿
                  </span>
                )}
                <span
                  className="font-mono uppercase"
                  style={{
                    fontSize: 9,
                    letterSpacing: "1.4px",
                    color: "var(--sub)",
                    fontWeight: 600,
                  }}
                >
                  {idx + 1}
                </span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: "var(--ink)",
                    fontWeight: 600,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={`${sKind}:${def?.id ?? step.actionId}`}
                >
                  {sKind !== preset.kind ? `${sKind} · ` : ""}
                  {def?.label ?? step.actionId}
                </span>
                {/* Enable/disable this action — kept in the sequence, just
                    skipped at run time when off. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={stepActive}
                  title={stepActive ? "Disable this action" : "Enable this action"}
                  onClick={() => patchStep(idx, { enabled: !stepActive })}
                  style={{
                    width: 26,
                    height: 14,
                    borderRadius: 8,
                    flexShrink: 0,
                    background: stepActive ? "var(--amber)" : "var(--panel-2)",
                    border: "1px solid var(--line-hi)",
                    position: "relative",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 1,
                      left: stepActive ? 13 : 1,
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: stepActive ? "var(--bg)" : "var(--sub)",
                      transition: "left 0.12s",
                    }}
                  />
                </button>
                {/* Reorder is via the drag handle (⠿). Per-step actions:
                    duplicate + remove. */}
                <StepIconButton
                  title="Duplicate this action"
                  onClick={() => duplicateStep(idx)}
                >
                  <Copy size={11} />
                </StepIconButton>
                <StepIconButton
                  title="Remove this action"
                  danger
                  onClick={() => removeStep(idx)}
                >
                  ×
                </StepIconButton>
              </div>
              {/* Per-action connection override — only for MULTI-STEP buttons
                  with a multi-instance kind (cross-device chains). A single
                  step inherits the button's Connection (set above), so its
                  own picker would be redundant. */}
              {preset.steps.length > 1 &&
                stepInstances.length > 1 &&
                (() => {
                  // What an UNPINNED step inherits: the button's pin if it's a
                  // valid enabled instance of this kind, else None (decks have
                  // no implicit "first-of-kind" fallback — unpinned = offline).
                  const bindingPinValid =
                    !!binding.connectionId &&
                    stepInstances.some(
                      (c) => c.id === binding.connectionId && c.enabled
                    );
                  return (
                    <ConnectionSelect
                      kind={sKind}
                      connections={connections}
                      value={step.connectionId}
                      fallbackId={
                        bindingPinValid ? binding.connectionId : undefined
                      }
                      onChange={(v) => patchStep(idx, { connectionId: v })}
                    />
                  );
                })()}
              {def && def.options.length > 0 ? (
                <div className="space-y-1">
                  {def.options
                    .filter((opt) => {
                      // Dependent fields (e.g. SetOutput's Input only when
                      // Value = "Input") — hide unless the gate matches.
                      if (!opt.showWhen) return true;
                      const cur = (step.options ?? {})[opt.showWhen.option];
                      return String(cur ?? "") === opt.showWhen.equals;
                    })
                    .map((opt) => (
                    <InspectorOptionField
                      key={opt.id}
                      def={opt}
                      value={(step.options ?? {})[opt.id]}
                      onChange={(v) => patchStepOptions(idx, { [opt.id]: v })}
                      // vMix inputs accept a number, a title, or a
                      // UUID — feed the live snapshot's input list as
                      // suggestions so the operator can pick by name
                      // (Camera 1, Lower Third, …) without remembering
                      // the index.
                      suggestions={
                        sKind === "vmix" && opt.id === "input"
                          ? inputSuggestions
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : def ? (
                <div style={{ fontSize: 10, color: "var(--muted)" }}>
                  No options.
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "var(--amber)" }}>
                  Action <code>{step.actionId}</code> isn&apos;t registered. It
                  will still fire (server-side dispatch) but options can&apos;t
                  be edited here.
                </div>
              )}
            </div>
          );
        })}
        {/* Add another action — turns a single-purpose key into one
            that triggers several things (and across kinds). */}
        <AddActionControl actions={actions} onAdd={addAction} />
      </section>

      {/* Action footer */}
      <section
        className="flex items-center gap-2"
        style={{
          marginTop: "auto",
          paddingTop: 8,
          borderTop: "1px solid var(--line)",
        }}
      >
        <button
          onClick={onTest}
          disabled={isFiring}
          className="font-mono uppercase"
          style={{
            padding: "6px 14px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: isFiring ? "var(--panel-2)" : "var(--ink)",
            color: "var(--bg)",
            border: 0,
            cursor: isFiring ? "wait" : "pointer",
            fontWeight: 700,
          }}
        >
          {isFiring ? "Firing…" : "Test"}
        </button>
        <button
          onClick={onCopy}
          title="Copy this key (Ctrl/Cmd+C)"
          className="font-mono uppercase"
          style={{
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "var(--panel-2)",
            color: "var(--mid)",
            border: "1px solid var(--line-hi)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Copy
        </button>
        <button
          onClick={onPaste}
          disabled={!canPaste}
          title={
            canPaste
              ? "Paste over this key (Ctrl/Cmd+V)"
              : "Copy a key first"
          }
          className="font-mono uppercase"
          style={{
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "var(--panel-2)",
            color: canPaste ? "var(--mid)" : "var(--sub)",
            border: "1px solid var(--line-hi)",
            cursor: canPaste ? "pointer" : "not-allowed",
            opacity: canPaste ? 1 : 0.5,
            fontWeight: 600,
          }}
        >
          Paste
        </button>
        <button
          onClick={onClear}
          className="font-mono uppercase"
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "transparent",
            color: "var(--pgm)",
            border: "1px solid var(--pgm)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Clear
        </button>
      </section>
    </div>
  );
}
