"""原地重压缩图片：文件名、扩展名、格式都不变，只把体积压下来。

用在「文件名不能改」的素材上。最典型的是头像：`/images/avatars/018.jpg` 这类路径
存在数据库的 User.avatar 和聊天记录里，改成 .webp 会让存量用户头像全部变成裂图，
而代码里一处引用都看不出来。这类素材只能保持文件名，换一种压得更狠的编码参数。

JPEG 用 quality=78 + optimize + progressive（渐进式让弱网下先出低清预览再变清晰）。
PNG 走调色板量化：256 色对 UI 图标、头像这类色彩简单的图几乎无损，体积能砍掉一半以上；
真彩照片类（颜色数 > 4000）跳过，避免出现色带。

用法：
  python scripts/recompress-inplace.py --dir client-app/public/images/avatars
  python scripts/recompress-inplace.py --dir client-app/public/images/avatars --apply
"""
import argparse
import io
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"node_modules", ".git", "dist", "__pycache__", "android", "ios"}


def walk(base):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            yield os.path.join(dirpath, fn)


def recompress(path, jpeg_quality, png_colors, max_width=0):
    """返回压缩后的字节；压不小就返回 None（宁可不动）。"""
    from PIL import Image

    ext = os.path.splitext(path)[1].lower()
    original = os.path.getsize(path)
    buf = io.BytesIO()

    with Image.open(path) as im:
        if getattr(im, "n_frames", 1) > 1:
            return None
        if max_width and im.width > max_width:
            # 只在「存下来的分辨率远超实际显示尺寸」时用，例如 400px 的头像只显示 40px
            im = im.copy()
            im.thumbnail((max_width, max_width), Image.LANCZOS)
        if ext in (".jpg", ".jpeg"):
            im.convert("RGB").save(buf, "JPEG", quality=jpeg_quality,
                                   optimize=True, progressive=True)
        elif ext == ".png":
            has_alpha = im.mode in ("RGBA", "LA", "PA")
            rgb = im.convert("RGBA" if has_alpha else "RGB")
            # 颜色数太多说明是照片/渐变，量化会出色带，交给 WebP 那条路去处理
            colors = rgb.convert("RGB").getcolors(maxcolors=4096)
            if colors is None:
                return None
            quant = rgb.quantize(colors=png_colors, method=Image.Quantize.MEDIANCUT)
            quant.save(buf, "PNG", optimize=True)
        else:
            return None

    data = buf.getvalue()
    return data if len(data) < original * 0.92 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--jpeg-quality", type=int, default=78)
    ap.add_argument("--png-colors", type=int, default=256)
    ap.add_argument("--min-kb", type=int, default=8)
    ap.add_argument("--max-width", type=int, default=0,
                    help="存图分辨率远超显示尺寸时缩到这个宽度，0 表示不缩")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    base = os.path.join(REPO, args.dir.replace("/", os.sep))
    if not os.path.isdir(base):
        sys.exit(f"目录不存在：{base}")

    before = after = 0
    changed = skipped = 0
    for path in sorted(walk(base)):
        if os.path.splitext(path)[1].lower() not in (".jpg", ".jpeg", ".png"):
            continue
        size = os.path.getsize(path)
        if size < args.min_kb * 1024:
            continue
        data = recompress(path, args.jpeg_quality, args.png_colors, args.max_width)
        before += size
        if data is None:
            after += size
            skipped += 1
            continue
        after += len(data)
        changed += 1
        if args.apply:
            with open(path, "wb") as f:
                f.write(data)

    verb = "已压缩" if args.apply else "可压缩（预演）"
    print(f"{verb} {changed} 个文件，另有 {skipped} 个压不小已跳过")
    if before:
        print(f"{before/1048576:.1f}MB → {after/1048576:.1f}MB（省 {(1-after/before)*100:.0f}%）")


main()
