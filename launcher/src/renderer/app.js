// Swiss-style renderer for Nexus launcher.

const $ = (id) => document.getElementById(id);

const els = {
  body: document.body,
  // hero
  numeral: $("numeral"),
  display: $("display"),
  subPort: $("subPort"),
  subEnd: $("subEnd"),
  // 02 interface
  ifaceValue: $("ifaceValue"),
  ifaceIp: $("ifaceIp"),
  ifaceDropdown: $("ifaceDropdown"),
  // 03 web ui port
  portValue: $("portValue"),
  portChange: $("portChange"),
  // vMix host / port / SRT / polling all live in the web app now:
  //   • host + port (HTTP)  → Network page connections panel
  //   • polling interval    → Network page connections panel
  //   • SRT port            → floating stream window
  // The launcher only deals with its own server (Interface + Port) and
  // the logs viewer.
  // cta
  cta: $("openGui"),
  ctaLabel: $("ctaLabel"),
  hideBtn: $("hideBtn"),
  quitBtn: $("quitBtn"),
  // logs
  logsBody: $("logsBody"),
  clearLogs: $("clearLogs"),
  // update
  updateRow: $("updateRow"),
  updateTitle: $("updateTitle"),
  updateSub: $("updateSub"),
  // quit modal
  quitConfirm: $("quitConfirm"),
  quitCancel: $("quitCancel"),
  quitConfirmBtn: $("quitConfirmBtn"),
};

let status = null;
let interfaces = [];
let settings = null;

/* ── View routing ──────────────────────────────────── */
function showView(name) {
  for (const v of document.querySelectorAll(".view"))
    v.classList.toggle("is-active", v.dataset.view === name);
}
for (const btn of document.querySelectorAll("[data-go]")) {
  btn.addEventListener("click", () => showView(btn.dataset.go));
}

/* ── State rendering ──────────────────────────────── */
function renderStatus(s) {
  status = s;
  els.body.classList.remove("is-running", "is-starting", "is-stopped", "is-error");

  switch (s.phase) {
    case "stopped":
      els.body.classList.add("is-stopped");
      els.display.textContent = "Stopped.";
      els.subPort.textContent = `:${s.port}`;
      els.subEnd.textContent = ".";
      els.ctaLabel.textContent = "START SERVER";
      els.cta.disabled = false;
      break;
    case "starting":
      els.body.classList.add("is-starting");
      els.display.textContent = "Starting…";
      els.subPort.textContent = `:${s.port}`;
      els.subEnd.textContent = ".";
      els.ctaLabel.textContent = "LAUNCH GUI";
      els.cta.disabled = true;
      break;
    case "running":
      els.body.classList.add("is-running");
      els.display.textContent = "Running.";
      els.subPort.textContent = `:${s.port}`;
      els.subEnd.textContent = ".";
      els.ctaLabel.textContent = "LAUNCH GUI";
      els.cta.disabled = false;
      break;
    case "error":
      els.body.classList.add("is-error");
      els.display.textContent = "Error.";
      els.subPort.textContent = s.error ? "—" : `:${s.port}`;
      els.subEnd.textContent = "";
      els.ctaLabel.textContent = "RETRY";
      els.cta.disabled = false;
      break;
  }

  // Decorative numeral mirrors the live web UI port
  els.numeral.textContent = String(s.port);

  // Port value (inline-editable mono numeral)
  if (!els.portValue.classList.contains("is-editing")) {
    els.portValue.textContent = String(s.port);
  }
}

function renderInterface() {
  if (!settings || !interfaces.length) return;
  const cur = interfaces.find((i) => i.ip === settings.gui_interface) || interfaces[0];
  // Strip the "Ethernet — 192.168.x.x" decoration from the label
  const name = cur.label.split(" — ")[0];
  els.ifaceValue.textContent = name;
  els.ifaceIp.textContent = cur.ip === "0.0.0.0" ? "All interfaces" : cur.ip;
}

/* ── Inline edit helper ────────────────────────────── */
function inlineEdit({ el, initial, validate, commit }) {
  if (el.classList.contains("is-editing")) return;
  const original = el.textContent;
  el.classList.add("is-editing");
  el.textContent = "";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.className = "cell-input";
  input.value = String(initial);
  el.appendChild(input);
  // Select-all on next frame so it works on all platforms
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });

  const cleanup = (text) => {
    el.classList.remove("is-editing");
    el.textContent = text;
  };

  const submit = async () => {
    const raw = input.value.trim();
    const ok = validate(raw);
    if (!ok) {
      cleanup(original);
      return;
    }
    try {
      await commit(ok);
    } catch {
      cleanup(original);
      return;
    }
    cleanup(String(ok));
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      cleanup(original);
    }
  });
  input.addEventListener("blur", submit);
}

const validPort = (raw) => {
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1024 || n > 65535) return null;
  return n;
};

