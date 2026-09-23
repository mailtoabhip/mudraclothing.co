/* ==========================================================================
   Mudra Studios — shared storefront plumbing
   Loaded by every page before its own script. Exposes window.Mudra.
   Cart + checkout talk to the Shopify Storefront API directly (fetch, no SDK).
   ========================================================================== */

(() => {

const SHOPIFY = {
  domain: 'q0xhyi-ac.myshopify.com',
  // Public Storefront token from the Headless channel. Public by design.
  // Never put an Admin token (shpat_) or the Headless PRIVATE token here.
  storefrontAccessToken: 'f2b9739c85384e64300f6b3c806ae959',
  apiVersion: '2026-07',
  shopId: '73593618511',
  cod: true,        // cash on delivery offered at checkout
  enabled: false,   // false: the bag is a local counter and checkout stays closed
};

const ACCOUNT_URL = `https://shopify.com/${SHOPIFY.shopId}/account`;
const API_URL = `https://${SHOPIFY.domain}/api/${SHOPIFY.apiVersion}/graphql.json`;

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const SPRITE_URL = '/assets/svg/sprite.svg?v=351f9262';

/* ---------- urls ------------------------------------------------------ */

// Pretty URLs (/p/face-card, /cart) are Vercel rewrites / cleanUrls. A plain
// static server (python -m http.server) can't do that, so fall back locally.
const isLocal = location.protocol === 'file:' ||
  /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);

function productUrl(id) {
  return isLocal ? `/product.html?id=${encodeURIComponent(id)}` : `/p/${encodeURIComponent(id)}`;
}
const CART_URL = isLocal ? '/cart.html' : '/cart';

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

const money = n => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// only colours we can actually print right now
const sellableColours = p => (p.colours || []).filter(c => c.sellable);

/* ---------- storefront api -------------------------------------------- */

class ShopError extends Error {}

async function sf(query, variables = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (SHOPIFY.storefrontAccessToken) headers['X-Shopify-Storefront-Access-Token'] = SHOPIFY.storefrontAccessToken;
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new ShopError('No connection to the shop. Try again in a moment.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) throw new ShopError("The shop didn't answer properly. Try again in a moment.");
  return body.data;
}

const PRODUCT_Q = `query P($handle: String!) {
  product(handle: $handle) {
    handle title availableForSale
    variants(first: 20) { nodes {
      id availableForSale price { amount currencyCode }
      selectedOptions { name value }
    } }
  }
}`;

const liveCache = new Map();
// → { price, variants: { S: { id, available, price } } } or null if Shopify doesn't know the handle
function liveProduct(handle) {
  if (!liveCache.has(handle)) {
    liveCache.set(handle, sf(PRODUCT_Q, { handle }).then(d => {
      const p = d.product;
      if (!p) return null;
      const variants = {};
      p.variants.nodes.forEach(v => {
        const size = v.selectedOptions.find(o => o.name.toLowerCase() === 'size')?.value;
        if (size) variants[size] = { id: v.id, available: v.availableForSale, price: Number(v.price.amount) };
      });
      const first = p.variants.nodes[0];
      return { price: first ? Number(first.price.amount) : null, variants };
    }).catch(err => { liveCache.delete(handle); throw err; }));
  }
  return liveCache.get(handle);
}

/* ---------- cart ------------------------------------------------------ */

const CART_FIELDS = `
  id checkoutUrl totalQuantity
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) { nodes {
    id quantity
    attributes { key value }
    cost { totalAmount { amount } }
    merchandise { ... on ProductVariant {
      id title
      selectedOptions { name value }
      image { url(transform: { maxWidth: 240 }) altText }
      product { handle title }
    } }
  } }`;

const Q = {
  get: `query C($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`,
  create: `mutation C($lines: [CartLineInput!]) { cartCreate(input: { lines: $lines }) { cart { ${CART_FIELDS} } userErrors { message } } }`,
  add: `mutation C($id: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $id, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } } }`,
  update: `mutation C($id: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $id, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } } }`,
  remove: `mutation C($id: ID!, $ids: [ID!]!) { cartLinesRemove(cartId: $id, lineIds: $ids) { cart { ${CART_FIELDS} } userErrors { message } } }`,
};

const CART_KEY = 'mudra.cartId';
const store = {
  get() { try { return localStorage.getItem(CART_KEY); } catch { return null; } },
  set(id) { try { id ? localStorage.setItem(CART_KEY, id) : localStorage.removeItem(CART_KEY); } catch { /* storage off */ } },
};

let cartState = null;
const listeners = new Set();
function setCart(c) {
  cartState = c;
  store.set(c ? c.id : null);
  renderBag();
  listeners.forEach(fn => fn(c));
  return c;
}

function unwrap(payload) {
  if (payload.userErrors?.length) throw new ShopError(payload.userErrors[0].message);
  return payload.cart;
}

const cart = {
  get state() { return cartState; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // loads the saved cart; an expired or unknown one is dropped and we start fresh
  async load() {
    const id = store.get();
    if (!id) return setCart(null);
    try {
      const d = await sf(Q.get, { id });
      return setCart(d.cart || null);
    } catch (err) {
      renderBag();
      throw err;
    }
  },

  async add(variantId, quantity = 1, attributes = []) {
    const lines = [{ merchandiseId: variantId, quantity, attributes }];
    const id = cartState?.id || store.get();
    if (id) {
      const d = await sf(Q.add, { id, lines });
      // no cart back means the saved one expired: fall through and start fresh
      if (d.cartLinesAdd.cart) return setCart(unwrap(d.cartLinesAdd));
    }
    const d = await sf(Q.create, { lines });
    return setCart(unwrap(d.cartCreate));
  },

  async update(lineId, quantity) {
    if (quantity < 1) return cart.remove(lineId);
    const d = await sf(Q.update, { id: cartState.id, lines: [{ id: lineId, quantity }] });
    return setCart(unwrap(d.cartLinesUpdate));
  },

  async remove(lineId) {
    const d = await sf(Q.remove, { id: cartState.id, ids: [lineId] });
    return setCart(unwrap(d.cartLinesRemove));
  },
};

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

/* ---------- bag count ------------------------------------------------- */

// With Shopify off, a local counter survives page changes in this tab.
const BAG_KEY = 'mudra.bag';
function readLocalBag() {
  try { return Number(sessionStorage.getItem(BAG_KEY)) || 0; } catch { return 0; }
}
function writeLocalBag(n) {
  try { sessionStorage.setItem(BAG_KEY, String(n)); } catch { /* private mode */ }
}
function bagCount() {
  return SHOPIFY.enabled ? (cartState?.totalQuantity || 0) : readLocalBag();
}
function renderBag() {
  const n = bagCount();
  document.querySelectorAll('.cart').forEach(b => {
    b.textContent = `Bag (${n})`;
    b.setAttribute('aria-label', `Bag, ${n} item${n === 1 ? '' : 's'}`);
    if (b.tagName === 'A') b.setAttribute('href', CART_URL);
  });
}

function flash(btn, msg, ms = 1400) {
  const was = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, ms);
}

/* ---------- drawer: opens after "Add to bag" --------------------------- */

let drawer, lastFocus;
function buildDrawer() {
  drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'false');
  drawer.setAttribute('aria-labelledby', 'drawerTitle');
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="drawer__head">
      <h2 id="drawerTitle" class="drawer__title">IN THE BAG</h2>
      <button class="drawer__x mono" data-drawer-close>Close</button>
    </div>
    <div class="drawer__body" id="drawerBody"></div>
    <div class="drawer__foot">
      <a class="drawer__view mono" href="${CART_URL}">View bag</a>
      <button class="drawer__keep mono" data-drawer-close>Keep looking</button>
    </div>`;
  document.body.appendChild(drawer);
  drawer.addEventListener('click', e => { if (e.target.closest('[data-drawer-close]')) closeDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
}

function openDrawer({ name, size, colour, image, price }, returnTo) {
  if (!drawer) buildDrawer();
  const n = bagCount();
  drawer.querySelector('#drawerBody').innerHTML = `
    <div class="dline">
      ${image ? `<img src="${esc(image)}" alt="" width="80" height="100">` : '<span class="dline__ph"></span>'}
      <div>
        <p class="dline__name">${esc(name)}</p>
        <p class="mono dline__meta">${[size, colour].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="mono dline__price">${money(price)}</p>
      </div>
    </div>
    <p class="mono drawer__count">${n} item${n === 1 ? '' : 's'} in the bag</p>`;
  lastFocus = returnTo || document.activeElement;
  drawer.hidden = false;
  void drawer.offsetWidth;   // commit the off-screen position so the slide-in animates
  drawer.classList.add('on');
  drawer.querySelector('.drawer__view').focus();
}

function closeDrawer() {
  drawer.classList.remove('on');
  setTimeout(() => { if (!drawer.classList.contains('on')) drawer.hidden = true; }, 220);
  lastFocus?.focus?.();
}

/* ---------- add to bag ------------------------------------------------- */

// item: { variantId, name, size, colour, image, price }
// Resolves true when added. Throws ShopError with a message fit to show inline.
async function addToBag(item, btn) {
  if (!SHOPIFY.enabled) {
    writeLocalBag(readLocalBag() + 1);
    renderBag();
    if (btn) flash(btn, 'Added');
    return true;
  }
  if (!item.variantId) throw new ShopError("That size isn't on sale yet.");
  const attributes = item.colour ? [{ key: 'Colour', value: item.colour }] : [];
  await cart.add(item.variantId, 1, attributes);
  if (btn) flash(btn, 'Added');
  openDrawer(item, btn);
  return true;
}

// Every page calls this once: bag count from the live cart when Shopify is on.
function initBag() {
  renderBag();
  if (SHOPIFY.enabled) return cart.load().catch(() => null);
  return Promise.resolve(null);
}

window.Mudra = {
  SHOPIFY, SIZES, ACCOUNT_URL, CART_URL, ShopError,
  productUrl, productIdFromUrl, loadCatalogue, loadSprite, sellableColours,
  money, esc, wireHeader, renderBag, initBag, addToBag, flash,
  liveProduct, cart, sf,
};

})();
