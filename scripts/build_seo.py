#!/usr/bin/env python3
"""SEO build: everything search engines and link previews read.

Called at the end of scripts/build_pages.py, so the normal command covers it:
    python3 scripts/build_pages.py && python3 scripts/fingerprint.py

What it writes:
  p/<id>.html     one static page per product (served at /p/<id>): real title,
                  description, canonical, share tags, Product + Breadcrumb JSON-LD,
                  and the name/price/copy/images in the HTML itself. product.js
                  still takes over in the browser exactly as before.
  index.html      head block (title, canonical, share tags, Organization +
                  WebSite JSON-LD) and the 16 product cards pre-rendered into the
                  grid, so the catalogue is readable without JavaScript.
  sitemap.xml, robots.txt
  assets/img/og/mudra-og.jpg   default 1200x630 share image (only if missing)
  assets/video/hero-poster.jpg first frame of the hero video (only if missing)

Product/Offer price data is only emitted while checkout is switched on
(SHOPIFY.enabled: true in assets/js/shop.js).
"""
import datetime, html, json, os, pathlib, re, subprocess

from site_config import (SITE_URL, SITE_NAME, CONTACT_EMAIL, INSTAGRAM_URL, OG_IMAGE,
                         PREORDER_MIN_DAYS, PREORDER_MAX_DAYS)

ROOT = pathlib.Path(__file__).resolve().parent.parent
TODAY = datetime.date.today().isoformat()

# ── Drop 01 (data/drop.json) ──────────────────────────────────────────────
# The phase is worked out at BUILD time, so the site must be rebuilt and pushed on
# the opening day, the day after closing, and the day after shipsBy (see README).
# DROP_PHASE=teaser|open|closed|launched overrides it, for testing builds only.
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
_drop_file = ROOT / "data/drop.json"
DROP = json.loads(_drop_file.read_text(encoding="utf-8")) if _drop_file.exists() else None


def drop_phase(now=None):
    forced = os.environ.get("DROP_PHASE")
    if forced in ("teaser", "open", "closed", "launched"):
        return forced
    if not DROP:
        return "launched"
    now = now or datetime.datetime.now(IST)
    opens = datetime.datetime.fromisoformat(DROP["opens"])
    closes = datetime.datetime.fromisoformat(DROP["closes"])
    launch = datetime.datetime.fromisoformat(DROP["shipsBy"] + "T00:00:00+05:30") + datetime.timedelta(days=1)
    if now < opens:
        return "teaser"
    if now <= closes:
        return "open"
    return "closed" if now < launch else "launched"


def in_drop(pid):
    return bool(DROP) and (DROP["products"] == "all" or pid in DROP["products"])


def sale_state(pid):
    ph = drop_phase()
    if ph == "launched":
        return "launched"
    return ph if in_drop(pid) else "notInDrop"


def _long(d):
    return f"{d:%a}, {d.day} {d:%b}"


def _short(d):
    return f"{d.day} {d:%b}"


def drop_dates():
    if not DROP:
        return None
    o = datetime.datetime.fromisoformat(DROP["opens"]).astimezone(IST)
    c = datetime.datetime.fromisoformat(DROP["closes"]).astimezone(IST)
    sb = datetime.date.fromisoformat(DROP["shipsBy"])
    return {"name": DROP["name"], "opens_long": _long(o), "opens_short": _short(o),
            "closes_short": _short(c), "ships_long": _long(sb), "ships_short": _short(sb)}


def before_launch(now=None):
    # `launch` only changes ticker/hero wording; pre-orders stay open either way
    if not DROP or not DROP.get("launch"):
        return False
    return (now or datetime.datetime.now(IST)) < datetime.datetime.fromisoformat(DROP["launch"])


