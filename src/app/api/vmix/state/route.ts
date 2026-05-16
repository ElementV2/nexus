import { NextRequest, NextResponse } from "next/server";
import { parseVmixXml } from "@/lib/vmix/xml-parser";
import { getPreferences } from "@/lib/db/preferences";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("raw");
  const { vmix_host: host, vmix_port: port } = getPreferences();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`http://${host}:${port}/api`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    const xml = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream ${res.status}: ${xml.slice(0, 200)}` },
        { status: 502 }
      );
    }

    if (raw) {
      return new NextResponse(xml, {
        headers: { "Content-Type": "text/xml" },
      });
    }

    const state = parseVmixXml(xml);
    return NextResponse.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to connect to vMix at ${host}:${port} — ${message}` },
      { status: 502 }
    );
  }
}
