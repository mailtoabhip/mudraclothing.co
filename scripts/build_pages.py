#!/usr/bin/env python3
"""Build the static content pages from _src/pages/*.html.

    python3 scripts/build_pages.py && python3 scripts/fingerprint.py

Each source file starts with a comment block of `key: value` lines:
    title        page <h1> (and <title>, unless pagetitle is set)
    pagetitle    optional plain <title> text
    kicker       small mono label above the title
    accent       blue | ink | lime | magenta  (the colour block)
    description  meta description
    summary      optional "short version" box (HTML allowed)
    layout       doc (numbered sections + contents rail) | plain | bare
                 (bare: no colour-block title; the page brings its own <h1>)
    css / js     optional extra asset name, e.g. `css: story` → /assets/css/story.css
    fonts        optional extra Google Fonts family, e.g. `fonts: Anek+Devanagari:wght@600`
    ticker       `ticker: yes` puts the blue ticker bar above the header
    updated      optional "last updated" date
    out          optional output filename (default: <slug>.html)

In `doc` layout every <h2> becomes a numbered, linkable section.
Wrap anything not yet confirmed in <span class="tbd">…</span>: open any page
with ?review=1 to see every placeholder highlighted.

The shared footer is also written into index.html and product.html between
<!-- footer:start --> and <!-- footer:end -->.
"""
import html, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from site_config import SITE_URL, OG_IMAGE, BRAND, LEGAL_NAME, CONTACT_EMAIL, MAILBOX_LIVE, INSTAGRAM_URL, INSTAGRAM_HANDLE

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "_src" / "pages"

ACCOUNT = "https://shopify.com/73593618511/account"

# header nav: the "Shop for" dropdown (same markup as index/product/cart.html), then plain links
SHOP_FOR = ('<div class="shopfor"><button type="button" class="shopfor__btn" id="shopforBtn" aria-haspopup="true" aria-expanded="false" aria-controls="shopforMenu">Shop for<i class="shopfor__chev" aria-hidden="true"></i></button><div class="shopfor__pop" id="shopforMenu"><div class="shopfor__panel"><a class="shopfor__item shopfor__item--go" href="/#shop">Oversized t-shirts</a><span class="shopfor__item shopfor__item--soon" aria-disabled="true">T-shirts<em class="shopfor__badge">Coming soon</em></span></div></div></div>')
NAV = [("/size-guide", "Size guide"), ("/about", "About")]

FOOTER_COLS = [
    ("Shop", [("/#shop", "All tees"), ("/size-guide", "Size guide"), ("/track", "Track order"), (ACCOUNT, "Account")]),
    ("Help", [("/shipping", "Shipping"), ("/returns", "Returns &amp; refunds"), ("/payment-help", "Payment help"), ("/contact", "Contact")]),
    ("Company", [("/about", "About"), ("/terms", "Terms"), ("/privacy", "Privacy")]),
]

FOOTER = """<!-- footer:start -->
<footer>
  <div class="wrap">
    <div class="fgrid">
      <div class="fbrand">
        <svg class="seal" viewBox="0 0 825 825" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><use href="#seal"/></svg>
        <p>Oversized tees, designed in-house and made in India.</p>
        <p class="fcontact"><a href="mailto:{{{{email}}}}">{{{{email}}}}</a><br><a href="{{{{instagram_url}}}}" target="_blank" rel="noopener">{{{{instagram}}}}</a></p>
      </div>
{cols}
    </div>
    <div class="fbot">
      <span>© 2026 {{{{legal_name}}}}</span>
      <span>The rest is between you and your mirror.</span>
    </div>
  </div>
</footer>
<!-- footer:end -->"""


def footer_html():
    cols = []
    for head, links in FOOTER_COLS:
        lis = "".join(f'<li><a href="{h}">{t}</a></li>' for h, t in links)
        cols.append(f"      <div>\n        <h4>{head}</h4>\n        <ul>{lis}</ul>\n      </div>")
    return site_tokens(FOOTER.format(cols="\n".join(cols)))


PBLOCK = """  <section class="pblock pblock--{accent}">
    <div class="wrap pblock__inner">
      <div class="pblock__meta mono"><span>{kicker}</span>{updated}</div>
      <h1 class="pblock__title">{title}</h1>
    </div>
  </section>

"""

# static copy of the ticker; the page's script swaps in the live drop lines
TICKER = """<div class="ticker">
  <div class="ticker__track" id="ticker">
    <span>Designed in-house</span><span>✳</span><span>Free shipping across India</span><span>✳</span>
    <span>Designed in-house</span><span>✳</span><span>Free shipping across India</span><span>✳</span>
  </div>
</div>
"""