# mirrors tickerItems() / heroTag() in assets/js/shop.js
def ticker_items():
    ph, d = drop_phase(), drop_dates()
    if not d or ph == "launched":
        return [f"Printed to order · {PREORDER_MIN_DAYS}–{PREORDER_MAX_DAYS} days", "Designed in-house", "Free shipping across India"]
    if ph == "teaser":
        return [f"{d['name']} · pre-orders open {d['opens_short']}", "Designed in-house", "Free shipping across India"]
    if ph == "open":
        if before_launch():
            return [f"{d['name']} · early pre-orders open", f"Closes {d['closes_short']}",
                    f"Ships by {d['ships_short']}", "Free shipping across India"]
        return [f"{d['name']} is live", f"Pre-orders close {d['closes_short']}",
                f"Ships by {d['ships_short']}", "Free shipping across India"]
    return [f"{d['name']} · printing now", f"Ships by {d['ships_short']}"]


def hero_tag():
    ph, d = drop_phase(), drop_dates()
    launched = f"Printed to order · {PREORDER_MIN_DAYS}–{PREORDER_MAX_DAYS} days"   # nothing drop-specific
    if not d:
        return launched
    return {"teaser": f"{d['name']} · pre-orders open {d['opens_short']}",
            "open": f"{d['name']} · early pre-orders open" if before_launch() else f"{d['name']} is live",
            "closed": f"{d['name']} · printing now"}.get(ph, launched)


HOME_TITLE = "Mudra Studios | Oversized graphic t-shirts, designed in India"
HOME_DESC = ("Oversized graphic tees with a clean front and a loud back. Food, city, Y2K, "
             "gym, travel and tarot designs, printed to order in India. Free shipping, "
             "cash on delivery.")

# content pages that belong in the sitemap (404, cart and the bare template don't)
SITEMAP_PAGES = ["about", "contact", "shipping", "returns", "payment-help", "size-guide",
                 "track", "terms", "privacy"]

e = lambda s: html.escape(str(s), quote=True)
HIGH = ' fetchpriority="high"'


def url(path):
    return SITE_URL.rstrip("/") + path


def jsonld(obj):
    # "</" must never appear raw inside a <script> block
    return ('<script type="application/ld+json">'
            + json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
            + "</script>")


def offers_live():
    js = (ROOT / "assets/js/shop.js").read_text(encoding="utf-8")
    m = re.search(r"\benabled:\s*(true|false)", js)
    return bool(m and m.group(1) == "true")


def preorder():
    # ORDERING.mode in assets/js/shop.js is the one switch
    js = (ROOT / "assets/js/shop.js").read_text(encoding="utf-8")
    m = re.search(r"ORDERING\s*=\s*\{\s*mode:\s*'(\w+)'", js)
    return bool(m and m.group(1) == "preorder")


DAYS = f"{PREORDER_MIN_DAYS}–{PREORDER_MAX_DAYS} days"


def blurb(p):
    # keep in step with blurb() in assets/js/product.js
    if p.get("blurb"):
        return p["blurb"]
    if p["print"] == "back":
        return (f"{p['name']}, from the {p['seriesLabel']} series. "
                "A small stamp on the chest, the whole graphic on the back.")
    return f"{p['name']}, from the {p['seriesLabel']} series. Chest print only."


def money(n):
    n = float(n)
    s = f"{int(n):,}" if n == int(n) else f"{n:,.2f}"
    # Indian grouping is identical below 1 lakh, which every price here is
    return "₹" + s


def images(p):
    return [m for m in p["media"] if m.get("type") == "img"]


def artwork_pair(p):
    imgs = [m for m in images(p) if "hanger" not in m["src"]]
    back = next((m for m in imgs if m["src"].endswith("-back.jpg")), None)
    front = next((m for m in imgs if m["src"].endswith("-front.jpg")), None)
    return [back, front] if back and front else []


def gallery_shots(p):
    # same rule as product.js: with photography, artwork moves out of the gallery
    shots, art = images(p), artwork_pair(p)
    photos = [m for m in shots if m not in art]
    return photos if len(art) == 2 and len(photos) >= 2 else shots


# ── shared assets ─────────────────────────────────────────────────────────

def make_og_image():
    out = ROOT / OG_IMAGE.lstrip("/")
    if out.exists():
        return
    from PIL import Image
    src = ROOT / "assets/img/products/face-card-snooker.jpg"
    if not src.exists():
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGB")
    # fill 1200 wide, keep the upper-middle band where the back print sits
    scale = 1200 / im.width
    im = im.resize((1200, round(im.height * scale)), Image.LANCZOS)
    top = max(0, min(im.height - 630, round(im.height * 0.22)))
    im.crop((0, top, 1200, top + 630)).save(out, "JPEG", quality=84, optimize=True, progressive=True)


