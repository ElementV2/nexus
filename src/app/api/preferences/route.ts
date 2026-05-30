import { NextRequest, NextResponse } from "next/server";
import { getPreferences, setPreferences } from "@/lib/db/preferences";
import { ensureBooted, reconcileFromPreferences } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getPreferences());
}

/**
 * Per-kind sync mapping. Each entry watches a set of legacy `*_host`/
 * `*_port`/... preference keys and, when any of them change, mirrors
 * the new values onto every registered connection of that kind. Keeps
 * the legacy connections-panel cards (vMix / Ableton / OBS) working
 * against the device-registry without forcing a full card refactor.
 *
 * Adding a new kind that still has a legacy card = one new entry here.
 * When a card is migrated to write through `/api/connections/:id` the
 * matching entry can be removed.
 */
type PrefsView = ReturnType<typeof getPreferences>;
type KindSync = {
  kind: string;
  changed: (before: PrefsView, after: PrefsView) => boolean;
  buildConfig: (p: PrefsView) => unknown;
};
const KIND_SYNCS: KindSync[] = [
  {
    kind: "obs",
    changed: (a, b) =>
      a.obs_host !== b.obs_host ||
      a.obs_port !== b.obs_port ||
      a.obs_password !== b.obs_password,
    buildConfig: (p) => ({
      host: p.obs_host,
      port: p.obs_port,
      password: p.obs_password,
    }),
  },
  {
    kind: "vmix",
    changed: (a, b) =>
      a.vmix_host !== b.vmix_host ||
      a.vmix_port !== b.vmix_port ||
      a.vmix_srt_port !== b.vmix_srt_port ||
      a.polling_interval !== b.polling_interval,
    buildConfig: (p) => ({
      host: p.vmix_host,
      port: p.vmix_port,
      pollingInterval: p.polling_interval,
      srtPort: p.vmix_srt_port,
    }),
  },
  {
    kind: "ableton",
    changed: (a, b) =>
      a.ableton_host !== b.ableton_host ||
      a.ableton_send_port !== b.ableton_send_port ||
      a.ableton_recv_port !== b.ableton_recv_port,
    buildConfig: (p) => ({
      host: p.ableton_host,
      sendPort: p.ableton_send_port,
      recvPort: p.ableton_recv_port,
    }),
  },
];

export async function PUT(request: NextRequest) {
  ensureBooted();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const before = getPreferences();
  const updated = setPreferences(body);

  // Mirror legacy named-key host/port edits into the device-registry's
  // `connections[]`, then reconcile — that calls each per-instance
  // broker's `updateConfig`, so the OBS/Ableton/vMix sockets pick up the
  // new host immediately (no singleton `refreshConfig` needed anymore).
  // Build the updated list IN MEMORY across all kind syncs, then persist
  // it in ONE `setPreferences` write.
  let nextConnections = updated.connections;
  let anyKindChanged = false;
  for (const sync of KIND_SYNCS) {
    if (!sync.changed(before, updated)) continue;
    const newConfig = sync.buildConfig(updated);
    nextConnections = nextConnections.map((c) =>
      c.kind === sync.kind ? { ...c, config: newConfig } : c
    );
    anyKindChanged = true;
  }
  if (anyKindChanged) {
    const synced = setPreferences({ connections: nextConnections });
    reconcileFromPreferences();
    return NextResponse.json(synced);
  }

  return NextResponse.json(updated);
}
