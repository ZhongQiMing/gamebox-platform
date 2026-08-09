# -*- coding: utf-8 -*-
"""Restore jsr pk10-race embed host after CDN fetch wipe."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSR = ROOT / "media" / "pk10-race"
BJSC = Path(__file__).resolve().parents[2] / "bjsc" / "media" / "pk10-race"

BOOT = r"""
        <script src="js/race-host.js?v=2"></script>
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
              if (m && m[1] && window.JsrPk10Race) {
                window.JsrPk10Race.setIssue(decodeURIComponent(m[1]));
              }
            } catch (e) {}
            /* 历史卡：URL 自带 settle=1，进页直接领奖台，避免父页时序漏调 */
            try {
              if (window.JsrPk10Race && /(?:\?|&)settle=1(?:&|$)/.test(location.search || '')) {
                var mo = /(?:\?|&)order=([^&]*)/.exec(location.search || '');
                if (mo && mo[1]) {
                  var issM = /(?:\?|&)issue=([^&]*)/.exec(location.search || '');
                  JsrPk10Race.settle(decodeURIComponent(mo[1]), {
                    issue: issM && issM[1] ? decodeURIComponent(issM[1]) : '',
                  });
                }
              }
            } catch (e2) {}
            try { parent.postMessage({ source: 'jsr-pk10-race', action: 'ready' }, location.origin); } catch (e) {}
          });
        </script>
"""


def main() -> None:
    assert JSR.is_dir(), JSR
    assert BJSC.is_dir(), BJSC

    # sounds from bjsc if missing/tiny
    for name in ("staring.mp3", "over.mp3", "bg.mp3", "cuttime.mp3"):
        src, dst = BJSC / "sound" / name, JSR / "sound" / name
        if src.exists() and (
            not dst.exists() or dst.stat().st_size < 1000 or dst.stat().st_size < src.stat().st_size
        ):
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            print("sound", name, dst.stat().st_size)

    # copy missing/tiny images from bjsc
    for src in (BJSC / "images").iterdir():
        if not src.is_file():
            continue
        dst = JSR / "images" / src.name
        if (not dst.exists()) or (
            dst.stat().st_size < 1000 and src.stat().st_size > dst.stat().st_size
        ):
            shutil.copy2(src, dst)
            print("img", src.name, src.stat().st_size)

    # race-host from bjsc with renames
    text = (BJSC / "js" / "race-host.js").read_text(encoding="utf-8")
    text = (
        text.replace("北京赛车房间嵌入控制", "极速赛车房间嵌入控制")
        .replace("BjscPk10Race", "JsrPk10Race")
        .replace("bjsc-pk10-race", "jsr-pk10-race")
    )
    host = JSR / "js" / "race-host.js"
    host.write_text(text, encoding="utf-8")
    print("race-host", host.stat().st_size, "JsrPk10Race" in text)

    # embed CSS patch
    css_path = JSR / "css" / "style.css"
    css = css_path.read_text(encoding="utf-8", errors="ignore")
    if "html.is-embed .trafficlight" not in css:
        bjcss = (BJSC / "css" / "style.css").read_text(encoding="utf-8", errors="ignore")
        marker = "/* ---- local preview / room embed patch ---- */"
        i = bjcss.find(marker)
        if i >= 0:
            css_path.write_text(css.rstrip() + "\n\n" + bjcss[i:], encoding="utf-8")
            print("embed css appended")
        else:
            print("WARN: embed css marker missing in bjsc")
    else:
        print("embed css ok")

    # remove bad font filename with #
    bad = JSR / "fonts" / "subset-DS-Digital-Bold.svg#DS-Digital-Bold"
    if bad.exists():
        bad.unlink()
        print("removed bad font", bad.name)

    for name in ("jisusc_index.html", "index.html"):
        p = JSR / name
        if not p.exists():
            print("skip missing", name)
            continue
        html = p.read_text(encoding="utf-8", errors="ignore")
        html = html.replace("images/logo.png", "images/jisusc_logo.png")
        # strip previous host/boot fragments
        html = re.sub(
            r'\s*<script src="js/race-host\.js[^"]*"></script>',
            "",
            html,
        )
        html = re.sub(
            r"(?s)\s*<!-- local preview / room embed boot -->\s*<script>.*?</script>",
            "",
            html,
        )
        if 'src="js/main.js"' not in html:
            print("WARN: main.js missing in", name)
            continue
        html = html.replace(
            '<script src="js/main.js"></script>',
            '<script src="js/main.js"></script>' + BOOT,
        )
        p.write_text(html, encoding="utf-8")
        print(
            "booted",
            name,
            "race-host" in html,
            "JsrPk10Race" in html,
            "jsr-pk10-race" in html,
        )

    # keep index identical to jisusc
    jisusc = JSR / "jisusc_index.html"
    if jisusc.exists():
        (JSR / "index.html").write_text(jisusc.read_text(encoding="utf-8"), encoding="utf-8")
        print("index synced")

    sounds = sorted(x.name for x in (JSR / "sound").iterdir() if x.is_file())
    print("sounds:", sounds)
    print("host exists:", host.exists())


if __name__ == "__main__":
    main()