def make_hero_poster():
    video = ROOT / "assets/video/hero.mp4"
    out = ROOT / "assets/video/hero-poster.jpg"
    if out.exists() or not video.exists():
        return
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0", "-i", str(video),
                    "-frames:v", "1", "-q:v", "4", str(out)], check=False)


# ── structured data ───────────────────────────────────────────────────────

def organization():
    org = {
        "@type": "Organization",
        "@id": url("/#org"),
        "name": SITE_NAME,
        "url": url("/"),
        "logo": url("/assets/favicon/icon-512.png"),
        "email": CONTACT_EMAIL,
        "contactPoint": {"@type": "ContactPoint", "contactType": "customer support",
                         "email": CONTACT_EMAIL, "areaServed": "IN",
                         "availableLanguage": ["en"]},
    }
    if INSTAGRAM_URL:
        org["sameAs"] = [INSTAGRAM_URL]
    return org


def product_ld(p, offers):
    shots = images(p)
    ld = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": f"{p['name']} Oversized T-Shirt",
        "description": blurb(p),
        "url": url(f"/p/{p['id']}"),
        "image": [url("/" + m["src"]) for m in shots],
        "brand": {"@type": "Brand", "name": SITE_NAME},
        "category": "Apparel & Accessories > Clothing > Shirts & Tops",
        "productID": p["id"],
        "size": [s["size"] for s in p["sizes"]],
    }
    st = sale_state(p["id"])
    if offers and st != "teaser":
        in_stock = any(s.get("available") for s in p["sizes"])
        ld["offers"] = {
            "@type": "Offer",
            "url": url(f"/p/{p['id']}"),
            "priceCurrency": "INR",
            "price": f"{float(p['price']):.2f}",
            "availability": "https://schema.org/" + ("InStock" if in_stock else "OutOfStock"),
            "itemCondition": "https://schema.org/NewCondition",
            "seller": {"@id": url("/#org")},
            "shippingDetails": {
                "@type": "OfferShippingDetails",
                "shippingRate": {"@type": "MonetaryAmount", "value": "0", "currency": "INR"},
                "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "IN"},
                # printed to order: 3–5 days to print + 4–5 days in transit = 7–10 days
                "deliveryTime": {
                    "@type": "ShippingDeliveryTime",
                    "handlingTime": {"@type": "QuantitativeValue", "minValue": 3, "maxValue": 5, "unitCode": "DAY"},
                    "transitTime": {"@type": "QuantitativeValue", "minValue": 4, "maxValue": 5, "unitCode": "DAY"},
                },
            },
            "hasMerchantReturnPolicy": {
                "@type": "MerchantReturnPolicy",
                "applicableCountry": "IN",
                "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                "merchantReturnDays": 7,
                "returnMethod": "https://schema.org/ReturnByMail",
                "returnFees": "https://schema.org/FreeReturn",
            },
        }
        if st == "open":
            # Drop 01: a real pre-order window, fixed ship-by date instead of 7–10 days
            ld["offers"]["availability"] = "https://schema.org/PreOrder"
            ld["offers"]["availabilityStarts"] = DROP["opens"]
            ld["offers"]["availabilityEnds"] = DROP["closes"]
            # the pre-order price is only valid until pre-orders close
            ld["offers"]["priceValidUntil"] = DROP["closes"][:10]
            ld["offers"]["shippingDetails"].pop("deliveryTime", None)
        elif st in ("closed", "notInDrop"):
            ld["offers"]["availability"] = "https://schema.org/OutOfStock"
            ld["offers"]["shippingDetails"].pop("deliveryTime", None)
    return ld


def breadcrumb_ld(p):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": url("/")},
            {"@type": "ListItem", "position": 2, "name": p["name"], "item": url(f"/p/{p['id']}")},
        ],
    }


