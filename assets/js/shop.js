/* ==========================================================================
   Mudra Studios — shared storefront plumbing
   Loaded by every page before its own script. Exposes window.Mudra.
   ========================================================================== */

(() => {

const SHOPIFY = {
  // Fill these in from Shopify admin → Sales channels → Buy Button.
  // The Storefront token is public by design. Never put the Admin token here.
  domain: 'your-store.myshopify.com',
  storefrontAccessToken: 'REPLACE_ME',
  enabled: false, // flip to true once the two values above are real
};

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const SPRITE_URL = '/assets/svg/sprite.svg?v=351f9262';

/* ---------- urls ------------------------------------------------------ */

// Pretty URLs (/p/face-card) are a Vercel rewrite. A plain static server
// (python -m http.server) can't do rewrites, so fall back to the query form.
const isLocal = location.protocol === 'file:' ||
  /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);

function productUrl(id) {
  return isLocal ? `/product.html?id=${encodeURIComponent(id)}` : `/p/${encodeURIComponent(id)}`;
}

function productIdFromUrl() {
  const q = new URLSearchParams(location.search).get('id');
  if (q) return q;
  const m = location.pathname.match(/^\/p\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------- data ------------------------------------------------------ */

let dataPromise;
function loadCatalogue() {
  dataPromise ||= fetch('/data/products.json', { cache: 'no-cache' }).then(r => r.json());
  return dataPromise;
}

async function loadSprite() {
  const svg = await fetch(SPRITE_URL).then(r => r.text());
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML = svg;
  document.body.prepend(holder);
}

const money = n => `₹${Number(n).toLocaleString('en-IN')}`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- header ---------------------------------------------------- */

function wireHeader({ solid = false } = {}) {
  const h = document.querySelector('header');
  if (!h) return;
  if (solid) { h.classList.add('scrolled', 'solid'); return; }
  let ticking = false;
  const sync = () => { h.classList.toggle('scrolled', window.scrollY > 12); ticking = false; };
  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(sync); }
  }, { passive: true });
  sync();
}

/* ---------- bag ------------------------------------------------------- */

// Local counter survives page changes in this tab until Shopify is wired.
const BAG_KEY = 'mudra.bag';
function readBag() {
  try { return Number(sessionStorage.getItem(BAG_KEY)) || 0; } catch { return 0; }
}
function writeBag(n) {
  try { sessionStorage.setItem(BAG_KEY, String(n)); } catch { /* private mode */ }
}
function renderBag() {
  document.querySelectorAll('.cart').forEach(b => { b.textContent = `Bag (${readBag()})`; });
}

function flash(btn, msg, ms = 1400) {
  const was = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, ms);
}

// variantId: a Shopify ProductVariant GID. Until Shopify is on, it's ignored.
function addToBag(variantId, btn) {
  if (SHOPIFY.enabled && window.mudraCart && variantId && variantId !== 'REPLACE_ME') {
    window.mudraCart.addVariantToCart({ id: variantId, quantity: 1 });
  } else {
    writeBag(readBag() + 1);
    renderBag();
  }
  if (btn) flash(btn, 'Added');
}

/* ---------- Shopify Buy Button --------------------------------------- */

function loadShopify() {
  if (!SHOPIFY.enabled) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js';
  s.onload = () => {
    const client = ShopifyBuy.buildClient({
      domain: SHOPIFY.domain,
      storefrontAccessToken: SHOPIFY.storefrontAccessToken,
    });
    ShopifyBuy.UI.onReady(client).then(ui => {
      ui.createComponent('cart', {
        node: document.getElementById('shopify-cart'),
        options: {
          cart: {
            startOpen: false,
            popup: false,
            text: { title: 'Bag', total: 'Subtotal', button: 'Checkout' },
            styles: {
              button: {
                'background-color': '#2B3AFF',
                'font-family': 'Space Mono, monospace',
                'font-size': '12px',
                'letter-spacing': '0.16em',
                'text-transform': 'uppercase',
                'border-radius': '0',
              },
            },
          },
        },
      }).then(cart => { window.mudraCart = cart; });
    });
  };
  document.head.appendChild(s);
}

window.Mudra = {
  SHOPIFY, SIZES, productUrl, productIdFromUrl, loadCatalogue, loadSprite,
  money, esc, wireHeader, renderBag, addToBag, flash, loadShopify,
};

})();
