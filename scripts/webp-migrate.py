"""把指定目录下的大图转成 WebP，并同步改写引用它的代码。

为什么需要：大陆到香港的线路对单条 TCP 连接限速约 60KB/s，进一个游戏要拉十几 MB
的 PNG。这些图多是 AI 生成的大尺寸 RGBA，PNG 已是压缩格式、gzip 拿不到收益，
只能换格式——实测 2096KB 的开奖背景转 WebP 只剩 139KB。

三条安全边界（都是踩过坑加上的，别绕过）：

  1. 引用按「解析后的真实路径」匹配，不按文件名。
     `chip-500.png` 这种名字在七八个游戏里各有一份，按文件名改引用会把 A 游戏的
     代码指向 B 游戏才转好的图，页面直接裂给你看。

  2. 只有 html/css/js/json/ts/vue 里的引用算数、也只改这些文件。
     被 .py 生成脚本引用的是绿幕源图，浏览器根本不下载，转了白转；
     被 android 原生壳引用的删了会打不出包，这两类只保留不改。

  3. 默认 dry-run，加 --apply 才落盘；落盘后自动回扫一遍确认没有断掉的引用。

用法：
  python scripts/webp-migrate.py --assets games-assets/bjsc
  python scripts/webp-migrate.py --assets games-assets/bjsc --min-kb 40 --apply

动态拼路径（如 `${SYM}/${symbol}.png`）扫不出来，这类目录用
--include-unreferenced 强制纳入，并手工把代码里的模板后缀改掉。
"""
import argparse
import os
import re
import sys
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(REPO, "client-app", "public")
IMAGE_EXT = {".png", ".jpg", ".jpeg"}
# 文件名被写进数据库的资源，永远不能改扩展名：
# 头像路径以 /images/avatars/018.jpg 的形式存在 User.avatar 字段里，
# 改成 .webp 会让所有存量用户的头像变成裂图，而代码里一处引用都看不出来。
ALWAYS_SKIP = ("images" + os.sep + "avatars" + os.sep,)
RUNTIME_EXT = {".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".ts", ".tsx", ".vue"}
PROTECT_EXT = {".py", ".sh", ".md", ".xml", ".java", ".kt", ".gradle"}
SKIP_DIRS = {"node_modules", ".git", "dist", "__pycache__", ".vite", "build",
             "dist-images", ".idea", ".vscode", "_yben_dump",
             # Capacitor 同步进去的构建产物。里面是打包后的 js，改它既没用又危险：
             # 会让脚本误以为某张图「有人引用」，从而把源码还在按 .png 找的图删掉。
             "android", "ios"}

# 捕获整个路径片段，不只是文件名：./a/b.png、../x/y.png、/images/z.png、w.png
REF_RE = re.compile(r"(?:\.{0,2}/)?(?:[\w\-.\u4e00-\u9fff]+/)*[\w\-.\u4e00-\u9fff]+\.(?:png|jpe?g)",
                    re.I)


def walk(base):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            yield os.path.join(dirpath, fn)


def resolve(token, from_file, scope=None, scope_index=None):
    """把代码里写的路径还原成磁盘上的绝对路径；拿不准就返回 None。

    scope/scope_index 是「同游戏目录内按文件名兜底」用的：像
    `loadImg(ASSETS + 'bg.png')` 这种拼出来的路径没法按相对路径解析，
    但引用它的代码就在同一个游戏目录里，且该目录内同名文件唯一时可以安全认定。
    """
    token = token.split("?")[0].split("#")[0]
    if token.startswith("/"):
        rel = token.lstrip("/")
        # 游戏域的 web 根同时映射 client-app/public 与仓库根的 games-assets/
        for base in (PUBLIC, REPO):
            cand = os.path.normpath(os.path.join(base, rel))
            if os.path.isfile(cand):
                return cand
        return None
    cand = os.path.normpath(os.path.join(os.path.dirname(from_file), token))
    if os.path.isfile(cand):
        return cand

    inside = bool(scope) and os.path.normcase(from_file).startswith(
        os.path.normcase(scope) + os.sep)
    if not inside:
        return None

    # js 里写的相对路径是相对「网页文档」解析的，不是相对 js 文件自己。
    # 例如 games-assets/longhu/js/lhd-table.js 里的 './assets/ui/chips/chip-50.png'
    # 实际指向 games-assets/longhu/assets/ui/chips/chip-50.png。
    # 所以从引用者所在目录逐级向上找到游戏根，唯一命中才认。
    hits = []
    base = os.path.dirname(from_file)
    scope_norm = os.path.normcase(os.path.normpath(scope))
    while True:
        cand = os.path.normpath(os.path.join(base, token))
        if os.path.isfile(cand) and cand not in hits:
            hits.append(cand)
        if os.path.normcase(base) == scope_norm:
            break
        parent = os.path.dirname(base)
        if parent == base:
            break
        base = parent
    if len(hits) == 1:
        return hits[0]
    if hits:
        return None  # 多处同名，宁可不动

    if scope_index is not None and "/" not in token:
        found = scope_index.get(token.lower(), ())
        if len(found) == 1:
            return found[0]
    return None


def scan_references(scope=None):
    """返回 图片绝对路径 -> {运行时: {(文件, 原始token)}, 保护: {文件}}"""
    scope_index = defaultdict(list)
    if scope:
        for p in walk(scope):
            if os.path.splitext(p)[1].lower() in IMAGE_EXT:
                scope_index[os.path.basename(p).lower()].append(p)

    refs = defaultdict(lambda: {"runtime": set(), "protect": set()})
    for path in walk(REPO):
        ext = os.path.splitext(path)[1].lower()
        if ext not in RUNTIME_EXT and ext not in PROTECT_EXT:
            continue
        try:
            text = open(path, "r", encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for token in set(REF_RE.findall(text)):
            target = resolve(token, path, scope, scope_index)
            if not target:
                continue
            key = os.path.normcase(target)
            if ext in RUNTIME_EXT:
                refs[key]["runtime"].add((path, token))
            else:
                refs[key]["protect"].add(path)
    return refs


def convert(src, quality):
    from PIL import Image
    dst = os.path.splitext(src)[0] + ".webp"
    with Image.open(src) as im:
        if getattr(im, "n_frames", 1) > 1:
            return None  # 多帧图转了会只剩第一帧
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "PA") else "RGB")
        im.save(dst, "WEBP", quality=quality, method=6)
    return dst


