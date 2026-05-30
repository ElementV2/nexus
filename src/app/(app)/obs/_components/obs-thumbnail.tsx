"use client";

import { useEffect, useState } from "react";
import { useConnections } from "@/hooks/use-connections";
import { useConnectionId } from "@/hooks/use-connection-command";

/* ── Live screenshot tiles, on a SHARED rate-capped scheduler ────────── */

/**
 * A scene grid can mount 15–30 thumbnails. If each polled OBS on its own
 * 1 Hz timer they'd fire 15–30 `GetSourceScreenshot` requests per second
 * — hammering OBS's encoder thread exactly when broadcast CPU headroom
 * matters most. Instead every tile registers with ONE module-level
 * scheduler that issues requests sequentially, round-robin, with a fixed
 * gap between them: total OBS load is capped regardless of grid size,
 * and tiles share the rate fairly. Paused while the tab is hidden.
 */

interface Tile {
  sourceName: string;
  width: number;
  height: number;
  obsId: string;
  update: (src: string | null, failed: boolean) => void;
}

// One request every MIN_GAP_MS at most (≈4 req/s), AND sequential (we await
// each before scheduling the next), so OBS never sees concurrent captures.
const MIN_GAP_MS = 250;
const HIDDEN_GAP_MS = 1500;

const tiles = new Set<Tile>();
let loopArmed = false;
let cursor = 0;

function scheduleLoop(delay: number): void {
  loopArmed = true;
  setTimeout(runOnce, delay);
}

async function runOnce(): Promise<void> {
  if (tiles.size === 0) {
    loopArmed = false;
    return;
  }
  if (typeof document !== "undefined" && document.hidden) {
    scheduleLoop(HIDDEN_GAP_MS);
    return;
  }
  // Round-robin: pick the next tile in a stable order.
  const arr = Array.from(tiles);
  const tile = arr[cursor % arr.length];
  cursor = (cursor + 1) % Math.max(1, arr.length);

  try {
    const res = await fetch(
      `/api/connections/${encodeURIComponent(tile.obsId)}/command`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "get-source-screenshot",
          sourceName: tile.sourceName,
          imageWidth: tile.width,
          imageHeight: tile.height,
        }),
      }
    );
    if (tiles.has(tile)) {
      if (res.ok) {
        const json = (await res.json()) as
          | { ok: true; data: string }
          | { ok: false; error: string };
        if (json.ok && typeof json.data === "string") {
          tile.update(json.data, false);
        } else {
          tile.update(null, true);
        }
      } else {
        tile.update(null, true);
      }
    }
  } catch {
    if (tiles.has(tile)) tile.update(null, true);
  }

  scheduleLoop(MIN_GAP_MS);
}

function registerTile(tile: Tile): () => void {
  tiles.add(tile);
  if (!loopArmed) scheduleLoop(0);
  return () => {
    tiles.delete(tile);
  };
}

export function ObsThumbnail({
  sourceName,
  width,
  height,
}: {
  sourceName: string;
  width: number;
  height: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { data: connectionsData } = useConnections();
  const obsId = useConnectionId(
    connectionsData?.connections ?? null,
    "obs",
    connectionsData?.defaults
  );

  useEffect(() => {
    if (!obsId) return;
    const tile: Tile = {
      sourceName,
      width,
      height,
      obsId,
      update: (nextSrc, nextFailed) => {
        if (nextSrc !== null) setSrc(nextSrc);
        setFailed(nextFailed);
      },
    };
    return registerTile(tile);
  }, [sourceName, width, height, obsId]);

  return (
    <div
      style={{
        aspectRatio: "16/9",
        background: "var(--bg)",
        border: "1px solid var(--line)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={sourceName}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span className="font-mono" style={{ fontSize: 9, color: "var(--sub)" }}>
          {failed ? "no preview" : "…"}
        </span>
      )}
    </div>
  );
}
