/* ==========================================================================
   Mudra: shared storefront plumbing
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
  enabled: true,    // false: the bag is a local counter and checkout stays closed
};

// How tees are sold. 'preorder': arrives in minDays–maxDays after the order
// calendar days. 'instock': plain "Add to bag", no arrival promise.
// minDays/maxDays MUST match PREORDER_MIN_DAYS/PREORDER_MAX_DAYS in scripts/site_config.py.
const ORDERING = { mode: 'preorder', minDays: 7, maxDays: 10 };
const isPreorder = () => ORDERING.mode === 'preorder';

const ACCOUNT_URL = `https://shopify.com/${SHOPIFY.shopId}/account`;
const API_URL = `https://${SHOPIFY.domain}/api/${SHOPIFY.apiVersion}/graphql.json`;

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const SPRITE_URL = '/assets/svg/sprite.svg?v=3ffb4f08';

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
  const m = location.pathname.match(/^\/p\/([^/?#]+?)(?:\.html)?\/?$/);
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

/* ---------- pre-order arrival window (IST, calendar days) ------------- */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// today's date in India, whatever the visitor's own timezone
function todayIST(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}
const fmtDay = t => { const d = new Date(t); return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

// → { from: "Tue, 30 Sep", to: "Fri, 3 Oct", text: "Tue, 30 Sep – Fri, 3 Oct" } for an order placed now
function arrivalRange(now = new Date()) {
  const t0 = todayIST(now), day = 864e5;
  const from = fmtDay(t0 + ORDERING.minDays * day);
  const to = fmtDay(t0 + ORDERING.maxDays * day);
  return { from, to, text: `${from} – ${to}` };
}

/* ---------- Drop 01: fixed pre-order window (data/drop.json) ----------- */
// Phases, by IST time: teaser (before opens), open, closed (after closes),
// launched (after the shipsBy day), when ORDERING takes over again.

let DROP = null;
let dropPromise;
let RESERVATIONS = { enabled: false, depositRupees: 199 };
let reservationsPromise;
function loadReservations() {
  reservationsPromise ||= fetch('/data/reservations.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('Reservation settings unavailable.'); return r.json(); })
    .then(config => {
      if (!Number.isSafeInteger(config.depositRupees) || config.depositRupees < 1) throw new Error('Invalid deposit.');
      RESERVATIONS = config;
      return config;
    }).catch(() => RESERVATIONS);
  return reservationsPromise;
}
function depositWindow(now = Date.now()) {
  return RESERVATIONS.enabled === true && !!DROP && now >= Date.parse(DROP.opens) && now <= Date.parse(DROP.closes);
}
function depositFor(productId) {
  const override = RESERVATIONS.temporaryOverrides?.[productId];
  return Number.isSafeInteger(override) && override >= 1 ? override : RESERVATIONS.depositRupees;
}
function loadDrop() {
  dropPromise ||= fetch('/data/drop.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { DROP = d; return d; });
  return dropPromise;
}

const LIVE_HOSTS = ['wearmudra.shop', 'www.wearmudra.shop', 'mudraclothing-co.vercel.app'];
// ?phase= is for testing: localhost or a Vercel preview URL only
const canForcePhase = isLocal || (/\.vercel\.app$/.test(location.hostname) && !LIVE_HOSTS.includes(location.hostname));

// the day after shipsBy, 00:00 IST
const launchTime = d => new Date(`${d.shipsBy}T00:00:00+05:30`).getTime() + 864e5;

function dropPhase(now = Date.now()) {
  if (!DROP) return 'launched';
  const forced = canForcePhase && new URLSearchParams(location.search).get('phase');
  if (['teaser', 'open', 'closed', 'launched'].includes(forced)) return forced;
  if (now < Date.parse(DROP.opens)) return 'teaser';
  if (now <= Date.parse(DROP.closes)) return 'open';
  if (RESERVATIONS.enabled && now >= Date.parse(DROP.launch)) return 'launched';
  if (now < launchTime(DROP)) return 'closed';
  return 'launched';
}

const inDrop = id => !!DROP && (DROP.products === 'all' || (Array.isArray(DROP.products) && DROP.products.includes(id)));

// what a product can do right now: 'teaser' | 'open' | 'closed' | 'notInDrop' | 'launched'
function saleState(id) {
  const ph = dropPhase();
  if (ph === 'launched') return 'launched';
  return inDrop(id) ? ph : 'notInDrop';
}
const canBuy = id => ['open', 'launched'].includes(saleState(id));

// every date customers see, from drop.json, in IST
function dropDates() {
  if (!DROP) return null;
  const long = iso => fmtDay(todayIST(new Date(iso)));
  const short = iso => { const d = new Date(todayIST(new Date(iso))); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const ships = `${DROP.shipsBy}T12:00:00+05:30`;
  return {
    name: DROP.name,
    opensLong: long(DROP.opens), opensShort: short(DROP.opens),
    closesShort: short(DROP.closes),
    launchShort: DROP.launch ? short(DROP.launch) : '',
    shipsLong: long(ships), shipsShort: short(ships),
  };
}

// only in the last 72 hours: "Closes in 3 days" / "Closes in 5 hours". No seconds.
function closesIn(now = Date.now()) {
  if (!DROP || dropPhase(now) !== 'open') return '';
  const left = Date.parse(DROP.closes) - now;
  if (left <= 0 || left > 72 * 36e5) return '';
  const h = Math.ceil(left / 36e5);
  // whole days only while at least 2 are left, so it never overstates the time
  if (h > 48) return `Closes in ${Math.floor(h / 24)} days`;
  return `Closes in ${h} hour${h === 1 ? '' : 's'}`;
}

// checkout only while pre-orders are open, or after launch
function checkoutBlock() {
  const ph = dropPhase(), d = dropDates();
  if (ph === 'teaser') return `Pre-orders open ${d.opensShort}`;
  if (ph === 'closed') return 'Pre-orders closed';
  return '';
}

// .ics for the opening time, made in the browser
function downloadIcs(productName) {
  if (!DROP) return;
  const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = Date.parse(DROP.opens);
  const d = dropDates();
  const slug = DROP.name.replace(/\s+/g, '-').toLowerCase();
  const pid = productIdFromUrl();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mudra//Drop//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${slug}-opens@mudrastudios`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + 36e5)}`,
    `SUMMARY:Mudra: pre-orders open`,
    `DESCRIPTION:${productName ? productName + '. ' : ''}Pre-orders run ${d.opensShort} to ${d.closesShort}. Ships by ${d.shipsShort}.`,
    `URL:${location.origin}${pid ? productUrl(pid) : '/'}`,
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Mudra pre-orders open soon', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mudra-${slug}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// `launch` (optional) is the public launch day inside the open window; it only
// changes the ticker and hero wording, pre-orders stay open either way
const beforeLaunch = (now = Date.now()) => !!(DROP && DROP.launch) && now < Date.parse(DROP.launch);

// ticker lines per phase; launched falls back to the delivery window
function tickerItems() {
  if (depositWindow()) return [`Pre-order @ ${money(RESERVATIONS.depositRupees)}`, `Orders open ${dropDates().launchShort}`, 'Free shipping across India'];
  const ph = dropPhase(), d = dropDates();
  if (!d || ph === 'launched') return [`At your door in ${ORDERING.minDays}–${ORDERING.maxDays} days`, 'Designed in-house', 'Free shipping across India'];
  if (ph === 'teaser') return [`Pre-orders open ${d.opensShort}`, 'Designed in-house', 'Free shipping across India'];
  if (ph === 'open') {
    return beforeLaunch()
      ? [`Early pre-orders open`, `Closes ${d.closesShort}`, 'Free shipping across India']
      : [`Pre-orders are now live`, `Open till ${d.closesShort}`, 'Free shipping across India'];
  }
  return [`Printing now`, `Ships by ${d.shipsShort}`];
}

// hero tag on the home page
function heroTag() {
  if (depositWindow()) return `Pre-order @ ${money(RESERVATIONS.depositRupees)} · Orders open ${dropDates().launchShort}`;
  const ph = dropPhase(), d = dropDates();
  if (!d) return `At your door in ${ORDERING.minDays}–${ORDERING.maxDays} days`;
  if (ph === 'teaser') return `Pre-orders open ${d.opensShort}`;
  if (ph === 'open') return beforeLaunch() ? 'Early pre-orders open' : 'Pre-orders are now live';
  if (ph === 'closed') return 'Printing now';
  return `At your door in ${ORDERING.minDays}–${ORDERING.maxDays} days`;   // after launch: nothing drop-specific
}

// COD is off while the drop runs (drop.json prepaidOnly)
const codNow = () => SHOPIFY.cod && !(DROP && DROP.prepaidOnly && dropPhase() !== 'launched');

const money = n => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* ---------- prices: MRP, now, and what it becomes after pre-orders ---- */
// data/products.json holds mrp / price / regularPrice / preorderEnds (written by
// scripts/pricing.py). A live Shopify price, when loaded, always wins: it's what
// checkout charges. The struck MRP only shows when it's above the price.
// Keep in step with price_view() in scripts/build_seo.py.
function priceView(p, live) {
  const pastWindow = DROP && Date.now() > Date.parse(DROP.closes);
  const now = pastWindow && p.regularPrice ? p.regularPrice : (live?.price ?? p.price);
  const mrp = live?.compareAt ?? p.mrp ?? null;
  const st = saleState(p.id);
  const pre = st === 'open' || st === 'teaser';
  const regular = pre && p.regularPrice > now ? p.regularPrice : null;
  return { now, mrp: mrp > now ? mrp : null, regular, pre };
}

// <picture> with the WebP widths scripts/build_images.py made (m.webp), JPEG fallback.
// Mirrored by picture() in scripts/build_seo.py for the pre-rendered HTML.
function pictureHTML(m, { cls = '', loading = 'lazy', sizes = '100vw', extra = '' } = {}) {
  const base = '/' + m.src.replace(/\.jpe?g$/i, '');
  const set = (m.webp || []).map(w => `${base}-${w}.webp ${w}w`).join(', ');
  const img = `<img${cls ? ` class="${cls}"` : ''} src="/${m.src}" alt="${esc(m.alt)}" width="${m.w || 800}" height="${m.h || 1000}" loading="${loading}" decoding="async"${extra}>`;
  return set ? `<picture><source type="image/webp" srcset="${set}" sizes="${sizes}">${img}</picture>` : img;
}
const CARD_SIZES = '(max-width: 600px) 50vw, (max-width: 1100px) 45vw, 30vw';

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
      id availableForSale price { amount currencyCode } compareAtPrice { amount }
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
      return {
        price: first ? Number(first.price.amount) : null,
        compareAt: first?.compareAtPrice ? Number(first.compareAtPrice.amount) : null,
        variants,
      };
    }).catch(err => { liveCache.delete(handle); throw err; }));
  }
  return liveCache.get(handle);
}

