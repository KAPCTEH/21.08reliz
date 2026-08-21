#!/usr/bin/env python3
"""Regression checks for the canonical transparent JustFun logo."""

from __future__ import annotations

import hashlib
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "source" / "application" / "assets" / "JustFun-official-transparent.png"
WEB_COPY = ROOT / "source" / "application" / "web" / "assets" / "justfun-official-transparent.png"
EXPECTED_SHA256 = "464d69baa9d275324532b8a55527d72452021cace7da04d88ec7d213b83a0359"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    assert MASTER.is_file(), f"Missing transparent master: {MASTER}"
    assert WEB_COPY.is_file(), f"Missing web logo: {WEB_COPY}"
    assert digest(MASTER) == EXPECTED_SHA256
    assert MASTER.read_bytes() == WEB_COPY.read_bytes(), "Web logo differs from the canonical master"

    with Image.open(MASTER) as image:
        assert image.mode == "RGBA", f"Expected RGBA, got {image.mode}"
        assert image.width >= 512 and image.height >= 512
        alpha = image.getchannel("A")
        histogram = alpha.histogram()
        corners = (
            alpha.getpixel((0, 0)),
            alpha.getpixel((image.width - 1, 0)),
            alpha.getpixel((0, image.height - 1)),
            alpha.getpixel((image.width - 1, image.height - 1)),
        )
        assert corners == (0, 0, 0, 0), f"Logo corners are not transparent: {corners}"
        assert histogram[0] > image.width * image.height * 0.10
        assert histogram[255] > image.width * image.height * 0.30
        assert sum(histogram[1:255]) > 0, "Soft alpha edge is missing"

    production_files = (
        ROOT / "source" / "application" / "web" / "index.html",
        ROOT / "source" / "application" / "telegram-setup.html",
        ROOT / "source" / "application" / "web" / "assets" / "css" / "110-desktop-platform-v750.css",
        ROOT / "source" / "application" / "web" / "assets" / "css" / "120-premium-release-v783.css",
        ROOT / "source" / "application" / "web" / "assets" / "css" / "130-experience-refresh-v783.css",
        ROOT / "source" / "installer" / "premium-ui" / "MainWindow.xaml",
    )
    for path in production_files:
        text = path.read_text(encoding="utf-8")
        assert "official-transparent.png" in text, f"Transparent logo is not referenced by {path}"

    print("logo-transparency-test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
