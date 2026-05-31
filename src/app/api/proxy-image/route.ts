import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";

export const dynamic = "force-dynamic";

// Cap proxied responses so a hostile/huge upstream can't exhaust memory.
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB
const FETCH_TIMEOUT_MS = 8_000;

/** Cloud-metadata addresses — never a legitimate image source. Checked
 *  against the RESOLVED IP (not just the literal hostname) so a domain
 *  pointing at one can't slip past via DNS. */
function isMetadataAddress(ip: string): boolean {
  return (
    ip === "169.254.169.254" ||
    ip === "fd00:ec2::254" ||
    ip.toLowerCase().startsWith("fd00:ec2:")
  );
}

/**
 * Resolve the host and reject if it points at a cloud-metadata address.
 * Private/LAN IPs stay allowed — proxying LAN images is the feature.
 * Note: this is a pre-flight check; a determined rebinding attack could
 * still flip DNS between this lookup and fetch's own resolution, but it
 * raises the bar against the trivial "domain → metadata IP" case.
 */
async function resolvesToBlocked(hostname: string): Promise<boolean> {
  // A literal metadata IP as the hostname is caught directly.
  if (isMetadataAddress(hostname)) return true;
  try {
    const records = await lookup(hostname, { all: true });
    return records.some((r) => isMetadataAddress(r.address));
  } catch {
    // DNS failure → let fetch surface the error normally.
    return false;
  }
}

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
  if (await resolvesToBlocked(check.url.hostname)) {
    return NextResponse.json({ error: "Blocked host" }, { status: 400 });
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
    // Reject oversized bodies early when the upstream is honest about size.
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared && declared > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }
    const contentType = res.headers.get("content-type") || "image/png";

    // Stream the body with a running cap instead of buffering it whole:
    // an upstream that omits/lies about content-length (chunked) could
    // otherwise push gigabytes into memory before the post-hoc size check.
    const reader = res.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: "Empty response" }, { status: 502 });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        controller.abort();
        return NextResponse.json({ error: "Image too large" }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    return new NextResponse(body, {
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
