/* global window, document */
// NOTE: must NOT be `const cross` — the preload exposes a non-configurable
// global `window.cross` via contextBridge, and a top-level lexical
// declaration with the same name throws "Identifier 'cross' has already
// been declared", which kills this whole script (every button dead).
const api = window.cross;

const $ = (id) => document.getElementById(id);
const stateEl = $("state");
const ipEl = $("ip");
const portEl = $("port");
const labelEl = $("label");
const saveEl = $("save");
const hintEl = $("hint");
const devicesEl = $("devices");
const versionEl = $("version");
const bannerEl = $("update-banner");
const updateTextEl = $("update-text");
const updateBtnEl = $("update-btn");

let updateUrl = null;

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

function renderState(status) {
  if (!status || !status.running) {
    stateEl.textContent = "Idle";
    stateEl.className = "pill pill-off";
  } else if (status.connected) {
    stateEl.textContent = "Connected";
    stateEl.className = "pill pill-on";
  } else {
    stateEl.textContent = "Connecting…";
    stateEl.className = "pill pill-connecting";
  }
  if (status && status.lastError && !status.connected) {
    hintEl.textContent = status.lastError;
  }
}

function renderDevices(status) {
  const devices = (status && status.devices) || [];
  if (devices.length === 0) {
    // On the SAME PC as the Nexus server / Elgato software the deck is
    // held exclusively, so it either fails to open (blocked>0) or isn't
    // even enumerated (blocked==0). Both look like "no deck" to users,
    // so always point at the most common cause.
    devicesEl.innerHTML =
      '<div class="muted">No deck detected.<br><br>' +
      'If a Stream Deck <b>is</b> plugged into this PC, it’s probably already in use by another app ' +
      '(the Nexus app or Elgato Stream Deck software) — a deck can only be opened by one program at a time. ' +
      'Nexus Cross is meant to run on a <b>different</b> machine than the Nexus server; ' +
      'on the same PC, close the other app first.</div>';
    return;
  }
  const satLabel = (status && status.label) || "";
  devicesEl.innerHTML = "";
  for (const d of devices) {
    const row = document.createElement("div");
    row.className = "device";
    const left = document.createElement("span");
    // Prefix the model with this satellite's label so it's obvious which
    // machine the deck is on (matches what the Nexus app shows for
    // remote decks). Falls back to just the model when no label is set.
    left.textContent = satLabel ? `${satLabel} · ${d.model}` : d.model;
    const right = document.createElement("span");
    right.className = "meta";
    right.textContent = `${d.serial} · ${d.rows}×${d.cols}`;
    row.appendChild(left);
    row.appendChild(right);
    devicesEl.appendChild(row);
  }
}

function render(status) {
  renderState(status);
  renderDevices(status);
}

async function init() {
  versionEl.textContent = "v" + (await api.getVersion());
  const settings = await api.getSettings();
  const { ip, port } = splitServer(settings.serverUrl || "");
  ipEl.value = ip;
  portEl.value = port;
  labelEl.value = settings.label || "";
  render(await api.getStatus());

  const info = await api.getUpdateInfo();
  if (info) showUpdate(info);
}

function showUpdate(info) {
  if (!info || !info.available) {
    bannerEl.hidden = true;
    return;
  }
  updateUrl = info.installerUrl || info.releaseUrl;
  updateTextEl.textContent = `Update ${info.latestVersion} available`;
  bannerEl.hidden = false;
}

saveEl.addEventListener("click", async () => {
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
  hintEl.textContent = "Saved.";
});

for (const el of [ipEl, portEl, labelEl]) {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveEl.click();
  });
}

updateBtnEl.addEventListener("click", () => {
  if (updateUrl) api.openExternal(updateUrl);
});

$("hide").addEventListener("click", () => api.hide());
$("quit").addEventListener("click", () => api.quit());

api.onStatus(render);
api.onUpdateInfo(showUpdate);

init();
