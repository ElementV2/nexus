"use client";

import type { ReactNode, RefObject } from "react";
import {
  Usb,
  Download,
  PanelRightClose,
  PanelRightOpen,
  Settings,
} from "lucide-react";

/**
 * The Stream Deck editor's top toolbar: page-wide actions (load to a
 * physical deck, import / export pages), the page label field, and the
 * preset-browser toggle. Purely presentational — all state and handlers
 * live in the page; this component just wires them to controls.
 */
export function EditorToolbar({
  leading,
  browserOpen,
  fileInputRef,
  onLoadToDeck,
  onImportClick,
  onExportCurrent,
  onExportAll,
  onPickImportFile,
  onOpenDevices,
  onToggleBrowser,
}: {
  /** Page selector (dropdown). Rendered first so switching pages lives in
   *  the toolbar instead of a space-hungry left rail. */
  leading?: ReactNode;
  browserOpen: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onLoadToDeck: () => void;
  onImportClick: () => void;
  onExportCurrent: () => void;
  onExportAll: () => void;
  onPickImportFile: (file: File) => void;
  onOpenDevices: () => void;
  onToggleBrowser: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-[24px] py-[12px] sw-hairline-bottom flex-wrap"
      style={{ background: "var(--panel)" }}
    >
      {leading && (
        <>
          {leading}
          <span style={{ width: 1, height: 18, background: "var(--line-hi)" }} />
        </>
      )}
      {/* Page-wide actions: load to a deck, and import / export. */}
      <button
        onClick={onLoadToDeck}
        title="Load a page onto a physical Stream Deck"
        className="flex items-center gap-1 font-mono uppercase"
        style={{
          padding: "5px 12px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: "var(--ink)",
          border: "1px solid var(--ink)",
          color: "var(--bg)",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        <Usb size={11} /> Load to deck
      </button>
      <button
        onClick={onImportClick}
        title="Import pages from a .json file"
        className="flex items-center gap-1 font-mono uppercase"
        style={{
          padding: "5px 8px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: "var(--panel-2)",
          border: "1px solid var(--line-hi)",
          color: "var(--mid)",
          cursor: "pointer",
        }}
      >
        <Download size={11} style={{ transform: "rotate(180deg)" }} /> Import
      </button>
      <button
        onClick={onExportCurrent}
        title="Export the current page to a .json file"
        className="flex items-center gap-1 font-mono uppercase"
        style={{
          padding: "5px 8px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: "var(--panel-2)",
          border: "1px solid var(--line-hi)",
          color: "var(--mid)",
          cursor: "pointer",
        }}
      >
        <Download size={11} /> Export
      </button>
      <button
        onClick={onExportAll}
        title="Export every page to a single .json file"
        className="flex items-center gap-1 font-mono uppercase"
        style={{
          padding: "5px 8px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: "var(--panel-2)",
          border: "1px solid var(--line-hi)",
          color: "var(--sub)",
          cursor: "pointer",
        }}
      >
        <Download size={11} /> All
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickImportFile(f);
          e.target.value = "";
        }}
      />

      <span style={{ width: 1, height: 18, background: "var(--line-hi)" }} />

      {/* Pages are switched/renamed via the toolbar page selector (the
          `leading` slot). The gear opens the Decks manager: name each deck +
          see which page is loaded where. */}
      <button
        onClick={onOpenDevices}
        title="Manage decks — name them, see what's loaded"
        className="flex items-center gap-1 font-mono uppercase"
        style={{
          padding: "5px 8px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: "var(--panel-2)",
          border: "1px solid var(--line-hi)",
          color: "var(--mid)",
          cursor: "pointer",
        }}
      >
        <Settings size={11} /> Decks
      </button>

      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {/* No "saved" chip — autosave is implicit; a failed save still
            surfaces via the TopBar sub-line. No "paired" picker either
            — pairing is driven entirely by "Load to deck" on the left
            you assign a page to a deck, done. */}
        <button
          onClick={onToggleBrowser}
          title={browserOpen ? "Hide preset browser" : "Show preset browser"}
          className="flex items-center justify-center"
          style={{
            padding: 6,
            background: "var(--panel-2)",
            border: "1px solid var(--line-hi)",
            color: "var(--mid)",
            cursor: "pointer",
          }}
        >
          {browserOpen ? (
            <PanelRightClose size={13} />
          ) : (
            <PanelRightOpen size={13} />
          )}
        </button>
      </div>
    </div>
  );
}
