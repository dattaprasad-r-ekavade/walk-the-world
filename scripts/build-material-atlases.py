#!/usr/bin/env python3
"""Build deterministic, mip-safe PBR atlases from the pinned source maps."""

from __future__ import annotations

import hashlib
import json
import platform
import sys
from pathlib import Path

from PIL import Image, __version__ as pillow_version


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "assets" / "manifest.json"
EXPECTED_PYTHON = (3, 11)
EXPECTED_PILLOW = "10.4.0"
CELL = 1024
GUTTER = 16
COLS = 3
ROWS = 2
ATLAS_SIZE = (COLS * CELL + (COLS + 1) * GUTTER, ROWS * CELL + (ROWS + 1) * GUTTER)
MAPS = {
    "color": {"suffix": "Color", "neutral": (128, 128, 128), "space": "sRGB", "name": "basecolor"},
    "normalGL": {"suffix": "NormalGL", "neutral": (128, 128, 255), "space": "linear", "name": "normal"},
    "roughness": {"suffix": "Roughness", "neutral": (255, 255, 255), "space": "linear", "name": "roughness"},
    "ambientOcclusion": {"suffix": "AmbientOcclusion", "neutral": (255, 255, 255), "space": "linear", "name": "ao"},
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def paste_dilated(atlas: Image.Image, tile: Image.Image, x: int, y: int, gutter: int) -> None:
    """Paste a tile and extend its edge texels into the surrounding gutter."""
    width, height = tile.size
    atlas.paste(tile, (x, y))
    atlas.paste(tile.crop((0, 0, 1, height)).resize((gutter, height)), (x - gutter, y))
    atlas.paste(tile.crop((width - 1, 0, width, height)).resize((gutter, height)), (x + width, y))
    atlas.paste(tile.crop((0, 0, width, 1)).resize((width, gutter)), (x, y - gutter))
    atlas.paste(tile.crop((0, height - 1, width, height)).resize((width, gutter)), (x, y + height))
    atlas.paste(tile.getpixel((0, 0)), (x - gutter, y - gutter, x, y))
    atlas.paste(tile.getpixel((width - 1, 0)), (x + width, y - gutter, x + width + gutter, y))
    atlas.paste(tile.getpixel((0, height - 1)), (x - gutter, y + height, x, y + height + gutter))
    atlas.paste(tile.getpixel((width - 1, height - 1)), (x + width, y + height, x + width + gutter, y + height + gutter))


def main() -> None:
    if sys.version_info[:2] != EXPECTED_PYTHON:
        raise SystemExit(f"Expected Python {EXPECTED_PYTHON[0]}.{EXPECTED_PYTHON[1]}, got {platform.python_version()}")
    if pillow_version != EXPECTED_PILLOW:
        raise SystemExit(f"Expected Pillow {EXPECTED_PILLOW}, got {pillow_version}")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    output_dir = ROOT / "assets" / "processed" / "materials"
    output_dir.mkdir(parents=True, exist_ok=True)
    surfaces = manifest["surfaces"]
    if len(surfaces) != 6:
        raise SystemExit(f"Expected six curated surfaces, got {len(surfaces)}")

    source_files = {}
    for surface in surfaces:
        surface_id = surface["id"].split(":", 1)[1]
        for map_key, spec in MAPS.items():
            map_info = surface["maps"].get(map_key)
            if map_info and map_info.get("selected"):
                source_path = ROOT / "assets" / "source" / "ambientcg" / surface_id / map_info["file"]
                if not source_path.is_file():
                    raise SystemExit(f"Missing selected source map: {source_path}")
                source_hash = sha256(source_path)
                if map_info.get("sourceSha256") and map_info["sourceSha256"] != source_hash:
                    raise SystemExit(f"Pinned source hash mismatch: {source_path}")
                source_files[(surface_id, map_key)] = source_path
                map_info["sourceFile"] = source_path.relative_to(ROOT / "assets").as_posix()
                map_info["sourceSha256"] = source_hash

    atlas_records = {}
    for map_key, spec in MAPS.items():
        atlas = Image.new("RGB", ATLAS_SIZE, spec["neutral"])
        rects = {}
        for index, surface in enumerate(surfaces):
            surface_id = surface["id"].split(":", 1)[1]
            col, row = index % COLS, index // COLS
            cell_x = GUTTER + col * (CELL + GUTTER)
            cell_y = GUTTER + row * (CELL + GUTTER)
            source_path = source_files.get((surface_id, map_key))
            is_default = source_path is None
            if source_path:
                with Image.open(source_path) as source:
                    tile = source.convert("RGB")
            elif map_key == "ambientOcclusion":
                color_info = surface["maps"]["color"]
                color_path = ROOT / "assets" / "source" / "ambientcg" / surface_id / color_info["file"]
                with Image.open(color_path) as source:
                    tile = Image.new("RGB", source.size, spec["neutral"])
            else:
                raise SystemExit(f"No source map for required type {map_key}: {surface_id}")

            if tile.width > CELL or tile.height > CELL:
                raise SystemExit(f"Source exceeds atlas cell: {surface_id} {map_key} {tile.size}")
            offset_x = (CELL - tile.width) // 2
            offset_y = (CELL - tile.height) // 2
            x = cell_x + offset_x
            y = cell_y + offset_y
            paste_dilated(atlas, tile, x, y, GUTTER)
            width, height = tile.size
            rects[surface_id] = {
                "pixelRectTopLeft": [x, y, width, height],
                "uvRectBottomLeft": [round(x / ATLAS_SIZE[0], 9), round(1 - (y + height) / ATLAS_SIZE[1], 9), round(width / ATLAS_SIZE[0], 9), round(height / ATLAS_SIZE[1], 9)],
                "sourceResolutionPx": [width, height],
                "neutralDefault": is_default,
            }

        output_path = output_dir / f"{spec['name']}-atlas.png"
        atlas.save(output_path, format="PNG", optimize=True, compress_level=9)
        atlas_records[map_key] = {
            "file": output_path.relative_to(ROOT / "assets").as_posix(),
            "sha256": sha256(output_path),
            "resolutionPx": list(ATLAS_SIZE),
            "colorSpace": spec["space"],
            "gutterPx": GUTTER,
            "grid": {"columns": COLS, "rows": ROWS, "cellPx": CELL, "order": [s["id"].split(":", 1)[1] for s in surfaces]},
            "rects": rects,
        }
        print(f"{output_path.relative_to(ROOT)} {ATLAS_SIZE[0]}x{ATLAS_SIZE[1]} sha256={atlas_records[map_key]['sha256']}")

    # Record every preserved source file, including the Kenney license, model files and palette.
    inventory = []
    for path in sorted((ROOT / "assets" / "source").rglob("*")):
        if path.is_file():
            inventory.append({"file": path.relative_to(ROOT / "assets").as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)})
    if manifest.get("sourceFiles") and manifest["sourceFiles"] != inventory:
        raise SystemExit("Pinned source inventory changed; inspect assets/source before rebuilding")

    manifest["outputRevision"] = "stage3-atlas-r1"
    manifest["status"] = "source snapshots and PBR atlases built; runtime adoption and facade/emissive integration remain pending"
    manifest["sourceFiles"] = inventory
    manifest["materialAtlases"] = {
        "revision": "stage3-atlas-r1",
        "builder": {"python": platform.python_version(), "pillow": pillow_version, "script": "scripts/build-material-atlases.py"},
        "layout": {"coordinateConvention": "pixel rectangles use top-left origin; UV rectangles use bottom-left origin", "cellPx": CELL, "gutterPx": GUTTER, "mipSafeLevelsApprox": 4, "directionalLightingBaked": False},
        "maps": atlas_records,
        "emissive": {"status": "not baked into the material atlases", "alignment": "existing procedural lit-window atlas shares the same GRID as the facade atlas in lib/engine/facade-uv.js"},
    }
    for surface in surfaces:
        sid = surface["id"].split(":", 1)[1]
        for key, record in atlas_records.items():
            surface["maps"].setdefault(key, {"selected": False, "role": "ambient occlusion", "colorSpace": "linear"})
            surface["maps"][key]["atlas"] = record["file"]
            surface["maps"][key]["atlasRect"] = record["rects"][sid]

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
