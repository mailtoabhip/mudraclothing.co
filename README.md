# Mudra Studios

Static storefront. Design and browsing live here; cart, checkout, inventory and
orders live in Shopify via the Buy Button SDK.

## Structure

```
index.html              page shell — hero, filters, spec band, footer
product.html            product page template (one page renders every product)
about.html, contact.html, shipping.html, returns.html, terms.html,
privacy.html, size-guide.html, track.html, 404.html
                        content pages. GENERATED from _src/pages/, don't edit directly
_src/pages/             source for the content pages (not deployed)
data/products.json      single source of truth for the catalogue
assets/css/styles.css
assets/js/shop.js       shared: Shopify config, bag, header, urls (load first)
assets/js/main.js       home: grid, carousel, filters, sort
assets/js/product.js    product page: gallery, size/colour, size guide, related
assets/css/product.css  product page styles
scripts/fingerprint.py  regenerates every ?v= cache-buster
scripts/build_pages.py  builds content pages + the shared footer
assets/svg/sprite.svg   logo + placeholder artwork symbols
assets/img/products/    product photography
assets/video/hero.mp4
```

## Adding a product

Add an object to `data/products.json`. Nothing else to touch.

```json
{
  "id": "bombay-bhook",
  "name": "Bombay Bhook",
  "series": "food",
  "seriesLabel": "Food",
  "colour": "black",
  "print": "back",
  "price": 1199,
  "badge": null,
  "sizes": [
    { "size": "S", "available": true, "variantId": "gid://shopify/ProductVariant/123" }
  ],
  "media": [
    { "type": "img", "src": "assets/img/products/bhook-front.jpg", "alt": "…" }
  ]
}
```

`media` entries are either `{"type":"img","src","alt"}` or
`{"type":"svg","ref":"#symbol-id","alt","viewBox"?}`.

Photos: crop to 4:5, 760×950, JPEG q82.

## Wiring Shopify

1. Shopify admin → Sales channels → add **Buy Button**.
2. Settings → Apps and sales channels → Develop apps → create an app, enable the
   Storefront API, copy the access token.
3. In `assets/js/main.js`, set `SHOPIFY.domain`, `SHOPIFY.storefrontAccessToken`,
   and flip `enabled` to `true`.
4. Replace every `REPLACE_ME` variantId in `data/products.json` with the real
   variant GID from Shopify.

Until step 3, Add to cart just increments a local counter so the UI is testable.

## Local dev

```bash
python3 -m http.server 8000
```

`fetch()` needs a server; opening index.html directly will fail on CORS.

## Deploy

Push to GitHub, import the repo in Vercel, add the domain. Every push deploys.

## Product pages

One template, every product. `/p/{id}` is rewritten to `product.html` in
`vercel.json`; locally use `/product.html?id={id}` (python's server can't rewrite).
Cards link there automatically. Shared page copy (details, care, shipping,
returns, size chart) lives in the `garment` block of `data/products.json`.
Optional per-product copy: add `"blurb"` to a product.

`garment.sizeChart` stays `null` until a real sample is measured. Format:
`{"columns":["Chest","Length","Shoulder"],"rows":[{"size":"S","values":["…","…","…"]}]}`

## Cache-busting

After changing any CSS, JS or the sprite: `python3 scripts/fingerprint.py`

## Content pages

Edit the source in `_src/pages/`, then run:

    python3 scripts/build_pages.py && python3 scripts/fingerprint.py

The builder wraps each page in the shared header/footer and also rewrites the
footer inside index.html and product.html. Footer links live in
`scripts/build_pages.py` (FOOTER_COLS).

Anything unconfirmed is wrapped in `<span class="tbd">…</span>`. Open any page
with `?review=1` (e.g. /returns?review=1) to see every placeholder highlighted.
Locally, pages are at /about.html etc. On Vercel, cleanUrls serves /about.
