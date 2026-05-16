import type { VmixCommand } from "./commands";
import type { VmixState } from "./types";

// The browser doesn't know which vMix to talk to — the server reads its
// connection info from the persisted preferences and proxies the request.

export async function getState(): Promise<VmixState> {
  const res = await fetch("/api/vmix/state", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch vMix state: ${res.status}`);
  }
  return res.json();
}

/**
 * Try once, and on a transient failure (network error or 5xx) retry once
 * after a short backoff. Most "command lost" cases come from a single
 * blip during reconnection; one retry is usually enough to ride it out
 * without the operator noticing.
 */
export async function sendCommand(command: VmixCommand): Promise<void> {
  const body = JSON.stringify(command);
  const attempt = async () => {
    const res = await fetch("/api/vmix/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`vMix command failed (${res.status}): ${text}`);
    }
  };

  try {
    await attempt();
  } catch (err) {
    // Don't retry on 4xx — those are us, not the network.
    const msg = err instanceof Error ? err.message : "";
    if (/\(4\d\d\)/.test(msg)) throw err;
    await new Promise((r) => setTimeout(r, 120));
    await attempt();
  }
}

export async function getRawXml(): Promise<string> {
  const res = await fetch("/api/vmix/state?raw=1", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch vMix XML: ${res.status}`);
  }
  return res.text();
}
