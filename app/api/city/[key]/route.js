// Write-through city-data cache backed by Cloudflare R2 (S3-compatible).
//   GET  /api/city/<key>  → R2 hit, or live Overpass fetch + R2 upload on miss
//   PUT  /api/city/<key>  → upload rendered city JSON to the bucket
import { NextResponse } from "next/server";
import { isConfigured, downloadObject, uploadObject } from "@/lib/r2Server";
import { fetchOverpassCell, parseCityKey } from "@/lib/overpassServer";

export const runtime = "nodejs";
export const maxDuration = 120;

const KEY_RE = /^wtw_city\d+_-?\d+\.\d{3}_-?\d+\.\d{3}$/;

export async function GET(_req, { params }) {
  const { key } = params;
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: "bad key" }, { status: 400 });
  }

  try {
    if (isConfigured()) {
      const text = await downloadObject(`${key}.json`);
      if (text !== null) {
        return new NextResponse(text, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    const coords = parseCityKey(key);
    if (!coords) {
      return NextResponse.json({ error: "bad key" }, { status: 400 });
    }

    const data = await fetchOverpassCell(coords.lat, coords.lon);
    const body = JSON.stringify(data);
    // Await upload so seed/cold-miss responses only succeed after R2 has the cell.
    if (isConfigured()) {
      try {
        await uploadObject(`${key}.json`, body);
      } catch (e) {
        console.warn("[r2] city upload failed:", e?.message);
      }
    }
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[city]", e?.message);
    return NextResponse.json({ error: "overpass failed" }, { status: 502 });
  }
}

export async function PUT(req, { params }) {
  const { key } = params;
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: "bad key" }, { status: 400 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  }
  try {
    const body = await req.text();
    if (!body || body.length > 8_000_000) {
      return NextResponse.json({ error: "bad body" }, { status: 400 });
    }
    JSON.parse(body);
    await uploadObject(`${key}.json`, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[r2] upload failed:", e?.message);
    return NextResponse.json({ error: "bucket error" }, { status: 502 });
  }
}
