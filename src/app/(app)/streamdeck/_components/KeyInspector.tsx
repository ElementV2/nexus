"use client";

import { Eyebrow } from "@/components/sw";
import { X } from "lucide-react";
import type { DeckBinding, DeckStep } from "@/lib/db/streamdeck";
import { useActionCatalog, useVmixInputSuggestions } from "./action-catalog";
import type {
  ActionCatalogEntry,
  ConnectionLite,
  FireState,
} from "./types";
import { ColorField, FaceField, InspectorOptionField } from "./inspector-fields";
import {
  AddActionControl,
  ConnectionSelect,
  StepIconButton,
} from "./inspector-actions";

export function KeyInspector({
  keyIndex,
  binding,
  connections,
  defaultsByKind,
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
  defaultsByKind: Record<string, string>;
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
  const moveStep = (stepIdx: number, dir: -1 | 1) => {
    const j = stepIdx + dir;
    if (j < 0 || j >= preset.steps.length) return;
    const nextSteps = [...preset.steps];
    [nextSteps[stepIdx], nextSteps[j]] = [nextSteps[j], nextSteps[stepIdx]];
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
      {/* Face preview + meta */}
      <div className="flex items-start gap-3">
        <div
          style={{
            width: 88,
            height: 88,
            flexShrink: 0,
            borderRadius: 8,
            background: preset.bgcolor ?? "#0a0a0a",
            color: preset.fgcolor ?? "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            lineHeight: 1.1,
            border: "1px solid var(--line-hi)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
            whiteSpace: "pre-line",
          }}
        >
          {preset.text ?? preset.label}
        </div>
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
          return (
            <div
              key={idx}
              style={{
                padding: 8,
                background: "var(--card)",
                border: "1px solid var(--line)",
              }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
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
                {/* Reorder + remove — only meaningful with 2+ steps. */}
                {preset.steps.length > 1 && (
                  <>
                    <StepIconButton
                      title="Move up"
                      disabled={idx === 0}
                      onClick={() => moveStep(idx, -1)}
                    >
                      ↑
                    </StepIconButton>
                    <StepIconButton
                      title="Move down"
                      disabled={idx === preset.steps.length - 1}
                      onClick={() => moveStep(idx, 1)}
                    >
                      ↓
                    </StepIconButton>
                  </>
                )}
                <StepIconButton
                  title="Remove this action"
                  danger
                  onClick={() => removeStep(idx)}
                >
                  ×
                </StepIconButton>
              </div>
              {/* Per-action connection — shown whenever this action's
                  kind has more than one instance, so the operator picks
                  which machine THIS action hits. One instance = no
                  choice, so it's hidden. */}
              {stepInstances.length > 1 && (
                <ConnectionSelect
                  kind={sKind}
                  connections={connections}
                  value={step.connectionId}
                  fallbackId={defaultsByKind[sKind]}
                  fallbackTag="default"
                  onChange={(v) => patchStep(idx, { connectionId: v })}
                />
              )}
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
