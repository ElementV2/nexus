import { NextRequest, NextResponse } from "next/server";
import { generateOverlayHTML } from "@/lib/web-assets/html-generator";
import { OVERLAY_RELOAD_DELAY_MS } from "@/lib/vmix/constants";
import type { OverlayConfig } from "@/lib/web-assets/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  // Check if config is passed as query param (for export preview)
  const configParam = request.nextUrl.searchParams.get("config");

  if (configParam) {
    try {
      const config = JSON.parse(configParam) as OverlayConfig;
      const html = generateOverlayHTML(config);
      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache, no-store",
        },
      });
    } catch {
      // Fall through to default
    }
  }

  // Default: basic HTML template (for backward compat)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; }
    body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: transparent;
    }
    #overlay {
      width: 100%;
      height: 100%;
      position: relative;
    }
  </style>
</head>
<body>
  <div id="overlay">
    <p style="color: white; padding: 20px; font-family: sans-serif;">
      Web Asset: ${name}
    </p>
  </div>
  <script>
    // Auto-refresh for live updates
    setTimeout(() => location.reload(), ${OVERLAY_RELOAD_DELAY_MS});
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache, no-store",
    },
  });
}

// POST endpoint - receive full config and return rendered HTML
export async function POST(request: NextRequest, _: { params: Promise<{ name: string }> }) {
  try {
    const config = (await request.json()) as OverlayConfig;
    const html = generateOverlayHTML(config);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
}
