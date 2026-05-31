/* global window, document */
// NOTE: must NOT be `const cross` — the preload exposes a non-configurable
// global `window.cross` via contextBridge, and a top-level lexical
// declaration with the same name throws "Identifier 'cross' has already
// been declared", which kills this whole script (every button dead).
const api = window.cross;

const $ = (id) => document.getElementById(id);
const displayEl = $("display");
const linkSubEl = $("linkSub");
const ipEl = $("ip");
const portEl = $("port");
const labelEl = $("label");
const saveEl = $("save");
const hintEl = $("hint");
const devicesEl = $("devices");
const conflictEl = $("conflict");
const conflictEyebrowEl = $("conflict-eyebrow");
const conflictTextEl = $("conflict-text");
const versionEl = $("version");
const bannerEl = $("update-banner");
const updateTextEl = $("update-text");
const updateSubEl = $("update-sub");
const ctaLabelEl = saveEl.querySelector(".cta-label");
const ctaArrowEl = saveEl.querySelector(".cta-arrow");

let updateInfo = null;
let currentStatus = null;

// The settings store a full base URL (http://host:port); the UI shows a
// bare IP + port so the operator never deals with the scheme.
function splitServer(url) {
  if (!url) return { ip: "", port: "" };
  try {
    const u = new URL(url);
    return { ip: u.hostname, port: u.port || "" };
  } catch {
    return { ip: url, port: "" };
  }
}

function composeServer(ip, port) {
  const host = (ip || "").trim();
  const p = (port || "").trim();
  if (!host) return "";
  return p ? `${host}:${p}` : host;
}

// Hero subline shows whichever server the satellite targets.
function renderLink() {
  const link = composeServer(ipEl.value, portEl.value);
  linkSubEl.textContent = link || "—";
}

const STATES = {
  offline: { word: "Offline.", cls: "is-offline" },
  connecting: { word: "Connecting…", cls: "is-connecting" },
  connected: { word: "Connected.", cls: "is-connected" },
  blocked: { word: "Blocked.", cls: "is-blocked" },
};

// One Connect/Disconnect button that reflects the link state. Server IP /
// Port / Name are editable ONLY when fully disconnected — you must
// Disconnect to change them, so a live bridge is never reconfigured under
// itself. When a local Nexus server blocks us, the button is dead and the
// only way out is Quit.
function renderAction(status) {
  const blocked = !!(status && status.localServer);
  const running = !!(status && status.running);
  for (const el of [ipEl, portEl, labelEl]) el.disabled = blocked || running;
  saveEl.disabled = blocked;
  saveEl.classList.toggle("cta--disconnect", running && !blocked);
  if (blocked) {
    ctaLabelEl.textContent = "Blocked";
    ctaArrowEl.textContent = "✕";
  } else if (running) {
    ctaLabelEl.textContent = "Disconnect";
    ctaArrowEl.textContent = "✕";
  } else {
    ctaLabelEl.textContent = "Connect";
    ctaArrowEl.textContent = "↗";
  }
  document.body.classList.toggle("is-locked", blocked);
}

function renderState(status) {
  let key = "offline";
  if (status && status.localServer) key = "blocked";
  else if (status && status.running) key = status.connected ? "connected" : "connecting";
  const s = STATES[key];
  displayEl.textContent = s.word;
  document.body.classList.remove(
    "is-offline",
    "is-connecting",
    "is-connected",
    "is-blocked"
  );
  document.body.classList.add(s.cls);
  // Surface a live link error only while disconnected — but not the
  // local-server block, which the conflict banner explains in full.
  if (status && status.lastError && !status.connected && !status.localServer) {
    hintEl.textContent = status.lastError;
  } else if (status && status.localServer) {
    hintEl.textContent = "";
  }
}

function renderDevices(status) {
  const devices = (status && status.devices) || [];
  if (devices.length === 0) {
    // Keep this terse — the same-PC / deck-in-use explanation lives in
    // the conflict warning above when it applies. A bare "no deck" here
    // covers the plain case (remote box, nothing plugged in yet).
    devicesEl.innerHTML =
      '<div class="muted">No deck detected. If one is plugged in, another app may ' +
      "be using it (a deck opens in one program at a time).</div>";
    return;
  }
  const satLabel = (status && status.label) || "";
  devicesEl.innerHTML = "";
  for (const d of devices) {
    const row = document.createElement("div");
    row.className = "device";
    const left = document.createElement("span");
    // Prefix the model with this satellite's label so it's obvious which
    // machine the deck is on (matches what the Nexus app shows).
    left.textContent = satLabel ? `${satLabel} · ${d.model}` : d.model;
    const right = document.createElement("span");
    right.className = "meta";
    right.textContent = `${d.serial} · ${d.rows}×${d.cols}`;
    row.appendChild(left);
    row.appendChild(right);
    devicesEl.appendChild(row);
  }
}

