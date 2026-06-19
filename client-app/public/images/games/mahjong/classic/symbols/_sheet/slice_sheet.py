"""裁切 2×5 麻将合集图为 10 张官方 MW1 符号 PNG。"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

NAMES = ['fa', 'zhong', 'bai', '8w', '5t', '5s', '2t', '2s', 'wild', 'hu']
COLS, ROWS = 5, 2
OUT_SIZE = 512


def slice_sheet(src: Path, out_dir: Path, margin_pct: float = 0.03, pad_pct: float = 0.06) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    mx, my = int(w * margin_pct), int(h * margin_pct)
    im = im.crop((mx, my, w - mx, h - my))
    w, h = im.size
    cell_w, cell_h = w // COLS, h // ROWS
    pad = int(min(cell_w, cell_h) * pad_pct)

    for idx, name in enumerate(NAMES):
        r, c = divmod(idx, COLS)
        box = (c * cell_w + pad, r * cell_h + pad, (c + 1) * cell_w - pad, (r + 1) * cell_h - pad)
        tile = im.crop(box).resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
        tile.save(out_dir / f'{name}.png', 'PNG')

    im.save(out_dir / 'sheet-source.png', 'PNG')
    print(f'sliced {src.name} -> {out_dir} ({len(NAMES)} tiles)')


if __name__ == '__main__':
    base = Path(__file__).parent
    variants = {
        'pg': base / 'mahjong-sheet-pg-traditional.png',
        'realistic': base / 'mahjong-sheet-realistic-traditional.png',
        'cartoon': base / 'mahjong-sheet-cartoon-traditional.png',
    }
    if len(sys.argv) >= 3:
        slice_sheet(Path(sys.argv[1]), Path(sys.argv[2]))
    else:
        for name, src in variants.items():
            if src.exists():
                slice_sheet(src, base.parent / '_variants' / name)
