"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useVmixStore } from "@/stores/vmix-store";
import { useConnections } from "@/hooks/use-connections";
import {
  Monitor,
  Volume2,
  Clapperboard,
  ListMusic,
  Type,
  Palette,
  Layers,
  Wifi,
  Tv,
  Menu,
  X,
  Music2,
  Video,
  Plug,
  Gamepad2,
  Sliders,
  Lightbulb,
  ScrollText,
  Film,
} from "lucide-react";

type Icon = typeof Monitor;
interface NavItem {
  href: string;
  label: string;
  icon: Icon;
}

/**
 * Hard-wired pages that exist regardless of which devices are
 * configured. Every device-specific page is contributed by its kind via
 * the registry, so adding or removing a connection toggles them
 * automatically. (The old dashboard "home" hub was removed — the deck is
 * the always-present landing.)
 */
const STATIC_NAV: NavItem[] = [
  { href: "/streamdeck", label: "Deck", icon: Gamepad2 },
  { href: "/timeline", label: "Show", icon: Film },
];

const TRAILING_NAV: NavItem[] = [
  { href: "/web-assets", label: "Assets", icon: Layers },
  { href: "/network",    label: "Network", icon: Wifi },
  { href: "/logs",       label: "Logs", icon: ScrollText },
];

/**
 * Icon registry for kind-contributed pages. The API response strips
 * the icon component (it can't cross JSON), so we map (kind, label)
 * tuples to lucide components here. Falls back to a per-kind default
 * icon, then to a generic plug for unknown kinds.
 *
 * Per-page entries take precedence — e.g. vMix contributes 6 pages
 * (live, audio, replay, ...) and each gets its own icon, while the
 * kind-level fallback covers OBS / Ableton's single pages.
 */
const KIND_ICONS: Record<string, Icon> = {
  obs: Video,
  vmix: Monitor,
  ableton: Music2,
  x32: Sliders,
  grandma3: Lightbulb,
  grandma2: Lightbulb,
};
const PAGE_ICONS: Record<string, Icon> = {
  "/live": Monitor,
  "/audio": Volume2,
  "/replay": Clapperboard,
  "/playlist": ListMusic,
  "/titles": Type,
  "/colorimetry": Palette,
  "/obs": Video,
  "/ableton": Music2,
  "/x32": Sliders,
  "/grandma3": Lightbulb,
  "/grandma2": Lightbulb,
};

interface SidebarProps {
  onToggleStream?: () => void;
  streamOpen?: boolean;
}

/* ── Brand block — square amber logo "vM" + LOCAL caption ────── */
function Brand() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 px-2 py-3"
      style={{
        minHeight: 60,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 30,
          height: 30,
          background: "var(--amber)",
          color: "var(--bg)",
        }}
      >
        <span
          className="font-mono font-bold"
          style={{ fontSize: 13, letterSpacing: "-0.02em" }}
        >
          vM
        </span>
      </div>
      <span
        className="font-mono font-semibold uppercase"
        style={{ fontSize: 8, letterSpacing: "0.18em", color: "var(--muted)" }}
      >
        Local
      </span>
    </div>
  );
}

