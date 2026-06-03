"use client";

import type { ActionOptionDef } from "./types";

export function FaceField({
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
}) {
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
  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "4px 6px",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    fontFamily: "var(--font-mono)",
    outline: "none",
    resize: "vertical",
  };
  return (
    <div className="flex items-center gap-2">
      <span style={labelStyle}>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )}
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" style={{ flex: 1 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          color: "var(--sub)",
          textTransform: "uppercase",
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
          width: 22,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 28,
          height: 24,
          padding: 0,
          border: "1px solid var(--line)",
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          padding: "3px 5px",
          fontSize: 10,
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          color: "var(--ink)",
          fontFamily: "var(--font-mono)",
          outline: "none",
        }}
      />
    </div>
  );
}

function normalizeHex(s: string): string {
  // <input type="color"> wants `#rrggbb`. Anything else we map to a
  // safe default so the picker stays usable while the operator types.
  return /^#[0-9a-f]{6}$/i.test(s) ? s : "#000000";
}

export function InspectorOptionField({
  def,
  value,
  onChange,
  suggestions,
}: {
  def: ActionOptionDef;
  value: unknown;
  onChange: (v: unknown) => void;
  /** vMix input picker entries: `value` is the stable input key (GUID)
   *  that gets stored; `label` is shown; `number`/`name` let the picker
   *  resolve a legacy number/name binding for display. */
  suggestions?: Array<{
    value: string;
    label: string;
    number?: number;
    name?: string;
  }>;
}) {
  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--sub)",
    textTransform: "uppercase",
    fontWeight: 600,
    width: 95,
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
  };
  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "3px 6px",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  if (def.type === "number") {
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle}>{def.label}</span>
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={inputStyle}
        />
      </div>
    );
  }
  if (def.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle}>{def.label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "var(--cyan)" }}
        />
      </div>
    );
  }
  if (def.type === "dropdown") {
    const cur = typeof value === "string" ? value : String(value ?? "");
    const choices = def.choices ?? [];
    // A freshly-added step (or a value pointing at a since-deleted choice, e.g.
    // a go-to-page target page that was removed) has no matching option. A
    // native <select> would silently DISPLAY its first option while the stored
    // value stays empty — so show an explicit placeholder and keep the select
    // empty until the operator actually picks, instead of a phantom selection.
    const matched = choices.some((c) => c.id === cur);
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle}>{def.label}</span>
        <select
          value={matched ? cur : ""}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {!matched && (
            <option value="">
              {cur ? "⚠ missing — pick one" : "— select —"}
            </option>
          )}
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const current =
    typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : String(value);

  // vMix input picker: pick from the live input list. The stored value is
  // the input's stable KEY (GUID), but we display the friendly name. A bound
  // input that's no longer present (deleted, vMix offline) shows as
  // "disconnected" — and the binding itself keeps working by key once vMix
  // returns. Legacy number/name bindings resolve to their current input for
  // display.
  if (suggestions) {
    const match = suggestions.find(
      (s) =>
        s.value === current ||
        (s.number !== undefined && String(s.number) === current) ||
        (s.name && s.name === current)
    );
    const stale = current !== "" && !match;
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle}>{def.label}</span>
        <select
          value={match ? match.value : current}
          onChange={(e) => onChange(e.target.value)}
          title={
            stale ? "Bound input not found on vMix (disconnected)" : undefined
          }
          style={{
            ...inputStyle,
            width: "100%",
            color: stale ? "#ff453a" : "var(--ink)",
          }}
        >
          <option value="">— none —</option>
          {stale && <option value={current}>⚠ disconnected</option>}
          {suggestions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Plain free-text string option.
  return (
    <div className="flex items-center gap-2">
      <span style={labelStyle}>{def.label}</span>
      <input
        type="text"
        value={current}
        placeholder={def.placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: "100%" }}
      />
    </div>
  );
}
