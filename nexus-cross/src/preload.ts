import { contextBridge, ipcRenderer } from "electron";
import type { AgentStatus } from "./agent";
import type { CrossSettings } from "./prefs";
import type { UpdateInfo } from "./updater";

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke("cross:get-version"),
  getSettings: (): Promise<CrossSettings> =>
    ipcRenderer.invoke("cross:get-settings"),
  getStatus: (): Promise<AgentStatus | null> =>
    ipcRenderer.invoke("cross:get-status"),
  setSettings: (partial: Partial<CrossSettings>): Promise<CrossSettings> =>
    ipcRenderer.invoke("cross:set-settings", partial),
  openExternal: (url: string) => ipcRenderer.send("cross:open-external", url),
  hide: () => ipcRenderer.send("cross:hide"),
  quit: () => ipcRenderer.send("cross:quit"),
  getUpdateInfo: (): Promise<UpdateInfo | null> =>
    ipcRenderer.invoke("cross:get-update-info"),
  checkUpdate: (): Promise<UpdateInfo | null> =>
    ipcRenderer.invoke("cross:check-update"),
  onStatus: (cb: (s: AgentStatus | null) => void) => {
    const listener = (_e: unknown, s: AgentStatus | null) => cb(s);
    ipcRenderer.on("cross:status", listener);
    return () => ipcRenderer.removeListener("cross:status", listener);
  },
  onUpdateInfo: (cb: (info: UpdateInfo) => void) => {
    const listener = (_e: unknown, info: UpdateInfo) => cb(info);
    ipcRenderer.on("cross:update-info", listener);
    return () => ipcRenderer.removeListener("cross:update-info", listener);
  },
};

contextBridge.exposeInMainWorld("cross", api);

export type CrossApi = typeof api;
