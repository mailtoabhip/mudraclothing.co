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
    layout       doc (numbered sections + contents rail) | plain
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
from site_config import SITE_URL, OG_IMAGE

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "_src" / "pages"

ACCOUNT = "https://shopify.com/73593618511/account"

NAV = [("/#shop", "Shop all"), ("/size-guide", "Size guide"), ("/about", "About"), (ACCOUNT, "Account")]

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
        <p>Oversized tees, designed in-house and printed to order in India.</p>
      </div>
{cols}
    </div>
    <div class="fbot">
      <span>© 2026 Mudra Studios</span>
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
    return FOOTER.format(cols="\n".join(cols))


SHELL = """<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title_tag}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mudra Studios">
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
<link href="https://fonts.googleapis.com/css2?family=Saira+Stencil+One&family=Saira:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/styles.css?v=0">
<link rel="stylesheet" href="/assets/css/pages.css?v=0">
</head>
<body class="is-page page-{slug}">

<header class="scrolled solid">
  <div class="wrap bar">
    <a class="brand" href="/">
      <svg class="logo" viewBox="0 0 2906 825" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Mudra Studios"><use href="#logo"/></svg>
    </a>
    <nav class="mainnav">{nav}</nav>
    <a class="cart" href="/cart">Bag (0)</a>
  </div>
</header>

<main>
  <section class="pblock pblock--{accent}">
    <div class="wrap pblock__inner">
      <div class="pblock__meta mono"><span>{kicker}</span>{updated}</div>
      <h1 class="pblock__title">{title}</h1>
    </div>
  </section>

{body}
</main>

{footer}

<script src="/assets/js/shop.js?v=0" defer></script>
<script src="/assets/js/pages.js?v=0" defer></script>
</body>
</html>
"""


def parse(path):
    raw = path.read_text(encoding="utf-8")
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
    nav = "".join(f'<a href="{h}">{t}</a>' for h, t in NAV)
    footer = footer_html()
    built = []
    for path in sorted(SRC.glob("*.html")):
        meta, content = parse(path)
        slug = path.stem
        body = doc_body(meta, content) if meta.get("layout", "doc") == "doc" else content.rstrip()
        updated = f'<span>Updated {meta["updated"]}</span>' if meta.get("updated") else ""
        title = meta["title"]
        page = SHELL.format(
            title_tag=html.escape(f"{meta.get('pagetitle') or html.unescape(re.sub(r'<[^>]+>', ' ', title)).strip()} · Mudra Studios".replace("  ", " "), quote=True),
            description=html.escape(meta.get("description", ""), quote=True),
            robots='<meta name="robots" content="noindex">\n' if slug == "404" else "",
            slug=slug, nav=nav, accent=meta.get("accent", "blue"),
            kicker=meta.get("kicker", ""), updated=updated, title=title,
            body=body, footer=footer,
            canonical=SITE_URL.rstrip("/") + ("/" if slug == "404" else f"/{slug}"),
            og_image=SITE_URL.rstrip("/") + OG_IMAGE,
        )
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
