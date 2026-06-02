"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { initClientLogCapture, clientLog } from "@/lib/client-log";

/**
 * Invisible mount that wires up the browser-side log capture as early as the
 * app shell renders, and drops a breadcrumb on every route change. The
 * route trail is the cheap, high-value context for a bug report: it shows
 * exactly what the operator did right before something went wrong, without
 * any network traffic. Renders nothing.
 */
export function LogCapture() {
  const pathname = usePathname();
  const started = useRef(false);

  // Install global capture once, before the first navigation log.
  if (typeof window !== "undefined") initClientLogCapture();

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      clientLog.info("client session started — logs are kept in this tab only (F5 clears)");
    }
    clientLog.info(`navigated to ${pathname}`);
  }, [pathname]);

  return null;
}
