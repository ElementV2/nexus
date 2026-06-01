/**
 * nexus-cross — Electron entry point.
 *
 * A tiny status app (window + tray) that runs the Stream Deck satellite
 * agent: it bridges a Stream Deck plugged into THIS machine to a Nexus
 * server running elsewhere on the LAN. The operator sets the server URL
 * in the window; the agent announces its decks, applies renders pushed
 * over SSE, and forwards key presses back.
 *
 * Mirrors the main Nexus launcher's shape (tray-resident, single
 * instance, dark window, GitHub-release updater) for a consistent feel.
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "./agent";
import { registerKeyFont } from "./key-image";
import { loadSettings, saveSettings, type CrossSettings } from "./prefs";
import { Updater } from "./updater";

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: Agent | null = null;
let updater: Updater | null = null;
let quitting = false;

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
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Nexus Cross",
    backgroundColor: "#0d1310",
    autoHideMenuBar: true,
    icon: resourcePath("icon.ico"),
    titleBarStyle: "hidden",
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

function showWindow(): void {
  if (!mainWindow) mainWindow = createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  let icon = nativeImage.createFromPath(resourcePath("icon.ico"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Nexus Cross");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show window", click: showWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else showWindow();
  });
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

function wireIpc(): void {
  ipcMain.handle("cross:get-version", () => app.getVersion());
  ipcMain.handle("cross:get-settings", () => loadSettings());
  ipcMain.handle("cross:get-status", () => agent?.getStatus() ?? null);
  ipcMain.handle(
    "cross:set-settings",
    async (_e, partial: Partial<CrossSettings>) => {
      const next = saveSettings(partial);
      // Reconnect with the new settings, but DON'T await it — start()
      // does HID enumeration + a network announce, either of which can
      // be slow. Awaiting here would freeze the Save round-trip (and the
      // window) until they finish. Progress is reported via status
      // events instead. Errors are swallowed (surfaced in status).
      void agent?.start(next).catch((err) => {
        console.error("[cross] agent.start failed:", err);
      });
      return next;
    }
  );
  // Manual disconnect: drop the bridge so the operator can edit the
  // server IP / port / name, then reconnect. Stays disconnected until the
  // next Connect (the local-server watcher won't auto-resume without a
  // block transition).
  ipcMain.handle("cross:disconnect", () => agent?.disconnect());
  ipcMain.on("cross:open-external", async (_e, url: string) => {
    // Only hand http(s) URLs to the OS — never file:/custom schemes.
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      console.warn("[cross] refused open-external for non-http(s) url:", url);
      return;
    }
    try {
      await shell.openExternal(url);
    } catch (err) {
      console.error("[cross] openExternal failed:", url, err);
    }
  });
  ipcMain.on("cross:hide", () => mainWindow?.hide());
  ipcMain.on("cross:quit", () => {
    quitting = true;
    app.quit();
  });
  ipcMain.handle("cross:get-update-info", () => updater?.getInfo() ?? null);
  ipcMain.handle("cross:check-update", async () => {
    if (!updater) return null;
    return await updater.check();
  });
}

app.on("second-instance", showWindow);
app.on("window-all-closed", () => {
  /* stay alive in the tray */
});
// Electron doesn't await async `before-quit` handlers, so the deck reset
// below would get cut short. preventDefault the first quit, run the cleanup
// to completion, then re-issue the quit (let through by the guard).
let quitCleanupDone = false;
app.on("before-quit", async (e) => {
  if (quitCleanupDone) return;
  e.preventDefault();
  quitting = true;
  try {
    // Release the physical Stream Decks on THIS machine back to the standby
    // logo — a quit shouldn't leave stale, dead buttons lit.
    await agent?.resetDecks();
    await agent?.stop();
  } catch {
    /* best effort — never block the quit on a deck reset */
  } finally {
    quitCleanupDone = true;
    app.quit();
  }
});

app.whenReady().then(async () => {
  const settings = loadSettings();

  // Register the bundled key-label font BEFORE any deck render so the
  // satellite paints the same Barlow Semi Condensed face the server does.
  // resourcePath() covers both the dev tree and the packaged resources dir.
  registerKeyFont([
    resourcePath(join("fonts", "BarlowSemiCondensed-Medium.ttf")),
    resourcePath("BarlowSemiCondensed-Medium.ttf"),
  ]);

  createTray();
  mainWindow = createWindow();

  agent = new Agent();
  agent.on("status", (s) => broadcast("cross:status", s));
  // Continuously watch for a Nexus server on this same machine; the agent
  // blocks itself (and releases the deck) whenever one is up.
  agent.watchLocalServer();

  updater = new Updater();
  updater.on("info", (info) => broadcast("cross:update-info", info));
  updater.start();

  wireIpc();

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("cross:status", agent?.getStatus() ?? null);
    const info = updater?.getInfo();
    if (info) mainWindow?.webContents.send("cross:update-info", info);
  });

  if (settings.startMinimized) mainWindow.hide();

  // Start the agent — no-ops cleanly when the server URL is still blank
  // (the window prompts the operator to set it). Fire-and-forget: a
  // persisted-but-unreachable server URL must not wedge app startup.
  void agent.start(settings).catch((err) => {
    console.error("[cross] initial agent.start failed:", err);
  });
});
