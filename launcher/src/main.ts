import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { ServerManager } from "./server-manager";
import { loadVmixPrefs, saveVmixPrefs } from "./prefs";
import { Updater } from "./updater";

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: ServerManager | null = null;
let updater: Updater | null = null;
let quitting = false;

interface LauncherSettings {
  port: number;
  /** IPv4 the web server binds to. "0.0.0.0" = all interfaces. */
  gui_interface: string;
  startMinimized: boolean;
}

// 9088 — visually echoes vMix's 8088 (just bumped the leading digit) and
// avoids the usual broadcast/AV/dev ports: vMix HTTP (8088), vMix SRT
// (5000), 3000, 4444/4455 (OBS), 1935 (RTMP), 8000, 9000.
const DEFAULT_SETTINGS: LauncherSettings = {
  port: 9088,
  gui_interface: "0.0.0.0",
  startMinimized: false,
};

function settingsPath(): string {
  let base: string;
  if (platform() === "win32") {
    base = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(base, "Nexus", "launcher.json");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Nexus", "launcher.json");
  }
  base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "nexus", "launcher.json");
}

function loadSettings(): LauncherSettings {
  try {
    const p = settingsPath();
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf-8");
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: LauncherSettings) {
  try {
    const p = settingsPath();
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(s, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

function rendererPath(file: string): string {
  return join(__dirname, "renderer", file);
}

function resourcePath(file: string): string {
  const candidates = [
    join(__dirname, "..", "resources", file),
    join(process.resourcesPath || "", file),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0];
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 540,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Nexus",
    // Match the dark-sage palette of the web UI so the OS chrome
    // doesn't flash white during launch.
    backgroundColor: "#0d1310",
    autoHideMenuBar: true,
    icon: resourcePath("icon.ico"),
    // Windows-only: keep the native min/maximize/close caption buttons
    // but paint the area behind them and their glyphs ourselves so the
    // OS title bar blends with the app body. `titleBarStyle: hidden`
    // is required for `titleBarOverlay` to apply on Windows.
    titleBarStyle: "hidden",
    // Match `--panel-2` (the hero background) so the OS caption-button
    // area visually merges with the strip immediately below it. Using
    // `--bg` here would re-introduce the dark band the meta bar used
    // to sit on.
    titleBarOverlay: {
      color: "#181f19",
      symbolColor: "#dde2d6",
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(rendererPath("index.html"));

  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createTray() {
  let icon = nativeImage.createFromPath(resourcePath("icon.ico"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Nexus");
  const menu = Menu.buildFromTemplate([
    {
      label: "Show window",
      click: () => {
        if (!mainWindow) mainWindow = createWindow();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Open GUI in browser",
      click: () => {
        const urls = server?.getStatus().lanUrls;
        if (urls && urls.length > 0) shell.openExternal(urls[0]);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!mainWindow) mainWindow = createWindow();
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function listInterfaces(): { label: string; ip: string }[] {
  const ifaces = require("node:os").networkInterfaces() as Record<
    string,
    Array<{ address: string; family: string; internal: boolean }>
  >;
  const out: { label: string; ip: string }[] = [
    { label: "All interfaces", ip: "0.0.0.0" },
  ];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family !== "IPv4") continue;
      if (info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      out.push({ label: `${name} — ${info.address}`, ip: info.address });
    }
  }
  out.push({ label: "Loopback only (127.0.0.1)", ip: "127.0.0.1" });
  return out;
}

function wireIpc(srv: ServerManager) {
  ipcMain.handle("launcher:get-version", () => app.getVersion());
  ipcMain.handle("launcher:get-status", () => srv.getStatus());
  ipcMain.handle("launcher:get-logs", () => srv.getLogs());
  ipcMain.handle("launcher:get-settings", () => loadSettings());
  ipcMain.handle("launcher:get-interfaces", () => listInterfaces());
  ipcMain.handle("launcher:set-port", async (_e, port: number) => {
    // Reject out-of-range ports before persisting / restarting — a 0 or
    // negative value would otherwise wedge the server in a restart loop.
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port ${port} — must be an integer 1-65535`);
    }
    const s = loadSettings();
    s.port = port;
    saveSettings(s);
    srv.setPort(port);
    await srv.restart();
  });
  ipcMain.handle("launcher:set-gui-interface", async (_e, ip: string) => {
    const s = loadSettings();
    s.gui_interface = ip;
    saveSettings(s);
    srv.setHostname(ip);
    await srv.restart();
  });
  // vMix preferences (host, ports, polling) are stored in the same JSON
  // file the Next.js server reads, so no restart is needed on change —
  // the server picks them up on the next request.
  ipcMain.handle("launcher:get-vmix-prefs", () => loadVmixPrefs());
  ipcMain.handle("launcher:set-vmix-prefs", (_e, partial: Record<string, unknown>) =>
    saveVmixPrefs(partial)
  );
  ipcMain.on("launcher:open-gui", () => {
    const urls = srv.getStatus().lanUrls;
    if (urls.length > 0) shell.openExternal(urls[0]);
  });
  ipcMain.on("launcher:open-external", async (_e, url: string) => {
    // Only ever hand http(s) URLs to the OS — never file:/custom schemes
    // (classic Electron footgun if the renderer is ever tricked).
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      console.warn("[launcher] refused open-external for non-http(s) url:", url);
      return;
    }
    try {
      await shell.openExternal(url);
    } catch (err) {
      console.error("[launcher] shell.openExternal failed:", url, err);
    }
  });
  ipcMain.on("launcher:hide", () => mainWindow?.hide());
  ipcMain.on("launcher:quit", () => {
    quitting = true;
    app.quit();
  });

  // Update checker: latest cached info is served synchronously; the
  // explicit re-check is wired here so a renderer dev tool / future
  // "check now" button can force a refresh without waiting 6h.
  ipcMain.handle("launcher:get-update-info", () => updater?.getInfo() ?? null);
  ipcMain.handle("launcher:check-update", async () => {
    if (!updater) return null;
    return await updater.check();
  });

  srv.on("status", (s) => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send("launcher:status", s)
    );
  });
  srv.on("log", (l) => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send("launcher:log", l)
    );
  });
}

app.on("second-instance", () => {
  if (!mainWindow) mainWindow = createWindow();
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  // Stay alive in the tray
});

app.on("before-quit", async () => {
  quitting = true;
  if (server) await server.stop();
});

app.whenReady().then(async () => {
  const settings = loadSettings();

  createTray();
  mainWindow = createWindow();

  server = new ServerManager();
  server.setPort(settings.port);
  server.setHostname(settings.gui_interface);
  updater = new Updater();
  updater.on("info", (info) => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send("launcher:update-info", info)
    );
  });
  updater.start();
  wireIpc(server);

  // Push initial state to renderer once it's ready
  mainWindow.webContents.on("did-finish-load", () => {
    if (!server) return;
    mainWindow?.webContents.send("launcher:status", server.getStatus());
    for (const l of server.getLogs()) {
      mainWindow?.webContents.send("launcher:log", l);
    }
    // Replay the most recent update check so the banner reappears after
    // a window reload (the updater's interval is hours, not seconds).
    const info = updater?.getInfo();
    if (info) mainWindow?.webContents.send("launcher:update-info", info);
  });

  if (settings.startMinimized) {
    mainWindow.hide();
  }

  await server.start();
});
