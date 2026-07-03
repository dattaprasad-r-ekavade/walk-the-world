// One-time Overture file-index build (reads only parquet footers, ~minutes).
// Run once locally: curl -X POST http://localhost:3000/api/overture-index
import { NextResponse } from "next/server";
import { buildManifest, getManifest } from "@/lib/overtureServer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const m = await getManifest();
  return NextResponse.json({ indexed: !!m, files: m?.length || 0 });
}

export async function POST() {
  try {
    const n = await buildManifest();
    return NextResponse.json({ ok: true, files: n });
  } catch (e) {
    console.error("[overture-index]", e?.message);
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
