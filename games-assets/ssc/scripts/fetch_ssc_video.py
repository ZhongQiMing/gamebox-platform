# -*- coding: utf-8 -*-
"""Download official 幸运时时彩 video pack → media/ssc-video/ + RING tones."""
from __future__ import annotations

import re
import ssl
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
CDN = "https://s8kj168.com/js/lib/video/SSC/"
OUT = Path(__file__).resolve().parents[1] / "media" / "ssc-video"
RINGS = Path(__file__).resolve().parents[1] / "media" / "ssc-rings"

SEED = [
    "xyssx_index.html",
    "css/style.css",
    "css/animateTool.css",
    "js/jquery-1.9.1.js",
    "js/victor1.0.js",
    "img/cqssc/bodybg.jpg",
    "sound/bg.mp3",
    "sound/opening.mp3",
    "sound/over.mp3",
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, context=CTX, timeout=45) as r:
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
    # urljoin needs a fake base file URL
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

    RINGS.mkdir(parents=True, exist_ok=True)
    for i in range(1, 11):
        name = f"RING_{i:02d}.wav"
        try:
            data = fetch(f"https://s8kj168.com/media/{name}")
            (RINGS / name).write_bytes(data)
            print("OK ring", name, len(data))
        except Exception as e:
            print("FAIL ring", name, e)

    files = [p for p in OUT.rglob("*") if p.is_file()]
    print("TOTAL", len(files), sum(p.stat().st_size for p in files))


if __name__ == "__main__":
    main()