/* ---------- cart ------------------------------------------------------ */

const CART_FIELDS = `
  id checkoutUrl totalQuantity
  attributes { key value }
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
  create: `mutation C($lines: [CartLineInput!], $attributes: [AttributeInput!]) { cartCreate(input: { lines: $lines, attributes: $attributes }) { cart { ${CART_FIELDS} } userErrors { message } } }`,
  attrs: `mutation C($id: ID!, $attributes: [AttributeInput!]!) { cartAttributesUpdate(cartId: $id, attributes: $attributes) { cart { ${CART_FIELDS} } userErrors { message } } }`,
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

// shows on the order in Shopify admin
function orderAttributes() {
  if (DROP && dropPhase() === 'open') {
    return [
      { key: 'Order type', value: 'Pre-order' },
      { key: 'Ships by', value: DROP.shipsBy },
    ];
  }
  if (!isPreorder()) return [];
  return [
    { key: 'Order type', value: 'Pre-order' },
    { key: 'Promised arrival', value: arrivalRange().text },
  ];
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
    return cart.addLines([{ merchandiseId: variantId, quantity, attributes }]);
  },

  async addLines(lines) {
    const id = cartState?.id || store.get();
    if (id) {
      const d = await sf(Q.add, { id, lines });
      // no cart back means the saved one expired: fall through and start fresh
      if (d.cartLinesAdd.cart) {
        const c = unwrap(d.cartLinesAdd);
        if (!orderAttributes().length) return setCart(c);
        // keep the promised window current for carts started on an earlier day
        const u = await sf(Q.attrs, { id: c.id, attributes: orderAttributes() });
        return setCart(unwrap(u.cartAttributesUpdate));
      }
    }
    const d = await sf(Q.create, { lines, attributes: orderAttributes() });
    return setCart(unwrap(d.cartCreate));
  },

  async update(lineId, quantity) {
    if (quantity < 1) return cart.remove(lineId);
    const d = await sf(Q.update, { id: cartState.id, lines: [{ id: lineId, quantity }] });
    return setCart(unwrap(d.cartLinesUpdate));
  },

  // Replace this product/colour's selected quantities without adding them twice.
  async replaceLines(existing, wanted) {
    const updates = [], remove = [], additions = [];
    const remaining = new Map(wanted.map(line => [line.merchandiseId, line]));
    for (const line of existing) {
      const next = remaining.get(line.merchandise.id);
      remaining.delete(line.merchandise.id);
      if (!next) remove.push(line.id);
      else if (next.quantity !== line.quantity) updates.push({ id: line.id, quantity: next.quantity });
    }
    additions.push(...remaining.values());
    if (remove.length) setCart(unwrap((await sf(Q.remove, { id: cartState.id, ids: remove })).cartLinesRemove));
    if (updates.length) setCart(unwrap((await sf(Q.update, { id: cartState.id, lines: updates })).cartLinesUpdate));
    if (additions.length) await cart.addLines(additions);
    return cartState;
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

/* ---------- header "Shop for" dropdown ---------------------------------- */
// CSS opens it on hover/focus-within without JS; with JS, .is-open is the only
// switch so Escape, outside taps and aria-expanded stay in sync.
function wireShopFor() {
  const box = document.querySelector('.shopfor');
  if (!box) return;
  const btn = box.querySelector('.shopfor__btn');
  const go = box.querySelector('.shopfor__item--go');
  const touch = matchMedia('(hover: none)').matches;
  let quiet = false;                                  // ignore the focus we cause ourselves
  box.classList.add('js');
  const set = open => {
    box.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  const close = () => set(false);

  box.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') set(true); });
  box.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') close(); });
  box.addEventListener('focusin', () => { if (!quiet && !touch) set(true); });
  // focus leaving for somewhere outside closes it; a click on the non-focusable
  // "T-shirts" row also drops focus (relatedTarget null) but the pointer is
  // still over the menu, so that one doesn't count
  box.addEventListener('focusout', e => {
    if (box.contains(e.relatedTarget) || (!e.relatedTarget && box.matches(':hover'))) return;
    close();
  });
  // Enter, Space and taps toggle. A mouse click lands after hover has already
  // opened the menu, so for a mouse it only ever opens (a toggle would shut it).
  let downType = '';
  btn.addEventListener('pointerdown', e => { downType = e.pointerType; });
  btn.addEventListener('click', e => {
    const mouse = e.detail > 0 && (downType === 'mouse' || downType === 'pen');
    downType = '';
    set(mouse ? true : !box.classList.contains('is-open'));
  });
  box.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !box.classList.contains('is-open')) return;
    e.preventDefault();
    close();
    quiet = true; btn.focus(); quiet = false;
  });
  document.addEventListener('pointerdown', e => { if (!box.contains(e.target)) close(); });

  // on the home page, glide to the tees instead of jumping (and leave room for the header)
  go.addEventListener('click', e => {
    const shop = document.getElementById('shop');
    if (!shop) return;                                 // other pages: plain /#shop navigation
    e.preventDefault();
    close();
    const head = document.querySelector('header');
    const y = shop.getBoundingClientRect().top + scrollY - (head ? head.offsetHeight : 0);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#shop');
    quiet = true; go.blur(); quiet = false;
  });
}
wireShopFor();   // shop.js is deferred on every page, so the header is already parsed

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
  const was = btn.innerHTML;
  btn.textContent = msg;
  btn.classList.add('done');
  setTimeout(() => { btn.innerHTML = was; btn.classList.remove('done'); }, ms);
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

function openDrawer({ id, name, size, colour, image, price }, returnTo) {
  if (!drawer) buildDrawer();
  const n = bagCount();
  drawer.querySelector('#drawerBody').innerHTML = `
    <div class="dline">
      ${image ? `<img src="${esc(image)}" alt="" width="80" height="100">` : '<span class="dline__ph"></span>'}
      <div>
        <p class="dline__name">${esc(name)}</p>
        <p class="mono dline__meta">${[size, colour].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="mono dline__price">${depositWindow() ? `Pre-order @ ${money(depositFor(id))} per tee` : money(price)}</p>
        ${lineNote(id) ? `<p class="mono dline__po">${esc(lineNote(id))}</p>` : ''}
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

// the promise under each bag line: drop ship-by date, or the 7–10 day delivery window
function lineNote(productId) {
  if (depositWindow()) return `Pre-order @ ${money(depositFor(productId))} per tee · Orders open ${dropDates().launchShort}`;
  const ph = dropPhase(), d = dropDates();
  if (d && ph !== 'launched') return ph === 'teaser' ? `Pre-orders open ${d.opensShort}` : `Pre-order · ships by ${d.shipsShort}`;
  return isPreorder() ? `Pre-order · Arrives ${arrivalRange().text}` : '';
}

/* ---------- add to bag ------------------------------------------------- */

// One item or an array: { variantId, name, size, colour, image, price, quantity }.
// Resolves true when added. Throws ShopError with a message fit to show inline.
async function addToBag(item, btn) {
  const items = Array.isArray(item) ? item : [item];
  const count = items.reduce((n, x) => n + (x.quantity || 1), 0);
  if (!SHOPIFY.enabled) {
    writeLocalBag(readLocalBag() + count);
    renderBag();
    if (btn) flash(btn, isPreorder() ? 'Pre-ordered' : 'Added');
    return true;
  }
  const lines = items.map(x => {
    if (x.id && !canBuy(x.id)) throw new ShopError(checkoutBlock() || 'Not available for pre-order.');
    if (!x.variantId) throw new ShopError("That size isn't on sale yet.");
    return { merchandiseId: x.variantId, quantity: x.quantity || 1,
      attributes: x.colour ? [{ key: 'Colour', value: x.colour }] : [] };
  });
  await cart.addLines(lines);
  if (btn) flash(btn, isPreorder() ? 'Pre-ordered' : 'Added');
  const preview = items.length === 1 && count === 1 ? items[0] : { ...items[0],
    size: items.map(x => `${x.size} × ${x.quantity || 1}`).join(', '),
    price: items.reduce((n, x) => n + x.price * (x.quantity || 1), 0) };
  openDrawer(preview, btn);
  return true;
}

// Every page calls this once: bag count from the live cart when Shopify is on.
function initBag() {
  renderBag();
  loadDrop();
  if (SHOPIFY.enabled) return cart.load().catch(() => null);
  return Promise.resolve(null);
}

// Re-read the saved Shopify cart when returning to the site or another tab.
addEventListener('storage', e => {
  if (SHOPIFY.enabled && e.key === CART_KEY) cart.load().catch(() => {});
});
addEventListener('pageshow', e => {
  if (SHOPIFY.enabled && e.persisted) cart.load().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (SHOPIFY.enabled && document.visibilityState === 'visible') cart.load().catch(() => {});
});

/* ---------- size chart (garment.sizeChart in products.json) ----------
   Same markup as the static table build_pages.py writes into /size-guide.
   Cells carry data-in; the in/cm buttons rewrite them in place. */
const fmtIn = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const toCm = v => String(Math.round(v * 2.54));
function sizeTableHTML(g) {
  const c = g && g.sizeChart;
  if (!c || !c.rows?.length) return '';
  const head = c.columns.map(col => `<th scope="col"><span class="sct__mk">${esc(col.mark)}</span>${esc(col.label)}${col.sub ? `<small>${esc(col.sub)}</small>` : ''}</th>`).join('');
  const rows = c.rows.map(r => `<tr><th scope="row">${esc(r.size)}</th>${r.values.map(v => `<td data-in="${v}">${fmtIn(v)}</td>`).join('')}</tr>`).join('');
  return `
    <div class="sct" data-unit="in">
      <div class="sct__bar">
        <span class="mono">Garment measurements · <span data-unit-label>inches</span></span>
        <div class="sct__units mono" role="group" aria-label="Units">
          <button type="button" data-unit-btn="in" aria-pressed="true">in</button><button type="button" data-unit-btn="cm" aria-pressed="false">cm</button>
        </div>
      </div>
      <div class="sct__scroll"><table class="sct__t"><thead><tr><th scope="col">Size</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="sct__note">${esc("Chest is measured all the way round. To compare with a tee you own, lay it flat, measure armpit to armpit and double it. Supplier measurements, \u00b11 in. We re-check them on our own samples.")}</p>
    </div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-unit-btn]');
  if (!b) return;
  const unit = b.dataset.unitBtn;
  // every chart on the page follows, so the sheet and the accordion agree
  document.querySelectorAll('.sct').forEach(t => {
    t.dataset.unit = unit;
    t.querySelectorAll('td[data-in]').forEach(td => { const v = parseFloat(td.dataset.in); td.textContent = unit === 'cm' ? toCm(v) : fmtIn(v); });
    t.querySelectorAll('[data-unit-btn]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.unitBtn === unit)));
    const l = t.querySelector('[data-unit-label]'); if (l) l.textContent = unit === 'cm' ? 'centimetres' : 'inches';
    const n = t.querySelector('.sct__note'); if (n) n.textContent = n.textContent.replace(unit === 'cm' ? '±1 in' : '±2.5 cm', unit === 'cm' ? '±2.5 cm' : '±1 in');
  });
});

window.Mudra = {
  loadReservations, depositWindow, depositFor, get depositRupees() { return RESERVATIONS.depositRupees; },
  SHOPIFY, SIZES, ACCOUNT_URL, CART_URL, ShopError, ORDERING, isPreorder, arrivalRange,
  loadDrop, dropPhase, dropDates, saleState, canBuy, inDrop, closesIn, checkoutBlock, downloadIcs,
  tickerItems, heroTag, codNow, lineNote, get drop() { return DROP; },
  productUrl, productIdFromUrl, loadCatalogue, loadSprite, sellableColours,
  money, priceView, esc, pictureHTML, CARD_SIZES, wireHeader, renderBag, initBag, addToBag, flash,
  liveProduct, cart, sf, sizeTableHTML, openDrawer,
};

})();
