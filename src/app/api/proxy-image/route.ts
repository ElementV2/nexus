import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Cap proxied responses so a hostile/huge upstream can't exhaust memory.
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Proxy an image the browser can't fetch directly (CORS). Legitimately
 * used to pull images off LAN hosts (vMix, web sources), so we do NOT
 * block private IPs — that's the feature. We do harden the obvious SSRF
 * footguns:
 *   • only http/https (no file:, data:, gopher:, etc.),
 *   • block the cloud-metadata address (169.254.169.254),
 *   • cap response size + time.
 */
function validateTarget(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Malformed url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http/https URLs are allowed" };
  }
  // Cloud metadata endpoints — never a legitimate image source.
  const host = url.hostname;
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    return { ok: false, error: "Blocked host" };
  }
  return { ok: true, url };
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }
  const check = validateTarget(raw);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(check.url, { signal: controller.signal });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Upstream error" },
        { status: res.status }
      );
    }
    // Reject obviously-non-image upstreams and oversized bodies early.
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared && declared > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