function NavTile({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-1.5 transition-colors"
      style={{
        minHeight: 64,
        background: active ? "var(--panel-2)" : "transparent",
        color: active ? "var(--ink)" : "var(--mid)",
        borderBottom: "1px solid var(--line)",
        transitionDuration: "80ms",
      }}
    >
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--pvw)",
          }}
        />
      )}
      <Icon
        size={16}
        strokeWidth={1.5}
        color={active ? "var(--pvw)" : "currentColor"}
      />
      <span
        className="font-mono uppercase"
        style={{
          fontSize: 8,
          letterSpacing: "0.18em",
          fontWeight: 600,
        }}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar({ onToggleStream, streamOpen }: SidebarProps) {
  const pathname = usePathname();
  const connected = useVmixStore((s) => s.connected);
  const { data: connectionsData } = useConnections();

  // Compose the final nav: STATIC + dynamic kind pages + TRAILING.
  // A kind page only appears if at least one enabled connection of
  // that kind exists, so adding/removing a device toggles the page
  // automatically without touching this file.
  const nav: NavItem[] = useMemo(() => {
    const kinds = connectionsData?.kinds ?? [];
    const connections = connectionsData?.connections ?? [];
    const activeKinds = new Set(
      connections.filter((c) => c.enabled).map((c) => c.kind)
    );
    const dynamic: NavItem[] = [];
    const seenHrefs = new Set<string>();
    for (const k of kinds) {
      if (!activeKinds.has(k.kind)) continue;
      if (!k.pages) continue;
      for (const p of k.pages) {
        if (seenHrefs.has(p.href)) continue;
        seenHrefs.add(p.href);
        dynamic.push({
          href: p.href,
          label: p.label,
          // Page-level icon override > kind default > generic plug.
          icon: PAGE_ICONS[p.href] ?? KIND_ICONS[k.kind] ?? Plug,
        });
      }
    }
    return [...STATIC_NAV, ...dynamic, ...TRAILING_NAV];
  }, [connectionsData]);

  return (
    <nav
      className="flex h-full flex-col shrink-0"
      style={{
        width: 60,
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
      }}
    >
      <Brand />

      <div className="flex-1 overflow-y-auto">
        {nav.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return <NavTile key={item.href} item={item} active={isActive} />;
        })}

        {onToggleStream && (
          <button
            onClick={onToggleStream}
            className="relative flex flex-col items-center justify-center gap-1.5 w-full transition-colors"
            style={{
              minHeight: 64,
              background: streamOpen ? "var(--panel-2)" : "transparent",
              color: streamOpen ? "var(--ink)" : "var(--mid)",
              borderBottom: "1px solid var(--line)",
              transitionDuration: "80ms",
            }}
          >
            {streamOpen && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "var(--pvw)",
                }}
              />
            )}
            <Tv
              size={16}
              strokeWidth={1.5}
              color={streamOpen ? "var(--pvw)" : "currentColor"}
            />
            <span
              className="font-mono uppercase"
              style={{ fontSize: 8, letterSpacing: "0.18em", fontWeight: 600 }}
            >
              Stream
            </span>
          </button>
        )}
      </div>

      {/* Footer: avatar (the only round element of the app) */}
      <div
        className="flex items-center justify-center px-2 py-3"
        style={{
          minHeight: 50,
          borderTop: "1px solid var(--line)",
        }}
      >
        <div
          className="avatar-round flex items-center justify-center"
          style={{
            width: 30,
            height: 30,
            background: "var(--card)",
            border: "1px solid var(--line-hi)",
            color: connected ? "var(--pvw)" : "var(--muted)",
          }}
          title={connected ? "Connected" : "Offline"}
          role="status"
          aria-live="polite"
          aria-label={connected ? "vMix connected" : "vMix offline"}
        >
          <span
            className="font-mono font-bold"
            style={{ fontSize: 11, letterSpacing: "-0.02em" }}
            aria-hidden
          >
            N
          </span>
        </div>
      </div>
    </nav>
  );
}

/* ── Mobile sidebar overlay ────────────────────────────────────────── */

export function MobileSidebar({
  open,
  onClose,
  onToggleStream,
  streamOpen,
}: {
  open: boolean;
  onClose: () => void;
  onToggleStream?: () => void;
  streamOpen?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar
          onToggleStream={
            onToggleStream
              ? () => {
                  onToggleStream();
                  onClose();
                }
              : undefined
          }
          streamOpen={streamOpen}
        />
      </div>
    </>
  );
}

/* ── Burger button for mobile header ─────────────────────────────── */

export function BurgerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center h-9 w-9 md:hidden"
      style={{
        border: "1px solid var(--line-hi)",
        background: "var(--card)",
        color: "var(--mid)",
      }}
    >
      <Menu size={16} />
    </button>
  );
}

export { X as CloseIcon };