SHELL = """<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title_tag}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mudra">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="{title_tag}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{og_image}">
<meta name="twitter:card" content="summary_large_image">
{robots}<link rel="icon" href="/assets/favicon/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/icon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#EDE9E0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Saira+Stencil+One&family=Saira:wght@400;500;600&family=Space+Mono:wght@400;700{fonts}&display=swap" onload="this.onload=null;this.rel=\'stylesheet\'"><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Stencil+One&family=Saira:wght@400;500;600&family=Space+Mono:wght@400;700{fonts}&display=swap"></noscript>
<link rel="stylesheet" href="/assets/css/styles.css?v=0">
<link rel="stylesheet" href="/assets/css/pages.css?v=0">
{css}</head>
<body class="is-page page-{slug}">
{ticker}
<header class="scrolled solid">
  <div class="wrap bar">
    <a class="brand" href="/">
      <svg class="logo" viewBox="0 0 2906 825" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Mudra"><use href="#logo"/></svg>
    </a>
    <nav class="mainnav">{nav}</nav>
    <div class="hacts"><a class="cart" href="/cart">Bag (0)</a><a class="acct" href="{account}" aria-label="Your account: orders and profile" title="Account"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></a></div>
  </div>
</header>

<main>
{pblock}{body}
</main>

{footer}

<script src="/assets/js/shop.js?v=0" defer></script>
<script src="/assets/js/pages.js?v=0" defer></script>
{js}</body>
</html>
"""


def drop_tokens(text):
    """Fill {{drop_name}}, {{drop_opens}}, {{drop_closes}}, {{drop_ships}}, {{drop_ships_long}}
    from data/drop.json, so policy pages quote the same dates as the shop."""
    if "{{drop_" not in text:
        return text
    from build_seo import drop_dates
    d = drop_dates()
    vals = {"drop_name": d["name"], "drop_opens": d["opens_short"], "drop_closes": d["closes_short"],
            "drop_ships": d["ships_short"], "drop_ships_long": d["ships_long"], "drop_launch": d["launch_short"]}
    out = re.sub(r"\{\{(drop_\w+)\}\}", lambda m: vals[m.group(1)], text)
    return out


def size_chart_html():
    """Static copy of sizeTableHTML() in assets/js/shop.js, from data/products.json."""
    import json
    g = json.loads((ROOT / "data/products.json").read_text(encoding="utf-8")).get("garment", {})
    c = g.get("sizeChart")
    if not c or not c.get("rows"):
        return ('<div class="sg__pending"><p>We\'re measuring the samples ourselves before we publish numbers. '
                'Guessing isn\'t a size guide.</p></div>')
    fmt = lambda v: str(int(v)) if float(v).is_integer() else f"{v:.1f}"
    head = "".join(f'<th scope="col"><span class="sct__mk">{html.escape(col["mark"])}</span>{html.escape(col["label"])}'
                   + (f'<small>{html.escape(col["sub"])}</small>' if col.get("sub") else "") + "</th>" for col in c["columns"])
    rows = "".join(f'<tr><th scope="row">{html.escape(r["size"])}</th>'
                   + "".join(f'<td data-in="{v}">{fmt(v)}</td>' for v in r["values"]) + "</tr>" for r in c["rows"])
    return f"""<div class="sct" data-unit="in">
        <div class="sct__bar">
          <span class="mono">Garment measurements · <span data-unit-label>inches</span></span>
          <div class="sct__units mono" role="group" aria-label="Units"><button type="button" data-unit-btn="in" aria-pressed="true">in</button><button type="button" data-unit-btn="cm" aria-pressed="false">cm</button></div>
        </div>
        <div class="sct__scroll"><table class="sct__t"><thead><tr><th scope="col">Size</th>{head}</tr></thead><tbody>{rows}</tbody></table></div>
        <p class="sct__note">Chest is measured all the way round. To compare with a tee you own, lay it flat, measure armpit to armpit and double it. Supplier measurements, ±1 in. We re-check them on our own samples.</p>
      </div>"""


SITE_TOKENS = {"email": CONTACT_EMAIL, "legal_name": LEGAL_NAME, "brand": BRAND,
               "instagram": INSTAGRAM_HANDLE, "instagram_url": INSTAGRAM_URL}


