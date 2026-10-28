#!/usr/bin/env python3
"""Decode-quality contact sheets and pixel metrics for the Stage 3.4 KTX2 pilot."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat, __version__ as pillow_version


EXPECTED_PILLOW = "10.4.0"
DETAIL_CELL = (16, 16, 528, 1040)
SHEET_COLUMNS = ("Original PNG", "ETC1S decode", "UASTC decode")
PANEL_W = 520
PANEL_H = 395
ROW_H = 424
HEADER_H = 82


def psnr(source: Image.Image, decoded: Image.Image, channels: int) -> dict:
    a = source.convert("RGBA")
    b = decoded.convert("RGBA")
    values: dict[str, float] = {}
    for index, label in enumerate(("R", "G", "B", "A")):
        if index >= channels:
            continue
        diff = ImageChops.difference(a.getchannel(index), b.getchannel(index))
        rms = ImageStat.Stat(diff).rms[0]
        values[label] = round(20.0 * math.log10(255.0 / rms), 4) if rms else None
    rgb = [values[label] for label in ("R", "G", "B") if values[label] is not None]
    return {
        "channelsDb": values,
        "meanRgbDb": round(sum(rgb) / len(rgb), 4) if rgb else None,
    }


def binary_iou(first: Image.Image, second: Image.Image) -> float:
    a = first.convert("1")
    b = second.convert("1")
    intersection = ImageChops.logical_and(a, b).histogram()[255]
    union = ImageChops.logical_or(a, b).histogram()[255]
    return round(intersection / union, 6) if union else 1.0


def alpha_mask(image: Image.Image) -> Image.Image:
    return image.convert("RGBA").getchannel("A").point(lambda value: 255 if value >= 128 else 0)


def lit_window_mask(image: Image.Image) -> Image.Image:
    red, green, blue = image.convert("RGB").split()
    maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    return maximum.point(lambda value: 255 if value >= 200 else 0)


def image_for(entry: dict, variant: str) -> Image.Image:
    path = Path(entry["source"] if variant == "source" else entry["decoded"][variant])
    with Image.open(path) as source:
        return source.convert("RGBA")


def contain(image: Image.Image, max_size: tuple[int, int]) -> Image.Image:
    copy = image.copy()
    copy.thumbnail(max_size, Image.Resampling.LANCZOS)
    return copy


def contact_sheet(entries: list[dict], output_path: Path) -> None:
    sheet = Image.new("RGB", (PANEL_W * len(SHEET_COLUMNS), HEADER_H + ROW_H * len(entries)), "#10151c")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((20, 15), "KTX2 decoded comparison · base level only", fill="#f1f5f9", font=font)
    for column, title in enumerate(SHEET_COLUMNS):
        x = column * PANEL_W + 12
        draw.text((x, 50), title, fill="#9fb5cb", font=font)

    variants = ("source", "etc1s", "uastc")
    for row, entry in enumerate(entries):
        y = HEADER_H + row * ROW_H
        draw.rectangle((0, y, sheet.width, y + 24), fill="#202a36")
        draw.text((12, y + 5), entry["label"], fill="#f1f5f9", font=font)
        for column, variant in enumerate(variants):
            image = image_for(entry, variant)
            preview = contain(image, (PANEL_W - 24, PANEL_H - 12))
            x = column * PANEL_W + (PANEL_W - preview.width) // 2
            image_y = y + 28 + (PANEL_H - preview.height) // 2
            sheet.paste(preview.convert("RGB"), (x, image_y))
            draw.rectangle((column * PANEL_W, y, (column + 1) * PANEL_W - 1, y + ROW_H - 1), outline="#2e3d4c")
    sheet.save(output_path, format="PNG", optimize=True)


def facade_detail_sheet(entries: list[dict], output_path: Path) -> None:
    selected = [entry for entry in entries if entry["id"] in ("facade-basecolor", "facade-emissive")]
    width = 3 * 512
    row_height = 1024 + 50
    sheet = Image.new("RGB", (width, 82 + len(selected) * row_height), "#10151c")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((16, 15), "First facade cell · windows, storefront detail and emissive mask", fill="#f1f5f9", font=font)
    for column, title in enumerate(SHEET_COLUMNS):
        draw.text((column * 512 + 12, 53), title, fill="#9fb5cb", font=font)
    variants = ("source", "etc1s", "uastc")
    for row, entry in enumerate(selected):
        y = 82 + row * row_height
        draw.rectangle((0, y, width, y + 25), fill="#202a36")
        draw.text((12, y + 6), entry["label"], fill="#f1f5f9", font=font)
        for column, variant in enumerate(variants):
            image = image_for(entry, variant).crop(DETAIL_CELL)
            sheet.paste(image.convert("RGB"), (column * 512, y + 26))
            draw.rectangle((column * 512, y, (column + 1) * 512 - 1, y + row_height - 1), outline="#2e3d4c")
    sheet.save(output_path, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs-json", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--metrics-json", required=True, type=Path)
    args = parser.parse_args()
    if pillow_version != EXPECTED_PILLOW:
        raise SystemExit(f"Expected Pillow {EXPECTED_PILLOW}, got {pillow_version}")

    entries = json.loads(args.inputs_json.read_text(encoding="utf-8"))
    metrics: dict[str, dict] = {}
    for entry in entries:
        source = image_for(entry, "source")
        metrics[entry["id"]] = {"decodedRgba8": {}}
        for variant in ("etc1s", "uastc"):
            decoded = image_for(entry, variant)
            if source.size != decoded.size:
                raise SystemExit(f"Decoded dimensions changed for {entry['id']} {variant}: {decoded.size} != {source.size}")
            item = psnr(source, decoded, entry["channels"])
            if entry["id"] == "facade-basecolor":
                item["alphaMaskIoUAt128"] = binary_iou(alpha_mask(source), alpha_mask(decoded))
            if entry["id"] == "facade-emissive":
                item["brightWindowMaskIoUAtRgbMax200"] = binary_iou(lit_window_mask(source), lit_window_mask(decoded))
            metrics[entry["id"]]["decodedRgba8"][variant] = item

    args.output_dir.mkdir(parents=True, exist_ok=True)
    contact_sheet(entries, args.output_dir / "quality-review.png")
    facade_detail_sheet(entries, args.output_dir / "quality-review-facade-detail.png")
    args.metrics_json.write_text(json.dumps(metrics, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Pillow {pillow_version}: wrote decoded comparison sheets and channel/mask metrics.")


if __name__ == "__main__":
    main()
