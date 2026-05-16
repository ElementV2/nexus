import { readJson, writeJson } from "./index";
import type { OverlayConfig } from "@/lib/web-assets/types";

const FILE = "overlays.json";

interface Store {
  overlays: OverlayConfig[];
}

function read(): Store {
  return readJson<Store>(FILE, { overlays: [] });
}

function write(store: Store) {
  writeJson(FILE, store);
}

export function listOverlays(): OverlayConfig[] {
  return read().overlays;
}

export function getOverlayByName(name: string): OverlayConfig | null {
  return read().overlays.find((o) => o.name === name) || null;
}

export function upsertOverlay(config: OverlayConfig): void {
  const store = read();
  const idx = store.overlays.findIndex((o) => o.id === config.id);
  if (idx >= 0) store.overlays[idx] = config;
  else store.overlays.push(config);
  write(store);
}

export function upsertManyOverlays(configs: OverlayConfig[]): void {
  // Full replace — the editor always sends the complete list when it syncs.
  write({ overlays: configs });
}

export function deleteOverlay(id: string): void {
  const store = read();
  store.overlays = store.overlays.filter((o) => o.id !== id);
  write(store);
}
