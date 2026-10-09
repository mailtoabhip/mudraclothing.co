# Mudra Clothing Company

Static storefront. Design and browsing live here; cart, checkout, inventory and
orders live in Shopify (Storefront API, no SDK).

## Structure

```
index.html              page shell: hero, filters, spec band, footer
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
cart.html               /cart: the bag (assets/js/cart.js, assets/css/cart.css)
assets/css/product.css  product page styles
scripts/fingerprint.py  regenerates every ?v= cache-buster
scripts/build_pages.py  builds content pages + the shared footer
assets/svg/sprite.svg   logo + placeholder artwork symbols
assets/img/products/    product photography
assets/video/hero.mp4
```

## Archiving a shirt

`data/products.json` has two lists. `products` is what the site sells; `archived`
holds shirts taken off the site for now. To archive one, move its object from
`products` to `archived` and rebuild. To bring it back, move it the other way.
Nothing is deleted: photos stay in `assets/img/products/`, prices stay current
(`scripts/pricing.py` covers both lists). An archived shirt has no card, no
product page and no sitemap entry; its old `/p/<id>` link shows the "doesn't
exist yet" page. Shopify is separate: set the product to Draft there too.

## Adding a product

**Never reuse an image file name.** Everything under `assets/img/` is cached for a year
(`immutable` in vercel.json), so a new photo saved under an old name keeps showing the
old one to anyone who has seen it. Give replacements a new name.

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
    { "size": "S", "available": true }
  ],
  "media": [
    { "type": "img", "src": "assets/img/products/bhook-front.jpg", "alt": "…" }
  ]
}
```

`media` entries are either `{"type":"img","src","alt"}` or
`{"type":"svg","ref":"#symbol-id","alt","viewBox"?}`.

Photos: crop to 4:5, 760×950, JPEG q82.

## Shopify (cart + checkout)

No SDK. `assets/js/shop.js` talks to the Storefront API (`SHOPIFY.apiVersion`)
with `fetch`: live price/availability per product (handle = products.json `id`),
and the Cart API (`cartCreate` / `cartLinesAdd` / `cartLinesUpdate` / `cartLinesRemove`).
The cart id lives in localStorage; checkout is Shopify's, via `cart.checkoutUrl`.

Config is the `SHOPIFY` block at the top of `shop.js`:

- `storefrontAccessToken`: the **public** token from the Headless channel. Public
  by design, fine to commit. Never put an Admin token (`shpat_…`) or the Headless
  private token anywhere in this repo.
- `enabled: false` keeps checkout closed: Add to bag is a local counter and /cart
  says checkout isn't open yet.
- `cod`: shows the cash-on-delivery line on /cart.

A handle Shopify doesn't know shows "Coming soon". Colours are passed to the order
as a line attribute (`Colour`); only colours with `"sellable": true` in
products.json are offered.

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

## Drop 01 (fixed pre-order window)

`data/drop.json` is the one config for every drop date customers see (plain JSON, no
comments). `window.Mudra.dropPhase()` gives `teaser` (before `opens`), `open`,
`closed` (after `closes`) or `launched` (from the day after `shipsBy`), in IST. After
launch the site falls back to `ORDERING` in shop.js (7–10 day delivery window).

- `launch` (optional): public launch day inside the open window. Before it, the
  ticker and hero say "early pre-orders open"; after it, "pre-orders are now live".
- `products`: `"all"` or a list of ids; the rest show "Not in Drop 01" until launch.
- `prepaidOnly`: the site hides COD and says "prepaid only" while the drop runs. It
  can't switch COD off at Shopify's checkout: turn off the COD payment method in
  Shopify admin for the window, or the promise isn't enforced.
- Testing: add `?phase=teaser|open|closed|launched` (localhost and Vercel preview
  URLs only; ignored on the live site). For a build, `DROP_PHASE=open python3 ...`.
- Policy pages use `{{drop_name}}`, `{{drop_opens}}`, `{{drop_closes}}`,
  `{{drop_ships}}`, `{{drop_ships_long}}`, filled from drop.json by build_pages.py.

**Rebuild and push on each phase change.** The pages switch live in the browser, but
the pre-built HTML, structured data and meta descriptions are fixed at build time:

    python3 scripts/build_pages.py && python3 scripts/fingerprint.py

- on 1 Nov 2026: reservations end at midnight IST and orders/balance payments open. Rebuild public prices, SEO and the merchant feed.
- Reserved tees retain the saved ship-by commitment of 15 Dec; their paid deposit and remaining balance are separate payments.

(10 Oct 2026: founder changed the reservation cutoff to launch on 1 Nov. The ₹199 deposit is part of the full tee price, never the Product Offer price.)

## Shopify's own storefront (redirect only)

Customers never see Shopify's theme. The published theme "Horizon · redirect to Mudra site"
loads `snippets/mudra-redirect.liquid` (via `snippets/view-transition-opt-in.liquid`), which
sends every q0xhyi-ac.myshopify.com page to this site: `/products/<handle>` → `/p/<handle>`,
`/cart` → `/cart`, collections/search → `/#shop`, policies → the matching page, else `/`.
That covers the checkout logo, "Continue shopping" and account links. The theme editor is
left alone. **When the domain changes, update the site address in that snippet too.**

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

