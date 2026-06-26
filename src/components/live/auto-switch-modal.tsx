"use client";

import { useState } from "react";
import type { VmixInput } from "@/lib/vmix/types";
import {
  applyPreset,
  TRANSITION_LABELS,
  type AutoPreset,
  type AutoSwitchConfig,
  type AutoSwitchState,
  type TransitionType,
} from "@/lib/auto-switch/types";

const TRANSITIONS: TransitionType[] = ["Cut", "Fade", "AlphaFade", "Merge", "Wipe", "Zoom"];
const PRESETS: { id: AutoPreset; label: string }[] = [
  { id: "calm", label: "Calme" },
  { id: "standard", label: "Standard" },
  { id: "reactive", label: "Réactif" },
  { id: "custom", label: "Custom" },
];

/**
 * Auto-réalisation settings. One modal: pick which inputs are cameras and the
 * mic(s) that drive each, the transition, a tuning preset (or hand-tune the
 * detection/timing in Advanced), and the manual-cut behaviour. Every edit saves
 * immediately (optimistic) — `onChange` round-trips through the server so the
 * running engine picks it up next tick.
 */
export function AutoSwitchModal({
  config,
  inputs,
  state,
  onChange,
  onClose,
}: {
  config: AutoSwitchConfig;
  inputs: VmixInput[];
  state: AutoSwitchState | null;
  onChange: (c: AutoSwitchConfig) => void;
  onClose: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);

  const camByInput = new Map(config.cameras.map((c) => [c.input, c]));
  const inputByNumber = new Map(inputs.map((i) => [i.number, i]));
  // Inputs not yet added as a camera — the pool the ADD picker offers. A camera
  // can be video-only, so this is NOT filtered on audio.
  const available = inputs.filter((i) => !camByInput.has(i.number));
  // Mic pickers only offer inputs that actually carry audio — same rule as the
  // Audio page (`hasAudio`); a silent input is useless as a trigger source.
  const audioCapable = inputs.filter((i) => i.hasAudio);

  const addCamera = (input: number) => {
    if (camByInput.has(input)) return;
    onChange({
      ...config,
      cameras: [...config.cameras, { input, audioInputs: [input], enabled: true }],
    });
  };

  const removeCamera = (input: number) =>
    onChange({ ...config, cameras: config.cameras.filter((c) => c.input !== input) });

  const patchCameraAudio = (input: number, audioInputs: number[]) =>
    onChange({
      ...config,
      cameras: config.cameras.map((c) => (c.input === input ? { ...c, audioInputs } : c)),
    });

  const addAudioInput = (input: number, audioInput: number) => {
    const cam = camByInput.get(input);
    if (!cam || cam.audioInputs.includes(audioInput)) return;
    patchCameraAudio(input, [...cam.audioInputs, audioInput]);
  };

  const removeAudioInput = (input: number, audioInput: number) => {
    const cam = camByInput.get(input);
    if (!cam) return;
    patchCameraAudio(input, cam.audioInputs.filter((a) => a !== audioInput));
  };

  // Editing any tuning field drops the preset to "custom" so the label is honest.
  const patchDetection = (p: Partial<AutoSwitchConfig["detection"]>) =>
    onChange({ ...config, preset: "custom", detection: { ...config.detection, ...p } });
  const patchTiming = (p: Partial<AutoSwitchConfig["timing"]>) =>
    onChange({ ...config, preset: "custom", timing: { ...config.timing, ...p } });

  const speakingByCam = new Map((state?.sources ?? []).map((s) => [s.camInput, s]));
  const inputLabel = (n: number) => {
    const i = inputByNumber.get(n);
    return i ? i.title : `Input ${n} (absent)`;
  };

  return (
    <Overlay onClose={onClose}>
      <Header onClose={onClose} />

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        {/* ─── Cameras + audio mapping ─── */}
        <Section title="Caméras & micros">
          <p style={hintStyle}>
            {"Ajoute les caméras à suivre, puis assigne-leur un ou plusieurs micros. Une cam passe à l'antenne dès qu'un de ses micros parle (ex. un plan large piloté par 3 micros). Défaut = l'input lui-même."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {config.cameras.map((cam) => {
              const inp = inputByNumber.get(cam.input);
              const title = inp?.title ?? `Input ${cam.input}`;
              const src = speakingByCam.get(cam.input);
              // Inputs available to add as a mic for THIS camera — audio-bearing
              // inputs only, minus the ones already assigned.
              const audioPool = audioCapable.filter((o) => !cam.audioInputs.includes(o.number));
              return (
                <div
                  key={cam.input}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "7px 8px",
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {/* line 1: camera identity + remove */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      title={src?.speaking ? "parle (à l'antenne)" : "silence / off-air"}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flex: "0 0 8px",
                        background: src?.speaking ? "var(--pgm)" : "var(--line-hi)",
                      }}
                    />
                    <span className="font-mono" style={{ fontSize: 11, color: "var(--pgm)", minWidth: 22 }}>
                      {String(cam.input).padStart(2, "0")}
                    </span>
                    <span className="truncate" style={{ fontSize: 12, flex: 1, color: "var(--ink)" }}>
                      {title}
                      {!inp && <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 10 }}>(absent)</span>}
                    </span>
                    <button
                      onClick={() => removeCamera(cam.input)}
                      aria-label="Retirer la caméra"
                      title="Retirer la caméra"
                      style={{
                        width: 24,
                        height: 24,
                        fontSize: 13,
                        lineHeight: 1,
                        color: "var(--muted)",
                        background: "var(--bg)",
                        border: "1px solid var(--line-hi)",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {/* line 2: audio mics (chips) + add */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingLeft: 16 }}>
                    <span className="font-mono uppercase" style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "1px" }}>
                      micros
                    </span>
                    {cam.audioInputs.map((ai) => (
                      <span
                        key={ai}
                        className="font-mono"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 4px 2px 6px",
                          fontSize: 10,
                          background: "var(--amber-tint)",
                          border: "1px solid var(--line-hi)",
                          color: "var(--ink)",
                        }}
                      >
                        {String(ai).padStart(2, "0")} · <span className="truncate" style={{ maxWidth: 120 }}>{inputLabel(ai)}</span>
                        <button
                          onClick={() => removeAudioInput(cam.input, ai)}
                          aria-label="Retirer ce micro"
                          title="Retirer ce micro"
                          style={{
                            fontSize: 11,
                            lineHeight: 1,
                            color: "var(--muted)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {cam.audioInputs.length === 0 && (
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>aucun (cam jamais auto-sélectionnée)</span>
                    )}
                    {audioPool.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) addAudioInput(cam.input, Number(e.target.value));
                        }}
                        style={{ ...selectStyle, fontSize: 10, padding: "2px 18px 2px 6px" }}
                        className="font-mono"
                        aria-label="Ajouter un micro"
                      >
                        <option value="">+ micro…</option>
                        {audioPool.map((o) => (
                          <option key={o.key} value={o.number}>
                            {String(o.number).padStart(2, "0")} · {o.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
            {config.cameras.length === 0 && (
              <p style={hintStyle}>Aucune caméra. Ajoute-en une ci-dessous.</p>
            )}

            {/* ADD picker — choose from inputs not already added. */}
            <select
              value=""
              disabled={available.length === 0}
              onChange={(e) => {
                if (e.target.value) addCamera(Number(e.target.value));
              }}
              style={{
                ...selectStyle,
                marginTop: 4,
                padding: "7px 20px 7px 10px",
                color: available.length ? "var(--amber)" : "var(--muted)",
                borderColor: "var(--line-hi)",
                fontWeight: 700,
                letterSpacing: "0.5px",
              }}
              className="font-mono uppercase"
            >
              <option value="">
                {available.length ? "+ Ajouter une caméra…" : "toutes les caméras ajoutées"}
              </option>
              {available.map((o) => (
                <option key={o.key} value={o.number}>
                  {String(o.number).padStart(2, "0")} · {o.title}
                </option>
              ))}
            </select>
          </div>
        </Section>

        {/* ─── Transition ─── */}
        <Section title="Transition">
          <p style={hintStyle}>
            {"Pas de plan large dédié : un plan large/groupe est simplement une caméra à plusieurs micros (ajoute-la ci-dessus et assigne-lui les micros concernés)."}
          </p>
          <Row label="Transition">
            <select
              value={config.transition.type}
              onChange={(e) =>
                onChange({
                  ...config,
                  transition: { ...config.transition, type: e.target.value as TransitionType },
                })
              }
              style={selectStyle}
            >
              {TRANSITIONS.map((t) => (
                <option key={t} value={t}>
                  {TRANSITION_LABELS[t]}
                </option>
              ))}
            </select>
            {config.transition.type !== "Cut" && (
              <NumberInput
                value={config.transition.durationMs}
                min={0}
                max={5000}
                step={50}
                suffix="ms"
                onChange={(v) =>
                  onChange({ ...config, transition: { ...config.transition, durationMs: v } })
                }
              />
            )}
          </Row>
        </Section>

        {/* ─── Preset ─── */}
        <Section title="Réactivité">
          <div style={{ display: "flex", gap: 6 }}>
            {PRESETS.map((p) => {
              const active = config.preset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    p.id === "custom"
                      ? onChange({ ...config, preset: "custom" })
                      : onChange(applyPreset(config, p.id))
                  }
                  className="font-mono uppercase"
                  style={{
                    flex: 1,
                    padding: "7px 4px",
                    fontSize: 10,
                    letterSpacing: "1px",
                    fontWeight: 700,
                    cursor: "pointer",
                    background: active ? "var(--amber)" : "var(--card)",
                    color: active ? "var(--bg)" : "var(--mid)",
                    border: "1px solid var(--line-hi)",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setAdvanced((v) => !v)}
            className="font-mono uppercase"
            style={{
              marginTop: 8,
              fontSize: 10,
              letterSpacing: "1px",
              color: "var(--muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {advanced ? "▾ masquer réglages avancés" : "▸ réglages avancés"}
          </button>

          {advanced && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              <Field label="Seuil ouverture (dB)" hint="au-dessus = parle">
                <NumberInput value={config.detection.openDb} min={-90} max={0} step={1} suffix="dB"
                  onChange={(v) => patchDetection({ openDb: v })} />
              </Field>
              <Field label="Seuil fermeture (dB)" hint="hystérésis">
                <NumberInput value={config.detection.closeDb} min={-90} max={0} step={1} suffix="dB"
                  onChange={(v) => patchDetection({ closeDb: v })} />
              </Field>
              <Field label="Hold activation" hint="anti-toux">
                <NumberInput value={config.detection.activationHoldMs} min={0} max={3000} step={50} suffix="ms"
                  onChange={(v) => patchDetection({ activationHoldMs: v })} />
              </Field>
              <Field label="Hang relâche" hint="tient sur les blancs">
                <NumberInput value={config.detection.releaseHangMs} min={0} max={5000} step={50} suffix="ms"
                  onChange={(v) => patchDetection({ releaseHangMs: v })} />
              </Field>
              <Field label="Temps min sur cam" hint="anti ping-pong / réactivité">
                <NumberInput value={config.timing.minOnCamMs} min={0} max={30000} step={250} suffix="ms"
                  onChange={(v) => patchTiming({ minOnCamMs: v })} />
              </Field>
              <Field label="Durée réaction" hint="plan réaction sur monologue">
                <NumberInput value={config.timing.reactionHoldMs} min={0} max={15000} step={250} suffix="ms"
                  onChange={(v) => patchTiming({ reactionHoldMs: v })} />
              </Field>
            </div>
          )}
        </Section>

        {/* ─── Manual override ─── */}
        <Section title="Sur cut manuel">
          <p style={hintStyle}>
            {"Quand tu coupes à la main (ou via un deck/une tablette) pendant que l'auto tourne :"}
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            {([
              { id: "off", label: "Rien" },
              { id: "timer", label: "Pause minutée" },
              { id: "hold", label: "Stop jusqu'à relance" },
            ] as const).map((m) => {
              const mode = config.manualHold
                ? "hold"
                : config.manualOverrideMs > 0
                  ? "timer"
                  : "off";
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    if (m.id === "off") onChange({ ...config, manualHold: false, manualOverrideMs: 0 });
                    else if (m.id === "timer")
                      onChange({
                        ...config,
                        manualHold: false,
                        manualOverrideMs: config.manualOverrideMs > 0 ? config.manualOverrideMs : 8000,
                      });
                    else onChange({ ...config, manualHold: true });
                  }}
                  className="font-mono uppercase"
                  style={{
                    flex: 1,
                    padding: "7px 4px",
                    fontSize: 9.5,
                    letterSpacing: "0.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    background: active ? "var(--amber)" : "var(--card)",
                    color: active ? "var(--bg)" : "var(--mid)",
                    border: "1px solid var(--line-hi)",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {!config.manualHold && config.manualOverrideMs > 0 && (
            <Field label="Durée de la pause" hint="puis reprise auto">
              <NumberInput value={config.manualOverrideMs} min={500} max={60000} step={500} suffix="ms"
                onChange={(v) => onChange({ ...config, manualOverrideMs: v })} />
            </Field>
          )}
          {config.manualHold && (
            <p style={{ ...hintStyle, margin: 0 }}>
              {"L'auto-mix se coupe (bouton AUTO → OFF). Reclique AUTO pour le relancer."}
            </p>
          )}
        </Section>
      </div>
    </Overlay>
  );
}

// ─────────────────────────── primitives ──────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "100%",
          maxHeight: "88vh",
          overflow: "auto",
          background: "var(--bg)",
          border: "1px solid var(--line-hi)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--line)",
        position: "sticky",
        top: 0,
        background: "var(--panel)",
        zIndex: 1,
      }}
    >
      <span className="font-mono uppercase" style={{ fontSize: 12, letterSpacing: "1.6px", fontWeight: 700, color: "var(--ink)" }}>
        Auto-réalisation
      </span>
      <button
        onClick={onClose}
        className="font-mono"
        style={{ fontSize: 16, lineHeight: 1, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}
        aria-label="Fermer"
      >
        ✕
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="font-mono uppercase label" style={{ fontSize: 10, letterSpacing: "1.4px", color: "var(--amber)" }}>
        {title}
      </span>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--mid)", minWidth: 92 }}>{label}</span>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--mid)", flex: 1 }}>
        {label}
        {hint && <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 10 }}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="font-mono"
        style={{
          width: 72,
          padding: "4px 6px",
          fontSize: 12,
          background: "var(--card)",
          color: "var(--ink)",
          border: "1px solid var(--line-hi)",
          outline: "none",
        }}
      />
      {suffix && <span className="font-mono" style={{ fontSize: 10, color: "var(--muted)" }}>{suffix}</span>}
    </span>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "4px 20px 4px 6px",
  fontSize: 12,
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--line-hi)",
  outline: "none",
  cursor: "pointer",
  // The global reset strips the native dropdown chevron (appearance:none);
  // draw one back so it reads as a select.
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><path d='M0 2 L4 6 L8 2' fill='none' stroke='%23888' stroke-width='1.5'/></svg>\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 6px center",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  margin: 0,
};
