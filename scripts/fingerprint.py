#!/usr/bin/env python3
"""Rewrite ?v=<hash> cache-busters from file contents (md5, first 8 hex).

Run from the repo root after ANY change to CSS, JS or the SVG sprite:
    python3 scripts/fingerprint.py
Updates every root *.html page and the sprite URL inside shop.js.
"""
import hashlib, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = [
    "assets/css/styles.css", "assets/css/product.css", "assets/css/pages.css", "assets/css/cart.css",
    "assets/js/shop.js", "assets/js/main.js", "assets/js/product.js", "assets/js/pages.js", "assets/js/cart.js",
    "assets/svg/sprite.svg",
]
PAGES = sorted(p.name for p in ROOT.glob("*.html")) + sorted(f"p/{p.name}" for p in ROOT.glob("p/*.html")) + ["assets/js/shop.js"]

def h(p): return hashlib.md5((ROOT / p).read_bytes()).hexdigest()[:8]

# sprite first: its hash lives inside shop.js, which is then hashed itself
order = ["assets/svg/sprite.svg"] + [a for a in ASSETS if a != "assets/svg/sprite.svg"]
for asset in order:
    digest = h(asset)
    name = re.escape(asset.split("/")[-1])
    pat = re.compile(r"(/?(?:assets/(?:css|js|svg)/)?" + name + r"\?v=)[^\"'\s)]+")
    for page in PAGES:
        f = ROOT / page
        if not f.exists() or page == asset:
            continue
        s = f.read_text(encoding="utf-8")
        n = pat.sub(lambda m: m.group(1) + digest, s)
        if n != s:
            f.write_text(n, encoding="utf-8")
    print(f"{asset:28} {digest}")
