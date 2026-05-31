"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";

const LS_POS_KEY = "vmix-stream-position";

const PLAYER_W = 480;
const PLAYER_H = 300;

type PlayerStatus = "idle" | "connecting" | "playing" | "error";

function loadPosition(): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(LS_POS_KEY);
    if (v) return JSON.parse(v);
  } catch {}
  return null;
}

function friendlyError(msg: string): string {
  if (/ffmpeg not found/i.test(msg))
    return "FFmpeg not found. The bundled ffmpeg-static should ship with the launcher.";
  if (/ffmpeg exited|ffmpeg process|exited code/i.test(msg))
    return "FFmpeg relay failed — is the vMix SRT output enabled, on this host/port?";
  if (/failed to fetch|networkerror/i.test(msg))
    return "Cannot reach the stream relay API. Is the server running?";
  if (/502|bad gateway/i.test(msg))
    return "Relay couldn't reach vMix's SRT. Enable the SRT output in vMix and check the host/port.";
  return msg;
}

interface FloatingPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FloatingPlayer({ open, onClose }: FloatingPlayerProps) {
  // Pick which configured vMix to stream from — no longer pinned to the
  // single global default. Choose the instance + SRT port, then launch.
  const { data } = useConnections();
  const vmixConns = useMemo(
    () => (data?.connections ?? []).filter((c) => c.kind === "vmix" && c.enabled),
    [data]
  );
  const defaultVmixId = data?.defaults?.vmix;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Seed / re-seed the selection: prefer the default vMix, else the first.
  useEffect(() => {
    setSelectedId((cur) => {
      if (cur && vmixConns.some((c) => c.id === cur)) return cur;
      return (
        vmixConns.find((c) => c.id === defaultVmixId)?.id ??
        vmixConns[0]?.id ??
        null
      );
    });
  }, [vmixConns, defaultVmixId]);

  const selected = vmixConns.find((c) => c.id === selectedId);
  const selectedCfg = (selected?.config ?? {}) as {
    host?: string;
    srtPort?: number;
  };
  const host = selectedCfg.host ?? "";

