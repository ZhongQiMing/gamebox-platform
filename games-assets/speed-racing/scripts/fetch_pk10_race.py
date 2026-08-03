# -*- coding: utf-8 -*-
"""Download 极速赛车 finishAnimation pack from 168 CDN into media/pk10-race."""
from __future__ import annotations

import re
import shutil
import urllib.request
from pathlib import Path

BASE = "https://s8kj168.com/webapp/js/lib/finishAnimation"
OUT = Path(__file__).resolve().parents[1] / "media" / "pk10-race"


def fetch(rel: str) -> bool:
    url = f"{BASE}/{rel}"
    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(url, dest)
        if dest.stat().st_size == 0:
            dest.unlink(missing_ok=True)
            print("EMPTY", rel)
            return False
        print("OK", rel, dest.stat().st_size)
        return True
    except Exception as e:
        print("FAIL", rel, e)
        dest.unlink(missing_ok=True)
        return False


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    fetch("jisusc_index.html")
    html = (OUT / "jisusc_index.html").read_text(encoding="utf-8", errors="ignore")
    fetch("index.html")

    refs = set(re.findall(r"""(?:src|href)=["']([^"']+)["']""", html))
    extra = [
        "css/main.css",
        "css/style.css",
        "css/stylespreloader.css",
        "fonts/fonts.css",
        "js/vendor/modernizr-2.8.3.min.js",
        "js/vendor/jquery-1.11.2.min.js",
        "js/greensock/TweenMax.min.js",
        "js/plugins.js",
        "js/main.js",
        "images/jisusc_logo.png",
        "images/logo.png",
        "images/scenery.jpg",
        "images/road.jpg",
        "images/finisher.png",
        "images/flame.png",
        "images/wheel.png",
        "images/wheel2.png",
        "images/wind.png",
        "images/numbersprite.png",
        "images/result1.png",
        "images/result2.png",
        "images/result3.png",
        "images/resultbg.jpg",
        "images/top_header.png",
        "images/on.png",
        "images/off.png",
        "images/bg-bottom.jpg",
        "images/trafficlight.png",
        "images/lightgreen.png",
        "images/lightred.png",
        "images/lightyellow.png",
        "sound/running.mp3",
        "sound/kaisound.mp3",
        "sound/cuttime.mp3",
        "sound/empt.mp3",
        "sound/bg.mp3",
    ]
    for i in range(1, 11):
        extra += [f"images/car{i}.png", f"images/winner{i}.png"]

    for r in sorted(refs | set(extra)):
        if r.startswith(("http", "data:", "#")):
            continue
        r = r.split("?")[0]
        if not r or r.endswith("/"):
            continue
        fetch(r)

    fc = OUT / "fonts" / "fonts.css"
    if fc.exists():
        for m in re.findall(r"""url\(['"]?([^)'"]+)['"]?\)""", fc.read_text(encoding="utf-8", errors="ignore")):
            m = m.split("?")[0].lstrip("./")
            if m.startswith("http"):
                continue
            fetch(f"fonts/{m}")

    # Preview uses index.html; keep 极速赛车 entry as default
    (OUT / "index.html").write_text(
        (OUT / "jisusc_index.html").read_text(encoding="utf-8", errors="ignore"),
        encoding="utf-8",
    )

    # CDN 不含房间嵌入层；抓完必须立刻还原 race-host / settle boot
    restore = Path(__file__).resolve().parent / "restore_pk10_embed.py"
    if restore.exists():
        import runpy

        runpy.run_path(str(restore), run_name="__main__")
    else:
        print("WARN: restore_pk10_embed.py missing — embed host not restored")

    files = [f for f in OUT.rglob("*") if f.is_file()]
    print("TOTAL", len(files), sum(f.stat().st_size for f in files))


if __name__ == "__main__":
    main()
