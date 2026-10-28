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
  await page.goto(`http://127.0.0.1:${server.address().port}/${path.relative(root, htmlPath).replaceAll(path.sep, "/")}`);
  await page.waitForFunction(() => window.__assetAtlasData || window.__assetAtlasError);
  const data = await page.evaluate(() => window.__assetAtlasData || { error: window.__assetAtlasError });
  if (data.error) throw new Error(data.error);
  if (data.layout.widthPx !== 512 || data.layout.heightPx !== 1024) {
    throw new Error(`Unexpected facade atlas dimensions: ${data.layout.widthPx}x${data.layout.heightPx}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputs = [
    { key: "facade", name: "facade-basecolor-atlas.png", role: "procedural facade albedo with shallow wall/window/storefront detail", colorSpace: "sRGB" },
    { key: "emissive", name: "facade-emissive-atlas.png", role: "night window emissive mask aligned to the facade atlas grid", colorSpace: "sRGB" },
  ];
  const maps = {};
  for (const output of outputs) {
    const base64 = data[output.key].replace(/^data:image\/png;base64,/, "");
    const bytes = Buffer.from(base64, "base64");
    const file = path.join(outputDir, output.name);
    await writeFile(file, bytes);
    maps[output.key] = {
      file: path.relative(path.join(root, "assets"), file).replaceAll(path.sep, "/"),
      sha256: sha256(bytes),
      bytes: bytes.length,
      resolutionPx: [data.layout.widthPx, data.layout.heightPx],
      role: output.role,
      colorSpace: output.colorSpace,
    };
    console.log(`${path.relative(root, file)} sha256=${maps[output.key].sha256}`);
  }

  manifest.outputRevision = "stage3-pipeline-r2";
  manifest.status = "source snapshots, PBR atlases, aligned procedural facade/emissive atlases and normalised props built; runtime adoption and browser visual approval remain pending";
  manifest.facadeAtlases = {
    revision: "stage3-facade-r1",
    builder: { script: "scripts/build-facade-atlases.mjs", playwright: PLAYWRIGHT_VERSION, chrome: chromeVersion },
    layout: { ...data.layout, coordinateConvention: "pixel coordinates use top-left origin; UV bands use bottom-left origin" },
    alignment: "both images are exported by makeFacadeAtlas() and makeLitWindowAtlas() from the shared GRID in lib/engine/facade-uv.js",
    directionalLightingBaked: false,
    maps,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
