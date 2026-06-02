"use client";

import { useState, useEffect } from "react";
import { Sidebar, MobileSidebar, BurgerButton } from "@/components/layout/sidebar";
import { LogCapture } from "@/components/layout/log-capture";
import { VmixProvider } from "@/providers/vmix-provider";
import { FloatingPlayer } from "@/components/stream/floating-player";
import { ConfirmProvider } from "@/components/sw";

function useBreakpoint() {
  const [bp, setBp] = useState<"mobile" | "tablet" | "desktop">("desktop");
  useEffect(() => {
    function check() {
      const w = window.innerWidth;
      setBp(w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop");
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return bp;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [streamOpen, setStreamOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const bp = useBreakpoint();
  const isMobile = bp === "mobile";

  return (
    <VmixProvider>
    <ConfirmProvider>
      <LogCapture />
      {/* Skip-to-content target for keyboard users: they otherwise have
          to tab past 12 sidebar items before reaching the page body. */}
      <a
        href="#main-content"
        className="font-mono uppercase"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "8px 12px",
          background: "var(--amber)",
          color: "var(--bg)",
          fontSize: 11,
          letterSpacing: "1.4px",
          fontWeight: 700,
          zIndex: 1000,
          transform: "translateY(-200%)",
          transition: "transform 80ms",
        }}
        onFocus={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.transform = "translateY(-200%)";
        }}
      >
        Skip to content
      </a>
      <div className="flex h-full w-full overflow-hidden bg-sw-bg">
        {/* Desktop sidebar */}
        {!isMobile && (
          <Sidebar
            onToggleStream={() => setStreamOpen((v) => !v)}
            streamOpen={streamOpen}
          />
        )}

        {/* Mobile sidebar overlay */}
        {isMobile && (
          <MobileSidebar
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            onToggleStream={() => setStreamOpen((v) => !v)}
            streamOpen={streamOpen}
          />
        )}

        {/* Main content — each screen renders its own <TopBar> */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {isMobile && (
            <div className="flex items-center gap-2 px-3 py-2 border-b-[1.5px] border-sw-line-2 bg-sw-bg">
              <BurgerButton onClick={() => setMobileMenuOpen(true)} />
            </div>
          )}
          <main
            id="main-content"
            className="flex-1 overflow-y-auto overflow-x-hidden overscroll-none"
          >
            {children}
          </main>
        </div>
      </div>
      <FloatingPlayer
        open={streamOpen}
        onClose={() => setStreamOpen(false)}
      />
    </ConfirmProvider>
    </VmixProvider>
  );
}
