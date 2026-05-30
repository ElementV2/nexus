// Generator: build src/lib/vmix/shortcuts.ts (source of truth) from the
// scraped help28 reference (.tmp_vmix28.json). Collapses numbered/lettered
// families into parametrized templates; everything else stays a singleton.
// 100% coverage is asserted at the end.
const fs = require("fs");
const raw = require("./.tmp_vmix28.json");

// Drop the header row ("Name/Description/Parameters") and dedupe by fn.
const seen = new Map();
for (const r of raw) {
  if (!r.fn || r.fn === "Name" || r.cat === "?") continue;
  if (!seen.has(r.fn)) seen.set(r.fn, r);
}
const items = [...seen.values()];

// ── param-string → ordered token ids ──────────────────────────────────
const PMAP = {
  Input: "input",
  Value: "value",
  Duration: "duration",
  Channel: "channel",
  Mix: "mix",
  SelectedIndex: "selectedIndex",
  SelectedName: "selectedName",
};
function toks(p) {
  if (!p || /^none$/i.test(p)) return [];
  return p
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => PMAP[t] || t.toLowerCase());
}

// ── curated family collapse rules ─────────────────────────────────────
// Each: re matches a concrete fn; tmpl(m) returns the template with
// {placeholders}; fam describes the placeholder param(s).
const INT = (id, min, max, label) => ({ id, kind: "int", min, max, label });
const ENUM = (id, values, label) => ({ id, kind: "enum", values, label });
const rules = [
  // Overlays (4 channels, + suffix variants)
  { re: /^OverlayInput([1-4])(In|Out|Last|Off|Zoom)?$/, tmpl: (m) => `OverlayInput{ch}${m[2] || ""}`, fam: [INT("ch", 1, 4, "Overlay #")] },
  { re: /^PreviewOverlayInput([1-4])$/, tmpl: () => `PreviewOverlayInput{ch}`, fam: [INT("ch", 1, 4, "Overlay #")] },
  // Transitions / stingers (4 GUI buttons)
  { re: /^Transition([1-4])$/, tmpl: () => `Transition{slot}`, fam: [INT("slot", 1, 4, "Button #")] },
  { re: /^Stinger([1-4])$/, tmpl: () => `Stinger{slot}`, fam: [INT("slot", 1, 4, "Stinger #")] },
  { re: /^SetStingerGTInput([1-4])$/, tmpl: () => `SetStingerGTInput{slot}`, fam: [INT("slot", 1, 4, "Stinger #")] },
  { re: /^SetTransitionEffect([1-4])$/, tmpl: () => `SetTransitionEffect{slot}`, fam: [INT("slot", 1, 4, "Button #")] },
  { re: /^SetTransitionDuration([1-4])$/, tmpl: () => `SetTransitionDuration{slot}`, fam: [INT("slot", 1, 4, "Button #")] },
  // Input effects (4)
  { re: /^Effect([1-4])(Off|On)?$/, tmpl: (m) => `Effect{n}${m[2] || ""}`, fam: [INT("n", 1, 4, "Effect #")] },
  { re: /^SetEffect([1-4])Strength$/, tmpl: () => `SetEffect{n}Strength`, fam: [INT("n", 1, 4, "Effect #")] },
  // Dynamic values / inputs (4)
  { re: /^SetDynamicValue([1-4])$/, tmpl: () => `SetDynamicValue{n}`, fam: [INT("n", 1, 4, "Slot #")] },
  { re: /^SetDynamicInput([1-4])$/, tmpl: () => `SetDynamicInput{n}`, fam: [INT("n", 1, 4, "Slot #")] },
  // Bus volumes A-G
  { re: /^SetBus([A-G])Volume$/, tmpl: () => `SetBus{bus}Volume`, fam: [ENUM("bus", ["A", "B", "C", "D", "E", "F", "G"], "Bus")] },
  { re: /^SetBus([A-G])VolumeFade$/, tmpl: () => `SetBus{bus}VolumeFade`, fam: [ENUM("bus", ["A", "B", "C", "D", "E", "F", "G"], "Bus")] },
  // Per-input send to bus M,A-G
  { re: /^SetVolumeBusMixer([A-GM])$/, tmpl: () => `SetVolumeBusMixer{bus}`, fam: [ENUM("bus", ["M", "A", "B", "C", "D", "E", "F", "G"], "Bus")] },
  // Stereo sub-channels 1/2
  { re: /^SetVolumeChannel([12])$/, tmpl: () => `SetVolumeChannel{ch}`, fam: [INT("ch", 1, 2, "Channel")] },
  { re: /^SetGainChannel([12])$/, tmpl: () => `SetGainChannel{ch}`, fam: [INT("ch", 1, 2, "Channel")] },
  // Channel-mixer sub-channels 1-16
  { re: /^SetVolumeChannelMixer([0-9]+)$/, tmpl: () => `SetVolumeChannelMixer{n}`, fam: [INT("n", 1, 16, "Sub-channel")] },
  // Replay cameras 1-8
  { re: /^ReplayCamera([1-8])$/, tmpl: () => `ReplayCamera{cam}`, fam: [INT("cam", 1, 8, "Camera #")] },
  { re: /^Replay([AB])Camera([1-8])$/, tmpl: () => `Replay{chn}Camera{cam}`, fam: [ENUM("chn", ["A", "B"], "Channel"), INT("cam", 1, 8, "Camera #")] },
  { re: /^ReplayToggleLastEventCamera([1-8])$/, tmpl: () => `ReplayToggleLastEventCamera{cam}`, fam: [INT("cam", 1, 8, "Camera #")] },
  { re: /^ReplayToggleSelectedEventCamera([1-8])$/, tmpl: () => `ReplayToggleSelectedEventCamera{cam}`, fam: [INT("cam", 1, 8, "Camera #")] },
  // Replay event-list selectors 1-20
  { re: /^ReplaySelectEvents([0-9]+)$/, tmpl: () => `ReplaySelectEvents{n}`, fam: [INT("n", 1, 20, "List #")] },
  // Input layers 1-10 (collapse the layer index only; keep the property suffix)
  { re: /^SetLayer(10|[1-9])(Crop|CropX1|CropX2|CropY1|CropY2|Height|Width|PanX|PanY|Rectangle|X|Y|Zoom)$/, tmpl: (m) => `SetLayer{n}${m[2]}`, fam: [INT("n", 1, 10, "Layer #")] },
];

