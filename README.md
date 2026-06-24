# 🌍 Walk the World

A Next.js app that opens on an interactive 3D **CesiumJS** globe. Spin the Earth,
click anywhere (or tap a city), and fly down into **Google Photorealistic 3D
Tiles** — real textured 3D meshes of cities you can walk through, Google Street
View style — then move around with the mouse and WASD.

## What is CesiumJS?

[CesiumJS](https://cesium.com/platform/cesiumjs/) is an open-source WebGL library
for 3D globes and maps. Unlike a textured sphere, it streams real geospatial data
— world terrain, satellite imagery, and **Google Photorealistic 3D Tiles**, which
are actual 3D building meshes captured from aerial/Street View imagery. That makes
the "walk around a real place" experience a genuine navigable 3D world rather than
flat photos. This app uses CesiumJS `1.142`.

## Runs with zero config

The app works immediately with **no tokens** — it falls back to Cesium's bundled
Natural Earth imagery, so you get a spinnable 3D globe out of the box. Add a token
to unlock high-res imagery, terrain, and the photorealistic 3D cities.

## Setup

```bash
npm install      # also copies Cesium's static assets into public/cesium
npm run dev      # http://localhost:3000
```

That's it for the basic globe.

### Unlock real 3D cities (recommended)

```bash
cp .env.local.example .env.local
```

Then add **either** token to `.env.local`:

- **`NEXT_PUBLIC_CESIUM_ION_TOKEN`** — free from <https://ion.cesium.com/tokens>.
  Enables world imagery, terrain, and Google Photorealistic 3D Tiles (Cesium ion
  proxies Google's tiles by default). If your host caps secret length at 255
  characters, split the token across **`NEXT_PUBLIC_CESIUM_ION_TOKEN_1`** and
  **`NEXT_PUBLIC_CESIUM_ION_TOKEN_2`** instead (the app concatenates them).
- **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** — a Google Maps Platform key with the
  *Map Tiles API* enabled (<https://developers.google.com/maps/documentation/tile/3d-tiles>).
  Streams Google's photorealistic tiles directly.

Restart `npm run dev` after editing the file.

## Run with Docker

The repo ships a production `Dockerfile` (multi-stage, Next.js standalone output)
and a `docker-compose.yml`. From the project folder:

```bash
docker compose up --build
```

Then open <http://localhost:3000>. To stop: `Ctrl+C`, or `docker compose down`.

Prefer plain Docker?

```bash
docker build -t walk-the-world .
docker run --rm -p 3000:3000 walk-the-world
```

### Tokens with Docker

`NEXT_PUBLIC_*` values are baked into the client bundle **at build time**, so
tokens must be supplied to the *build*, not just the run:

- **Compose:** create a `.env` file (copy `.env.local.example` to `.env`) with
  your token(s); Compose passes them in as build args automatically. Re-run
  `docker compose up --build`.
- **Plain Docker:**

  ```bash
  docker build \
    --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=YOUR_KEY \
    -t walk-the-world .
  docker run --rm -p 3000:3000 walk-the-world
  ```

The first build takes a few minutes (Cesium is a large bundle to compile);
later builds are cached and fast.

## Controls

- **Click** anywhere on the globe, or tap a **city button**, to fly down.
- **Drag** to look around · **scroll** to zoom.
- **WASD** (or arrow keys) to walk · **Q/Space** up · **E/Shift** down.
  Movement speed scales with altitude — slow and walkable near the ground.
- **🌐 Globe** button returns to the full-Earth view.

## How it works

- `components/Globe.js` — the whole app: creates the Cesium `Viewer`, sets a
  no-token Natural Earth base layer, optionally upgrades to ion imagery/terrain
  and adds `createGooglePhotorealistic3DTileset()`, handles click-to-fly,
  exposes camera controls, and runs the WASD walk loop on `scene.preRender`.
- `app/page.js` — UI overlay (title, city shortcuts, globe button, token hint)
  and the dynamic (client-only) import of the globe.
- `scripts/copy-cesium.mjs` — copies Cesium's `Workers/Assets/Widgets/ThirdParty`
  into `public/cesium`, served at `window.CESIUM_BASE_URL = "/cesium"`. Runs
  automatically before `dev` and `build`.
- `lib/geo.js` — the city shortcut coordinates.

## Notes

- **Tokens are public by design.** `NEXT_PUBLIC_` vars ship to the browser, which
  is how Cesium ion / Google client tokens are meant to be used. Restrict the
  token's allowed domains in the provider dashboard before deploying.
- **Photorealistic coverage** is excellent across major world cities and good in
  many smaller ones; remote areas fall back to terrain + imagery.
- The production build bundles Cesium (large), so `npm run build` takes a while.
  `npm run dev` starts fast because Cesium loads in the browser.

## Tech

Next.js 14 (App Router) · React 18 · CesiumJS 1.142 · Google Photorealistic 3D Tiles
