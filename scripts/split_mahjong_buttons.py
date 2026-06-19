"""Split combined mahjong button sprite sheet into individual transparent PNGs."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROW1_NAMES = [
    "btn-turbo.png",
    "btn-minus.png",
    "btn-spin.png",
    "btn-plus.png",
    "btn-auto.png",
    "icon-menu.png",
]

ROW2_NAMES = [
    "btn-exit.png",
    "btn-sound.png",
    "btn-paytable.png",
    "btn-rules.png",
    "btn-history.png",
    "btn-close.png",
]


def is_background_pixel(r: int, g: int, b: int, a: int = 255, threshold: int = 35) -> bool:
    if a < 10:
        return True
    # Solid black or near-black backdrop for easy cutout
    if r <= threshold and g <= threshold and b <= threshold:
        return True
    avg = (r + g + b) / 3
    spread = max(r, g, b) - min(r, g, b)
    # Light checkerboard fallback
    if avg > 165 and spread < 25:
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


def axis_density(img: Image.Image, axis: str) -> list[int]:
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    density: list[int] = []

    if axis == "x":
        for x in range(w):
            count = sum(1 for y in range(h) if pixels[x, y][3] > 20)
            density.append(count)
    else:
        for y in range(h):
            count = sum(1 for x in range(w) if pixels[x, y][3] > 20)
            density.append(count)

    return density


def find_segments(
    density: list[int],
    min_gap: int = 10,
    min_width: int = 30,
) -> list[tuple[int, int]]:
    segments: list[tuple[int, int]] = []
    start: int | None = None
    gap = 0

    for i, value in enumerate(density):
        if value > min_width:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                end = i - gap + 1
                if end - start >= min_width:
                    segments.append((start, end))
                start = None
                gap = 0

    if start is not None:
        segments.append((start, len(density) - 1))

    return segments


def trim_alpha(img: Image.Image, padding: int = 6) -> Image.Image:
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


def equal_segments(length: int, count: int) -> list[tuple[int, int]]:
    width = length // count
    return [(i * width, (i + 1) * width) for i in range(count)]


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


# Row 1 center spin button is wider than siblings.
ROW1_WEIGHTS = [1.0, 1.0, 1.65, 1.0, 1.0, 1.0]


def split_row(
    row_img: Image.Image,
    names: list[str],
    expected: int,
    *,
    weights: list[float] | None = None,
) -> list[tuple[str, Image.Image]]:
    segments = find_segments(axis_density(row_img, "x"))
    if len(segments) != expected:
        segments = (
            proportional_segments(row_img.width, weights)
            if weights
            else equal_segments(row_img.width, expected)
        )

    results: list[tuple[str, Image.Image]] = []
    for (left, right), name in zip(segments, names, strict=True):
        crop = row_img.crop((left, 0, right, row_img.height))
        results.append((name, trim_alpha(crop)))
    return results


def split_buttons(
    input_path: Path,
    output_dir: Path,
    *,
    remove_bg: bool = True,
    bg_threshold: int = 35,
) -> None:
    source = Image.open(input_path)
    cleaned = remove_background(source, bg_threshold) if remove_bg else source.convert("RGBA")

    row_segments = find_segments(axis_density(cleaned, "y"), min_gap=20, min_width=80)
    if len(row_segments) != 2:
        half = cleaned.height // 2
        row_segments = [(0, half), (half, cleaned.height)]

    output_dir.mkdir(parents=True, exist_ok=True)

    row1 = cleaned.crop((0, row_segments[0][0], cleaned.width, row_segments[0][1]))
    row2 = cleaned.crop((0, row_segments[1][0], cleaned.width, row_segments[1][1]))

    for name, img in split_row(row1, ROW1_NAMES, len(ROW1_NAMES), weights=ROW1_WEIGHTS):
        out_path = output_dir / name
        img.save(out_path, "PNG")
        print(f"Saved {out_path} ({img.size[0]}x{img.size[1]})")

    for name, img in split_row(row2, ROW2_NAMES, len(ROW2_NAMES)):
        out_path = output_dir / name
        img.save(out_path, "PNG")
        print(f"Saved {out_path} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    input_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        r"C:\Users\pc\.cursor\projects\c-Users-pc-Desktop-gamebox-platform\assets\mahjong-buttons-full-set-black-bg.png"
    )
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
        r"c:\Users\pc\Desktop\gamebox-platform\client-app\public\images\games\mahjong\classic\buttons"
    )
    split_buttons(input_file, output)
