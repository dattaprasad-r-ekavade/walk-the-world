import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = "1.52.0";
const installedPlaywrightVersion = require("playwright/package.json").version;
if (installedPlaywrightVersion !== PLAYWRIGHT_VERSION) {
  throw new Error(`Expected Playwright ${PLAYWRIGHT_VERSION}, got ${installedPlaywrightVersion}`);
}
const manifestPath = path.join(root, "assets", "manifest.json");
const htmlPath = path.join(root, "scripts", "facade-atlas-export.html");
const outputDir = path.join(root, "assets", "processed", "facades");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405).end("Method not allowed");
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes[path.extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

let browser;
try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const surfaceOrder = manifest.materialAtlases.maps.color.grid.order;
  const materialInputMaps = ["color", "normalGL", "roughness", "ambientOcclusion"];
  const browserInputs = {
    materials: surfaceOrder.map((id) => {
      const surface = manifest.surfaces.find((item) => item.id === `ambientCG:${id}`);
      if (!surface) throw new Error(`Missing surface metadata for ${id}`);
      return {
        id,
        tileMeters: surface.tileMeters,
        maps: Object.fromEntries(materialInputMaps.map((kind) => {
          const atlas = manifest.materialAtlases.maps[kind];
          const rect = atlas.rects[id]?.pixelRectTopLeft;
          if (!rect) throw new Error(`Missing ${kind} atlas rect for ${id}`);
          return [kind, { url: `/assets/${atlas.file}`, rect }];
        })),
      };
    }),
  };

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const chromeVersion = browser.version();
  const pinnedChromeVersion = manifest.facadeAtlases?.builder?.chrome;
  if (pinnedChromeVersion && pinnedChromeVersion !== chromeVersion) {
    throw new Error(`Expected Chrome ${pinnedChromeVersion}, got ${chromeVersion}; update the recorded tool pin intentionally before rebuilding`);
  }
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") process.stderr.write(`Chrome console error: ${message.text()}\n`);
  });
  page.on("pageerror", (error) => process.stderr.write(`Chrome page error: ${error.stack || error}\n`));
  await page.addInitScript((inputs) => { window.__assetAtlasInputs = inputs; }, browserInputs);
  await page.goto(`http://127.0.0.1:${server.address().port}/${path.relative(root, htmlPath).replaceAll(path.sep, "/")}`);
  await page.waitForFunction(() => window.__assetAtlasData || window.__assetAtlasError);
  const data = await page.evaluate(() => window.__assetAtlasData || { error: window.__assetAtlasError });
  if (data.error) throw new Error(data.error);
  if (data.layout.widthPx !== 512 || data.layout.heightPx !== 1024) {
    throw new Error(`Unexpected facade cell dimensions: ${data.layout.widthPx}x${data.layout.heightPx}`);
  }
  if (data.packedResolutionPx?.[0] !== 1600 || data.packedResolutionPx?.[1] !== 2096) {
    throw new Error(`Unexpected packed facade atlas dimensions: ${data.packedResolutionPx}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputs = [
    { key: "templateFacade", collection: "maps", name: "facade-basecolor-atlas.png", role: "procedural facade albedo with shallow wall/window/storefront detail", colorSpace: "sRGB", resolution: [data.layout.widthPx, data.layout.heightPx] },
    { key: "templateEmissive", collection: "maps", name: "facade-emissive-atlas.png", role: "night window emissive mask aligned to the facade atlas grid", colorSpace: "sRGB", resolution: [data.layout.widthPx, data.layout.heightPx] },
    { key: "basecolor", collection: "packedMaps", name: "facade-pbr-basecolor-atlas.png", role: "source material albedo with shallow facade detail", colorSpace: "sRGB", resolution: data.packedResolutionPx },
    { key: "normal", collection: "packedMaps", name: "facade-pbr-normal-atlas.png", role: "source tangent normal on walls with neutral window normals", colorSpace: "linear", resolution: data.packedResolutionPx },
    { key: "roughness", collection: "packedMaps", name: "facade-pbr-roughness-atlas.png", role: "source roughness with lower-roughness facade glass detail", colorSpace: "linear", resolution: data.packedResolutionPx },
    { key: "ao", collection: "packedMaps", name: "facade-pbr-ao-atlas.png", role: "source ambient occlusion with neutral panes and shallow reveal occlusion", colorSpace: "linear", resolution: data.packedResolutionPx },
    { key: "emissive", collection: "packedMaps", name: "facade-pbr-emissive-atlas.png", role: "emissive window mask packed into the matching material cells", colorSpace: "sRGB", resolution: data.packedResolutionPx },
  ];
  const maps = {};
  const packedMaps = {};
  for (const output of outputs) {
    const dataUri = output.collection === "packedMaps" ? data.packed[output.key] : data[output.key];
    const base64 = dataUri.replace(/^data:image\/png;base64,/, "");
    const bytes = Buffer.from(base64, "base64");
    const file = path.join(outputDir, output.name);
    await writeFile(file, bytes);
    const record = {
      file: path.relative(path.join(root, "assets"), file).replaceAll(path.sep, "/"),
      sha256: sha256(bytes),
      bytes: bytes.length,
      resolutionPx: output.resolution,
      role: output.role,
      colorSpace: output.colorSpace,
    };
    if (output.collection === "packedMaps") packedMaps[output.key] = record;
    else maps[output.key === "templateFacade" ? "facade" : "emissive"] = record;
    console.log(`${path.relative(root, file)} sha256=${record.sha256}`);
  }

  manifest.outputRevision = "stage3-pipeline-r3";
  manifest.status = "source snapshots, PBR atlases, composited facade PBR atlases, aligned emissive atlases and normalised props built; runtime adoption and browser visual approval remain pending";
  manifest.facadeAtlases = {
    revision: "stage3-facade-r2",
    builder: { script: "scripts/build-facade-atlases.mjs", playwright: PLAYWRIGHT_VERSION, chrome: chromeVersion },
    layout: { ...data.layout, coordinateConvention: "pixel coordinates use top-left origin; UV bands use bottom-left origin" },
    alignment: "basecolor, normal, roughness, AO and emissive cells are generated against the shared GRID in lib/engine/facade-uv.js",
    directionalLightingBaked: false,
    maps,
    packed: {
      revision: "stage3-facade-pbr-r1",
      resolutionPx: data.packedResolutionPx,
      cellPx: [data.layout.widthPx, data.layout.heightPx],
      gutterPx: data.packedGutterPx,
      mipSafeLevelsApprox: 4,
      grid: { columns: 3, rows: 2, order: surfaceOrder },
      coordinateConvention: "pixel rectangles use top-left origin; UV rectangles use bottom-left origin",
      alignment: "all five maps share identical material cell rectangles; each emissive mask repeats the corresponding facade cell window pattern",
      materialRects: data.materialRects,
      maps: packedMaps,
    },
  };
  for (const surface of manifest.surfaces) {
    surface.facadeAtlasRect = data.materialRects[surface.id.split(":")[1]];
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