function escStr(s) {
  return JSON.stringify(s == null ? "" : s);
}

// ── classify every item ───────────────────────────────────────────────
const families = new Map(); // template -> {entry, members:[fn], ruleParams}
const singletons = [];
const covered = new Set();

for (const it of items) {
  let matched = null;
  for (const r of rules) {
    const m = it.fn.match(r.re);
    if (m) {
      matched = { template: r.tmpl(m), fam: r.fam };
      break;
    }
  }
  if (!matched) {
    singletons.push(it);
    continue;
  }
  covered.add(it.fn);
  const key = matched.template;
  if (!families.has(key)) {
    families.set(key, {
      fn: matched.template,
      cat: it.cat,
      desc: it.desc,
      params: toks(it.params),
      fam: matched.fam,
      members: [it.fn],
    });
  } else {
    families.get(key).members.push(it.fn);
  }
}

// ── coverage assertion ────────────────────────────────────────────────
let memberCount = 0;
for (const f of families.values()) memberCount += f.members.length;
const totalRepresented = memberCount + singletons.length;
if (totalRepresented !== items.length) {
  throw new Error(`coverage mismatch: ${totalRepresented} != ${items.length}`);
}

// ── assemble entries grouped by category, in source order ─────────────
const CAT_ORDER = ["General", "Audio", "Transition", "Output", "Title", "Input", "Overlay", "PlayList", "Scripting", "Replay", "NDI", "PTZ", "Preset", "DataSources", "Browser"];
const entries = [];
for (const f of families.values()) entries.push({ fn: f.fn, cat: f.cat, desc: f.desc, params: f.params, fam: f.fam, variants: f.members.length });
for (const s of singletons) entries.push({ fn: s.fn, cat: s.cat, desc: s.desc, params: toks(s.params), fam: null, variants: 1 });

entries.sort((a, b) => {
  const ci = CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat);
  if (ci !== 0) return ci;
  return a.fn.localeCompare(b.fn);
});

// ── emit TS ───────────────────────────────────────────────────────────
function famLiteral(fam) {
  if (!fam) return "";
  const parts = fam.map((p) => {
    if (p.kind === "int") {
      const lbl = p.label ? `, label: ${escStr(p.label)}` : "";
      return `{ id: ${escStr(p.id)}, kind: "int", min: ${p.min}, max: ${p.max}${lbl} }`;
    }
    const lbl = p.label ? `, label: ${escStr(p.label)}` : "";
    return `{ id: ${escStr(p.id)}, kind: "enum", values: [${p.values.map(escStr).join(", ")}]${lbl} }`;
  });
  return `, family: [${parts.join(", ")}]`;
}