def repair(assets_dir, apply):
    """把指向「已被转成 webp 的 png/jpg」的残留引用改过来。

    同一张图常在 index.html 和 js 里各写一遍，早期版本只改到其中一处，
    这个模式专门收尾：引用解析不到文件、但同路径的 .webp 在，就改过去。
    """
    scope_index = defaultdict(list)
    for p in walk(assets_dir):
        if os.path.splitext(p)[1].lower() in IMAGE_EXT | {".webp"}:
            scope_index[os.path.basename(p).lower()].append(p)

    fixes = defaultdict(set)
    for path in walk(assets_dir):
        if os.path.splitext(path)[1].lower() not in RUNTIME_EXT:
            continue
        text = open(path, "r", encoding="utf-8", errors="ignore").read()
        for token in set(REF_RE.findall(text)):
            if resolve(token, path, assets_dir, scope_index):
                continue
            webp_token = os.path.splitext(token)[0] + ".webp"
            if resolve(webp_token, path, assets_dir, scope_index):
                fixes[path].add(token)

    total = sum(len(v) for v in fixes.values())
    print(f"发现 {total} 处可修复的残留引用，涉及 {len(fixes)} 个文件")
    for path, tokens in sorted(fixes.items()):
        print(f"  {os.path.relpath(path, REPO)}: {', '.join(sorted(tokens)[:4])}"
              f"{' …' if len(tokens) > 4 else ''}")
    if not apply or not total:
        if total:
            print("\n（预演，加 --apply 才会真正修改）")
        return
    for path, tokens in fixes.items():
        text = open(path, "r", encoding="utf-8").read()
        for token in sorted(tokens, key=len, reverse=True):
            text = text.replace(token, os.path.splitext(token)[0] + ".webp")
        open(path, "w", encoding="utf-8", newline="").write(text)
    print(f"已修复 {total} 处")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", required=True, help="要处理的素材目录（相对仓库根）")
    ap.add_argument("--min-kb", type=int, default=40)
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--include-unreferenced", action="store_true")
    ap.add_argument("--exclude", default="",
                    help="逗号分隔的路径片段，命中的文件跳过（如 games/bcbm）")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--repair", action="store_true",
                    help="只修复指向已删 png/jpg 的残留引用（同名 webp 存在时改过去）")
    args = ap.parse_args()

    assets_dir = os.path.join(REPO, args.assets.replace("/", os.sep))
    if not os.path.isdir(assets_dir):
        sys.exit(f"目录不存在：{assets_dir}")

    if args.repair:
        repair(assets_dir, args.apply)
        return

    print("扫描全仓库引用……", flush=True)
    refs = scan_references(assets_dir)

    excludes = [e.strip().replace("/", os.sep) for e in args.exclude.split(",") if e.strip()]
    planned, small, only_src, unref, skipped_ex = [], 0, 0, 0, 0
    for path in sorted(walk(assets_dir)):
        if os.path.splitext(path)[1].lower() not in IMAGE_EXT:
            continue
        if any(e in path for e in excludes) or any(s in path for s in ALWAYS_SKIP):
            skipped_ex += 1
            continue
        size = os.path.getsize(path)
        if size < args.min_kb * 1024:
            small += 1
            continue
        info = refs.get(os.path.normcase(path), {"runtime": set(), "protect": set()})
        if not info["runtime"]:
            if info["protect"]:
                only_src += 1
                continue
            if not args.include_unreferenced:
                unref += 1
                continue
        planned.append((path, size, info["runtime"], info["protect"]))

    before = sum(s for _, s, _, _ in planned)
    print(f"\n计划转换 {len(planned)} 个文件，合计 {before/1048576:.1f}MB")
    print(f"跳过：小于 {args.min_kb}KB {small} 个，仅生成脚本引用（源图）{only_src} 个，"
          f"无任何引用 {unref} 个\n")

    if not args.apply:
        for path, size, rt, guard in sorted(planned, key=lambda x: -x[1])[:30]:
            tag = "  [保留原图：原生壳/脚本还在用]" if guard else ""
            print(f"  {size//1024:>6}KB  {os.path.relpath(path, assets_dir)}"
                  f"  ← {len(rt)} 处引用{tag}")
        if len(planned) > 30:
            print(f"  …… 另外 {len(planned)-30} 个")
        print("\n（预演，加 --apply 才会真正修改）")
        return

    after, edits = 0, defaultdict(list)
    animated = []
    for path, size, rt, guard in planned:
        dst = convert(path, args.quality)
        if dst is None:
            animated.append(os.path.relpath(path, REPO))
            after += size
            continue
        after += os.path.getsize(dst)
        for text_file, token in rt:
            edits[text_file].append(token)
        if not guard:
            os.remove(path)

    for text_file, tokens in edits.items():
        text = open(text_file, "r", encoding="utf-8").read()
        for token in sorted(set(tokens), key=len, reverse=True):
            text = text.replace(token, os.path.splitext(token)[0] + ".webp")
        open(text_file, "w", encoding="utf-8", newline="").write(text)

    print(f"完成：{before/1048576:.1f}MB → {after/1048576:.1f}MB "
          f"（省 {(1-after/before)*100:.0f}%），改写 {len(edits)} 个代码文件")
    if animated:
        print(f"跳过 {len(animated)} 个多帧图：{', '.join(animated[:5])}")

    print("\n回扫校验……")
    scope_index = defaultdict(list)
    for p in walk(assets_dir):
        if os.path.splitext(p)[1].lower() in IMAGE_EXT | {".webp"}:
            scope_index[os.path.basename(p).lower()].append(p)
    broken = []
    for text_file in edits:
        text = open(text_file, "r", encoding="utf-8", errors="ignore").read()
        for token in set(re.findall(
                r"(?:\.{0,2}/)?(?:[\w\-.\u4e00-\u9fff]+/)*[\w\-.\u4e00-\u9fff]+\.webp", text)):
            if not resolve(token, text_file, assets_dir, scope_index):
                broken.append((os.path.relpath(text_file, REPO), token))
    if broken:
        print(f"!! {len(broken)} 处引用找不到文件：")
        for f, t in broken[:15]:
            print(f"   {f}  ->  {t}")
    else:
        print("干净：改过的文件里每一条引用都能落到实际文件上。")


main()
