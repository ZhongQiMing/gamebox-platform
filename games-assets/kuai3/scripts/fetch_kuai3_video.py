# -*- coding: utf-8 -*-
"""Download official 极速快3 video pack → media/kuai3-video/."""
from __future__ import annotations

import re
import ssl
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
CDN = "https://s8kj168.com/js/lib/video/kuai3_video/"
OUT = Path(__file__).resolve().parents[1] / "media" / "kuai3-video"

SEED = [
    "Kuai3_jisu.html",
    "css/kuai3.css",
    "css/fonts/fonts.css",
    "js/jquery-1.7.2.min.js",
    "js/main.js",
    "img/bj.jpg",
    "img/bj_2.jpg",
    "img/jisukuai3logo.png",
    "img/progress.gif",
    "img/num/k3v.png",
    "sound/bg.mp3",
    "sound/run.mp3",
    "css/fonts/subset-DS-Digital-Bold.eot",
    "css/fonts/subset-DS-Digital-Bold.woff2",
    "css/fonts/subset-DS-Digital-Bold.woff",
    "css/fonts/subset-DS-Digital-Bold.ttf",
    "css/fonts/subset-DS-Digital-Bold.svg",
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return r.read()


def save_rel(rel: str, data: bytes) -> Path:
    rel = rel.split("?")[0].lstrip("./").replace("\\", "/")
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.stat().st_size != len(data):
        path.write_bytes(data)
    print("OK", rel, len(data))
    return path


def resolve_ref(base_rel: str, ref: str) -> str | None:
    ref = ref.strip().split("?")[0]
    if not ref or ref.startswith(("http://", "https://", "//", "data:", "#")):
        return None
    joined = urljoin("https://x/" + base_rel, ref)
    path = joined.replace("https://x/", "").lstrip("/")
    if path.startswith(".."):
        return None
    return path


def extract_refs(text: str) -> set[str]:
    refs: set[str] = set()
    for pat in (
        r'(?:src|href)=["\']([^"\']+)["\']',
        r"url\(\s*['\"]?([^'\")\s]+)['\"]?\s*\)",
        r'["\']((?:img|sound|css|js)/[^"\']+)["\']',
        r'["\'](sound/[^"\']+\.mp3)["\']',
    ):
        refs.update(re.findall(pat, text, re.I))
    return refs


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    queue = list(SEED)
    seen: set[str] = set()

    while queue:
        rel = queue.pop(0).split("?")[0].lstrip("./")
        if not rel or rel in seen:
            continue
        seen.add(rel)
        try:
            data = fetch(urljoin(CDN, rel))
        except Exception as e:
            print("FAIL", rel, e)
            continue
        path = save_rel(rel, data)
        if path.suffix.lower() not in {".html", ".css", ".js"}:
            continue
        text = data.decode("utf-8", "replace")
        for ref in extract_refs(text):
            cand = resolve_ref(rel, ref)
            if cand and cand not in seen:
                queue.append(cand)

    files = [p for p in OUT.rglob("*") if p.is_file()]
    print("TOTAL", len(files), sum(p.stat().st_size for p in files))


if __name__ == "__main__":
    main()
