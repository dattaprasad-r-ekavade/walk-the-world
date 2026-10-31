// One-time Overture file-index build (reads only parquet footers, ~minutes).
// POST is local-development-only and requires OVERTURE_INDEX_SECRET as a Bearer token.
// Use `npm run overture-index` for a release manifest or R2 upload.
import { NextResponse } from "next/server";
import { buildManifest, getManifest } from "@/lib/overtureServer";
import { overtureIndexAuthorization } from "@/lib/overtureIndexAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const m = await getManifest();
  return NextResponse.json({ indexed: !!m, files: m?.length || 0 });
}

export async function POST(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Use the local Overture index command." }, { status: 404 });
  }

  const authorization = overtureIndexAuthorization(request);
  if (authorization !== "authorized") {
    const disabled = authorization === "disabled";
    return NextResponse.json(
      { error: disabled ? "Overture indexing is disabled." : "Unauthorized." },
      {
        status: disabled ? 503 : 401,
        headers: disabled ? undefined : { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  try {
    const n = await buildManifest();
    return NextResponse.json({ ok: true, files: n });
  } catch (e) {
    console.error("[overture-index]", e?.message);
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
