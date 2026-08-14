// Write-through city-data cache backed by Cloudflare R2 (S3-compatible).
//   GET  /api/city/<key>  → R2 hit, or live Overpass fetch + R2 upload on miss
//   PUT  /api/city/<key>  → upload rendered city JSON to the bucket
import { NextResponse } from "next/server";
import { isConfigured, downloadObject, uploadObject, checkEditorKey } from "@/lib/r2Server";
import { fetchOverpassCell, parseCityKey, looksPartial } from "@/lib/overpassServer";

export const runtime = "nodejs";
export const maxDuration = 120;

const KEY_RE = /^wtw_city\d+_-?\d+\.\d{3}_-?\d+\.\d{3}$/;

export async function GET(req, { params }) {
  const { key } = params;
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: "bad key" }, { status: 400 });
  }
  // ?refresh=1 (editor key required) bypasses the R2 read so a cell cached
  // before the partial-result guard existed can be re-fetched. R2 is
  // authoritative, so without this a poisoned cell is permanent.
  const refresh = new URL(req.url).searchParams.get("refresh") === "1" && checkEditorKey(req);

  try {
    if (isConfigured() && !refresh) {
      const text = await downloadObject(`${key}.json`);
      if (text !== null) {
        // Cells cached before the guard can still be building-less. Detect on
        // read and fall through to a live re-fetch instead of serving a city
        // with no buildings in it forever.
        let stale = false;
        try {
          stale = looksPartial(JSON.parse(text).elements).partial;
        } catch { /* unparseable — let the normal path re-fetch */ stale = true; }
        if (!stale) {
          return new NextResponse(text, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
        console.warn(`[city] ${key} cached with 0 buildings — re-fetching`);
      }
    }

    const coords = parseCityKey(key);
    if (!coords) {
      return NextResponse.json({ error: "bad key" }, { status: 400 });
    }

    const data = await fetchOverpassCell(coords.lat, coords.lon);
    const partial = !!data.partial;
    delete data.partial; // internal flag, not part of the cell payload
    const body = JSON.stringify(data);
    // Await upload so seed/cold-miss responses only succeed after R2 has the cell.
    // Never persist a partial: the player gets it for this session, and the
    // next request retries instead of inheriting a permanently broken cell.
    if (isConfigured() && !partial) {
      try {
        await uploadObject(`${key}.json`, body);
      } catch (e) {
        console.warn("[r2] city upload failed:", e?.message);
      }
    } else if (partial) {
      console.warn(`[city] ${key} partial (0 buildings) — serving but NOT caching`);
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
