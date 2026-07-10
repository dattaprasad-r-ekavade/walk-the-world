// Same-origin GLB streaming (avoids bucket CORS for GLTFLoader).
//   GET /api/assets/<name> → binary from R2 assets/<name>
import { NextResponse } from "next/server";
import { isConfigured, downloadBinary } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;

const NAME_RE = /^[a-zA-Z0-9._-]{1,80}\.(glb|gltf|png|jpg|jpeg|webp|bin)$/;

export async function GET(_req, { params }) {
  if (!isConfigured()) return NextResponse.json({ error: "r2 not configured" }, { status: 501 });
  const name = params.name || "";
  if (!NAME_RE.test(name)) return NextResponse.json({ error: "bad name" }, { status: 400 });
  const buf = await downloadBinary(`assets/${name}`);
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(buf, {
    headers: {
      "content-type": name.endsWith(".gltf")
        ? "model/gltf+json"
        : /\.(png)$/.test(name)
          ? "image/png"
          : /\.(jpe?g)$/.test(name)
            ? "image/jpeg"
            : name.endsWith(".webp")
              ? "image/webp"
              : name.endsWith(".bin")
                ? "application/octet-stream"
                : "model/gltf-binary",
      "cache-control": "public, max-age=3600",
    },
  });
}
