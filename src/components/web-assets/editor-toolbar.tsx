"use client";

import {
  useOverlayEditorStore,
  getActiveOverlay,
} from "@/stores/overlay-editor-store";
import type { ActiveTool } from "@/stores/overlay-editor-store";
import { useConfirm } from "@/components/sw";

function ToolBtn({
  onClick,
  active,
  disabled,
  title,
  role = "default",
  children,
}: {
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  role?: "default" | "red" | "green" | "blue" | "amber";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      // Most ToolBtn instances are icon-only; mirror the visible
      // hover-title to an accessible name so screen-reader users get
      // the same affordance.
      aria-label={title}
      aria-pressed={active || undefined}
      data-active={active ? "true" : "false"}
      data-role={role}
      className="sw-cell"
      style={{ padding: "5px 8px", fontSize: 10, minWidth: 28, height: 28 }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 18,
        background: "var(--line-hi)",
        margin: "0 6px",
      }}
    />
  );
}

function ToolButton({
  tool,
  label,
}: {
  tool: ActiveTool;
  label: string;
}) {
  const activeTool = useOverlayEditorStore((s) => s.activeTool);
  const setActiveTool = useOverlayEditorStore((s) => s.setActiveTool);
  return (
    <ToolBtn
      active={activeTool === tool}
      role="amber"
      onClick={() => setActiveTool(tool)}
      title={label}
    >
      {label.slice(0, 3).toUpperCase()}
    </ToolBtn>
  );
}

export function EditorToolbar() {
  const confirm = useConfirm();
  const overlays = useOverlayEditorStore((s) => s.overlays);
  const activeOverlayId = useOverlayEditorStore((s) => s.activeOverlayId);
  const setActiveOverlay = useOverlayEditorStore((s) => s.setActiveOverlay);
  const addOverlay = useOverlayEditorStore((s) => s.addOverlay);
  const removeOverlay = useOverlayEditorStore((s) => s.removeOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const removeElements = useOverlayEditorStore((s) => s.removeElements);
  const duplicateElements = useOverlayEditorStore((s) => s.duplicateElements);
  const undo = useOverlayEditorStore((s) => s.undo);
  const redo = useOverlayEditorStore((s) => s.redo);
  const undoStack = useOverlayEditorStore((s) => s.undoStack);
  const redoStack = useOverlayEditorStore((s) => s.redoStack);
  const snapEnabled = useOverlayEditorStore((s) => s.snapEnabled);
  const setSnapEnabled = useOverlayEditorStore((s) => s.setSnapEnabled);
  const alignElements = useOverlayEditorStore((s) => s.alignElements);
  const bringForward = useOverlayEditorStore((s) => s.bringForward);

  const hasSelection = selectedIds.length > 0;

  const handleExportHtml = () => {
    const overlay = getActiveOverlay();
    if (!overlay) return;
    const url = `/overlay/${encodeURIComponent(overlay.name)}`;
    window.open(url, "_blank");
  };

  const handleDownloadPng = async () => {
    const overlay = getActiveOverlay();
    if (!overlay) return;
    const { exportOverlayPng } = await import("@/lib/web-assets/export-png");
    await exportOverlayPng(overlay);
  };

  return (
    <div className="flex items-center gap-1 px-3 py-2 sw-rule-bottom shrink-0 overflow-x-auto">
      {/* Overlay tabs */}
      <div className="flex items-center">
        {overlays.map((o) => {
          const isActive = o.id === activeOverlayId;
          return (
            <div key={o.id} className="flex">
              <button
                onClick={() => setActiveOverlay(o.id)}
                data-active={isActive ? "true" : "false"}
                data-role="amber"
                className="sw-cell"
                style={{ padding: "5px 10px", fontSize: 10, height: 28 }}
              >
                {o.name}
              </button>
              {overlays.length > 1 && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Supprimer "${o.name}" ?`,
                      message:
                        "L'overlay et tous ses éléments seront effacés. Cette action ne peut pas être annulée.",
                      dangerous: true,
                      confirmLabel: "Supprimer",
                    });
                    if (ok) removeOverlay(o.id);
                  }}
                  className="sw-cell"
                  style={{
                    padding: "5px 6px",
                    fontSize: 10,
                    height: 28,
                    color: "var(--pgm)",
                  }}
                  title="Remove overlay"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <ToolBtn
          onClick={() =>
            addOverlay({ name: `Overlay ${overlays.length + 1}` })
          }
          title="New overlay"
        >
          +
        </ToolBtn>
      </div>

      <Divider />

      {/* Tools */}
      <ToolButton tool="select" label="Select" />
      <ToolButton tool="hole" label="Hole" />
      <ToolButton tool="text" label="Text" />
      <ToolButton tool="image" label="Image" />

      <Divider />

      {/* Undo / Redo */}
      <ToolBtn
        onClick={undo}
        disabled={undoStack.length === 0}
        title="Undo (Ctrl+Z)"
      >
        ↶
      </ToolBtn>
      <ToolBtn
        onClick={redo}
        disabled={redoStack.length === 0}
        title="Redo (Ctrl+Y)"
      >
        ↷
      </ToolBtn>

      <Divider />

      {/* Alignment */}
      <ToolBtn
        onClick={() => alignElements("left")}
        disabled={!hasSelection}
        title="Align left"
      >
        ⊢
      </ToolBtn>
      <ToolBtn
        onClick={() => alignElements("center")}
        disabled={!hasSelection}
        title="Align center"
      >
        ⊣⊢
      </ToolBtn>
      <ToolBtn
        onClick={() => alignElements("right")}
        disabled={!hasSelection}
        title="Align right"
      >
        ⊣
      </ToolBtn>
      <ToolBtn
        onClick={() => alignElements("top")}
        disabled={!hasSelection}
        title="Align top"
      >
        ⊤
      </ToolBtn>
      <ToolBtn
        onClick={() => alignElements("middle")}
        disabled={!hasSelection}
        title="Align middle"
      >
        ⊥⊤
      </ToolBtn>
      <ToolBtn
        onClick={() => alignElements("bottom")}
        disabled={!hasSelection}
        title="Align bottom"
      >
        ⊥
      </ToolBtn>

      <Divider />

      {/* Z-order */}
      <ToolBtn
        onClick={() => bringForward(selectedIds)}
        disabled={!hasSelection}
        title="Bring forward (])"
      >
        ↑z
      </ToolBtn>

      <Divider />

      {/* Snap */}
      <ToolBtn
        onClick={() => setSnapEnabled(!snapEnabled)}
        active={snapEnabled}
        role="blue"
        title={`Snap ${snapEnabled ? "ON" : "OFF"}`}
      >
        ◊ Snap
      </ToolBtn>

      <div className="flex-1" />

      {/* Selection actions */}
      {hasSelection && (
        <>
          <ToolBtn
            onClick={() => duplicateElements(selectedIds)}
            title="Duplicate (Ctrl+D)"
          >
            ⊕ Dup
          </ToolBtn>
          <ToolBtn
            onClick={() => removeElements(selectedIds)}
            title="Delete (Del)"
            role="red"
            active
          >
            ⌫ Delete
          </ToolBtn>
          <Divider />
        </>
      )}

      <ToolBtn onClick={handleDownloadPng} title="Download PNG">
        ↓ PNG
      </ToolBtn>
      <ToolBtn onClick={handleExportHtml} title="Open HTML export">
        ↗ HTML
      </ToolBtn>
    </div>
  );
}
