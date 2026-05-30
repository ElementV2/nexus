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
  /** Optional dropdown-like quick-pick values rendered as a
   *  `<datalist>`. The widget remains a free-text input — the user
   *  can pick a suggestion or type anything else. */
  suggestions?: Array<{ value: string; label: string }>;
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
    return (
      <div className="flex items-center gap-2">
        <span style={labelStyle}>{def.label}</span>
        <select
          value={typeof value === "string" ? value : String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {(def.choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  // String / free-text. When `suggestions` are provided we attach a
  // datalist so the operator gets a quick-pick of known values (e.g.
  // vMix input numbers + titles) while still being able to type any
  // string they want. The list id is derived from the option id;
  // multiple instances on the same page would collide if we used a
  // static id.
  const listId = suggestions && suggestions.length > 0
    ? `inspector-${def.id}-suggestions`
    : undefined;
  return (
    <div className="flex items-center gap-2">
      <span style={labelStyle}>{def.label}</span>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <input
          type="text"
          // Legacy bindings stored numeric defaults — coerce to
          // string so the field renders correctly post-migration.
          value={
            typeof value === "string"
              ? value
              : value === undefined || value === null
                ? ""
                : String(value)
          }
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
          list={listId}
        />
        {listId && (
          <datalist id={listId}>
            {suggestions!.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
}
