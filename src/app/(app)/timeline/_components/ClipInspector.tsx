"use client";

import { useState } from "react";
import { Copy, Trash2, X } from "lucide-react";
import { Eyebrow } from "@/components/sw";
import {
  AddActionControl,
  ConnectionSelect,
  StepIconButton,
} from "@/app/(app)/streamdeck/_components/inspector-actions";
import {
  ColorField,
  FaceField,
  InspectorOptionField,
} from "@/app/(app)/streamdeck/_components/inspector-fields";
import { useVmixInputSuggestions } from "@/app/(app)/streamdeck/_components/action-catalog";
import type {
  ActionCatalogEntry,
  ConnectionLite,
} from "@/app/(app)/streamdeck/_components/types";
import type { DeckStep } from "@/lib/db/streamdeck";
import type { Scenario, Selection, TimelineClip } from "./types";
import { defaultOptions, stepGlobalId } from "./types";

/**
 * Right panel: edits the selected clip (its action options, target
 * connection, time, face) or the selected WAIT marker. Reuses the deck
 * editor's option/connection/face field components verbatim.
 */
export function ClipInspector({
  scenario,
  selection,
  connections,
  actions,
  onUpdateClip,
  onDeleteClip,
  onUpdateWait,
  onDeleteWait,
  onClose,
}: {
  scenario: Scenario;
  selection: Selection;
  connections: ConnectionLite[];
  actions: ActionCatalogEntry[] | null;
  onUpdateClip: (
    trackId: string,
    clipId: string,
    patch: Partial<TimelineClip>
  ) => void;
  onDeleteClip: (trackId: string, clipId: string) => void;
  onUpdateWait: (
    waitId: string,
    patch: { offsetMs?: number; label?: string }
  ) => void;
  onDeleteWait: (waitId: string) => void;
  onClose: () => void;
}) {
  // Live vMix input picker — mirrors the deck inspector. Hook stays
  // unconditional (above the wait/clip branches); enabled only when the
  // selected clip actually has a vMix step so it doesn't poll otherwise.
  const selectedClip =
    selection?.kind === "clip"
      ? scenario.tracks
          .find((t) => t.id === selection.trackId)
          ?.clips.find((c) => c.id === selection.clipId)
      : undefined;
  const hasVmixStep = !!selectedClip?.steps.some(
    (s) =>
      (s.kind ??
        (s.actionId.includes(":")
          ? s.actionId.slice(0, s.actionId.indexOf(":"))
          : "")) === "vmix"
  );
  const vmixInputs = useVmixInputSuggestions(hasVmixStep);
  // Index of the action being dragged to reorder (mirrors the deck).
  const [dragStep, setDragStep] = useState<number | null>(null);

  const labelStyle: React.CSSProperties = {
    width: 50,
    flexShrink: 0,
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--sub)",
    textTransform: "uppercase",
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
  };
  const numStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "4px 6px",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  // ── WAIT marker editor ──
  if (selection?.kind === "wait") {
    const wait = scenario.waits.find((w) => w.id === selection.waitId);
    if (!wait) return null;
    return (
      <Panel onClose={onClose} title="WAIT marker">
        <div className="flex items-center gap-2">
          <span style={labelStyle}>At (s)</span>
          <input
            type="number"
            step={0.05}
            value={(wait.offsetMs / 1000).toString()}
            onChange={(e) =>
              onUpdateWait(wait.id, {
                offsetMs: Math.max(0, Math.round(Number(e.target.value) * 1000)),
              })
            }
            style={numStyle}
          />
        </div>
        <FaceField
          label="Label"
          value={wait.label ?? ""}
          placeholder="optional"
          onChange={(v) => onUpdateWait(wait.id, { label: v })}
        />
        <button
          onClick={() => onDeleteWait(wait.id)}
          className="flex items-center justify-center gap-1 font-mono uppercase"
          style={{
            marginTop: 4,
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: "0.1em",
            background: "var(--panel-2)",
            border: "1px solid var(--line-hi)",
            color: "var(--pgm, #ff453a)",
            cursor: "pointer",
          }}
        >
          <Trash2 size={12} /> Delete wait
        </button>
      </Panel>
    );
  }

  // ── Clip editor (a clip is a bundle of actions, like a deck button) ──
  if (selection?.kind === "clip") {
    const track = scenario.tracks.find((t) => t.id === selection.trackId);
    const clip = track?.clips.find((c) => c.id === selection.clipId);
    if (!track || !clip) return null;

    const firstEntry = clip.steps[0]
      ? actions?.find((a) => a.globalId === stepGlobalId(clip.steps[0]))
      : undefined;

    const setSteps = (steps: DeckStep[]) =>
      onUpdateClip(track.id, clip.id, { steps });
    const updateStep = (idx: number, patch: Partial<DeckStep>) =>
      setSteps(clip.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    const setStepOption = (idx: number, optId: string, v: unknown) =>
      updateStep(idx, {
        options: { ...(clip.steps[idx].options ?? {}), [optId]: v },
      });
    const removeStep = (idx: number) => {
      // Removing the last action removes the whole clip.
      if (clip.steps.length <= 1) onDeleteClip(track.id, clip.id);
      else setSteps(clip.steps.filter((_, i) => i !== idx));
    };
    const addStep = (entry: ActionCatalogEntry) =>
      setSteps([
        ...clip.steps,
        {
          actionId: entry.globalId,
          kind: entry.kind,
          options: defaultOptions(entry),
        },
      ]);
    const duplicateStep = (idx: number) =>
      setSteps([
        ...clip.steps.slice(0, idx + 1),
        structuredClone(clip.steps[idx]),
        ...clip.steps.slice(idx + 1),
      ]);
    const moveStep = (from: number, to: number) => {
      if (from === to || from < 0 || to < 0) return;
      const next = [...clip.steps];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setSteps(next);
    };

    return (
      <Panel onClose={onClose} title={firstEntry?.label ?? clip.steps[0]?.actionId ?? "Clip"}>
        <div className="flex items-center gap-2">
          <span style={labelStyle}>At (s)</span>
          <input
            type="number"
            step={0.05}
            value={(clip.offsetMs / 1000).toString()}
            onChange={(e) =>
              onUpdateClip(track.id, clip.id, {
                offsetMs: Math.max(0, Math.round(Number(e.target.value) * 1000)),
              })
            }
            style={numStyle}
          />
        </div>

        {/* Action list — same model as a deck button. */}
        <Eyebrow tone="muted">
          Actions · {clip.steps.length}
          {clip.steps.length === 1 ? " step" : " steps"}
        </Eyebrow>
        {clip.steps.map((step, idx) => {
          const kind =
            step.kind ??
            (step.actionId.includes(":")
              ? step.actionId.slice(0, step.actionId.indexOf(":"))
              : "");
          const entry = actions?.find((a) => a.globalId === stepGlobalId(step));
          const opts = step.options ?? {};
          // Inherit the clip's pin only if it's a valid instance of THIS
          // step's kind (a cross-kind step can't inherit a different-kind pin).
          const clipPinValid =
            !!clip.connectionId &&
            connections.some((c) => c.id === clip.connectionId && c.kind === kind);
          const active = step.enabled !== false;
          const multi = clip.steps.length > 1;
          return (
            <div
              key={idx}
              onDragOver={(e) => {
                if (dragStep !== null && dragStep !== idx) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragStep !== null) moveStep(dragStep, idx);
                setDragStep(null);
              }}
              className="space-y-2"
              style={{
                padding: 8,
                background: "var(--panel-2)",
                border:
                  dragStep !== null && dragStep !== idx
                    ? "1px dashed var(--amber)"
                    : "1px solid var(--line)",
                opacity: dragStep === idx ? 0.5 : active ? 1 : 0.5,
              }}
            >
              <div className="flex items-center gap-2">
                {/* Drag handle — reorder actions (multi-step only). Only the
                    handle is draggable so option inputs stay selectable. */}
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
                  className="font-mono"
                  style={{ fontSize: 9, color: "var(--sub)", fontWeight: 700 }}
                >
                  {idx + 1}
                </span>
                <span
                  className="font-mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11,
                    color: "var(--ink)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={step.actionId}
                >
                  {entry?.label ?? step.actionId}
                </span>
                {/* Enable/disable — the same orange switch as the deck. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  title={active ? "Disable this action" : "Enable this action"}
                  onClick={() => updateStep(idx, { enabled: !active })}
                  style={{
                    width: 26,
                    height: 14,
                    borderRadius: 8,
                    flexShrink: 0,
                    background: active ? "var(--amber)" : "var(--panel-2)",
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
                      left: active ? 13 : 1,
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: active ? "var(--bg)" : "var(--sub)",
                      transition: "left 0.12s",
                    }}
                  />
                </button>
                <StepIconButton
                  title="Duplicate this action"
                  onClick={() => duplicateStep(idx)}
                >
                  <Copy size={11} />
                </StepIconButton>
                <StepIconButton title="Remove action" danger onClick={() => removeStep(idx)}>
                  ×
                </StepIconButton>
              </div>
              <ConnectionSelect
                kind={kind}
                connections={connections}
                value={step.connectionId}
                fallbackId={clipPinValid ? clip.connectionId : undefined}
                onChange={(v) => updateStep(idx, { connectionId: v })}
              />
              {entry &&
                entry.options
                  .filter(
                    (o) =>
                      !o.showWhen ||
                      String(opts[o.showWhen.option] ?? "") === o.showWhen.equals
                  )
                  .map((o) => (
                    <InspectorOptionField
                      key={o.id}
                      def={o}
                      value={opts[o.id]}
                      onChange={(v) => setStepOption(idx, o.id, v)}
                      // Live vMix input list for the "input" option — same
                      // picker the deck inspector gives (pick by name, stores
                      // the stable input key).
                      suggestions={
                        kind === "vmix" && o.id === "input"
                          ? vmixInputs
                          : undefined
                      }
                    />
                  ))}
            </div>
          );
        })}
        <AddActionControl actions={actions} onAdd={addStep} />

        {/* Face overrides */}
        <div className="space-y-2" style={{ marginTop: 2 }}>
          <Eyebrow tone="muted">Tile</Eyebrow>
          <FaceField
            label="Label"
            value={clip.label ?? ""}
            placeholder={firstEntry?.label ?? ""}
            onChange={(v) => onUpdateClip(track.id, clip.id, { label: v })}
          />
          <ColorField
            label="BG"
            value={clip.color ?? ""}
            onChange={(v) => onUpdateClip(track.id, clip.id, { color: v })}
          />
        </div>

        <button
          onClick={() => onDeleteClip(track.id, clip.id)}
          className="flex items-center justify-center gap-1 font-mono uppercase"
          style={{
            marginTop: 4,
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: "0.1em",
            background: "var(--panel-2)",
            border: "1px solid var(--line-hi)",
            color: "var(--pgm, #ff453a)",
            cursor: "pointer",
          }}
        >
          <Trash2 size={12} /> Delete clip
        </button>
      </Panel>
    );
  }

  // ── Nothing selected ──
  return (
    <div
      className="font-mono"
      style={{
        padding: 16,
        fontSize: 10,
        color: "var(--sub)",
        lineHeight: 1.6,
      }}
    >
      Drag an action from the palette onto a track, then click a clip to edit
      it here.
      <br />
      <br />
      Shortcuts: <strong>Ctrl/Cmd+C / +V</strong> copy & paste a clip,{" "}
      <strong>Suppr / Del</strong> deletes the selected clip or wait.
    </div>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>
      <div
        className="flex items-center justify-between sw-hairline-bottom"
        style={{ padding: "8px 12px" }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        <button
          onClick={onClose}
          title="Close"
          style={{
            padding: 2,
            background: "transparent",
            border: 0,
            color: "var(--sub)",
            cursor: "pointer",
          }}
        >
          <X size={13} />
        </button>
      </div>
      <div className="space-y-2" style={{ padding: 12, overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}
