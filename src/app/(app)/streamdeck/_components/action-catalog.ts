"use client";

import { useEffect, useState } from "react";
import type { ActionCatalogEntry } from "./types";

// Module-cached action catalog so the inspector doesn't re-fetch on
// every mount (selection toggle, layout switch). Lives at module
// scope so HMR reruns it lazily and SSR doesn't touch it.
let actionCatalogPromise: Promise<ActionCatalogEntry[]> | null = null;
function loadActionCatalog(): Promise<ActionCatalogEntry[]> {
  if (!actionCatalogPromise) {
    actionCatalogPromise = fetch("/api/actions", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ actions: ActionCatalogEntry[] }>)
      .then((j) => j.actions)
      .catch(() => []);
  }
  return actionCatalogPromise;
}

export function useActionCatalog(): ActionCatalogEntry[] | null {
  const [actions, setActions] = useState<ActionCatalogEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadActionCatalog().then((a) => {
      if (!cancelled) setActions(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return actions;
}

// ─────────────────── vMix input suggestions ───────────────────────────

/**
 * Live list of vMix inputs (number + title) for the inspector's
 * datalist. Resolves the first enabled connection of kind="vmix" via
 * `/api/connections`, then fetches its snapshot.
 *
 * Polled every 8 s — picks up new/renamed inputs without waiting for
 * a manual refresh. Disabled when `enabled` is false to avoid the
 * fetch when no vMix binding is selected.
 */
export interface VmixInputSuggestion {
  value: string;
  label: string;
}
interface VmixInputDTO {
  number: number;
  title: string;
}
interface ConnectionSnapshotResponse {
  snapshot?: { inputs?: VmixInputDTO[] };
}

export function useVmixInputSuggestions(
  enabled: boolean
): VmixInputSuggestion[] | undefined {
  const [suggestions, setSuggestions] = useState<
    VmixInputSuggestion[] | undefined
  >(undefined);

  useEffect(() => {
    if (!enabled) {
      // Mirror "off" state by emptying the cache once; we don't want
      // to call setState every render. eslint flags this as a
      // cascading render concern but the guard above means it fires
      // at most once per `enabled` flip.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions(undefined);
      return;
    }
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        // Find the active vMix connection. Reuse `/api/connections`
        // (cached upstream by useConnections in other tabs, but this
        // hook lives in the inspector — one extra round-trip is fine).
        const resList = await fetch("/api/connections", { cache: "no-store" });
        if (!resList.ok) return;
        const list = (await resList.json()) as {
          connections: Array<{ id: string; kind: string; enabled: boolean }>;
        };
        const vmix = list.connections.find(
          (c) => c.kind === "vmix" && c.enabled
        );
        if (!vmix) {
          if (!cancelled) setSuggestions([]);
          return;
        }
        const resSnap = await fetch(
          `/api/connections/${encodeURIComponent(vmix.id)}`,
          { cache: "no-store" }
        );
        if (!resSnap.ok) return;
        const snap = (await resSnap.json()) as ConnectionSnapshotResponse;
        const inputs = snap.snapshot?.inputs ?? [];
        if (cancelled) return;
        // Suggest the number first (most common — operators bind by
        // index) followed by the title as a second entry per input.
        // The datalist deduplicates on `value`, so we make sure the
        // two entries differ when title === number.
        const out: VmixInputSuggestion[] = [];
        for (const inp of inputs) {
          const n = String(inp.number);
          out.push({ value: n, label: `${n} · ${inp.title}` });
          if (inp.title && inp.title !== n) {
            out.push({ value: inp.title, label: `${inp.title} · #${n}` });
          }
        }
        setSuggestions(out);
      } catch {
        /* leave stale */
      }
    };

    void fetchOnce();
    const handle = setInterval(fetchOnce, 8_000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled]);

  return suggestions;
}
