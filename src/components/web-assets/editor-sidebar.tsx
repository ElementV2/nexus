"use client";

import { useMemo } from "react";
import {
  useOverlayEditorStore,
  selectActiveOverlay,
} from "@/stores/overlay-editor-store";
import { LayersPanel } from "./sidebar/layers-panel";
import { CanvasProperties } from "./sidebar/canvas-properties";
import { ElementProperties } from "./sidebar/element-properties";
import { HoleProperties } from "./sidebar/hole-properties";
import { TextProperties } from "./sidebar/text-properties";
import { ImageProperties } from "./sidebar/image-properties";
import { Eyebrow } from "@/components/sw";

export function EditorSidebar() {
  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);

  const single = useMemo(() => {
    if (!overlay || selectedIds.length !== 1) return null;
    return overlay.elements.find((e) => e.id === selectedIds[0]) || null;
  }, [overlay, selectedIds]);

  return (
    <div
      className="w-60 lg:w-72 shrink-0 flex flex-col min-h-0 bg-sw-bg"
      style={{ borderLeft: "1px solid var(--line)", background: "var(--panel)" }}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="px-[18px] py-[16px] sw-hairline-bottom">
          <Eyebrow tone="amber" className="mb-2">
            A · Layers
          </Eyebrow>
          <LayersPanel />
        </div>

        {single && (
          <>
            <div className="px-[18px] py-[16px] sw-hairline-bottom">
              <Eyebrow tone="amber" className="mb-2">
                B · Element
              </Eyebrow>
              <ElementProperties />
            </div>
            {(single.type === "hole" ||
              single.type === "text" ||
              single.type === "image") && (
              <div className="px-[18px] py-[16px] sw-hairline-bottom">
                <Eyebrow tone="amber" className="mb-2">
                  C · {single.type === "hole" ? "Hole" : single.type === "text" ? "Text" : "Image"}
                </Eyebrow>
                {single.type === "hole" && <HoleProperties />}
                {single.type === "text" && <TextProperties />}
                {single.type === "image" && <ImageProperties />}
              </div>
            )}
          </>
        )}

        {selectedIds.length > 1 && (
          <div className="px-[18px] py-[16px] sw-hairline-bottom">
            <Eyebrow tone="muted" className="mb-2">
              Multi-selection
            </Eyebrow>
            <p className="text-[11px] text-sw-text-dim">
              <span className="font-mono">{selectedIds.length}</span> elements
              selected.
            </p>
          </div>
        )}

        <div className="px-[18px] py-[16px]">
          <Eyebrow tone="amber" className="mb-2">
            Z · Canvas
          </Eyebrow>
          <CanvasProperties />
        </div>
      </div>
    </div>
  );
}
