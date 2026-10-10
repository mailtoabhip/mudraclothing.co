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
  assets/img/og/mudra-og-face-card.jpg   default 1200x630 share image (only if missing)
  assets/video/hero-poster.jpg first frame of the hero video (only if missing)

Product/Offer price data is only emitted while checkout is switched on
(SHOPIFY.enabled: true in assets/js/shop.js).
"""
import datetime, hashlib, html, json, os, pathlib, re, subprocess

from site_config import (SITE_URL, SITE_NAME, BRAND, LEGAL_NAME, CONTACT_EMAIL, INSTAGRAM_URL, INSTAGRAM_HANDLE, OG_IMAGE,
                         PREORDER_MIN_DAYS, PREORDER_MAX_DAYS, FEED_GENDER, FEED_AGE_GROUP)
import build_images

ROOT = pathlib.Path(__file__).resolve().parent.parent
TODAY = datetime.date.today().isoformat()

# ── Drop 01 (data/drop.json) ──────────────────────────────────────────────
# The phase is worked out at BUILD time, so the site must be rebuilt and pushed on
# the opening day, the day after closing, and the day after shipsBy (see README).
# DROP_PHASE=teaser|open|closed|launched overrides it, for testing builds only.
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
_drop_file = ROOT / "data/drop.json"
DROP = json.loads(_drop_file.read_text(encoding="utf-8")) if _drop_file.exists() else None
RESERVATIONS = json.loads((ROOT / 'data/reservations.json').read_text(encoding='utf-8'))


def deposit_for(pid):
    return RESERVATIONS.get('temporaryOverrides', {}).get(pid, RESERVATIONS['depositRupees'])


def deposit_window(now=None):
    now = now or datetime.datetime.now(IST)
    return bool(RESERVATIONS.get('enabled') and DROP and
                datetime.datetime.fromisoformat(DROP['opens']) <= now <= datetime.datetime.fromisoformat(DROP['closes']))


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
    if RESERVATIONS.get('enabled') and now >= datetime.datetime.fromisoformat(DROP['launch']):
        return 'launched'
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
            "closes_short": _short(c), "ships_long": _long(sb), "ships_short": _short(sb),
            "launch_short": _short(datetime.datetime.fromisoformat(DROP['launch']).astimezone(IST))}


def before_launch(now=None):
    # `launch` only changes ticker/hero wording; pre-orders stay open either way
    if not DROP or not DROP.get("launch"):
        return False
    return (now or datetime.datetime.now(IST)) < datetime.datetime.fromisoformat(DROP["launch"])


# mirrors tickerItems() / heroTag() in assets/js/shop.js
def ticker_items():
    if deposit_window():
        return [f"Pre-order @ {money(RESERVATIONS['depositRupees'])}", f"Orders open {drop_dates()['launch_short']}", 'Free shipping across India']
    ph, d = drop_phase(), drop_dates()
    if not d or ph == "launched":
        return [f"At your door in {PREORDER_MIN_DAYS}–{PREORDER_MAX_DAYS} days", "Designed in-house", "Free shipping across India"]
    if ph == "teaser":
        return [f"Pre-orders open {d['opens_short']}", "Designed in-house", "Free shipping across India"]
    if ph == "open":
        if before_launch():
            return ["Early pre-orders open", f"Closes {d['closes_short']}",
                    "Free shipping across India"]
        return ["Pre-orders are now live", f"Open till {d['closes_short']}",
                "Free shipping across India"]
    return ["Printing now", f"Ships by {d['ships_short']}"]


def hero_tag():
    if deposit_window():
        return f"Pre-order @ {money(RESERVATIONS['depositRupees'])} · Orders open {drop_dates()['launch_short']}"
    ph, d = drop_phase(), drop_dates()
    launched = f"At your door in {PREORDER_MIN_DAYS}–{PREORDER_MAX_DAYS} days"   # nothing drop-specific
    if not d:
        return launched
    return {"teaser": f"Pre-orders open {d['opens_short']}",
            "open": "Early pre-orders open" if before_launch() else "Pre-orders are now live",
            "closed": "Printing now"}.get(ph, launched)


HOME_TITLE = "Oversized Graphic T-Shirts, Designed in India · Mudra"
HOME_DESC = ("Mudra makes oversized graphic t-shirts, designed in Bengaluru, India. A small stamp on the front, "
             "the whole graphic on the back. Free shipping across India.")
OG_SIZE = (1200, 630)
OG_ALT = "Mudra oversized graphic t-shirt, full back print"

# srcset "sizes": mirror CARD_SIZES (shop.js) and GALLERY_SIZES / RELATED_SIZES (product.js)
CARD_SIZES = "(max-width: 600px) 50vw, (max-width: 1100px) 45vw, 30vw"
GALLERY_SIZES = "(max-width: 900px) 100vw, 30vw"
RELATED_SIZES = "(max-width: 1000px) 50vw, 25vw"

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
        return (f"{p['name']}. "
                "A small stamp on the chest, the whole graphic on the back.")
    return f"{p['name']}. Chest print only."


def money(n):
    n = float(n)
    s = f"{int(n):,}" if n == int(n) else f"{n:,.2f}"
    # Indian grouping is identical below 1 lakh, which every price here is
    return "₹" + s


def images(p):
    return [m for m in p["media"] if m.get("type") == "img"]


def webp_set(m):
    base = "/" + re.sub(r"\.jpe?g$", "", m["src"], flags=re.I)
    return ", ".join(f"{base}-{w}.webp {w}w" for w in m.get("webp", []))


def picture(m, cls="", loading="lazy", sizes="100vw", extra=""):
    # mirrors pictureHTML() in assets/js/shop.js
    cls_attr = f' class="{cls}"' if cls else ""
    img = (f'<img{cls_attr} src="/{m["src"]}" alt="{e(m["alt"])}" '
           f'width="{m.get("w", 800)}" height="{m.get("h", 1000)}" loading="{loading}" decoding="async"{extra}>')
    s = webp_set(m)
    return f'<picture><source type="image/webp" srcset="{s}" sizes="{sizes}">{img}</picture>' if s else img


def seo_desc(p):
    d = (p.get("seo") or {}).get("description", "")
    return d.replace("{price}", money(p["price"])) if d else ""


def artwork_pair(p):
    imgs = [m for m in images(p) if "hanger" not in m["src"]]
    back = next((m for m in imgs if m["src"].endswith(f'/{p["id"]}-back.jpg')), None)
    front = next((m for m in imgs if m["src"].endswith(f'/{p["id"]}-front.jpg')), None)
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
    src = ROOT / "assets/img/products/face-card-heart-doorway.jpg"
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

RETURN_POLICY = {
    "@type": "MerchantReturnPolicy",
    "applicableCountry": "IN",
    "returnPolicyCountry": "IN",
    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
    "merchantReturnDays": 7,
    "returnMethod": "https://schema.org/ReturnByMail",
    "returnFees": "https://schema.org/FreeReturn",
}


ALT_NAMES = ["Wear Mudra", "wearmudra", "wearmudra.shop", "wear.mudra", BRAND,
             "Mudra Clothing Co.", "Mudra Clothing"]


def organization():
    org = {
        "@type": ["Organization", "OnlineStore"],
        "@id": url("/#org"),
        "name": LEGAL_NAME,
        # every name people search us by: brand, domain, Instagram handle
        "alternateName": ALT_NAMES,
        "description": "Mudra is an online-only Indian streetwear label based in Bengaluru, making oversized graphic t-shirts: "
                       "a small print on the front, the full graphic on the back. Sold only at wearmudra.shop, no physical store.",
        "url": url("/"),
        # the seal, square, 512 px
        "logo": url("/assets/favicon/icon-512.png"),
        "email": CONTACT_EMAIL,
        "founder": {"@type": "Person", "name": "Abhijeet P.", "jobTitle": "Showrunner"},
        "foundingLocation": {"@type": "Place", "name": "Bengaluru, India"},
        "knowsAbout": ["Oversized t-shirts", "Graphic t-shirts", "Streetwear", "DTF printing"],
        "address": {"@type": "PostalAddress", "addressLocality": "Bengaluru",
                    "addressRegion": "Karnataka", "addressCountry": "IN"},
        "contactPoint": {"@type": "ContactPoint", "contactType": "customer support",
                         "email": CONTACT_EMAIL, "areaServed": "IN",
                         "availableLanguage": ["en"]},
        "hasMerchantReturnPolicy": RETURN_POLICY,
        "hasShippingService": {
            "@type": "ShippingService",
            "name": "Free shipping across India",
            "shippingConditions": {
                "@type": "ShippingConditions",
                "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "IN"},
                "shippingRate": {"@type": "MonetaryAmount", "value": 0, "currency": "INR"},
            },
        },
    }
    if INSTAGRAM_URL:
        org["sameAs"] = [INSTAGRAM_URL]
    return org


def product_title(p):
    return f"{p['name']} Oversized Graphic T-Shirt"


def colours(p):
    return [c["name"] for c in p.get("colours", []) if c.get("sellable")]


def offer_ld(p, size):
    st = sale_state(p["id"])
    o = {
        "@type": "Offer",
        "url": url(f"/p/{p['id']}"),
        "priceCurrency": "INR",
        "price": f"{float(p['price']):.2f}",
        "availability": "https://schema.org/" + ("InStock" if size.get("available") else "OutOfStock"),
        "itemCondition": "https://schema.org/NewCondition",
        "seller": {"@id": url("/#org")},
        "shippingDetails": {
            "@type": "OfferShippingDetails",
            "shippingRate": {"@type": "MonetaryAmount", "value": "0", "currency": "INR"},
            "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "IN"},
            # after launch: 3–5 days to make + 4–5 days in transit = 7–10 days
            "deliveryTime": {
                "@type": "ShippingDeliveryTime",
                "handlingTime": {"@type": "QuantitativeValue", "minValue": 3, "maxValue": 5, "unitCode": "DAY"},
                "transitTime": {"@type": "QuantitativeValue", "minValue": 4, "maxValue": 5, "unitCode": "DAY"},
            },
        },
        "hasMerchantReturnPolicy": RETURN_POLICY,
    }
    if p.get("mrp") and float(p["mrp"]) > float(p["price"]):
        # the MRP shown struck through next to the price
        o["priceSpecification"] = [
            {"@type": "UnitPriceSpecification", "price": f"{float(p['price']):.2f}", "priceCurrency": "INR"},
            {"@type": "UnitPriceSpecification", "priceType": "https://schema.org/StrikethroughPrice",
             "price": f"{float(p['mrp']):.2f}", "priceCurrency": "INR"},
        ]
    if st == "open" and size.get("available"):
        # a real pre-order window, fixed ship-by date instead of 7–10 days
        o["availability"] = "https://schema.org/PreOrder"
        o["availabilityStarts"] = DROP["opens"]
        o["availabilityEnds"] = DROP["closes"]
        o["priceValidUntil"] = DROP["closes"][:10]   # the pre-order price ends with pre-orders
        o["shippingDetails"].pop("deliveryTime", None)
    elif st in ("closed", "notInDrop"):
        o["availability"] = "https://schema.org/OutOfStock"
        o["shippingDetails"].pop("deliveryTime", None)
    return o


def product_ld(p, offers):
    # ProductGroup (the design) with one Product per size; all sizes live on one page
    shots = images(p)
    page = url(f"/p/{p['id']}")
    pics = [url("/" + m["src"]) for m in shots]
    cols = colours(p)
    ld = {
        "@context": "https://schema.org",
        "@type": "ProductGroup",
        "name": product_title(p),
        "description": seo_desc(p) or blurb(p),
        "url": page,
        "image": pics,
        "brand": {"@type": "Brand", "name": BRAND},
        "category": "Apparel & Accessories > Clothing > Shirts & Tops",
        "productGroupID": p["id"],
        "variesBy": ["https://schema.org/size"],
        "audience": {"@type": "PeopleAudience", "suggestedGender": "unisex"},
        "hasVariant": [],
    }
    if cols:
        ld["color"] = "/".join(cols)
    with_offers = offers and sale_state(p["id"]) != "teaser"
    for s in p["sizes"]:
        v = {"@type": "Product", "name": f"{product_title(p)}, {s['size']}", "sku": f"{p['id']}-{s['size'].lower()}",
             "size": s["size"], "url": page, "image": pics[0] if pics else url(OG_IMAGE)}
        if cols:
            v["color"] = "/".join(cols)
        if with_offers:
            v["offers"] = offer_ld(p, s)
        ld["hasVariant"].append(v)
    return ld


def breadcrumb_ld(p):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": url("/")},
            {"@type": "ListItem", "position": 2, "name": "Oversized T-Shirts", "item": url("/#shop")},
            {"@type": "ListItem", "position": 3, "name": p["name"], "item": url(f"/p/{p['id']}")},
        ],
    }


def head_tags(title, desc, path, image, og_type="website", extra="", img_size=None, img_alt=""):
    w, h = img_size or (None, None)
    return "\n".join([
        "<!-- seo:start -->",
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc)}">',
        f'<link rel="canonical" href="{e(url(path))}">',
        f'<meta property="og:type" content="{og_type}">',
        f'<meta property="og:site_name" content="{BRAND}">',
        '<meta property="og:locale" content="en_IN">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:url" content="{e(url(path))}">',
        f'<meta property="og:image" content="{e(url(image))}">',
        f'<meta property="og:image:width" content="{w}">' if w else "",
        f'<meta property="og:image:height" content="{h}">' if h else "",
        f'<meta property="og:image:alt" content="{e(img_alt)}">' if img_alt else "",
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{e(title)}">',
        f'<meta name="twitter:description" content="{e(desc)}">',
        f'<meta name="twitter:image" content="{e(url(image))}">',
        f'<meta name="twitter:image:alt" content="{e(img_alt)}">' if img_alt else "",
        extra,
        "<!-- seo:end -->",
    ]).replace("\n\n", "\n").replace("\n\n", "\n")


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
    now = p.get('regularPrice', p['price']) if DROP and datetime.datetime.now(IST) > datetime.datetime.fromisoformat(DROP['closes']) else p['price']
    mrp = p.get("mrp")
    pre = sale_state(p["id"]) in ("open", "teaser")
    reg = p.get("regularPrice")
    return {"now": now, "mrp": mrp if mrp and mrp > now else None,
            "regular": reg if pre and reg and reg > now else None, "pre": pre}


def card_price(p):
    # mirrors cardPrice() in assets/js/main.js
    v = price_view(p)
    if deposit_window():
        return f'<div class="pprice"><span class="pprice__now is-pre">{money(v["now"])}</span><span class="deposit-tag">Pre-order at {money(deposit_for(p["id"]))} today!</span></div>'
    return ('<div class="pprice">'
            + (f'<s class="pprice__mrp"><span class="sr">MRP </span>{money(v["mrp"])}</s>' if v["mrp"] else "")
            + f'<span class="pprice__now">{money(v["now"])}</span>'
            + ('<span class="pprice__po mono">Pre-order</span>' if v["pre"] else "")
            + "</div>")


def buy_price(p):
    # mirrors priceHTML() in assets/js/product.js
    v, d = price_view(p), drop_dates()
    if deposit_window():
        deposit = deposit_for(p['id'])
        return (f'<div class="buy__price" id="priceBlock"><p class="mono buy__label">Product price</p>'
                f'<div class="buy__pricerow"><span class="price is-pre" id="price"><span class="price__num">{money(v["now"])}</span></span><span class="deposit-tag">Pre-order at {money(deposit)} today!</span></div>'
                f'<p class="mono buy__tax">Inclusive of all taxes · Free shipping</p>'
                f'<aside class="pricenote" role="note"><p class="pricenote__text">Pay {money(deposit)} now to pre-order this tee. Balance {money(v["now"] - deposit)} when orders open on {e(d["launch_short"])}. Free shipping. Refundable before dispatch.</p></aside></div>')
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
    if deposit_window():
        return f"Orders open {drop_dates()['launch_short']}", f'<a class="atc" href="{href}">Pre-order @ {money(deposit_for(p["id"]))}</a>'
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


# colour swatches on the home cards (off for now; main.js has CARD_SWATCHES too)
CARD_SWATCHES = False


def card_html(p):
    # mirrors cardHTML() in assets/js/main.js; main.js re-renders over it
    href = f"/p/{p['id']}"
    avail = [s["size"] for s in p["sizes"] if s.get("available")]
    stock = ["in" if avail else "out"] + (["low"] if (p.get("badge") or {}).get("type") == "low" else [])
    badge = (f'<span class="pbadge {p["badge"]["type"]}">{e(p["badge"]["label"])}</span>'
             if p.get("badge") else "")
    imgs = images(p)
    slides = "".join(
        picture(m, cls="slide" + (" is-on" if i == 0 else ""), loading="eager" if i == 0 else "lazy",
                sizes=CARD_SIZES)
        for i, m in enumerate(imgs))
    dots = "".join('<i class="is-on"></i>' if i == 0 else "<i></i>" for i in range(len(imgs)))
    # colour swatches on the cards are off for now (main.js CARD_SWATCHES too)
    sw = [c for c in p.get("colours", []) if c.get("sellable")] if CARD_SWATCHES else []
    swatches = "".join(
        f'<button class="pswatch{" on" if i == 0 else ""}" data-colour="{c["key"]}" '
        f'style="--sw:{c["hex"]}" title="{e(c["name"])}" aria-label="{e(c["name"])}"></button>'
        for i, c in enumerate(sw))
    tag, atc = card_cta(p, href, bool(avail))
    return (f'<article class="pcard" data-id="{p["id"]}" data-media-order="{p.get("mediaOrder", "random")}" data-series="{p["series"]}" '
            f'data-colour="{e(p["colour"])}" data-print="{p["print"]}" data-stock="{" ".join(stock)}" '
            f'data-sizes="{" ".join(avail)}" data-price="{p["price"]}" data-name="{e(p["name"])}" data-url="{href}">'
            f'<div class="pcard__media" tabindex="0" aria-label="{e(p["name"])}, view product">{badge}'
            f'<div class="slides">{slides}</div>'
            '<button class="navbtn prev" aria-label="Previous image">&#8249;</button>'
            '<button class="navbtn next" aria-label="Next image">&#8250;</button>'
            f'<div class="dots">{dots}</div></div>'
            f'<div class="pcard__info">'
            f'<h3><a href="{href}">{e(p["name"])}</a></h3>'
            + card_price(p)
            + (f'<div class="ptag mono pcard__po">{tag}</div>' if tag else "")
            + (f'<div class="pswatches">{swatches}</div>' if swatches else "")
            + f'{atc}</div></article>')


def home_desc():
    return HOME_DESC


def product_desc(p):
    # data/products.json "seo.description" when written; the generated line otherwise
    if seo_desc(p):
        return seo_desc(p)
    st, d = sale_state(p["id"]), drop_dates()
    lead = f"{blurb(p)} {money(p['price'])}."
    if st == "teaser":
        return f"{lead} Pre-orders open {d['opens_short']}, ship by {d['ships_short']}. Free shipping across India."
    if st == "open":
        return f"{lead} Pre-order until {d['closes_short']}, ships by {d['ships_short']}. Free shipping across India."
    if st == "closed":
        return f"{lead} Pre-orders are printing now and ship by {d['ships_short']}. Free shipping across India."
    if st == "notInDrop":
        return f"{lead} Back after launch. Free shipping across India."
    promise = f"Pre-order, arrives in {DAYS}. " if preorder() else ""
    return f"{lead} {promise}Free shipping across India, cash on delivery."


def build_home(products):
    f = ROOT / "index.html"
    s = f.read_text(encoding="utf-8")
    graph = {"@context": "https://schema.org", "@graph": [
        organization(),
        {"@type": "WebSite", "@id": url("/#site"), "name": BRAND, "alternateName": ALT_NAMES, "url": url("/"),
         "inLanguage": "en-IN", "publisher": {"@id": url("/#org")}},
        {"@type": "ItemList", "name": "Oversized graphic t-shirts", "numberOfItems": len(products),
         "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": url(f"/p/{p['id']}"),
                              "name": product_title(p)} for i, p in enumerate(products)]},
    ]}
    # The campaign image is the first big paint on the home page.
    preload = '<link rel="preload" as="image" href="/assets/img/campaigns/mudra-people-hero-v2.webp" type="image/webp" fetchpriority="high">'
    s = put_head(s, head_tags(HOME_TITLE, home_desc(), "/", OG_IMAGE, extra=preload + "\n" + jsonld(graph),
                              img_size=OG_SIZE, img_alt=OG_ALT))
    # ticker + hero tag for the phase at build time (main.js re-renders them live)
    row = "".join(f"<span>{e(t)}</span>" for t in ticker_items())
    s = re.sub(r'(<div class="ticker__track">\n).*?(\n  </div>)',
               lambda m: m.group(1) + "    " + row + "\n    " + row + m.group(2), s, count=1, flags=re.S)
    s = re.sub(r'(<div class="mono hero__tag">).*?(</div>)', lambda m: m.group(1) + e(hero_tag()) + m.group(2), s, count=1)
    grid = "<!-- grid:start -->" + "".join(card_html(p) for p in products) + "<!-- grid:end -->"
    if "<!-- grid:start -->" in s:
        s = re.sub(r"<!-- grid:start -->.*?<!-- grid:end -->", lambda _: grid, s, flags=re.S)
    else:
        s = s.replace('<div class="pgrid" id="pgrid"></div>', f'<div class="pgrid" id="pgrid">{grid}</div>', 1)
    n = len(products)                      # counts shown before main.js runs
    s = re.sub(r'(<span class="mono" id="count">).*?(</span>)', lambda m: f"{m.group(1)}{n} {'piece' if n == 1 else 'pieces'}{m.group(2)}", s, count=1)
    s = re.sub(r'(<span class="mono" id="showing">).*?(</span>)', lambda m: f"{m.group(1)}Showing all{m.group(2)}", s, count=1)
    s = s.replace('<html lang="en">', '<html lang="en-IN">', 1)
    f.write_text(s, encoding="utf-8")


# ── product pages ─────────────────────────────────────────────────────────

def delivery_line(p):
    # the same facts the page's pre-order box shows
    st, d = drop_phase(), drop_dates()
    if d and st == "open":
        if deposit_window():
            return f"Pre-order @ {money(deposit_for(p['id']))} deposit per tee. Orders open {d['launch_short']}. Pre-ordered tees ship by {d['ships_long']}."
        return f"Pre-order: pre-orders close {d['closes_short']}, ships by {d['ships_long']}"
    if d and st == "closed":
        return f"Printing now, ships by {d['ships_long']}"
    if d and st == "teaser":
        return f"Pre-orders open {d['opens_short']}, ship by {d['ships_long']}"
    return f"At your door in {DAYS}"


def pinfo_html(p):
    # "About this design" (Marketing's blurb, only when written) + facts already in the data
    sizes = [s["size"] for s in p["sizes"]]
    size_txt = f"{sizes[0]} to {sizes[-1]}" if len(sizes) > 1 else sizes[0]
    items = [
        "Oversized fit with a drop shoulder",
        ("Small print on the chest, the full graphic on the back" if p["print"] == "back"
         else "Chest print only"),
        f'Sizes {size_txt}. <a href="/size-guide">Size guide</a>',
    ]
    if colours(p):
        items.append("Colour: " + e(", ".join(colours(p))))
    items += [e(delivery_line(p)), "Free shipping across India",
              'Returns: <a href="/returns">how returns work</a>']
    about = (f'<div class="pinfo__col"><h2 class="pinfo__h">About this design</h2>'
             f'<p class="pinfo__p">{e(p["blurb"])}</p></div>' if (p.get("blurb") or "").strip() else "")
    return (about + '<div class="pinfo__col"><h2 class="pinfo__h">Details</h2><ul class="pinfo__list">'
            + "".join(f"<li>{i}</li>" for i in items) + "</ul></div>")


def related_picks(p, products, n=4):
    # mirrors renderRelated() in assets/js/product.js
    same = [x for x in products if x["id"] != p["id"] and x["series"] == p["series"]]
    rest = [x for x in products if x["id"] != p["id"] and x["series"] != p["series"]]
    return (same + rest)[:n]


def related_html(p, products):
    out = []
    for x in related_picks(p, products):
        img = next(iter(images(x)), None)
        out.append(f'<a class="rcard" href="/p/{x["id"]}"><div class="rcard__img">'
                   + (picture(img, sizes=RELATED_SIZES) if img else "")
                   + f'</div><div class="rcard__meta"><h3>{e(x["name"])}</h3>'
                   f'<span class="pprice">{("Pre-order @ " + money(deposit_for(x["id"]))) if deposit_window() else money(x["price"])}</span></div></a>')
    return "".join(out)


def build_products(products, offers):
    template = (ROOT / "product.html").read_text(encoding="utf-8")
    template = template.replace('<meta name="robots" content="noindex">\n', "")
    outdir = ROOT / "p"
    outdir.mkdir(exist_ok=True)
    keep = set()
    for p in products:
        shots = gallery_shots(p)
        title = f"{product_title(p)} · {BRAND}"
        desc = product_desc(p)
        first = shots[0] if shots else None
        preload = (f'<link rel="preload" as="image" type="image/webp" imagesrcset="{webp_set(first)}" '
                   f'imagesizes="{GALLERY_SIZES}" fetchpriority="high">' if first and first.get("webp") else "")
        extra = preload + "\n" + jsonld(product_ld(p, offers)) + "\n" + jsonld(breadcrumb_ld(p))
        s = put_head(template, head_tags(title, desc, f"/p/{p['id']}",
                                         "/" + first["src"] if first else OG_IMAGE,
                                         og_type="product", extra=extra,
                                         img_size=(first.get("w"), first.get("h")) if first else OG_SIZE,
                                         img_alt=first["alt"] if first else OG_ALT))
        if offers and sale_state(p["id"]) != "teaser":
            s = s.replace("<!-- seo:end -->",
                          f'<meta property="product:price:amount" content="{float(p["price"]):.2f}">\n'
                          '<meta property="product:price:currency" content="INR">\n<!-- seo:end -->', 1)
        s = s.replace('<html lang="en">', '<html lang="en-IN">', 1)
        # breadcrumb ends with the name in the HTML itself (product.js leaves it alone)
        s = s.replace('<a href="/#shop">Oversized T-Shirts</a>\n',
                      f'<a href="/#shop">Oversized T-Shirts</a> <span>/</span> <strong>{e(p["name"])}</strong>\n', 1)
        gallery = "".join(
            f'<button class="gshot" data-i="{i}" aria-label="Enlarge image {i + 1} of {len(shots)}">'
            + picture(m, loading="eager" if i < 2 else "lazy", sizes=GALLERY_SIZES, extra=HIGH if i == 0 else "")
            + '</button>'
            for i, m in enumerate(shots))
        s = re.sub(r'(<div class="gallery__track" id="track">).*?(</div>\n)',
                   lambda m: m.group(1) + gallery + m.group(2), s, count=1, flags=re.S)
        buy = (f'<h1 class="buy__name">{e(p["name"])}</h1>'
               + buy_price(p)
               + f'<p class="buy__blurb">{e(blurb(p))}</p>')
        s = s.replace('<aside class="buy" id="buy" aria-live="polite"></aside>',
                      f'<aside class="buy" id="buy" aria-live="polite">{buy}</aside>', 1)
        s = s.replace('<section class="wrap pinfo" id="pinfo" hidden></section>',
                      f'<section class="wrap pinfo" id="pinfo" aria-label="About this t-shirt">{pinfo_html(p)}</section>', 1)
        s = s.replace('<section class="wrap related" id="related" hidden>',
                      '<section class="wrap related" id="related">', 1)
        s = s.replace('<div class="rgrid" id="rgrid"></div>',
                      f'<div class="rgrid" id="rgrid">{related_html(p, products)}</div>', 1)
        out = outdir / f"{p['id']}.html"
        out.write_text(s, encoding="utf-8")
        keep.add(out.name)
    for old in outdir.glob("*.html"):          # products removed from the catalogue
        if old.name not in keep:
            old.unlink()


# ── sitemap + robots ──────────────────────────────────────────────────────

STATE = ROOT / "data/sitemap-state.json"     # build-only (.vercelignore): page hash -> lastmod


def page_file(path):
    return ROOT / ("index.html" if path == "/" else f"{path.lstrip('/')}.html")


def page_hash(path):
    # the page as a reader sees it: asset ?v= hashes don't count as a change
    s = page_file(path).read_text(encoding="utf-8")
    s = re.sub(r"\?v=[0-9a-f]+", "", s)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def build_sitemap(products):
    rows = [("/", "1.0")] + [(f"/p/{p['id']}", "0.8") for p in products] + \
           [(f"/{s}", "0.4") for s in SITEMAP_PAGES if (ROOT / f"{s}.html").exists()]
    pics = {f"/p/{p['id']}": images(p) for p in products}
    pics["/"] = [m for p in products for m in images(p)[:1]]
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    new_state, body = {}, []
    for path, pr in rows:
        h = page_hash(path)
        old = state.get(path, {})
        lastmod = old["lastmod"] if old.get("hash") == h else TODAY
        new_state[path] = {"hash": h, "lastmod": lastmod}
        imgs = "".join(f"<image:image><image:loc>{e(url('/' + m['src']))}</image:loc></image:image>"
                       for m in pics.get(path, []))
        body.append(f"<url><loc>{e(url(path))}</loc><lastmod>{lastmod}</lastmod>"
                    f"<priority>{pr}</priority>{imgs}</url>")
    STATE.write_text(json.dumps(new_state, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + "".join(body) + "</urlset>\n",
        encoding="utf-8")
    (ROOT / "robots.txt").write_text(
        "User-agent: *\nAllow: /\nAllow: /assets/\nDisallow: /cart\nDisallow: /product$\nDisallow: /product.html\n\n"
        f"Sitemap: {url('/sitemap.xml')}\n", encoding="utf-8")


# ── Google Merchant Center feed (free listings) ───────────────────────────

FEED = ROOT / "feeds/google-merchant.xml"


def build_feed(products):
    st_all, d = drop_phase(), drop_dates()
    x = lambda s: html.escape(str(s), quote=False)
    items = []
    for p in products:
        st = sale_state(p["id"])
        pics = [url("/" + m["src"]) for m in images(p)]
        cols = colours(p)
        price, mrp = float(p["price"]), float(p.get("mrp") or 0)
        for s in p["sizes"]:
            if st == "open" and s.get("available"):
                avail = "<g:availability>preorder</g:availability>" \
                        f"<g:availability_date>{DROP['shipsBy']}T00:00:00+05:30</g:availability_date>"
            elif st in ("closed", "notInDrop", "teaser") or not s.get("available"):
                avail = "<g:availability>out_of_stock</g:availability>"
            else:
                avail = "<g:availability>in_stock</g:availability>"
            if mrp > price:
                money_tags = f"<g:price>{mrp:.2f} INR</g:price><g:sale_price>{price:.2f} INR</g:sale_price>"
                if st == "open":
                    money_tags += f"<g:sale_price_effective_date>{DROP['opens']}/{DROP['closes']}</g:sale_price_effective_date>"
            else:
                money_tags = f"<g:price>{price:.2f} INR</g:price>"
            items.append(
                "<item>"
                f"<g:id>{x(p['id'])}-{x(s['size'].lower())}</g:id>"
                f"<g:item_group_id>{x(p['id'])}</g:item_group_id>"
                f"<title>{x(product_title(p))}</title>"
                f"<description>{x(product_desc(p))}</description>"
                f"<link>{x(url('/p/' + p['id']))}</link>"
                + (f"<g:image_link>{x(pics[0])}</g:image_link>" if pics else "")
                + "".join(f"<g:additional_image_link>{x(u)}</g:additional_image_link>" for u in pics[1:11])
                + avail + money_tags
                + f"<g:brand>{x(BRAND)}</g:brand><g:condition>new</g:condition>"
                "<g:google_product_category>212</g:google_product_category>"
                "<g:identifier_exists>no</g:identifier_exists>"
                f"<g:gender>{x(FEED_GENDER)}</g:gender><g:age_group>{x(FEED_AGE_GROUP)}</g:age_group>"
                + (f"<g:color>{x('/'.join(cols))}</g:color>" if cols else "")
                + f"<g:size>{x(s['size'])}</g:size><g:size_system>IN</g:size_system>"
                "<g:shipping><g:country>IN</g:country><g:price>0.00 INR</g:price></g:shipping>"
                "</item>")
    FEED.parent.mkdir(exist_ok=True)
    FEED.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>'
        f"<title>{x(BRAND)}</title><link>{x(url('/'))}</link>"
        "<description>Oversized graphic t-shirts, designed in India.</description>"
        + "".join(items) + "</channel></rss>\n", encoding="utf-8")
    return len(items)


# ── redirects for archived tees (vercel.json) ─────────────────────────────

def build_redirects(archived):
    # temporary (302): an archived tee may come back. Rewritten on every build.
    f = ROOT / "vercel.json"
    cfg = json.loads(f.read_text(encoding="utf-8"))
    keep = [r for r in cfg.get("redirects", []) if not r.get("source", "").startswith("/p/")]
    cfg["redirects"] = keep + [{"source": f"/p/{p['id']}", "destination": "/", "statusCode": 302}
                               for p in archived]
    f.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")


def build_llms(products):
    """/llms.txt: a plain summary for AI assistants and answer engines. Facts only, from the same data as the pages."""
    host = SITE_URL.split("//", 1)[1]
    lines = [f"# {BRAND} ({LEGAL_NAME})", "",
             f"> {BRAND} is an online-only Indian streetwear label based in Bengaluru, making oversized graphic t-shirts: a small print on the "
             f"front, the full graphic on the back. No physical store. Shop: {host}. Instagram: {INSTAGRAM_HANDLE}.", "",
             f"Also known as: {', '.join(ALT_NAMES)}.",
             f"Contact: {CONTACT_EMAIL}. Free shipping across India.", "",
             "## T-shirts", ""]
    for p in products:
        lines.append(f"- [{product_title(p)}]({url('/p/' + p['id'])}): {blurb(p)} {money(p['price'])}.")
    lines += ["", "## Help", "",
              f"- [Size guide]({url('/size-guide')})", f"- [Shipping]({url('/shipping')})",
              f"- [Returns]({url('/returns')})", f"- [Track an order]({url('/track')})",
              f"- [Our story]({url('/about')})", f"- [Contact]({url('/contact')})", ""]
    (ROOT / "llms.txt").write_text("\n".join(lines), encoding="utf-8")


def build():
    build_images.build()                       # WebP sizes, recorded in products.json
    data = json.loads((ROOT / "data/products.json").read_text(encoding="utf-8"))
    products = data["products"]
    if DROP and datetime.datetime.now(IST) > datetime.datetime.fromisoformat(DROP['closes']):
        products = [dict(p, price=p.get('regularPrice', p['price'])) for p in products]
    check_prices(products)
    offers = offers_live()
    # the one public setting product.js needs from site_config (Instagram link)
    (ROOT / "data/site.json").write_text(json.dumps({"instagram": INSTAGRAM_URL}) + "\n", encoding="utf-8")
    make_og_image()
    make_hero_poster()
    build_home(products)
    build_products(products, offers)
    build_sitemap(products)
    n = build_feed(products) if offers else 0
    build_redirects(data.get("archived", []))
    build_llms(products)
    print(f"seo: home, {len(products)} product pages, sitemap, robots, feed ({n} items), "
          f"{len(data.get('archived', []))} archive redirects "
          f"(offers {'on' if offers else 'off'}, drop phase {drop_phase()}, site {SITE_URL})")


if __name__ == "__main__":
    build()
