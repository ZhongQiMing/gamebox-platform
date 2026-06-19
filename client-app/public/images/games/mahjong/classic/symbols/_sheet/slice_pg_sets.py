"""裁切 PG 风 2×5 合集 → 常规/金色两套，去绿底、无阴影抠图。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

NAMES = ['fa', 'zhong', 'bai', '8w', '5t', '5s', '2t', '2s', 'wild', 'hu']
COLS, ROWS = 5, 2
OUT_SIZE = 512

# 牌面区域占比（略小于格子，避免切到邻牌）
MARGIN_PCT = 0.025
PAD_PCT = 0.05

# 绿毡底 key（可微调）
GREEN_KEY = (34, 85, 48)
GREEN_TOLERANCE = 55


def color_dist(c1: tuple[int, ...], c2: tuple[int, ...]) -> float:
    return sum((a - b) ** 2 for a, b in zip(c1[:3], c2)) ** 0.5


def key_green(im: Image.Image) -> Image.Image:
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if g > r and g > b and color_dist((r, g, b), GREEN_KEY) < GREEN_TOLERANCE:
                px[x, y] = (r, g, b, 0)
            elif color_dist((r, g, b), GREEN_KEY) < GREEN_TOLERANCE * 0.7:
                px[x, y] = (r, g, b, 0)
    return im


def slice_sheet(src: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    mx, my = int(w * MARGIN_PCT), int(h * MARGIN_PCT)
    im = im.crop((mx, my, w - mx, h - my))
    w, h = im.size
    cell_w, cell_h = w // COLS, h // ROWS
    pad = int(min(cell_w, cell_h) * PAD_PCT)

    for idx, name in enumerate(NAMES):
        r, c = divmod(idx, COLS)
        box = (
            c * cell_w + pad,
            r * cell_h + pad,
            (c + 1) * cell_w - pad,
            (r + 1) * cell_h - pad,
        )
        tile = im.crop(box)
        tile = key_green(tile)
        tile = tile.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
        tile.save(out_dir / f'{name}.png', 'PNG')

    im.save(out_dir / 'sheet-source.png', 'PNG')
    print(f'OK {src.name} -> {out_dir}')


def main() -> None:
    sheet_dir = Path(__file__).parent
    regular_dir = sheet_dir.parent
    golden_dir = regular_dir.parent / 'symbols-golden'

    pairs = [
        (sheet_dir / 'mahjong-sheet-pg-v2-regular.png', regular_dir),
        (sheet_dir / 'mahjong-sheet-pg-v2-golden.png', golden_dir),
    ]
    for src, out in pairs:
        if not src.exists():
            print(f'skip missing {src}')
            continue
        slice_sheet(src, out)


if __name__ == '__main__':
    main()
