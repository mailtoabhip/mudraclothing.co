#!/usr/bin/env python3
"""WebP copies of every live product photo, for <picture>/srcset.

Called by scripts/build_seo.py (so the normal build covers it). For each image in
data/products.json "products" it writes, next to the JPEG:

    <name>-800.webp       800 px wide
    <name>-<w>.webp       the photo's own width, when that is wider than 800

and records the widths on the media entry ("w", "h", "webp"), which main.js,
product.js and build_seo.py read to build srcset. The JPEG stays as the fallback
and is what the sitemap, structured data and the Merchant feed point at.

No upscaling: a 1000 px photo gets 800 and 1000, a 760 px one only 760. For
1600 px versions, add higher-resolution JPEGs under new file names.
Existing WebP files are kept (file names are never reused, see README).
"""
import json, pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
STEP = 800          # the small size every card and phone uses
QUALITY = 78        # keeps an 800 px photo comfortably under 120 KB


def webp_widths(width):
    return sorted({min(STEP, width), width})


def build():
    pf = ROOT / "data/products.json"
    data = json.loads(pf.read_text(encoding="utf-8"))
    made = 0
    for p in data["products"]:
        for m in p["media"]:
            if m.get("type") != "img":
                continue
            src = ROOT / m["src"]
            with Image.open(src) as im:
                w, h = im.size
                widths = webp_widths(w)
                for tw in widths:
                    out = src.with_name(f"{src.stem}-{tw}.webp")
                    if out.exists():
                        continue
                    img = im.convert("RGB")
                    if tw != w:
                        img = img.resize((tw, round(h * tw / w)), Image.LANCZOS)
                    img.save(out, "WEBP", quality=QUALITY, method=6)
                    made += 1
            m["w"], m["h"], m["webp"] = w, h, widths
    pf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return made


if __name__ == "__main__":
    print(f"webp: {build()} new files")
