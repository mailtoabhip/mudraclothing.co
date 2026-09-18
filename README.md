# Mudra Studios

Static storefront. Design and browsing live here; cart, checkout, inventory and
orders live in Shopify via the Buy Button SDK.

## Structure

```
index.html              page shell — hero, filters, spec band, footer
data/products.json      single source of truth for the catalogue
assets/css/styles.css
assets/js/main.js       renders the grid, carousel, filters, sort, cart
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