def head_tags(title, desc, path, image, og_type="website", extra=""):
    return "\n".join([
        "<!-- seo:start -->",
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc)}">',
        f'<link rel="canonical" href="{e(url(path))}">',
        f'<meta property="og:type" content="{og_type}">',
        f'<meta property="og:site_name" content="{SITE_NAME}">',
        '<meta property="og:locale" content="en_IN">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:url" content="{e(url(path))}">',
        f'<meta property="og:image" content="{e(url(image))}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{e(title)}">',
        f'<meta name="twitter:description" content="{e(desc)}">',
        f'<meta name="twitter:image" content="{e(url(image))}">',
        extra,
        "<!-- seo:end -->",
    ]).replace("\n\n", "\n")


def put_head(s, block):
    """Replace the seo block, or on first run swap it in for <title> + description."""
    if "<!-- seo:start -->" in s:
        return re.sub(r"<!-- seo:start -->.*?<!-- seo:end -->", lambda _: block, s, flags=re.S)
    s = re.sub(r"<title>.*?</title>\n", "", s, count=1, flags=re.S)
    s = re.sub(r'<meta name="description"[^>]*>\n', "", s, count=1)
    s = re.sub(r'<meta property="og:(type|site_name)"[^>]*>\n', "", s)
    return s.replace('<meta name="viewport" content="width=device-width, initial-scale=1">\n',
                     '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + block + "\n", 1)


# ── prices (mirrors priceView() in assets/js/shop.js) ─────────────────────

def price_view(p):
    now = p["price"]
    mrp = p.get("mrp")
    pre = sale_state(p["id"]) in ("open", "teaser")
    reg = p.get("regularPrice")
    return {"now": now, "mrp": mrp if mrp and mrp > now else None,
            "regular": reg if pre and reg and reg > now else None, "pre": pre}


def card_price(p):
    # mirrors cardPrice() in assets/js/main.js
    v = price_view(p)
    return ('<div class="pprice">'
            + (f'<s class="pprice__mrp"><span class="sr">MRP </span>{money(v["mrp"])}</s>' if v["mrp"] else "")
            + f'<span class="pprice__now">{money(v["now"])}</span>'
            + ('<span class="pprice__po mono">Pre-order</span>' if v["pre"] else "")
            + "</div>")


def buy_price(p):
    # mirrors priceHTML() in assets/js/product.js
    v, d = price_view(p), drop_dates()
    label = '<p class="mono buy__label" aria-hidden="true">Pre-order price</p>' if v["pre"] else ""
    row = ('<div class="buy__pricerow">'
           + (f'<s class="mono buy__mrp">MRP {money(v["mrp"])}</s>' if v["mrp"] else "")
           + f'<span class="price{" is-pre" if v["pre"] else ""}" id="price"><span class="sr">'
           + ("Pre-order price " if v["pre"] else "Price ")
           + f'</span><span class="price__num">{money(v["now"])}</span></span></div>')
    tax = '<p class="mono buy__tax">Inclusive of all taxes · Free shipping</p>'
    note = ('<aside class="pricenote" role="note" aria-label="Price after pre-orders close">'
            f'<div class="pricenote__row"><span class="mono">After {e(d["closes_short"])}</span>'
            f'<span class="pricenote__price">{money(v["regular"])}</span></div>'
            '<p class="pricenote__text">The pre-order price ends when pre-orders close.</p></aside>'
            if v["regular"] and d else "")
    return f'<div class="buy__price" id="priceBlock">{label}{row}{tax}{note}</div>'


def check_prices(products):
    # products.json and drop.json must agree on when pre-order prices end
    if not DROP:
        return
    bad = [p["id"] for p in products if p.get("preorderEnds") and p["preorderEnds"] != DROP["closes"]]
    if bad:
        raise SystemExit(f"preorderEnds != drop.json closes for: {', '.join(bad)}. "
                         "Run python3 scripts/pricing.py preorder|regular.")


# ── home ──────────────────────────────────────────────────────────────────

def card_cta(p, href, in_stock):
    # mirrors cardCta() in assets/js/main.js
    st, d = sale_state(p["id"]), drop_dates()
    if st == "teaser":
        return "", f'<a class="atc" href="{href}">Opens {d["opens_short"]}</a>'
    if st == "open":
        return f"Closes {d['closes_short']}", f'<a class="atc" href="{href}">Pre-order now</a>'
    if st == "closed":
        return "", f'<a class="atc" href="{href}">Closed</a>'
    if st == "notInDrop":
        return "", f'<button class="atc" disabled>Not in {e(d["name"])}</button>'
    tag = f"Pre-order · {DAYS}" if preorder() else ""
    btn = (f'<a class="atc" href="{href}">{"Pre-order" if preorder() else "Choose size"}</a>' if in_stock
           else '<button class="atc" disabled>Sold out</button>')
    return tag, btn


def card_html(p, lazy=False):
    # mirrors cardHTML() in assets/js/main.js; main.js re-renders over it
    href = f"/p/{p['id']}"
    avail = [s["size"] for s in p["sizes"] if s.get("available")]
    stock = ["in" if avail else "out"] + (["low"] if (p.get("badge") or {}).get("type") == "low" else [])
    badge = (f'<span class="pbadge {p["badge"]["type"]}">{e(p["badge"]["label"])}</span>'
             if p.get("badge") else "")
    imgs = images(p)
    slides = "".join(
        f'<img class="slide{" is-on" if i == 0 else ""}" src="/{m["src"]}" alt="{e(m["alt"])}" '
        f'loading="{"eager" if i == 0 and not lazy else "lazy"}" decoding="async" width="800" height="1000">'
        for i, m in enumerate(imgs))
    dots = "".join('<i class="is-on"></i>' if i == 0 else "<i></i>" for i in range(len(imgs)))
    sw = [c for c in p.get("colours", []) if c.get("sellable")]
    swatches = "".join(
        f'<button class="pswatch{" on" if i == 0 else ""}" data-colour="{c["key"]}" '
        f'style="--sw:{c["hex"]}" title="{e(c["name"])}" aria-label="{e(c["name"])}"></button>'
        for i, c in enumerate(sw))
    tag, atc = card_cta(p, href, bool(avail))
    kind = "Back print" if p["print"] == "back" else "Chest only"
    return (f'<article class="pcard" data-id="{p["id"]}" data-line="{e(p.get("line", ""))}" data-series="{p["series"]}" '
            f'data-colour="{e(p["colour"])}" data-print="{p["print"]}" data-stock="{" ".join(stock)}" '
            f'data-sizes="{" ".join(avail)}" data-price="{p["price"]}" data-name="{e(p["name"])}" data-url="{href}">'
            f'<div class="pcard__media" tabindex="0" aria-label="{e(p["name"])}, view product">{badge}'
            f'<div class="slides">{slides}</div>'
            '<button class="navbtn prev" aria-label="Previous image">&#8249;</button>'
            '<button class="navbtn next" aria-label="Next image">&#8250;</button>'
            f'<div class="dots">{dots}</div></div>'
            f'<div class="pcard__info"><div class="ptag mono">{e(p["seriesLabel"])} · {kind}</div>'
            f'<h3><a href="{href}">{e(p["name"])}</a></h3>'
            + card_price(p)
            + (f'<div class="ptag mono pcard__po">{tag}</div>' if tag else "")
            + f'<div class="pswatches">{swatches}</div>{atc}</div></article>')


# ── three lines (data/lines.json) ─────────────────────────────────────────
# mirrors linesHTML() / lineIntroHTML() / lineSwitchHTML() in assets/js/main.js

_lines_file = ROOT / "data/lines.json"
LINES = json.loads(_lines_file.read_text(encoding="utf-8")) if _lines_file.exists() else None


def line_name(p):
    ln = next((l for l in (LINES or {}).get("lines", []) if l["key"] == p.get("line")), None)
    return ln["name"] if ln else ""


def line_products(products, ln):
    mine = [p for p in products if p.get("line") == ln["key"]]
    pick = [i for i in ln.get("strip", []) if any(p["id"] == i for p in mine)]
    by_id = {p["id"]: p for p in mine}
    return [by_id[i] for i in pick] if pick else mine[:6], len(mine)


def line_visual(ln, has_products, lazy):
    # a line with products and a feature photo shows the photo; otherwise the name, set big
    f = ln.get("feature")
    if has_products and f:
        src, alt = f["src"], f["alt"]
        if not (ROOT / src).exists() and f.get("fallback"):
            src, alt = f["fallback"], f.get("fallbackAlt", alt)
        return (f'<div class="lvis lvis--photo"><img src="/{e(src)}" alt="{e(alt)}" width="800" height="1000" '
                f'loading="lazy" decoding="async"></div>')
    return (f'<div class="lvis lvis--type lvis--{e(ln.get("block", "blue"))}" aria-hidden="true">'
            f'<span class="lvis__name">{e(ln["name"])}</span></div>')


def line_intro(ln, count, lazy):
    L = LINES
    act = (f'<a class="btn lines__cta" href="/?line={e(ln["key"])}#shop" data-line-link="{e(ln["key"])}">{e(ln["cta"])}</a>'
           if count else
           f'<p class="mono lines__soon">{e(L["teaser"])}</p>'
           + (f'<a class="linkish mono lines__follow" href="{e(INSTAGRAM_URL)}" target="_blank" rel="noopener">{e(L["follow"])}</a>'
              if INSTAGRAM_URL else ""))
    return (f'<div class="lines__intro"><div class="lines__copy">'
            f'<p class="mono lines__name">{e(ln["name"])}</p>'
            f'<p class="lines__text">{e(ln["copy"])}</p>'
            f'<div class="lines__act">{act}</div></div>'
            + line_visual(ln, count > 0, lazy) + '</div>')


def line_strip(ln, strip):
    if not strip:
        return ""
    return (f'<div class="lstrip"><div class="lstrip__track" tabindex="-1">'
            + "".join(card_html(p, lazy=True) for p in strip)
            + '</div><div class="lstrip__nav">'
            f'<button class="lstrip__btn" data-dir="-1" aria-label="Scroll {e(ln["name"])} tees back">&#8249;</button>'
            f'<button class="lstrip__btn" data-dir="1" aria-label="Scroll {e(ln["name"])} tees forward">&#8250;</button>'
            '</div></div>')


def lines_html(products):
    L = LINES
    tabs, panels = [], []
    for i, ln in enumerate(L["lines"]):
        k, on = e(ln["key"]), i == 0
        strip, count = line_products(products, ln)
        tabs.append(f'<button class="lines__tab mono" role="tab" id="ltab-{k}" aria-controls="lpanel-{k}" '
                    f'aria-selected="{"true" if on else "false"}" tabindex="{0 if on else -1}" data-line="{k}">{e(ln["name"])}</button>')
        panels.append(f'<div class="lines__panel" role="tabpanel" id="lpanel-{k}" aria-labelledby="ltab-{k}" tabindex="0"'
                      f'{"" if on else " hidden"}>' + line_intro(ln, count, not on) + line_strip(ln, strip) + '</div>')
    return ('<div class="wrap">'
            f'<h2 class="lines__head" id="linesHead">{e(L["heading"])}</h2>'
            '<div class="lines__tabs" role="tablist" aria-labelledby="linesHead">' + "".join(tabs) + '</div>'
            + "".join(panels)
            + '<noscript><style>.lines__panel[hidden]{display:block}.lines__tabs{display:none}</style></noscript>'
            '</div>')


def line_switch_html():
    btns = ['<button class="mono" data-line="all" aria-pressed="true">All</button>'] + [
        f'<button class="mono" data-line="{e(ln["key"])}" aria-pressed="false">{e(ln["name"])}</button>'
        for ln in LINES["lines"]]
    return '<div class="lineswitch" id="lineSwitch" role="group" aria-label="Line">' + "".join(btns) + '</div>'


def series_counts(s, products):
    # "Food 4": counts for the ALL view; main.js recounts per line
    def fix(m):
        v = m.group(1)
        n = sum(1 for p in products if p["series"] == v)
        return f'<button data-v="{v}"{"" if n else " hidden"}>{m.group(2)} <span class="fcount">{n}</span></button>'
    block = re.search(r'<div class="fchips" data-key="series">.*?</div>', s, flags=re.S)
    if not block:
        return s
    new = re.sub(r'<button data-v="([^"]+)"(?: hidden)?>([^<]+?)(?: <span class="fcount">\d+</span>)?</button>', fix, block.group(0))
    return s[:block.start()] + new + s[block.end():]


def home_desc():
    ph, d = drop_phase(), drop_dates()
    if not d or ph == "launched":
        return HOME_DESC
    base = ("Oversized graphic tees with a clean front and a loud back. Food, city, Y2K, "
            "gym, travel and tarot designs, printed in India. ")
    if ph == "closed":
        return base + f"{d['name']} is printing now and ships by {d['ships_short']}. Free shipping across India."
    return base + (f"{d['name']} pre-orders {d['opens_short']} to {d['closes_short']}, ships by "
                   f"{d['ships_short']}. Free shipping across India.")


def product_desc(p):
    st, d = sale_state(p["id"]), drop_dates()
    lead = f"{blurb(p)} {money(p['price'])}."
    if st == "teaser":
        return f"{lead} {d['name']} pre-orders open {d['opens_short']}, ship by {d['ships_short']}. Free shipping across India."
    if st == "open":
        return f"{lead} Pre-order until {d['closes_short']}, ships by {d['ships_short']}. Free shipping across India."
    if st == "closed":
        return f"{lead} {d['name']} is printing now and ships by {d['ships_short']}. Free shipping across India."
    if st == "notInDrop":
        return f"{lead} Back after {d['name']} launches. Free shipping across India."
    promise = f"Pre-order, arrives in {DAYS}. " if preorder() else ""
    return f"{lead} {promise}Free shipping across India, cash on delivery."


def build_home(products):
    f = ROOT / "index.html"
    s = f.read_text(encoding="utf-8")
    graph = {"@context": "https://schema.org", "@graph": [
        organization(),
        {"@type": "WebSite", "@id": url("/#site"), "name": SITE_NAME, "url": url("/"),
         "inLanguage": "en-IN", "publisher": {"@id": url("/#org")}},
        {"@type": "ItemList", "name": "The drops", "numberOfItems": len(products),
         "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": url(f"/p/{p['id']}"),
                              "name": p["name"]} for i, p in enumerate(products)]},
    ]}
    s = put_head(s, head_tags(HOME_TITLE, home_desc(), "/", OG_IMAGE, extra=jsonld(graph)))
    # ticker + hero tag for the phase at build time (main.js re-renders them live)
    row = "".join(f"<span>{e(t)}</span><span>✳</span>" for t in ticker_items())
    s = re.sub(r'(<div class="ticker__track">\n).*?(\n  </div>)',
               lambda m: m.group(1) + "    " + row + "\n    " + row + m.group(2), s, count=1, flags=re.S)
    s = re.sub(r'(<div class="mono hero__tag">).*?(</div>)', lambda m: m.group(1) + e(hero_tag()) + m.group(2), s, count=1)
    grid = "<!-- grid:start -->" + "".join(card_html(p) for p in products) + "<!-- grid:end -->"
    if "<!-- grid:start -->" in s:
        s = re.sub(r"<!-- grid:start -->.*?<!-- grid:end -->", lambda _: grid, s, flags=re.S)
    else:
        s = s.replace('<div class="pgrid" id="pgrid"></div>', f'<div class="pgrid" id="pgrid">{grid}</div>', 1)
    if LINES:
        s = re.sub(r"<!-- lines:start -->.*?<!-- lines:end -->",
                   lambda _: "<!-- lines:start -->" + lines_html(products) + "<!-- lines:end -->", s, flags=re.S)
        s = re.sub(r"<!-- lineswitch:start -->.*?<!-- lineswitch:end -->",
                   lambda _: "<!-- lineswitch:start -->" + line_switch_html() + "<!-- lineswitch:end -->", s, flags=re.S)
    s = series_counts(s, products)
    s = s.replace('<html lang="en">', '<html lang="en-IN">', 1)
    f.write_text(s, encoding="utf-8")