## SEO

`python3 scripts/build_pages.py` also runs `scripts/build_seo.py`, which writes:
one static page per product in `p/<id>.html` (served at `/p/<id>`), the home
page head + pre-rendered grid, `sitemap.xml`, `robots.txt`, the default share
image and the hero poster. Re-run it after any change to `data/products.json`.

- Site address: `SITE_URL` in `scripts/site_config.py`, now https://www.wearmudra.shop
  (the bare domain redirects to www on Vercel). Every canonical, sitemap entry and
  share tag follows it. mudraclothing-co.vercel.app still serves the same site.
- Instagram: set `INSTAGRAM_URL` in the same file; it goes into the
  Organization structured data.
- Price/stock structured data is only emitted while `SHOPIFY.enabled` is true.
- `product.html` is now only the fallback template (noindex).


### Product copy, images, feed (Oct 2026 SEO pass)

- `blurb` in `data/products.json`: the "About this design" paragraph on each product
  page. Marketing writes it, word for word; when it's empty nothing renders.
- `seo.keyword` / `seo.description`: the search phrase and the meta description
  (also og:description, the structured data and the Merchant feed). `{price}` is
  filled with the current price at build time. Keep it under 155 characters.
- Images: `scripts/build_images.py` (run by the build) writes `<photo>-800.webp` and
  `<photo>-<width>.webp` next to each JPEG and records `w`, `h`, `webp` on the media
  entry. Pages use `<picture>`; the JPEG stays the fallback and is what the sitemap
  and feed list. No upscaling: for 1600 px versions, add bigger JPEGs (new names).
- `sitemap.xml` lastmod only moves when a page's content changes. The hashes live
  in `data/sitemap-state.json` (commit it; it isn't deployed).
- Google Merchant feed: `/feeds/google-merchant.xml`, one item per size, rebuilt
  from `data/products.json`. Gender and age group: `FEED_GENDER` / `FEED_AGE_GROUP`
  in `scripts/site_config.py`. Submit the URL in Merchant Center.
- Archived tees: the build writes a temporary (302) redirect `/p/<id>` → `/` into
  `vercel.json` for every entry in "archived"; moving a tee back removes it.

## Prices (Drop 01)

`data/pricing.json` holds the MRP, the three tiers and which tee is in which tier
(provisional until Design confirms print areas). `scripts/pricing.py` writes
`tier / mrp / price / regularPrice / preorderEnds` into `data/products.json`
and a matching Shopify plan into `ops/` (not deployed):

    python3 scripts/pricing.py preorder   # during pre-orders: price = pre-order price
    python3 scripts/pricing.py regular    # when pre-orders close: price = regular price
    python3 scripts/build_pages.py && python3 scripts/fingerprint.py

Shopify must match: price = `price`, compare-at = MRP, metafield
`custom.regular_price`. Apply `ops/shopify-prices-<phase>.json` through the
Shopify connector, with the founder's go-ahead, in the same sitting as the push.
The build stops if `preorderEnds` and `data/drop.json` disagree.

## Our Story (/about)

Source: `_src/pages/about.html` (layout `bare`), styles `assets/css/story.css`,
script `assets/js/story.js`. The copy is Marketing's "Website story" and must
stay word for word; change it only with Marketing.

Photos: six editorial frames, rendered in the source with descriptive alt text.
The scenes are generated illustrations of the story, using the existing tee designs.
JPEGs live in `assets/img/story/` with these exact names:
`01-fan.jpg` (portrait, ~1600×2000) · `02-seal.jpg` (landscape, ~2400×1500) ·
`03-chai.jpg` (4:5) · `04a-balcony.jpg` and `04b-airport.jpg` (4:5 each) ·
`05-mirror.jpg` (3:4.4 portrait). `/about?review=1` labels each empty frame.
