// Authorized writes; bounded, cancellation-aware read-through cache.
import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { isConfigured, downloadObjectRaw, uploadObject, checkEditorKey } from "@/lib/r2Server";
import { fetchOverpassCell } from "@/lib/overpassServer";
import { parseCityKey, validCityData, isCompleteCity, MAX_CITY_BYTES } from "@/lib/city-contract";
import { readBoundedJson } from "@/lib/read-bounded-json";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req, { params }) {
  const { key } = params;
  const coords = parseCityKey(key);
  if (!coords) return NextResponse.json({ error: "bad key" }, { status: 400 });
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh && !checkEditorKey(req)) return NextResponse.json({ error: "bad editor key" }, { status: 401 });
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(105000)]);
  try {
    if (isConfigured() && !refresh) {
      const stored = await downloadObjectRaw(`${key}.json`, { signal });
      // Objects we wrote ourselves were validated complete: stream the gzip bytes through untouched.
      if (stored?.trusted) return new Response(stored.bytes, {
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Cache-Control": "public, max-age=86400",
        },
      });
      if (stored) {
        let data;
        try {
          const bytes = stored.gzip ? gunzipSync(stored.bytes) : stored.bytes;
          data = JSON.parse(bytes.toString("utf8"));
        } catch { /* retry malformed legacy entry */ }
        if (isCompleteCity(data)) return NextResponse.json(data, {
          headers: { "Cache-Control": "public, max-age=86400" },
        });
      }
    }
    const data = await fetchOverpassCell(coords.lat, coords.lon, { signal });
    data.partial = !isCompleteCity(data);
    if (isConfigured() && !data.partial) {
      // Write-back is best effort: a storage failure must not discard a good Overpass result.
      try { await uploadObject(`${key}.json`, JSON.stringify(data), { signal, complete: true }); }
      catch (error) { console.warn(`[city] R2 write-back failed for ${key}:`, error?.message || error); }
    }
    return NextResponse.json(data, {
      headers: { "Cache-Control": data.partial ? "no-store" : "public, max-age=86400" },
    });
  } catch (error) {
    return NextResponse.json({ error: "City data unavailable; please retry shortly" }, {
      status: signal.aborted ? 504 : 502,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
}

export async function PUT(req, { params }) {
  // Authenticate before consuming bytes or consulting storage.
  if (!checkEditorKey(req)) return NextResponse.json({ error: "bad editor key" }, { status: 401 });
  if (!parseCityKey(params.key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  try {
    const data = await readBoundedJson(req, MAX_CITY_BYTES);
    if (!validCityData(data) || !isCompleteCity(data)) {
      return NextResponse.json({ error: "A complete city payload is required" }, { status: 400 });
    }
    await uploadObject(`${params.key}.json`, JSON.stringify(data), { signal: req.signal, complete: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : "bucket error" }, { status: error.status || 502 });
  }
}
