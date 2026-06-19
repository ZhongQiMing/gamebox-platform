"""Split labeled mahjong button sprite sheet (2x4) into individual PNGs."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

BUTTON_NAMES = [
    ["btn-turbo.png", "btn-auto.png", "btn-exit.png", "btn-sound.png"],
    ["btn-paytable.png", "btn-rules.png", "btn-history.png", "btn-close.png"],
]


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


def split_labeled_buttons(input_path: Path, output_dir: Path) -> None:
    source = remove_background(Image.open(input_path))
    row_h = source.height // 2
    col_w = source.width // 4
    output_dir.mkdir(parents=True, exist_ok=True)

    for row_idx, row_names in enumerate(BUTTON_NAMES):
        top = row_idx * row_h
        bottom = top + row_h
        for col_idx, name in enumerate(row_names):
            left = col_idx * col_w
            right = left + col_w
            crop = trim_alpha(source.crop((left, top, right, bottom)))
            out_path = output_dir / name
            crop.save(out_path, "PNG")
            print(f"Saved {out_path} ({crop.size[0]}x{crop.size[1]})")


if __name__ == "__main__":
    input_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        r"C:\Users\pc\.cursor\projects\c-Users-pc-Desktop-gamebox-platform\assets\mahjong-labeled-buttons-black-bg.png"
    )
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
        r"c:\Users\pc\Desktop\gamebox-platform\client-app\public\images\games\mahjong\classic\buttons"
    )
    split_labeled_buttons(input_file, output)
