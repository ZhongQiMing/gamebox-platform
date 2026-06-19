"""Split utility mahjong buttons (minus, plus, spin, menu) from a single row sprite."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

BUTTON_NAMES = ["btn-minus.png", "btn-plus.png", "btn-spin.png", "icon-menu.png"]
WEIGHTS = [1.0, 1.0, 1.55, 1.0]


def is_background_pixel(r: int, g: int, b: int, a: int = 255, threshold: int = 35) -> bool:
    if a < 10:
        return True
    if r <= threshold and g <= threshold and b <= threshold:
        return True
    return False


def remove_background(img: Image.Image, threshold: int = 35) -> Image.Image:
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if is_background_pixel(r, g, b, a, threshold):
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def trim_alpha(img: Image.Image, padding: int = 8) -> Image.Image:
    rgba = img.convert("RGBA")
    bbox = rgba.getbbox()
    if not bbox:
        return rgba
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(rgba.width, right + padding)
    bottom = min(rgba.height, bottom + padding)
    return rgba.crop((left, top, right, bottom))


def proportional_segments(length: int, weights: list[float]) -> list[tuple[int, int]]:
    total = sum(weights)
    segments: list[tuple[int, int]] = []
    cursor = 0
    for weight in weights:
        width = int(length * weight / total)
        segments.append((cursor, cursor + width))
        cursor += width
    if segments:
        last_left, _ = segments[-1]
        segments[-1] = (last_left, length)
    return segments


def split_utility_buttons(input_path: Path, output_dir: Path) -> None:
    source = remove_background(Image.open(input_path))
    segments = proportional_segments(source.width, WEIGHTS)
    output_dir.mkdir(parents=True, exist_ok=True)

    for (left, right), name in zip(segments, BUTTON_NAMES, strict=True):
        crop = trim_alpha(source.crop((left, 0, right, source.height)))
        out_path = output_dir / name
        crop.save(out_path, "PNG")
        print(f"Saved {out_path} ({crop.size[0]}x{crop.size[1]})")


if __name__ == "__main__":
    input_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        r"C:\Users\pc\.cursor\projects\c-Users-pc-Desktop-gamebox-platform\assets\mahjong-utility-buttons-black-bg.png"
    )
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
        r"c:\Users\pc\Desktop\gamebox-platform\client-app\public\images\games\mahjong\classic\buttons"
    )
    split_utility_buttons(input_file, output)
