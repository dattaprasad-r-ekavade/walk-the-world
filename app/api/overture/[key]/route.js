// Overture buildings for a cell — R2-cached, DuckDB-backed.
// GET /api/overture/wtw_ovt_<lat>_<lon>  (3-decimal coords, ~650 m radius)
import { NextResponse } from "next/server";
import { isConfigured, downloadObject, uploadObject } from "@/lib/r2Server";
import { queryBuildings } from "@/lib/overtureServer";

export const runtime = "nodejs";
export const maxDuration = 300; // per-cell query is seconds once indexed

const KEY_RE = /^wtw_ovt_-?\d+\.\d{3}_-?\d+\.\d{3}$/;

export async function GET(_req, { params }) {
  const { key } = params;
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  try {
    const hit = await downloadObject(`${key}.json`);
    if (hit) return new NextResponse(hit, { status: 200, headers: { "Content-Type": "application/json" } });
    const [, latS, lonS] = key.match(/^wtw_ovt_(-?\d+\.\d{3})_(-?\d+\.\d{3})$/);
    const lat = parseFloat(latS), lon = parseFloat(lonS);
    const dLat = 0.006, dLon = 0.006 / Math.cos((lat * Math.PI) / 180);
    const res = await queryBuildings(lat - dLat, lat + dLat, lon - dLon, lon + dLon);
    if (res.status === "no-index") {
      return NextResponse.json(
        { error: "index not built — POST /api/overture-index once" },
        { status: 503 }
      );
    }
    const body = JSON.stringify(res.buildings);
    await uploadObject(`${key}.json`, body);
    return new NextResponse(body, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[overture]", e?.message);
    return NextResponse.json({ error: "query failed" }, { status: 502 });
  }
}
