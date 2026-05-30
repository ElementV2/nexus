"use client";

import { useEffect, useState } from "react";
import { useConnections } from "@/hooks/use-connections";
import { useConnectionId } from "@/hooks/use-connection-command";

/* ── Live screenshot tile ────────────────────────────────────── */

/**
 * Polls the OBS broker via the generic connection command at ~1 Hz
 * to keep a live thumbnail visible. Pauses when the tab is hidden so
 * we don't burn OBS's CPU when the operator isn't looking.
 */
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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, 1500);
        return;
      }
      try {
        const res = await fetch(
          `/api/connections/${encodeURIComponent(obsId)}/command`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              action: "get-source-screenshot",
              sourceName,
              imageWidth: width,
              imageHeight: height,
            }),
          }
        );
        if (!cancelled) {
          if (res.ok) {
            const json = (await res.json()) as
              | { ok: true; data: string }
              | { ok: false; error: string };
            if (json.ok && typeof json.data === "string") {
              setSrc(json.data);
              setFailed(false);
            } else {
              setFailed(true);
            }
          } else {
            setFailed(true);
          }
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
      // Slower cadence after a failure — avoid hammering when the
      // source name is wrong or OBS is gone.
      timer = setTimeout(tick, failed ? 5000 : 1000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sourceName, width, height, failed, obsId]);

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
        <span
          className="font-mono"
          style={{ fontSize: 9, color: "var(--sub)" }}
        >
          {failed ? "no preview" : "…"}
        </span>
      )}
    </div>
  );
}
