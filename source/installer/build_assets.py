#!/usr/bin/env python3
"""Build deterministic NSIS artwork from the one approved JustFun logo."""

from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path

from PIL import Image, ImageDraw


OFFICIAL_LOGO_SHA256 = "4faffc5cd41e8e26f44df14c879f340d5451ae058a7b5e90ca485ea442258813"
TRANSPARENT_LOGO_SHA256 = "464d69baa9d275324532b8a55527d72452021cace7da04d88ec7d213b83a0359"
BACKGROUND = (6, 24, 20)
GOLD = (216, 173, 80)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def circular_logo(source: Image.Image) -> Image.Image:
    """Keep the approved emblem pixels and remove only the baked checkerboard."""
    width, height = source.size
    # The supplied approved file contains a checkerboard outside the emblem.
    # These proportional bounds follow the outer gold ring without redrawing it.
    crop = (
        round(width * 0.045),
        round(height * 0.025),
        round(width * 0.951),
        round(height * 0.971),
    )
    emblem = source.crop(crop).convert("RGBA")
    side = max(emblem.size)
    emblem = emblem.resize((side, side), Image.Resampling.LANCZOS)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).ellipse(
        (0, 0, emblem.width - 1, emblem.height - 1),
        fill=255,
    )
    emblem.putalpha(mask)
    return emblem


def fit_logo(source: Image.Image, size: tuple[int, int], inset: int) -> Image.Image:
    canvas = Image.new("RGB", size, BACKGROUND)
    target = (max(1, size[0] - inset * 2), max(1, size[1] - inset * 2))
    logo = circular_logo(source)
    logo.thumbnail(target, Image.Resampling.LANCZOS)
    x = (size[0] - logo.width) // 2
    y = (size[1] - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--logo", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    logo_path = args.logo.resolve()
    transparent_logo_path = logo_path.with_name("JustFun-official-transparent.png")
    output = args.output_dir.resolve()
    actual = sha256(logo_path)
    if actual != OFFICIAL_LOGO_SHA256:
        raise RuntimeError(
            "The supplied logo is not the approved JustFun logo. "
            f"Expected {OFFICIAL_LOGO_SHA256}, actual {actual}."
        )
    if not transparent_logo_path.is_file():
        raise RuntimeError(f"The approved transparent logo is missing: {transparent_logo_path}")
    transparent_actual = sha256(transparent_logo_path)
    if transparent_actual != TRANSPARENT_LOGO_SHA256:
        raise RuntimeError(
            "The supplied transparent logo is not the approved JustFun logo. "
            f"Expected {TRANSPARENT_LOGO_SHA256}, actual {transparent_actual}."
        )

    output.mkdir(parents=True, exist_ok=True)
    source = Image.open(logo_path).convert("RGB")
    # Preserve the approved transparent master byte-for-byte. Re-encoding through
    # Pillow keeps the pixels but changes PNG chunks and the pinned SHA-256.
    shutil.copyfile(transparent_logo_path, output / "JustFun-official-transparent.png")

    icon = circular_logo(source)
    icon.save(output / "JustFun-mark.png", format="PNG", optimize=True)
    icon.save(
        output / "JustFun.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    welcome = fit_logo(source, (164, 314), 10)
    draw = ImageDraw.Draw(welcome)
    draw.rectangle((0, 0, 163, 313), outline=GOLD, width=2)
    welcome.save(output / "welcome.bmp", format="BMP")

    header = fit_logo(source, (150, 57), 5)
    draw = ImageDraw.Draw(header)
    draw.line((0, 56, 149, 56), fill=GOLD, width=1)
    header.save(output / "header.bmp", format="BMP")

    sidebar = fit_logo(source, (210, 420), 12)
    draw = ImageDraw.Draw(sidebar)
    draw.rectangle((0, 0, 209, 419), outline=GOLD, width=2)
    sidebar.save(output / "sidebar.bmp", format="BMP")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