# ── product pages ─────────────────────────────────────────────────────────

def build_products(products, offers):
    template = (ROOT / "product.html").read_text(encoding="utf-8")
    template = template.replace('<meta name="robots" content="noindex">\n', "")
    outdir = ROOT / "p"
    outdir.mkdir(exist_ok=True)
    keep = set()
    for p in products:
        shots = gallery_shots(p)
        title = f"{p['name']} Oversized T-Shirt | {p['seriesLabel']} series | {SITE_NAME}"
        desc = product_desc(p)
        extra = jsonld(product_ld(p, offers)) + "\n" + jsonld(breadcrumb_ld(p))
        s = put_head(template, head_tags(title, desc, f"/p/{p['id']}",
                                         "/" + shots[0]["src"] if shots else OG_IMAGE,
                                         og_type="product", extra=extra))
        if offers and sale_state(p["id"]) != "teaser":
            s = s.replace("<!-- seo:end -->",
                          f'<meta property="product:price:amount" content="{float(p["price"]):.2f}">\n'
                          '<meta property="product:price:currency" content="INR">\n<!-- seo:end -->', 1)
        s = s.replace('<html lang="en">', '<html lang="en-IN">', 1)
        gallery = "".join(
            f'<button class="gshot" data-i="{i}" aria-label="Enlarge image {i + 1} of {len(shots)}">'
            f'<img src="/{m["src"]}" alt="{e(m["alt"])}" width="800" height="1000" '
            f'loading="{"eager" if i < 2 else "lazy"}" decoding="async"{HIGH if i == 0 else ""}></button>'
            for i, m in enumerate(shots))
        s = re.sub(r'(<div class="gallery__track" id="track">).*?(</div>\n)',
                   lambda m: m.group(1) + gallery + m.group(2), s, count=1, flags=re.S)
        buy = (f'<div class="buy__top"><span class="mono buy__series">{e(p["seriesLabel"])} series</span>'
               + (f'<span class="mono buy__line">{e(line_name(p))}</span>' if line_name(p) else "")
               + '</div>'
               f'<h1 class="buy__name">{e(p["name"])}</h1>'
               + buy_price(p)
               + f'<p class="buy__blurb">{e(blurb(p))}</p>')
        s = s.replace('<aside class="buy" id="buy" aria-live="polite"></aside>',
                      f'<aside class="buy" id="buy" aria-live="polite">{buy}</aside>', 1)
        out = outdir / f"{p['id']}.html"
        out.write_text(s, encoding="utf-8")
        keep.add(out.name)
    for old in outdir.glob("*.html"):          # products removed from the catalogue
        if old.name not in keep:
            old.unlink()


