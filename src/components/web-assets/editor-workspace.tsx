"use client";

import { useEffect, useState } from "react";
import { EditorToolbar } from "./editor-toolbar";
import { EditorCanvas } from "./editor-canvas";
import { EditorSidebar } from "./editor-sidebar";
import {
  useOverlayEditorStore,
  selectActiveOverlay,
} from "@/stores/overlay-editor-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { TopBar, ToolbarSlot } from "@/components/sw";
import { copyToClipboard } from "@/lib/utils/clipboard";

export function EditorWorkspace() {
  const loadFromStorage = useOverlayEditorStore((s) => s.loadFromStorage);
  const activeOverlay = useOverlayEditorStore(selectActiveOverlay);
  const overlays = useOverlayEditorStore((s) => s.overlays);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useKeyboardShortcuts();

  const htmlUrl = activeOverlay
    ? `/overlay/${encodeURIComponent(activeOverlay.name)}`
    : "";

  const copyHtmlUrl = async () => {
    if (!htmlUrl) return;
    const ok = await copyToClipboard(window.location.origin + htmlUrl);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex flex-col h-full bg-sw-bg">
      <TopBar
        status="live"
        num="08"
        label="Overlay editor"
        title={
          activeOverlay ? (
            <>
              {activeOverlay.name}
              <span className="text-sw-muted font-light">.</span>
            </>
          ) : (
            <>No overlay.</>
          )
        }
        sub={`${overlays.length} overlay${overlays.length !== 1 ? "s" : ""}${activeOverlay ? ` · 1920×1080 · ${activeOverlay.elements.length} element${activeOverlay.elements.length !== 1 ? "s" : ""}` : ""}`}
        right={
          activeOverlay && (
            <ToolbarSlot label="Public URL">
              <button
                onClick={copyHtmlUrl}
                className="sw-cell"
                title={htmlUrl}
              >
                {copied ? "✓ Copied" : "⎘ Copy URL"}
              </button>
            </ToolbarSlot>
          )
        }
      />

      <EditorToolbar />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 sw-rule-right">
          <EditorCanvas />
        </div>
        <EditorSidebar />
      </div>
    </div>
  );
}