/* ── Interface dropdown ────────────────────────────── */
function buildInterfaceDropdown() {
  els.ifaceDropdown.innerHTML = "";
  for (const opt of interfaces) {
    const btn = document.createElement("button");
    btn.className = "dropdown-item";
    if (settings && opt.ip === settings.gui_interface)
      btn.classList.add("is-selected");
    const name = opt.label.split(" — ")[0];
    btn.innerHTML = `${name}<span class="mono">${opt.ip}</span>`;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      els.ifaceDropdown.hidden = true;
      await window.launcher.setGuiInterface(opt.ip);
      settings = await window.launcher.getSettings();
      renderInterface();
    });
    els.ifaceDropdown.appendChild(btn);
  }
}

els.ifaceValue.addEventListener("click", (e) => {
  e.stopPropagation();
  buildInterfaceDropdown();
  els.ifaceDropdown.hidden = !els.ifaceDropdown.hidden;
});
document.addEventListener("click", () => {
  els.ifaceDropdown.hidden = true;
});

/* ── Port editing ──────────────────────────────────── */
function editWebUiPort() {
  if (!status) return;
  inlineEdit({
    el: els.portValue,
    initial: status.port,
    validate: validPort,
    commit: (n) => window.launcher.setPort(n),
  });
}
els.portValue.addEventListener("click", editWebUiPort);
els.portChange.addEventListener("click", (e) => {
  e.stopPropagation();
  editWebUiPort();
});

/* ── Bottom actions ────────────────────────────────── */
els.cta.addEventListener("click", () => {
  if (els.cta.disabled) return;
  window.launcher.openGui();
});
els.hideBtn.addEventListener("click", () => window.launcher.hide());
els.quitBtn.addEventListener("click", () => {
  els.quitConfirm.classList.add("is-open");
});
els.quitCancel.addEventListener("click", () => {
  els.quitConfirm.classList.remove("is-open");
});
els.quitConfirmBtn.addEventListener("click", () => window.launcher.quit());
// Esc dismisses the modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.quitConfirm.classList.contains("is-open")) {
    els.quitConfirm.classList.remove("is-open");
  }
});

/* ── Logs ──────────────────────────────────────────── */
function appendLog(entry) {
  const div = document.createElement("div");
  div.className = "log-line";
  const ts = new Date(entry.ts).toISOString().slice(11, 19);
  const tsSpan = document.createElement("span");
  tsSpan.className = "log-ts";
  tsSpan.textContent = ts;
  const msg = document.createElement("span");
  msg.className = `log-msg ${entry.level}`;
  msg.textContent = entry.message;
  div.appendChild(tsSpan);
  div.appendChild(msg);
  els.logsBody.appendChild(div);

  while (els.logsBody.childElementCount > 500) {
    els.logsBody.firstElementChild?.remove();
  }
  const nearBottom =
    els.logsBody.scrollHeight - els.logsBody.scrollTop - els.logsBody.clientHeight < 30;
  if (nearBottom) els.logsBody.scrollTop = els.logsBody.scrollHeight;
}
els.clearLogs.addEventListener("click", () => {
  els.logsBody.innerHTML = "";
});

/* ── Update banner ─────────────────────────────────── */
let updateInfo = null;

function renderUpdate(info) {
  updateInfo = info;
  // Hide the row unless the updater confirms a strictly-newer release
  // is published on GitHub. The "error" case (offline / API down) also
  // stays hidden — we don't want a "couldn't check for updates" banner
  // nagging operators in venues without reliable internet.
  if (!info || !info.available) {
    els.updateRow.hidden = true;
    return;
  }
  els.updateRow.hidden = false;
  els.updateTitle.textContent = `v${info.latestVersion} available`;
  els.updateSub.textContent = `current: v${info.currentVersion}`;
}

els.updateRow.addEventListener("click", () => {
  if (!updateInfo) return;
  // Prefer the direct installer link when present so the user lands on
  // the .exe download; fall back to the release page (with notes) if
  // the asset isn't named the way we expect.
  const url = updateInfo.installerUrl || updateInfo.releaseUrl;
  if (url) window.launcher.openExternal(url);
});

/* ── Backend events ────────────────────────────────── */
window.launcher.onStatus((s) => renderStatus(s));
window.launcher.onLog((entry) => appendLog(entry));
window.launcher.onUpdateInfo((info) => renderUpdate(info));

/* ── Hydrate ───────────────────────────────────────── */
(async () => {
  const s = await window.launcher.getStatus();
  if (s) renderStatus(s);
  const logs = await window.launcher.getLogs();
  for (const entry of logs) appendLog(entry);
  settings = await window.launcher.getSettings();
  interfaces = await window.launcher.getInterfaces();
  renderInterface();
  const cachedUpdate = await window.launcher.getUpdateInfo();
  if (cachedUpdate) renderUpdate(cachedUpdate);
})();
