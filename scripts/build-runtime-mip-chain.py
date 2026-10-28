#!/usr/bin/env python3
"""Generate repeat-S, clamp-T mip images for runtime facade atlases."""

import json
import sys
from pathlib import Path

from PIL import Image, __version__ as PILLOW_VERSION


EXPECTED_PILLOW_VERSION = "10.4.0"


def next_mip(image: Image.Image, wrap_s: str) -> Image.Image:
    width, height = image.size
    mip_width = max(1, width // 2)
    mip_height = max(1, height // 2)

    # Pillow clamps vertical taps, matching runtime ClampToEdge. Repeat U for
    # the shared facade pair; packed material atlases clamp on both axes.
    if wrap_s == "clamp":
        return image.resize((mip_width, mip_height), Image.Resampling.LANCZOS)
    tiled = Image.new("RGBA", (width * 3, height))
    for offset in (0, width, width * 2):
        tiled.paste(image, (offset, 0))
    resized = tiled.resize((mip_width * 3, mip_height), Image.Resampling.LANCZOS)
    return resized.crop((mip_width, 0, mip_width * 2, mip_height))


def main() -> None:
    if PILLOW_VERSION != EXPECTED_PILLOW_VERSION:
        raise RuntimeError(f"Expected Pillow {EXPECTED_PILLOW_VERSION}; found {PILLOW_VERSION}")
    if len(sys.argv) != 4 or sys.argv[3] not in {"repeat", "clamp"}:
        raise RuntimeError("usage: build-runtime-mip-chain.py <source-image> <output-directory> <repeat|clamp>")

    source_path = Path(sys.argv[1])
    output_directory = Path(sys.argv[2])
    wrap_s = sys.argv[3]
    output_directory.mkdir(parents=True, exist_ok=True)
    image = Image.open(source_path).convert("RGBA")
    paths = []
    level = 0
    while True:
        output_path = output_directory / f"level-{level:02d}.png"
        image.save(output_path, format="PNG", optimize=False, compress_level=9)
        paths.append(str(output_path.resolve()))
        if max(image.size) == 1:
            break
        image = next_mip(image, wrap_s)
        level += 1

    print(json.dumps(paths))


if __name__ == "__main__":
    main()
