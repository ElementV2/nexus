"use client";

import { useVmixStore } from "@/stores/vmix-store";
import { useXmlStore } from "@/stores/xml-store";
import { useState, useMemo } from "react";
import { XMLParser } from "fast-xml-parser";
import {
  TopBar,
  Tabs,
  Cell,
  ButtonGroup,
  ToolbarSlot,
} from "@/components/sw";
import { copyToClipboard } from "@/lib/utils/clipboard";

// Module-scope parser — constructing it lazily inside `useMemo` meant
// allocating a fresh instance every ~150 ms while the JSON view was
// open AND the page was watching the live (not paused) XML. The parser
// is stateless across `parse()` calls, so one instance is fine.
const rawParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (tagName) =>
    ["input", "overlay", "item"].includes(tagName.toLowerCase()),
});

export default function DebugXmlPage() {
  const rawXml = useXmlStore((s) => s.rawXml);
  const connected = useVmixStore((s) => s.connected);
  const debugPaused = useXmlStore((s) => s.debugPaused);
  const debugSnapshotXml = useXmlStore((s) => s.debugSnapshotXml);
  const toggleDebugPause = useXmlStore((s) => s.toggleDebugPause);
  const vmixState = useVmixStore((s) => s.vmixState);
  const pollingInterval = useVmixStore((s) => s.pollingInterval);

  const [view, setView] = useState<"xml" | "json">("xml");
  const [copied, setCopied] = useState(false);

  const activeXml = debugPaused ? debugSnapshotXml : rawXml;

  // Only re-parse + re-stringify when the JSON view is actually open.
  // Without this guard, every poll tick (~150 ms) we'd burn a full
  // parse + JSON.stringify of a 100 KB payload on the main thread,
  // stalling input on weaker boxes even when the user isn't looking.
  const rawJson = useMemo(() => {
    if (view !== "json") return "";
    if (!activeXml) return "";
    try {
      const parsed = rawParser.parse(activeXml);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return "Parse error";
    }
  }, [activeXml, view]);

  const content = view === "xml" ? activeXml : rawJson;
  const size = (content || "").length;

  const handleCopy = async () => {
    const ok = await copyToClipboard(content || "");
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar
        status={connected ? "live" : "offline"}
        num="10"
        label="Raw inspector"
        title={
          <>
            {(size / 1024).toFixed(1)}{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>kb</span>
          </>
        }
        sub={
          debugPaused ? "snapshot · paused" : `live · ${pollingInterval}ms`
        }
        right={
          <>
            <ToolbarSlot label="Mode">
              <ButtonGroup>
                <Cell
                  active={!debugPaused}
                  role="green"
                  onClick={() => debugPaused && toggleDebugPause(vmixState)}
                >
                  Live
                </Cell>
                <Cell
                  active={debugPaused}
                  role="amber"
                  onClick={() => !debugPaused && toggleDebugPause(vmixState)}
                >
                  Paused
                </Cell>
              </ButtonGroup>
            </ToolbarSlot>
            <ToolbarSlot label="Format">
              <Tabs
                options={[
                  { value: "xml", label: "XML" },
                  { value: "json", label: "JSON" },
                ]}
                value={view}
                onChange={(v) => setView(v)}
              />
            </ToolbarSlot>
            <ToolbarSlot label="Action">
              <button
                onClick={handleCopy}
                className="font-mono uppercase transition-colors"
                style={{
                  padding: "6px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "1.4px",
                  background: copied ? "var(--pvw-tint)" : "var(--card)",
                  color: copied ? "var(--pvw)" : "var(--mid)",
                  border: `1px solid ${copied ? "var(--pvw)" : "var(--line)"}`,
                  transitionDuration: "80ms",
                }}
              >
                {copied ? "✓ Copied" : "⎘ Copy"}
              </button>
            </ToolbarSlot>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {!connected ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[13px] text-sw-muted">
              Connect to vMix to view debug data
            </p>
          </div>
        ) : (
          <pre
            className="font-mono text-[11px] leading-relaxed text-sw-text-dim px-[24px] py-[18px] whitespace-pre-wrap break-all"
            style={{ tabSize: 2 }}
          >
            {content || "Waiting for data…"}
          </pre>
        )}
      </div>
    </div>
  );
}