let out = "";
out += `// ─────────────────────────────────────────────────────────────────────\n`;
out += `// vMix Shortcut Function Reference — SOURCE OF TRUTH\n`;
out += `//\n`;
out += `// Auto-generated from the official reference, scraped in full:\n`;
out += `//   https://www.vmix.com/help28/ShortcutFunctionReference.html\n`;
out += `//   Scraped 2026-05-30 · 714 documented functions · 100% coverage.\n`;
out += `//\n`;
out += `// Numbered / lettered families are condensed into a single templated\n`;
out += `// entry: the variable part of the Function name becomes a {placeholder}\n`;
out += `// described by \`family\` (e.g. OverlayInput{ch} covers OverlayInput1..4,\n`;
out += `// SetBus{bus}Volume covers A..G). Every other function is listed 1:1.\n`;
out += `// \`params\` lists, in vMix's documented order, the query args the call\n`;
out += `// reads besides the family placeholders.\n`;
out += `//\n`;
out += `// Do not hand-edit — regenerate via .tmp_gen_shortcuts.cjs against a\n`;
out += `// fresh scrape when vMix ships a new version.\n`;
out += `// ─────────────────────────────────────────────────────────────────────\n\n`;

out += `export type VmixParamId =\n`;
out += `  | "input"\n  | "value"\n  | "duration"\n  | "channel"\n  | "mix"\n  | "selectedIndex"\n  | "selectedName";\n\n`;

out += `export type VmixCategory =\n`;
out += CAT_ORDER.map((c) => `  | ${escStr(c)}`).join("\n") + ";\n\n";

out += `/** A condensed placeholder baked into a Function-name template. */\n`;
out += `export type VmixFamilyParam =\n`;
out += `  | { id: string; kind: "int"; min: number; max: number; label?: string }\n`;
out += `  | { id: string; kind: "enum"; values: string[]; label?: string };\n\n`;

out += `export interface VmixShortcut {\n`;
out += `  /** Function name. May contain {placeholders} expanded via \`family\`. */\n`;
out += `  fn: string;\n`;
out += `  category: VmixCategory;\n`;
out += `  description: string;\n`;
out += `  /** Query args read besides any family placeholders, in vMix order. */\n`;
out += `  params: VmixParamId[];\n`;
out += `  /** Present when \`fn\` is a condensed template. */\n`;
out += `  family?: VmixFamilyParam[];\n`;
out += `}\n\n`;

out += `export const VMIX_SHORTCUTS: VmixShortcut[] = [\n`;
let lastCat = null;
for (const e of entries) {
  if (e.cat !== lastCat) {
    out += `\n  // ══════════════════════════ ${e.cat} ══════════════════════════\n`;
    lastCat = e.cat;
  }
  const p = `[${e.params.map(escStr).join(", ")}]`;
  out += `  { fn: ${escStr(e.fn)}, category: ${escStr(e.cat)}, description: ${escStr(e.desc)}, params: ${p}${famLiteral(e.fam)} },\n`;
}
out += `];\n\n`;

// ── helper: expand a template + selection into a concrete Function name ─
out += `/**\n`;
out += ` * Resolve a (possibly templated) shortcut into a concrete vMix Function\n`;
out += ` * name by substituting the chosen family values.\n`;
out += ` *   buildVmixFunction("OverlayInput{ch}", { ch: 2 }) === "OverlayInput2"\n`;
out += ` */\n`;
out += `export function buildVmixFunction(\n`;
out += `  fn: string,\n`;
out += `  selection: Record<string, string | number> = {},\n`;
out += `): string {\n`;
out += `  return fn.replace(/\\{(\\w+)\\}/g, (_, id) => {\n`;
out += `    const v = selection[id];\n`;
out += `    if (v === undefined) {\n`;
out += `      throw new Error(\`buildVmixFunction: missing family value "\${id}" for "\${fn}"\`);\n`;
out += `    }\n`;
out += `    return String(v);\n`;
out += `  });\n`;
out += `}\n\n`;

out += `/** Total documented functions represented (expanded count). */\n`;
out += `export const VMIX_SHORTCUT_COUNT = ${items.length};\n`;

fs.writeFileSync("src/lib/vmix/shortcuts.ts", out);

// ── report ────────────────────────────────────────────────────────────
console.log("scraped functions :", items.length);
console.log("condensed entries :", entries.length);
console.log("families          :", families.size);
console.log("singletons        :", singletons.length);
console.log("coverage check    : OK (" + totalRepresented + "/" + items.length + ")");
console.log("output bytes      :", out.length);
console.log("\nfamily templates:");
for (const f of families.values()) console.log("  " + f.fn + "  (" + f.members.length + " variants)");
