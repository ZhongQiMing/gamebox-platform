# -*- coding: utf-8 -*-
"""Download 北京赛车 PK10 finishAnimation pack into games-assets/bjsc/media/pk10-race."""
from __future__ import annotations

import re
import shutil
import urllib.request
from pathlib import Path

BASE = "https://s8kj168.com/webapp/js/lib/finishAnimation"
OUT = Path(__file__).resolve().parents[1] / "media" / "pk10-race"

EXTRA = [
    "index.html",
    "css/main.css",
    "css/style.css",
    "css/stylespreloader.css",
    "fonts/fonts.css",
    "js/vendor/modernizr-2.8.3.min.js",
    "js/vendor/jquery-1.11.2.min.js",
    "js/greensock/TweenMax.min.js",
    "js/plugins.js",
    "js/main.js",
    "images/logo.png",
    "images/jisusc_logo.png",
    "images/scenery.jpg",
    "images/road.jpg",
    "images/finisher.png",
    "images/flame.png",
    "images/wheel.gif",
    "images/wheel.png",
    "images/wheel2.png",
    "images/wind.png",
    "images/numbersprite.png",
    "images/result1.png",
    "images/result2.png",
    "images/result3.png",
    "images/resultbg.jpg",
    "images/top_header.jpg",
    "images/top_header.png",
    "images/vulebtn.png",
    "images/bg-bottom.jpg",
    "images/trafficlight.png",
    "images/lightgreen.png",
    "images/lightred.png",
    "images/lightyellow.png",
    "images/on.png",
    "images/off.png",
    "sound/bg.mp3",
    "sound/cuttime.mp3",
    "sound/staring.mp3",
    "sound/over.mp3",
    "sound/running.mp3",
    "sound/kaisound.mp3",
    "sound/empt.mp3",
]


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
        print("FAIL", rel, getattr(e, "code", e))
        dest.unlink(missing_ok=True)
        return False


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for i in range(1, 11):
        EXTRA.extend([f"images/car{i}.png", f"images/winner{i}.png"])

    for rel in EXTRA:
        fetch(rel)

    html_path = OUT / "index.html"
    if html_path.exists():
        html = html_path.read_text(encoding="utf-8", errors="ignore")
        for rel in sorted(set(re.findall(r"""(?:src|href)=["']([^"']+)["']""", html))):
            if rel.startswith(("http", "data:", "#")):
                continue
            rel = rel.split("?")[0]
            if not rel or rel.endswith("/"):
                continue
            if not (OUT / rel).exists():
                fetch(rel)

    fc = OUT / "fonts" / "fonts.css"
    if fc.exists():
        for m in re.findall(r"""url\(['"]?([^)'"]+)['"]?\)""", fc.read_text(encoding="utf-8", errors="ignore")):
            m = m.split("?")[0].lstrip("./")
            if m.startswith("http"):
                continue
            fetch(f"fonts/{m}")

    # Local preview patches: hide preloader / debug buttons, fix layout for iframe
    css = OUT / "css" / "style.css"
    if css.exists():
        text = css.read_text(encoding="utf-8", errors="ignore")
        patch = """
/* ---- local preview patch ---- */
html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #000 !important; position: static !important; left: auto !important; }
.container { width: 1334px; height: 780px; overflow: hidden; position: absolute; left: 0; top: 0; }
#preloader { display: none !important; }
#an-btn1, #an-btn2, #an-btn3, #an-btn4, #an-btn5 { display: none !important; }
"""
        css.write_text(text + "\n" + patch, encoding="utf-8")

    if html_path.exists():
        html = html_path.read_text(encoding="utf-8", errors="ignore")
        boot = """
        <script>
          $(function () {
            $('#preloader').hide();
            var audio = document.getElementById('sound');
            if (audio) { audio.pause(); audio.muted = true; audio.removeAttribute('autoplay'); }
          });
        </script>
"""
        if "</body>" in html and "local preview boot" not in html:
            html = html.replace("</body>", "        <!-- local preview boot -->" + boot + "    </body>")
            html_path.write_text(html, encoding="utf-8")

    files = [f for f in OUT.rglob("*") if f.is_file()]
    print("TOTAL", len(files), sum(f.stat().st_size for f in files))


if __name__ == "__main__":
    main()
