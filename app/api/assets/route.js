// 3D asset library backed by R2 (assets/ prefix).
//   GET  /api/assets            → list {name, size, url}
//   POST /api/assets?name=x.glb → upload (raw body, x-editor-key required)
import { NextResponse } from "next/server";
import { isConfigured, listObjects, uploadBinary, checkEditorKey } from "@/lib/r2Server";
import { readBoundedBytes } from "@/lib/read-bounded-json";

export const runtime = "nodejs";
export const maxDuration = 60;

const PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || "";
const MAX_ASSET_BYTES = 30_000_000;
const NAME_RE = /^[a-zA-Z0-9._-]{1,80}\.(glb|gltf|png|jpg|jpeg|webp|bin)$/;

export async function GET() {
  // The city engine treats the optional asset library as empty when R2 is not
  // configured; return that same successful empty-list contract here.
  if (!isConfigured()) return NextResponse.json([]);
  let items;
  try { items = await listObjects("assets/"); }
  catch (error) {
    console.warn("[assets] list failed:", error?.message || error);
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    items.map((o) => ({
      name: o.key.slice("assets/".length),
      size: o.size,
      url: `/api/assets/${o.key.slice("assets/".length)}`, // same-origin (no bucket CORS needed)
      cdnUrl: PUBLIC_BASE ? `${PUBLIC_BASE}/${o.key}` : null,
    }))
  );
}

export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  if (!checkEditorKey(req)) return NextResponse.json({ error: "bad editor key" }, { status: 401 });
  const name = new URL(req.url).searchParams.get("name") || "";
  if (!NAME_RE.test(name)) return NextResponse.json({ error: "bad name (use .glb)" }, { status: 400 });
  let buf;
  try { buf = Buffer.from(await readBoundedBytes(req, MAX_ASSET_BYTES)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
  if (!buf.length) return NextResponse.json({ error: "empty upload" }, { status: 400 });
  const ct = name.endsWith(".png") ? "image/png"
    : /\.jpe?g$/.test(name) ? "image/jpeg"
    : name.endsWith(".webp") ? "image/webp"
    : name.endsWith(".bin") ? "application/octet-stream"
    : "model/gltf-binary";
  try { await uploadBinary(`assets/${name}`, buf, ct); }
  catch (error) { return NextResponse.json({ error: "bucket error" }, { status: 502 }); }
  return NextResponse.json({ ok: true, url: `/api/assets/${name}` });
}
