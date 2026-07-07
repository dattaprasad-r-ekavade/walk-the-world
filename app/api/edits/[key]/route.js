// Per-cell world edits (placed assets, terrain patches, OSM tag overrides).
//   GET /api/edits/<cellkey>  → edits JSON or {} if none
//   PUT /api/edits/<cellkey>  → save (x-editor-key required)
import { NextResponse } from "next/server";
import { isConfigured, downloadObject, uploadObject, checkEditorKey } from "@/lib/r2Server";

export const runtime = "nodejs";

const KEY_RE = /^wtw_city\d+_-?\d+\.\d{3}_-?\d+\.\d{3}$/;

export async function GET(_req, { params }) {
  const { key } = params;
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({});
  const text = await downloadObject(`edits/${key}.json`).catch(() => null);
  return new NextResponse(text || "{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(req, { params }) {
  const { key } = params;
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  if (!checkEditorKey(req)) return NextResponse.json({ error: "bad editor key" }, { status: 401 });
  const body = await req.text();
  if (body.length > 1_000_000) return NextResponse.json({ error: "too large" }, { status: 400 });
  JSON.parse(body); // validate
  await uploadObject(`edits/${key}.json`, body);
  return NextResponse.json({ ok: true });
}