  // Port follows the selected vMix's configured SRT port but stays
  // editable for a one-off. Re-seeds when the chosen connection changes.
  const [port, setPort] = useState(5000);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || seededFor.current === selected.id) return;
    seededFor.current = selected.id;
    setPort(selectedCfg.srtPort ?? 5000);
  }, [selected, selectedCfg.srtPort]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof import("mpegts.js")["default"]["createPlayer"]> | null>(null);
  const destroyedRef = useRef(false);

  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    return (
      loadPosition() ?? {
        x: typeof window !== "undefined" ? window.innerWidth - PLAYER_W - 24 : 400,
        y: typeof window !== "undefined" ? window.innerHeight - PLAYER_H - 24 : 400,
      }
    );
  });
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Persist the player position, but debounce so a drag doesn't write
  // localStorage 60× a second (sync API, can stall the main thread).
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(LS_POS_KEY, JSON.stringify(position));
    }, 400);
    return () => clearTimeout(t);
  }, [position]);

  useEffect(() => {
    if (!open) {
      destroyPlayer();
      setStatus("idle");
      setErrorMsg(null);
    }
  }, [open]);

  function destroyPlayer() {
    const mp = playerRef.current;
    if (mp) {
      try {
        mp.pause();
        mp.unload();
        mp.detachMediaElement();
        mp.destroy();
      } catch {}
      playerRef.current = null;
    }
  }

  /** Changing the target (vMix or port) drops the current stream so the
   *  idle "Connect" affordance reappears for the new selection. */
  const retarget = useCallback(() => {
    if (status === "idle") return;
    destroyPlayer();
    setStatus("idle");
    setErrorMsg(null);
  }, [status]);

  const connect = useCallback(async () => {
    if (!host) return;
    destroyPlayer();
    destroyedRef.current = false;
    setStatus("connecting");
    setErrorMsg(null);

    try {
      const mpegts = (await import("mpegts.js")).default;
      if (destroyedRef.current || !videoRef.current) return;
      if (!mpegts.isSupported()) {
        setStatus("error");
        setErrorMsg("mpegts.js is not supported in this browser.");
        return;
      }
      mpegts.LoggingControl.enableAll = false;

      // Stream the CHOSEN vMix instance + port (server validates + relays).
      const url = `/api/stream?host=${encodeURIComponent(host)}&srtPort=${port}`;
      const mp = mpegts.createPlayer(
        { type: "mpegts", url, isLive: true },
        {
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 1.5,
          liveBufferLatencyMinRemain: 0.3,
        }
      );

      playerRef.current = mp;

      mp.on(
        mpegts.Events.ERROR,
        (_type: string, _detail: string, info: { msg?: string }) => {
          if (!destroyedRef.current) {
            setStatus("error");
            setErrorMsg(friendlyError(info?.msg ?? "Unknown stream error"));
          }
        }
      );

      mp.on(mpegts.Events.LOADING_COMPLETE, () => {
        if (!destroyedRef.current) {
          setStatus("error");
          setErrorMsg("Stream ended.");
        }
      });

      mp.attachMediaElement(videoRef.current);
      mp.load();

      try {
        await videoRef.current.play();
        if (!destroyedRef.current) setStatus("playing");
      } catch {
        if (!destroyedRef.current) setStatus("playing");
      }
    } catch (err) {
      if (!destroyedRef.current) {
        setStatus("error");
        setErrorMsg(friendlyError(String(err)));
      }
    }
  }, [host, port]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    return () => {
      destroyedRef.current = true;
      destroyPlayer();
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        px: position.x,
        py: position.y,
      };
    },
    [position]
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPosition({
        x: dragStart.current.px + dx,
        y: dragStart.current.py + dy,
      });
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging]);

  if (!open) return null;

  const hasVmix = vmixConns.length > 0;
  const srtInfo = host ? `srt://${host}:${port}` : "—";

  return (
    <div
      className="fixed z-50 flex flex-col bg-sw-bg"
      style={{
        width: PLAYER_W,
        left: position.x,
        top: position.y,
        border: "1px solid var(--line-hi)",
        background: "var(--panel)",
      }}
    >
      {/* Header — drag handle */}
      <div
        className={cn(
          "flex items-center justify-between px-[14px] py-[8px] select-none sw-rule-bottom",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={handlePointerDown}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-[9.5px] font-semibold uppercase"
            style={{
              letterSpacing: "0.22em",
              color: status === "playing" ? "var(--amber)" : "var(--muted)",
            }}
          >
            {status === "playing" ? "● Live" : "○ Stream"}
          </span>
          {/* vMix picker + SRT port — pointerdown stopped so editing the
              controls doesn't drag the window. */}
          <span
            className="font-mono text-[10px] text-sw-muted flex items-center"
            style={{ letterSpacing: "0.02em", gap: 4 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {hasVmix ? (
              <>
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    retarget();
                  }}
                  className="font-mono"
                  title="Choose which vMix to stream"
                  style={{
                    fontSize: 10,
                    padding: "1px 4px",
                    maxWidth: 180,
                    background: "var(--card)",
                    color: "var(--ink)",
                    border: "1px solid var(--line)",
                    outline: "none",
                  }}
                >
                  {vmixConns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} · {(c.config as { host?: string }).host ?? "?"}
                    </option>
                  ))}
                </select>
                <span>:</span>
                <input
                  type="number"
                  value={String(port)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setPort(Number.isFinite(n) ? n : 0);
                    retarget();
                  }}
                  title="SRT port"
                  className="font-mono"
                  style={{
                    width: 56,
                    fontSize: 10,
                    padding: "1px 4px",
                    background: "var(--card)",
                    color: "var(--ink)",
                    border: "1px solid var(--line)",
                    outline: "none",
                  }}
                />
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>No vMix configured</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted((v) => !v)}
            className="flex items-center justify-center"
            style={{
              width: 22,
              height: 22,
              color: muted ? "var(--pgm)" : "var(--ink)",
              background: "transparent",
              border: "none",
            }}
            aria-pressed={muted}
            aria-label={muted ? "Unmute stream" : "Mute stream"}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <VolumeX size={16} strokeWidth={1.75} />
            ) : (
              <Volume2 size={16} strokeWidth={1.75} />
            )}
          </button>
          <button
            onClick={onClose}
            className="hover:text-[var(--pgm)] text-[14px]"
            style={{ color: "var(--muted)" }}
            title="Close"
            aria-label="Close stream player"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Video area */}
      <div
        className="relative"
        style={{ height: PLAYER_H - 40, background: "#0a0a0a" }}
      >
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          muted={muted}
          playsInline
        />

        {/* Idle */}
        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sw-bg">
            {hasVmix ? (
              <>
                <button
                  onClick={connect}
                  data-active="true"
                  data-role="amber"
                  className="sw-cell"
                  style={{ padding: "10px 22px", fontSize: 12 }}
                >
                  ▶ Connect to {srtInfo}
                </button>
                <p
                  className="font-mono text-[10px] text-sw-muted text-center"
                  style={{ letterSpacing: "0.02em" }}
                >
                  Pick the vMix + SRT port in the header, then connect.
                </p>
              </>
            ) : (
              <p
                className="font-mono text-[11px] text-sw-muted text-center px-6"
                style={{ letterSpacing: "0.02em" }}
              >
                Add a vMix connection in Network › Connections to stream its
                SRT output.
              </p>
            )}
          </div>
        )}

        {/* Connecting */}
        {status === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sw-bg/90">
            <span
              className="font-mono text-[10px] font-semibold uppercase text-sw-amber"
              style={{ letterSpacing: "0.22em" }}
            >
              ● Booting
            </span>
            <p className="font-mono text-[11px] text-sw-muted">
              Connecting to {srtInfo}…
            </p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sw-bg px-6">
            <span
              className="font-mono text-[10px] font-semibold uppercase text-sw-red"
              style={{ letterSpacing: "0.22em" }}
            >
              ● Error
            </span>
            <p className="text-[11px] text-sw-text-dim text-center leading-relaxed">
              {errorMsg}
            </p>
            <button
              onClick={connect}
              className="sw-cell"
              style={{ padding: "8px 18px", fontSize: 11 }}
            >
              ↻ Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