def site_tokens(text):
    """Fill {{email}}, {{legal_name}}, {{brand}}, {{instagram}}, {{instagram_url}} from
    site_config.py. Until the mailbox is live, the visible address is marked .tbd."""
    if "{{size_chart}}" in text:
        text = text.replace("{{size_chart}}", size_chart_html())
    out = re.sub(r"\{\{(email|legal_name|brand|instagram|instagram_url)\}\}", lambda m: SITE_TOKENS[m.group(1)], text)
    assert "{{" not in out, "unknown {{token}} in a page source"
    if not MAILBOX_LIVE:
        out = re.sub(r'(?<!class="tbd")>' + re.escape(CONTACT_EMAIL) + '<', f'><span class="tbd">{CONTACT_EMAIL}</span><', out)
    return out


def parse(path):
    raw = drop_tokens(path.read_text(encoding="utf-8"))
    m = re.match(r"\s*<!--(.*?)-->\s*", raw, re.S)
    meta = {}
    for line in m.group(1).strip().splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    return meta, raw[m.end():]


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).lower().replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def doc_body(meta, content):
    toc = []
    n = 0

    def number(m):
        nonlocal n
        n += 1
        text = m.group(1)
        sid = slugify(text)
        toc.append((sid, text, n))
        return (f'<h2 id="{sid}"><span class="h2n mono">{n:02d}</span>'
                f'<span class="h2t">{text}</span></h2>')

    content = re.sub(r"<h2>(.*?)</h2>", number, content)
    summary = meta.get("summary")
    summary_html = (f'<div class="tldr"><span class="mono">The short version</span>'
                    f'<p>{summary}</p></div>') if summary else ""
    toc_html = "".join(f'<li><a href="#{sid}"><span class="mono">{i:02d}</span>{t}</a></li>'
                       for sid, t, i in toc)
    return f"""  <div class="wrap doc">
    <aside class="doc__rail">
      <span class="mono doc__raillabel">On this page</span>
      <ol class="toc">{toc_html}</ol>
    </aside>
    <article class="doc__body">
      {summary_html}
      {content.strip()}
    </article>
  </div>"""


def build():
    nav = SHOP_FOR + "".join(f'<a href="{h}">{t}</a>' for h, t in NAV)
    footer = footer_html()
    built = []
    for path in sorted(SRC.glob("*.html")):
        meta, content = parse(path)
        slug = path.stem
        body = doc_body(meta, content) if meta.get("layout", "doc") == "doc" else content.rstrip()
        bare = meta.get("layout") == "bare"
        updated = f'<span>Updated {meta["updated"]}</span>' if meta.get("updated") else ""
        title = meta["title"]
        page = SHELL.format(
            title_tag=html.escape(f"{meta.get('pagetitle') or html.unescape(re.sub(r'<[^>]+>', ' ', title)).strip()} · {BRAND}".replace("  ", " "), quote=True),
            description=html.escape(meta.get("description", ""), quote=True),
            robots='<meta name="robots" content="noindex">\n' if slug in ("404", "pre-orders") else "",
            slug=slug, nav=nav, body=body, footer=footer, account=ACCOUNT,
            pblock="" if bare else PBLOCK.format(accent=meta.get("accent", "blue"),
                                                 kicker=meta.get("kicker", ""), updated=updated, title=title),
            fonts=f"&family={meta['fonts']}" if meta.get("fonts") else "",
            css=f'<link rel="stylesheet" href="/assets/css/{meta["css"]}.css?v=0">\n' if meta.get("css") else "",
            js=f'<script src="/assets/js/{meta["js"]}.js?v=0" defer></script>\n' if meta.get("js") else "",
            ticker=TICKER if meta.get("ticker") else "",
            canonical=SITE_URL.rstrip("/") + ("/" if slug == "404" else f"/{slug}"),
            og_image=SITE_URL.rstrip("/") + OG_IMAGE,
        )
        page = site_tokens(page)
        out = ROOT / meta.get("out", f"{slug}.html")
        # keep existing ?v= hashes stable; fingerprint.py rewrites them
        if out.exists():
            old = out.read_text(encoding="utf-8")
            for m in re.finditer(r'(/assets/[^"?]+)\?v=([0-9a-f]+)', old):
                page = page.replace(f"{m.group(1)}?v=0", f"{m.group(1)}?v={m.group(2)}")
        out.write_text(page, encoding="utf-8")
        built.append(out.name)

    for name in ("index.html", "product.html", "cart.html"):
        f = ROOT / name
        s = f.read_text(encoding="utf-8")
        s2 = re.sub(r"<!-- footer:start -->.*?<!-- footer:end -->", lambda _: footer, s, flags=re.S)
        if s2 != s:
            f.write_text(s2, encoding="utf-8")

    print("built:", ", ".join(built))


if __name__ == "__main__":
    build()
    import build_seo
    build_seo.build()
