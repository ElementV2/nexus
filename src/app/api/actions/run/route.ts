import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/core/catalog";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Execute one action. Body:
 *   `{ globalId: "vmix:cut", options: {...}, connectionId?: string }`
 *
 * `connectionId` is optional — when missing the catalog picks the
 * first enabled connection of the action's kind. Surfaces that bind
 * a button to a specific instance pass the id; ad-hoc browser
 * triggers (preset tile click) omit it.
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: {
    globalId?: unknown;
    options?: unknown;
    connectionId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.globalId !== "string" || !body.globalId) {
    return NextResponse.json({ error: "globalId required" }, { status: 400 });
  }
  const opts =
    body.options && typeof body.options === "object"
      ? (body.options as Record<string, unknown>)
      : {};
  const cid =
    typeof body.connectionId === "string" ? body.connectionId : undefined;
  const result = await runAction(body.globalId, opts, cid);
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
