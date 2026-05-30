"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import type {
  OverlayConfig,
  OverlayElement,
  HoleElement,
  TextElement,
  ImageElement,
} from "@/lib/web-assets/types";

const STORAGE_KEY = "overlay-editor-v2";
const POLL_MS = 500;

function findOverlayLocal(name: string): OverlayConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const overlays = JSON.parse(raw) as OverlayConfig[];
    return overlays.find((o) => o.name === name) || null;
  } catch {
    return null;
  }
}

// ── Element renderers ──

function RenderHole({ el }: { el: HoleElement }) {
  if (el.borderWidth <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        zIndex: el.zIndex,
        border: `${el.borderWidth}px solid ${el.borderColor}`,
        borderRadius: el.borderRadius || undefined,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    />
  );
}

function RenderText({ el }: { el: TextElement }) {
  const textShadow =
    el.shadowBlur > 0 || el.shadowOffsetX || el.shadowOffsetY
      ? `${el.shadowOffsetX}px ${el.shadowOffsetY}px ${el.shadowBlur}px ${el.shadowColor}`
      : undefined;

  return (
    <div
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        zIndex: el.zIndex,
        fontFamily: el.fontFamily,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        color: el.color,
        backgroundColor:
          el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
        textAlign: el.textAlign,
        lineHeight: el.lineHeight,
        display: "flex",
        alignItems: "center",
        justifyContent:
          el.textAlign === "center"
            ? "center"
            : el.textAlign === "right"
            ? "flex-end"
            : "flex-start",
        overflow: "hidden",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        textShadow,
        WebkitTextStroke:
          el.strokeWidth > 0
            ? `${el.strokeWidth}px ${el.strokeColor}`
            : undefined,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {el.content}
    </div>
  );
}

function RenderImage({ el }: { el: ImageElement }) {
  if (!el.src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={el.src}
      alt=""
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        zIndex: el.zIndex,
        objectFit: el.objectFit,
        opacity: el.opacity,
        borderRadius: el.borderRadius || undefined,
        border:
          el.borderWidth > 0
            ? `${el.borderWidth}px solid ${el.borderColor}`
            : undefined,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    />
  );
}

function RenderElement({ el }: { el: OverlayElement }) {
  if (!el.visible) return null;
  switch (el.type) {
    case "hole":
      return <RenderHole el={el} />;
    case "text":
      return <RenderText el={el} />;
    case "image":
      return <RenderImage el={el} />;
  }
}

function buildClipPathCSS(holes: HoleElement[]): string | undefined {
  if (holes.length === 0) return undefined;

  // Outer rect (full canvas) — keeps everything visible
  let d = "M0,0 H1920 V1080 H0 Z";

  for (const h of holes) {
    const rx = Math.min(h.borderRadius || 0, h.width / 2, h.height / 2);
    if (rx > 0) {
      d += ` M${h.x + rx},${h.y}`;
      d += ` H${h.x + h.width - rx}`;
      d += ` A${rx},${rx} 0 0 1 ${h.x + h.width},${h.y + rx}`;
      d += ` V${h.y + h.height - rx}`;
      d += ` A${rx},${rx} 0 0 1 ${h.x + h.width - rx},${h.y + h.height}`;
      d += ` H${h.x + rx}`;
      d += ` A${rx},${rx} 0 0 1 ${h.x},${h.y + h.height - rx}`;
      d += ` V${h.y + rx}`;
      d += ` A${rx},${rx} 0 0 1 ${h.x + rx},${h.y}`;
      d += ` Z`;
    } else {
      d += ` M${h.x},${h.y} H${h.x + h.width} V${h.y + h.height} H${h.x} Z`;
    }
  }

  return `path(evenodd, "${d}")`;
}

// ── Main page ──

export default function OverlayLivePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const [config, setConfig] = useState<OverlayConfig | null>(null);

  // Diff-gate: this overlay is the live browser-source output polled
  // every 500 ms. Without a change check, each poll called setConfig and
  // re-rendered the entire overlay tree 2×/s even when nothing changed.
  // Only publish a new config when the payload actually differs.
  const lastJson = useRef("");
  const applyConfig = useCallback((next: OverlayConfig | null) => {
    const json = next ? JSON.stringify(next) : "";
    if (json === lastJson.current) return;
    lastJson.current = json;
    setConfig(next);
  }, []);

  const fetchFromDb = useCallback(async (): Promise<OverlayConfig | null> => {
    try {
      const res = await fetch(
        `/api/overlays/by-name/${encodeURIComponent(decodedName)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return null;
      return (await res.json()) as OverlayConfig;
    } catch {
      return null;
    }
  }, [decodedName]);

  const refresh = useCallback(async () => {
    const remote = await fetchFromDb();
    applyConfig(remote ?? findOverlayLocal(decodedName));
  }, [decodedName, fetchFromDb, applyConfig]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // First load: fetch the overlay config when the name resolves. The
  // periodic refresh effect above keeps it fresh after that.
  useEffect(() => {
    void fetchFromDb().then((remote) => {
      applyConfig(remote ?? findOverlayLocal(decodedName));
    });
  }, [decodedName, fetchFromDb, applyConfig]);

  if (!config) {
    return (
      <div
        style={{
          width: 1920,
          height: 1080,
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.3)",
          fontFamily: "sans-serif",
          fontSize: 18,
        }}
      >
        Overlay &quot;{decodedName}&quot; not found
      </div>
    );
  }

  const sortedElements = [...config.elements]
    .filter((e) => e.visible)
    .sort((a, b) => a.zIndex - b.zIndex);

  const holes = sortedElements.filter(
    (e) => e.type === "hole"
  ) as HoleElement[];
  const clipPathValue = buildClipPathCSS(holes);

  return (
    <div style={{ width: 1920, height: 1080, position: "relative", overflow: "hidden", background: "transparent" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: clipPathValue,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: config.backgroundColor,
            backgroundImage: config.backgroundImageUrl
              ? `url(${config.backgroundImageUrl})`
              : undefined,
            backgroundSize: "cover",
          }}
        />

        {config.textureUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${config.textureUrl})`,
              backgroundSize: "cover",
              mixBlendMode: config.blendMode as React.CSSProperties["mixBlendMode"],
              opacity: config.textureOpacity,
              pointerEvents: "none",
            }}
          />
        )}

        {sortedElements
          .filter((e) => e.type !== "hole")
          .map((el) => (
            <RenderElement key={el.id} el={el} />
          ))}
      </div>

      {holes.map((el) => (
        <RenderHole key={`border-${el.id}`} el={el} />
      ))}
    </div>
  );
}