# ── sitemap + robots ──────────────────────────────────────────────────────

def build_sitemap(products):
    rows = [("/", "1.0")] + [(f"/p/{p['id']}", "0.8") for p in products] + \
           [(f"/{s}", "0.4") for s in SITEMAP_PAGES if (ROOT / f"{s}.html").exists()]
    body = "".join(f"<url><loc>{e(url(path))}</loc><lastmod>{TODAY}</lastmod>"
                   f"<priority>{pr}</priority></url>" for path, pr in rows)
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + body + "</urlset>\n",
        encoding="utf-8")
    (ROOT / "robots.txt").write_text(
        "User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /product$\nDisallow: /product.html\n\n"
        f"Sitemap: {url('/sitemap.xml')}\n", encoding="utf-8")


def build():
    data = json.loads((ROOT / "data/products.json").read_text(encoding="utf-8"))
    products = data["products"]
    check_prices(products)
    offers = offers_live()
    # the one public setting product.js needs from site_config (Instagram link)
    (ROOT / "data/site.json").write_text(json.dumps({"instagram": INSTAGRAM_URL}) + "\n", encoding="utf-8")
    make_og_image()
    make_hero_poster()
    build_home(products)
    build_products(products, offers)
    build_sitemap(products)
    print(f"seo: home, {len(products)} product pages, sitemap, robots "
          f"(offers {'on' if offers else 'off'}, drop phase {drop_phase()}, site {SITE_URL})")


if __name__ == "__main__":
    build()
