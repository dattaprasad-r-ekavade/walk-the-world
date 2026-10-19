// Authorized writes; bounded, cancellation-aware read-through cache.
import { NextResponse } from "next/server";
import { isConfigured, downloadObject, uploadObject, checkEditorKey } from "@/lib/r2Server";
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
      const text = await downloadObject(`${key}.json`, { signal });
      if (text) {
        let data;
        try { data = JSON.parse(text); } catch { /* retry malformed legacy entry */ }
        if (isCompleteCity(data)) return NextResponse.json(data, {
          headers: { "Cache-Control": "public, max-age=86400" },
        });
      }
    }
    const data = await fetchOverpassCell(coords.lat, coords.lon, { signal });
    data.partial = !isCompleteCity(data);
    if (isConfigured() && !data.partial) {
      await uploadObject(`${key}.json`, JSON.stringify(data), { signal });
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
    await uploadObject(`${params.key}.json`, JSON.stringify(data), { signal: req.signal });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : "bucket error" }, { status: error.status || 502 });
  }
}