// Warn loudly when Cross is running on the SAME PC as the Nexus server.
// Two tells: the server URL resolves to this machine (sameHost), or a
// local deck is already claimed by another app (blocked). In both cases
// the satellite is in the wrong place — it belongs on another box.
function renderConflict(status) {
  // localServer is set by the agent only when a real Nexus server answers
  // on this machine — so this never fires from a local IP with nothing
  // listening (no false alarm).
  let shown = true;
  if (status && status.localServer) {
    conflictEyebrowEl.textContent = "⚠ Server running on this PC";
    conflictTextEl.textContent =
      "A Nexus server is running on this PC, so Cross is blocked — both here " +
      "would fight over the Stream Deck. Run Cross on another PC, or just " +
      "close it with Quit below. Unblocks if the local server stops.";
  } else if (status && status.blocked > 0) {
    conflictEyebrowEl.textContent = "⚠ Deck already in use";
    conflictTextEl.textContent =
      "A Stream Deck here is held by another app (Nexus or Elgato). A deck " +
      "opens in one program at a time — close it, or run Cross elsewhere.";
  } else {
    shown = false;
  }
  conflictEl.hidden = !shown;
  // Free vertical space (and avoid a scrollbar) by dropping the now-moot
  // deck list whenever a conflict banner is up.
  document.body.classList.toggle("has-conflict", shown);
}

function render(status) {
  currentStatus = status;
  renderState(status);
  renderConflict(status);
  renderDevices(status);
  renderAction(status);
}

function showUpdate(info) {
  updateInfo = info;
  // Hide unless the updater confirms a strictly-newer Nexus Cross asset
  // is published. The error case (offline / API down) stays hidden too —
  // same policy as the main app, no "couldn't check" nagging.
  if (!info || !info.available) {
    bannerEl.hidden = true;
    return;
  }
  updateTextEl.textContent = `v${info.latestVersion} available`;
  updateSubEl.textContent = `current: v${info.currentVersion}`;
  bannerEl.hidden = false;
}

async function init() {
  versionEl.textContent = "v" + (await api.getVersion());
  const settings = await api.getSettings();
  const { ip, port } = splitServer(settings.serverUrl || "");
  ipEl.value = ip;
  portEl.value = port;
  labelEl.value = settings.label || "";
  renderLink();
  render(await api.getStatus());

  const info = await api.getUpdateInfo();
  if (info) showUpdate(info);
}

saveEl.addEventListener("click", async () => {
  const s = currentStatus;
  if (s && s.localServer) return; // blocked — Quit is the only way out
  if (s && s.running) {
    // Connected (or connecting) → disconnect so the fields unlock.
    hintEl.textContent = "Disconnecting…";
    await api.disconnect();
    hintEl.textContent = "";
    return;
  }
  // Disconnected → save the edited settings and connect.
  hintEl.textContent = "Connecting…";
  const saved = await api.setSettings({
    serverUrl: composeServer(ipEl.value, portEl.value),
    label: labelEl.value,
  });
  // Reflect the normalised result (default :9088 added when no port was
  // given) back into the bare IP + port fields.
  if (saved && typeof saved.serverUrl === "string") {
    const { ip, port } = splitServer(saved.serverUrl);
    ipEl.value = ip;
    portEl.value = port;
  }
  renderLink();
});

for (const el of [ipEl, portEl, labelEl]) {
  el.addEventListener("input", renderLink);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveEl.click();
  });
}

bannerEl.addEventListener("click", () => {
  // Prefer the direct installer link, then the release page, then a
  // hardcoded releases/latest — so the click always opens something
  // useful even if assets lag the release. Mirrors the main app.
  const url =
    (updateInfo && (updateInfo.installerUrl || updateInfo.releaseUrl)) ||
    "https://github.com/ElementV2/nexus/releases/latest";
  api.openExternal(url);
});

$("hide").addEventListener("click", () => api.hide());
$("quit").addEventListener("click", () => api.quit());

api.onStatus(render);
api.onUpdateInfo(showUpdate);

init();
