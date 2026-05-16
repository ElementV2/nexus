import { NextRequest, NextResponse } from "next/server";
import { generateAssetPng } from "@/lib/web-assets/image-generator";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { searchParams } = request.nextUrl;

  // Accept config via query params or use defaults
  const bgColor = searchParams.get("bg") || "#083a8b";
  const holesParam = searchParams.get("holes");

  let holes: { id: string; x: number; y: number; width: number; height: number; borderColor: string; borderWidth: number }[] = [];

  if (holesParam) {
    try {
      holes = JSON.parse(decodeURIComponent(holesParam));
    } catch {
      // ignore parse errors
    }
  }

  try {
    const pngBuffer = await generateAssetPng({
      backgroundColor: bgColor,
      holes,
    });

    return new NextResponse(new Uint8Array(pngBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${name}.png"`,
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `PNG generation failed: ${message}` },
      { status: 500 }
    );
  }
}
