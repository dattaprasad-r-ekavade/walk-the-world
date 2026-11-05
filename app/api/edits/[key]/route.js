// Per-cell world edits (placed assets, terrain patches, OSM tag overrides).
//   GET /api/edits/<cellkey>  → edits JSON or {} if none
//   PUT /api/edits/<cellkey>  → save (x-editor-key required)
import { NextResponse } from "next/server";
import { isConfigured, downloadObject, uploadObject, checkEditorKey } from "@/lib/r2Server";
import { readBoundedJson } from "@/lib/read-bounded-json";

export const runtime = "nodejs";

const KEY_RE = /^wtw_city\d+_-?\d+\.\d{3}_-?\d+\.\d{3}$/;
const MAX_EDITS_BYTES = 1_000_000;

export async function GET(_req, context) {
  const { key } = await context.params;
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({});
  const text = await downloadObject(`edits/${key}.json`).catch(() => null);
  return new NextResponse(text || "{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(req, context) {
  const { key } = await context.params;
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  if (!checkEditorKey(req)) return NextResponse.json({ error: "bad editor key" }, { status: 401 });
  try {
    const edits = await readBoundedJson(req, MAX_EDITS_BYTES);
    if (!edits || typeof edits !== "object" || Array.isArray(edits)) {
      return NextResponse.json({ error: "edits must be a JSON object" }, { status: 400 });
    }
    await uploadObject(`edits/${key}.json`, JSON.stringify(edits), { signal: req.signal });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : "bucket error" }, { status: error.status || 502 });
  }
}
