# -*- coding: utf-8 -*-
"""Restore speed-boat pk10-race embed host after CDN fetch."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSB = ROOT / "media" / "pk10-race"
BJSC = Path(__file__).resolve().parents[2] / "bjsc" / "media" / "pk10-race"

BOOT = r"""
        <script src="js/race-host.js?v=1"></script>
        <!-- local preview / room embed boot -->
        <script>
          $(function () {
            if (/[?&]embed=1(?:&|$)/.test(location.search)) {
              document.documentElement.classList.add('is-embed');
            }
            $('#preloader').hide();
            var audio = document.getElementById('sound');
            if (audio) { audio.pause(); audio.muted = true; audio.removeAttribute('autoplay'); }
            try {
              var m = /(?:\?|&)issue=([^&]*)/.exec(location.search || '');
              if (m && m[1] && window.JsbPk10Race) {
                window.JsbPk10Race.setIssue(decodeURIComponent(m[1]));
              }
            } catch (e) {}
            try {
              if (window.JsbPk10Race && /(?:\?|&)settle=1(?:&|$)/.test(location.search || '')) {
                var mo = /(?:\?|&)order=([^&]*)/.exec(location.search || '');
                if (mo && mo[1]) {
                  var issM = /(?:\?|&)issue=([^&]*)/.exec(location.search || '');
                  JsbPk10Race.settle(decodeURIComponent(mo[1]), {
                    issue: issM && issM[1] ? decodeURIComponent(issM[1]) : '',
                  });
                }
              }
            } catch (e2) {}
            try { parent.postMessage({ source: 'jsb-pk10-race', action: 'ready' }, '*'); } catch (e) {}
          });
        </script>
"""


def main() -> None:
    assert JSB.is_dir(), JSB

    # fill missing sounds from bjsc when CDN lacks them
    if BJSC.is_dir():
        for name in ("staring.mp3", "over.mp3", "bg.mp3", "cuttime.mp3"):
            src, dst = BJSC / "sound" / name, JSB / "sound" / name
            if src.exists() and (not dst.exists() or dst.stat().st_size < 1000):
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                print("sound", name, dst.stat().st_size)
        for src in (BJSC / "images").iterdir():
            if not src.is_file():
                continue
            dst = JSB / "images" / src.name
            if (not dst.exists()) or (
                dst.stat().st_size < 1000 and src.stat().st_size > dst.stat().st_size
            ):
                # don't overwrite boat-specific scenery/logo/road/cars if present with size
                if src.name in {
                    "logo.png",
                    "scenery.jpg",
                    "road.jpg",
                    "finisher.png",
                } and dst.exists() and dst.stat().st_size > 1000:
                    continue
                if re.match(r"car\d+\.png$", src.name) and dst.exists() and dst.stat().st_size > 1000:
                    continue
                shutil.copy2(src, dst)
                print("img", src.name, src.stat().st_size)

    text = (BJSC / "js" / "race-host.js").read_text(encoding="utf-8")
    text = (
        text.replace("北京赛车房间嵌入控制", "幸运飞艇房间嵌入控制")
        .replace("BjscPk10Race", "JsbPk10Race")
        .replace("bjsc-pk10-race", "jsb-pk10-race")
    )
    host = JSB / "js" / "race-host.js"
    host.write_text(text, encoding="utf-8")
    print("race-host", host.stat().st_size)

    css_path = JSB / "css" / "style.css"
    css = css_path.read_text(encoding="utf-8", errors="ignore")
    if "html.is-embed .trafficlight" not in css:
        bjcss = (BJSC / "css" / "style.css").read_text(encoding="utf-8", errors="ignore")
        marker = "/* ---- local preview / room embed patch ---- */"
        i = bjcss.find(marker)
        if i >= 0:
            css_path.write_text(css.rstrip() + "\n\n" + bjcss[i:], encoding="utf-8")
            print("embed css appended")
    else:
        print("embed css ok")

    bad = JSB / "fonts" / "subset-DS-Digital-Bold.svg#DS-Digital-Bold"
    if bad.exists():
        bad.unlink()
        print("removed bad font")

    for name in ("index.html",):
        p = JSB / name
        if not p.exists():
            continue
        html = p.read_text(encoding="utf-8", errors="ignore")
        html = re.sub(r'\s*<script src="js/race-host\.js[^"]*"></script>', "", html)
        html = re.sub(
            r"(?s)\s*<!-- local preview / room embed boot -->\s*<script>.*?</script>",
            "",
            html,
        )
        if 'src="js/main.js"' not in html:
            print("WARN: main.js missing")
            continue
        html = html.replace(
            '<script src="js/main.js"></script>',
            '<script src="js/main.js"></script>' + BOOT,
        )
        p.write_text(html, encoding="utf-8")
        print("booted", name, "JsbPk10Race" in html)

    print("sounds:", sorted(x.name for x in (JSB / "sound").iterdir() if x.is_file()))


if __name__ == "__main__":
    main()
