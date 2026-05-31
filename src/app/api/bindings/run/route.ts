import { NextRequest, NextResponse } from "next/server";
import { runSteps } from "@/lib/core/catalog";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Fire an arbitrary list of steps. Used by the deck inspector's
 * Test button (and any future "run this binding now" affordance)
 * because the bound steps may carry user-edited option overrides
 * that the catalog version doesn't have.
 *
 * Body: `{ kind, steps: [{actionId, options?}], connectionId? }`.
 * Response mirrors `/api/presets/run`: `{ results: [{ok, ...}] }`.
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: {
    kind?: unknown;
    steps?: unknown;
    connectionId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.kind !== "string" || !body.kind) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json(
      { error: "steps must be a non-empty array" },
      { status: 400 }
    );
  }
  // Light validation — refuse obviously malformed entries but trust
  // the catalog/action runner to surface the rest. Per-step
  // `connectionId` / `kind` are carried through so the Test button
  // fires against the same instance the binding will at press time.
  const steps: Array<{
    actionId: string;
    options?: Record<string, unknown>;
    connectionId?: string;
    kind?: string;
  }> = [];
  for (const raw of body.steps) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as {
      actionId?: unknown;
      options?: unknown;
      connectionId?: unknown;
      kind?: unknown;
    };
    if (typeof r.actionId !== "string" || !r.actionId) continue;
    steps.push({
      actionId: r.actionId,
      options:
        r.options && typeof r.options === "object"
          ? (r.options as Record<string, unknown>)
          : undefined,
      connectionId:
        typeof r.connectionId === "string" ? r.connectionId : undefined,
      kind: typeof r.kind === "string" ? r.kind : undefined,
    });
  }
  if (steps.length === 0) {
    return NextResponse.json(
      { error: "no valid steps" },
      { status: 400 }
    );
  }
  const cid =
    typeof body.connectionId === "string" ? body.connectionId : undefined;
  // allowDefault=false — the Test button must behave EXACTLY like a real
  // deck press: pinned connection only, never the per-kind default.
  const result = await runSteps(steps, body.kind, cid, false);
  const anyFailed = result.results.some((r) => !r.ok);
  return NextResponse.json(result, { status: anyFailed ? 502 : 200 });
}
