import { contextBridge, ipcRenderer } from "electron";
import type { ServerStatus, ServerLog } from "./server-manager";
import type { VmixPrefs } from "./prefs";
import type { UpdateInfo } from "./updater";

interface LauncherSettings {
  port: number;
  gui_interface: string;
  startMinimized: boolean;
}

interface InterfaceOption {
  label: string;
  ip: string;
}

const api = {
  getStatus: (): Promise<ServerStatus> =>
    ipcRenderer.invoke("launcher:get-status"),
  getLogs: (): Promise<ServerLog[]> =>
    ipcRenderer.invoke("launcher:get-logs"),
  getSettings: (): Promise<LauncherSettings> =>
    ipcRenderer.invoke("launcher:get-settings"),
  getInterfaces: (): Promise<InterfaceOption[]> =>
    ipcRenderer.invoke("launcher:get-interfaces"),
  setPort: (port: number): Promise<void> =>
    ipcRenderer.invoke("launcher:set-port", port),
  setGuiInterface: (ip: string): Promise<void> =>
    ipcRenderer.invoke("launcher:set-gui-interface", ip),
  getVmixPrefs: (): Promise<VmixPrefs> =>
    ipcRenderer.invoke("launcher:get-vmix-prefs"),
  setVmixPrefs: (partial: Partial<VmixPrefs>): Promise<VmixPrefs> =>
    ipcRenderer.invoke("launcher:set-vmix-prefs", partial),
  openGui: () => ipcRenderer.send("launcher:open-gui"),
  openExternal: (url: string) => ipcRenderer.send("launcher:open-external", url),
  hide: () => ipcRenderer.send("launcher:hide"),
  quit: () => ipcRenderer.send("launcher:quit"),
  onStatus: (cb: (s: ServerStatus) => void) => {
    const listener = (_e: unknown, s: ServerStatus) => cb(s);
    ipcRenderer.on("launcher:status", listener);
    return () => ipcRenderer.removeListener("launcher:status", listener);
  },
  onLog: (cb: (l: ServerLog) => void) => {
    const listener = (_e: unknown, l: ServerLog) => cb(l);
    ipcRenderer.on("launcher:log", listener);
    return () => ipcRenderer.removeListener("launcher:log", listener);
  },
  getUpdateInfo: (): Promise<UpdateInfo | null> =>
    ipcRenderer.invoke("launcher:get-update-info"),
  checkUpdate: (): Promise<UpdateInfo | null> =>
    ipcRenderer.invoke("launcher:check-update"),
  onUpdateInfo: (cb: (info: UpdateInfo) => void) => {
    const listener = (_e: unknown, info: UpdateInfo) => cb(info);
    ipcRenderer.on("launcher:update-info", listener);
    return () => ipcRenderer.removeListener("launcher:update-info", listener);
  },
};

contextBridge.exposeInMainWorld("launcher", api);

export type LauncherApi = typeof api;
