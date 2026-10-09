/* ==========================================================================
   Mudra: product page
   One template for every product: /p/{id} (Vercel rewrite) or
   /product.html?id={id} locally. Data comes from data/products.json.
   ========================================================================== */

const M = window.Mudra;
const { esc, money } = M;

const $ = s => document.querySelector(s);

const view = {
  product: null,
  garment: {},
  size: null,
  quantities: {},
  bagQuantities: {},
  saving: false,
  colour: null,
  shots: [],   // image media only
  zoomAt: 0,
};

/* ---------- boot ------------------------------------------------------ */

async function init() {
  M.wireHeader({ solid: true });
  const [, data, , site] = await Promise.all([
    M.loadSprite(), M.loadCatalogue(), M.loadDrop(),
    fetch('/data/site.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    M.loadReservations(),
  ]);
  view.site = site || {};
  const bagReady = M.initBag();

  const id = M.productIdFromUrl();
  const list = data.products;
  const p = list.find(x => x.id === id);
  view.garment = data.garment || {};

  if (!p) return renderMissing(id);

  view.product = p;
  view.shots = p.media.filter(m => m.type === 'img');
  // with real photography, the flat artwork lives in the "clean front, loud back"
  // section instead of the gallery, so it isn't shown twice
  view.art = artworkPair(p);
  const photos = view.shots.filter(m => !view.art.includes(m));
  if (view.art.length === 2 && photos.length >= 2) view.shots = photos; else view.art = [];
  const wanted = new URLSearchParams(location.search).get('c');
  view.colours = M.sellableColours(p);
  view.colour = view.colours.find(c => c.key === wanted) || view.colours[0] || null;
  view.price = p.price;
  view.variants = null;   // live Shopify variants by size, once loaded

  setMeta(p);
  renderCrumb(p);
  renderGallery(p);
  renderBuy(p);
  renderSides(p);
  renderRelated(p, list);
  wireSizeSheet();
  wireZoom();
  wireStickyBar();
  M.cart.onChange(() => {
    if (!view.saving) restoreBagSelection();
  });
  await bagReady;
  restoreBagSelection();
  if (M.SHOPIFY.enabled) loadLive(p);
}

/* ---------- live price + availability from Shopify -------------------- */

async function loadLive(p) {
  const atc = $('#atc');
  atc.disabled = true;
  atc.textContent = 'One moment';
  syncSticky();
  let live;
  try {
    live = await M.liveProduct(p.id);
  } catch (err) {
    showError(err.message);
    atc.textContent = 'Unavailable';
    syncSticky();
    return;
  }
  if (!live) return comingSoon();
  view.variants = live.variants;
  if (live.price != null) {
    view.price = live.price;
    view.live = live;
    $('#priceBlock').innerHTML = priceHTML(p);
  }
  document.querySelectorAll('.szbtn').forEach(b => {
    const ok = !!live.variants[b.dataset.size]?.available;
    b.disabled = !ok;
    b.toggleAttribute('aria-disabled', !ok);
  });
  if (view.size && !live.variants[view.size]?.available) view.size = null;
  const any = Object.values(live.variants).some(v => v.available);
  atc.disabled = !any;
  if (locked()) return paintLocked();
  // "Sold out" only when Shopify itself reports no size available
  if (!any) atc.textContent = 'Sold out';
  else if (view.size) atc.innerHTML = ctaHTML();
  else atc.textContent = 'Pick a size';
  syncSticky();
}

// Shopify doesn't know this handle yet
function comingSoon() {
  view.variants = {};
  document.querySelectorAll('.szbtn').forEach(b => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); });
  const atc = $('#atc');
  atc.disabled = true;
  atc.textContent = 'Coming soon';
  $('#sbBtn').textContent = 'Coming soon';
  $('#sbBtn').disabled = true;
  syncSticky();
}

function showError(msg) {
  const el = $('#atcErr');
  el.textContent = msg || '';
  el.hidden = !msg;
  $('#sbErr').textContent = msg || '';
  $('#sbErr').hidden = !msg;
}

/* ---------- head ------------------------------------------------------ */

function setMeta(p) {
  if (document.querySelector('link[rel="canonical"]')) return;   // pre-built page
  const title = `${p.name} · Mudra`;
  const desc = blurb(p);
  document.title = title;
  document.querySelector('meta[name="description"]').setAttribute('content', desc);
  const og = (prop, content) => {
    let m = document.querySelector(`meta[property="${prop}"]`);
    if (!m) { m = document.createElement('meta'); m.setAttribute('property', prop); document.head.appendChild(m); }
    m.setAttribute('content', content);
  };
  og('og:title', title);
  og('og:description', desc);
  if (view.shots[0]) og('og:image', new URL('/' + view.shots[0].src, location.origin).href);
  // pre-built /p/<id> pages already carry the right canonical + share tags
  if (document.querySelector('link[rel="canonical"]')) return;
  const canon = document.createElement('link');
  canon.rel = 'canonical';
  canon.href = new URL(`/p/${p.id}`, location.origin).href;
  document.head.appendChild(canon);
}

// Per-product copy can go in products.json as "blurb". Until then, a line
// built only from facts we already know: series + the front/back formula.
function blurb(p) {
  if (p.blurb) return p.blurb;
  return p.print === 'back'
    ? `${p.name}. A small stamp on the chest, the whole graphic on the back.`
    : `${p.name}. Chest print only.`;
}

const pad2 = n => String(n).padStart(2, '0');

/* ---------- crumb ----------------------------------------------------- */

function renderCrumb(p) {
  if ($('#crumb strong')) return;          // pre-built /p/<id> pages already end with the name
  $('#crumb').insertAdjacentHTML('beforeend',
    ` <span>/</span> <strong>${esc(p.name)}</strong>`);
}

/* ---------- gallery --------------------------------------------------- */

// mirrors GALLERY_SIZES / RELATED_SIZES in scripts/build_seo.py
const GALLERY_SIZES = '(max-width: 900px) 100vw, 30vw';
const RELATED_SIZES = '(max-width: 1000px) 50vw, 25vw';

function renderGallery(p) {
  const track = $('#track');
  track.innerHTML = view.shots.map((m, i) => `
    <button class="gshot" data-i="${i}" aria-label="Enlarge image ${i + 1} of ${view.shots.length}">
      ${M.pictureHTML(m, { loading: i < 2 ? 'eager' : 'lazy', sizes: GALLERY_SIZES, extra: i === 0 ? ' fetchpriority="high"' : '' })}
    </button>`).join('');

  track.classList.toggle('odd', view.shots.length % 2 === 1);

  if (p.badge) track.insertAdjacentHTML('beforebegin',
    `<span class="pbadge ${p.badge.type} gallery__badge">${esc(p.badge.label)}</span>`);

  track.addEventListener('click', e => {
    const b = e.target.closest('.gshot');
    if (b) openZoom(Number(b.dataset.i));
  });

  // mobile: the track scrolls sideways; keep the counter honest
  const count = $('#gcount');
  const total = view.shots.length;
  const setCount = i => { count.textContent = `${pad2(i + 1)} / ${pad2(total)}`; };
  setCount(0);
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting && en.intersectionRatio > .6) setCount(Number(en.target.dataset.i)); });
  }, { root: track, threshold: [.6] });
  track.querySelectorAll('.gshot').forEach(s => io.observe(s));
}

/* ---------- buy box --------------------------------------------------- */

function renderBuy(p) {
  const g = view.garment;
  const sizes = p.sizes.map(s => `
    <div class="szchoice">
      <button type="button" class="szbtn" data-size="${s.size}" ${s.available ? '' : 'disabled aria-disabled="true"'}
              aria-pressed="false" aria-label="Add one ${esc(SIZE_NAMES[s.size] || s.size)} shirt">${s.size}</button>
      <span class="szchoice__count" aria-hidden="true" hidden>0</span>
      <button type="button" class="szchoice__remove" data-remove-size="${s.size}" aria-label="Remove all ${esc(SIZE_NAMES[s.size] || s.size)} shirts" hidden>×</button>
    </div>`).join('');
  const swatches = view.colours.map(c => `
    <button class="cswatch${view.colour && c.key === view.colour.key ? ' on' : ''}" data-colour="${c.key}"
            style="--sw:${c.hex}" aria-label="${esc(c.name)}" title="${esc(c.name)}"
            aria-pressed="${view.colour && c.key === view.colour.key}"></button>`).join('');
  const anyStock = p.sizes.some(s => s.available);

  // small line icons from the sprite (i-<name>), decorative: the label carries the meaning
  const icon = n => (n ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${esc(n)}"/></svg>` : '');
  const details = (g.details || []).map(r => {
    const [k, v, n] = Array.isArray(r) ? [r[0], r[1], ''] : [r.label, r.value, r.icon];
    return `<div>${icon(n)}<dt class="mono">${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
  }).join('');
  const care = (g.care || []).map(c => typeof c === 'string'
    ? `<li>${esc(c)}</li>`
    : `<li>${icon(c.icon)}<span>${esc(c.text)}</span></li>`).join('');

  $('#buy').innerHTML = `
    <h1 class="buy__name">${esc(p.name)}</h1>

    <div class="buy__price" id="priceBlock">${priceHTML(p)}</div>

    <p class="buy__blurb">${esc(blurb(p))}</p>

    ${swatches ? `
    <div class="opt">
      <div class="opt__head"><span class="mono">Colour</span><span class="mono opt__val" id="colourName">${esc(view.colour?.name || '')}</span></div>
      <div class="cswatches" id="swatches">${swatches}</div>
    </div>` : ''}

    <div class="opt" id="sizeOpt">
      <div class="opt__head">
        <span class="mono">Size</span>
        <button class="mono linkish" data-size-guide>Size guide</button>
      </div>
      <div class="sizes5" id="sizes" role="group" aria-label="Size">${sizes}</div>
      <p class="opt__hint mono" id="sizeHint">Cut oversized on purpose. Take your usual size.</p>
      <p class="opt__hint mono" id="productBagStatus" role="status" hidden></p>
    </div>

    <button class="buy__atc" id="atc" ${anyStock ? '' : 'disabled'}>${anyStock ? 'Pick a size' : 'Sold out'}</button>
    ${teaserActionsHTML(p)}
    ${infoBoxHTML(p)}
    <p class="buy__err mono" id="atcErr" role="alert" hidden></p>

    <div class="twoside">
      <div><span class="mono">Front</span><p>Small stamp, left chest.</p></div>
      <div><span class="mono">Back</span><p>${p.print === 'back' ? 'The full graphic.' : 'Nothing. On purpose.'}</p></div>
    </div>

    <div class="acc">
      <details open>
        <summary class="mono">Details</summary>
        <dl class="spec-dl">${details}</dl>
      </details>
      ${g.printMethod ? `
      <details>
        <summary class="mono">How the print is made</summary>
        <p class="acc__p acc__p--ico">${icon('print')}<span>${esc(g.printMethod)}</span></p>
      </details>` : ''}
      <details>
        <summary class="mono">Size &amp; fit</summary>
        <div class="acc__body" data-size-body></div>
      </details>
      <details>
        <summary class="mono">Care</summary>
        <ul class="acc__list care-list">${care}</ul>
        ${g.careNote ? `<p class="acc__p acc__note">${esc(g.careNote)}</p>` : ''}
      </details>
      <details>
        <summary class="mono">Shipping</summary>
        <p class="acc__p">${esc(shippingText(p))}</p>
      </details>
      <details>
        <summary class="mono">Returns</summary>
        <p class="acc__p">${esc(g.returns || '')}</p>
      </details>
      ${g.colourNote ? `
      <details>
        <summary class="mono">Colour note</summary>
        <p class="acc__p acc__p--ico">${icon('screen')}<span>${esc(g.colourNote)}</span></p>
      </details>` : ''}
    </div>`;

  // the "Take your usual size" hint is a fit claim; only show it once a chart exists
  if (!g.sizeChart) $('#sizeHint').textContent = 'Cut oversized, drop shoulder.';

  document.querySelectorAll('[data-size-body]').forEach(el => { el.innerHTML = sizeGuideHTML(); });

  $('#sizes').addEventListener('click', e => {
    if ($('#atc').disabled || locked()) return;
    const remove = e.target.closest('[data-remove-size]');
    if (remove && !remove.disabled) {
      const size = remove.dataset.removeSize;
      delete view.quantities[size];
      showError('');
      syncSticky();
      document.querySelector(`#sizes [data-size="${size}"]`).focus({ preventScroll: true });
      return;
    }
    const b = e.target.closest('.szbtn');
    if (!b || b.disabled) return;
    selectSize(b.dataset.size);
  });

  $('#swatches')?.addEventListener('click', e => {
    const b = e.target.closest('.cswatch');
    if (!b) return;
    document.querySelectorAll('.cswatch').forEach(x => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('on');
    b.setAttribute('aria-pressed', 'true');
    view.colour = view.colours.find(c => c.key === b.dataset.colour);
    $('#colourName').textContent = view.colour.name;
    restoreBagSelection(true);
    syncSticky();
  });

  $('#atc').addEventListener('click', e => addCurrent(e.currentTarget));
  $('#icsBtn')?.addEventListener('click', () => M.downloadIcs(p.name));
  if (locked()) paintLocked();
}

/* ---------- Drop 01 phases (data/drop.json) ---------------------------- */

const locked = () => !M.canBuy(view.product.id);

// the disabled main button outside the pre-order window
function lockedLabel() {
  const st = M.saleState(view.product.id), d = M.dropDates();
  if (st === 'teaser') return `Opens ${d.opensLong}`;
  if (st === 'closed') return 'Pre-orders closed';
  if (st === 'notInDrop') return 'Not available yet';
  return '';
}

function paintLocked() {
  const label = lockedLabel();
  const atc = $('#atc'), sb = $('#sbBtn');
  atc.disabled = true;
  atc.classList.remove('ready');
  atc.textContent = label;
  sb.disabled = true;
  sb.textContent = label;
  syncSticky();
}

// teaser only: calendar file + follow link
function teaserActionsHTML(p) {
  if (M.saleState(p.id) !== 'teaser') return '';
  const ig = view.site.instagram;
  return `
    <div class="dropx">
      <button class="dropx__cal mono" id="icsBtn" type="button">Add to calendar</button>
      ${ig ? `<a class="linkish mono" href="${esc(ig)}" target="_blank" rel="noopener">Follow for updates</a>` : ''}
    </div>`;
}

// the quiet box under the button: drop facts, or the 7–10 day delivery window after launch
function infoBoxHTML(p) {
  const st = M.saleState(p.id), d = M.dropDates();
  const box = (tag, right, note, extra = '') => `
    <aside class="preorder" role="note" aria-label="${esc(tag)} details">
      <div class="preorder__head">
        <span class="mono preorder__tag">${esc(tag)}</span>
        <span class="mono preorder__date">${esc(right)}</span>
        ${extra ? `<span class="mono preorder__closes">${esc(extra)}</span>` : ''}
      </div>
      <p class="preorder__note">${esc(note)}</p>
    </aside>`;
  const prepaid = M.drop && M.drop.prepaidOnly ? ' Prepaid only for pre-orders.' : '';
  if (st === 'teaser') return box('Pre-order', `Opens ${d.opensLong}`,
    `Pre-orders run ${d.opensShort} to ${d.closesShort}. Everything is made in one run after they close, and ships by ${d.shipsShort}.${prepaid}`);
  if (st === 'open') return box('Pre-orders open', `Ships by ${d.shipsLong}`,
    M.depositWindow() ? `Pre-order @ ${money(M.depositRupees)} per tee. Orders open ${d.launchShort}. Your deposit locks only your selected tees, sizes and quantities. Pay the remaining balance from launch, before dispatch.` : `Made in one run after pre-orders close on ${d.closesShort}.${prepaid}`, M.closesIn());
  if (st === 'closed') return box('Printing now', `Ships by ${d.shipsLong}`,
    `Pre-orders are closed and printing now. They ship by ${d.shipsShort}. Missed it? This design comes back after launch.`);
  if (st === 'notInDrop') return box('Not available yet', '',
    `This design isn't up for pre-order. It comes back after launch.`);
  if (!M.isPreorder()) return '';
  return box('Pre-order', `Arrives ${M.arrivalRange().text}`,
    'At your door in 7–10 days, counted from the day you order. Free shipping across India.');
}

// Shipping accordion: drop dates while the drop runs, the delivery window after launch
function shippingText(p) {
  const st = M.saleState(p.id), d = M.dropDates();
  if (['teaser', 'open', 'closed'].includes(st)) {
    const prepaid = M.drop.prepaidOnly ? ' Prepaid only for pre-orders; cash on delivery comes back after launch.' : '';
    return `Pre-orders run ${d.opensShort} to ${d.closesShort}, are made in one run after they close, and ship by ${d.shipsShort}. Free shipping across India.${prepaid}`;
  }
  return view.garment.shipping || '';
}

// struck MRP, the price (highlighted while pre-orders run), and what it becomes after.
// Keep in step with the static block in scripts/build_seo.py.
function priceHTML(p) {
  const v = M.priceView(p, view.live), d = M.dropDates();
  if (M.depositWindow()) return `<p class="mono buy__label">Pre-order @</p>
    <div class="buy__pricerow"><span class="price is-pre" id="price"><span class="price__num">${money(M.depositRupees)}</span></span></div>
    <p class="mono buy__tax">Deposit per tee · Full tee price ${money(v.now)}</p>
    <aside class="pricenote" role="note"><p class="pricenote__text">Pay ${money(M.depositRupees)} now to reserve this tee. Balance ${money(v.now - M.depositRupees)} when orders open on ${esc(M.dropDates().launchShort)}. Free shipping. Refundable before dispatch.</p></aside>`;
  const closes = d ? d.closesShort : '';
  // DOM order is MRP then price, so screen readers hear "MRP ₹1,600, Pre-order price ₹1,299";
  // CSS puts the price first visually. The visible label repeats the sr text, so it's hidden from AT.
  return `
    ${v.pre ? '<p class="mono buy__label" aria-hidden="true">Pre-order price</p>' : ''}
    <div class="buy__pricerow">
      ${v.mrp ? `<s class="mono buy__mrp">MRP ${money(v.mrp)}</s>` : ''}
      <span class="price${v.pre ? ' is-pre' : ''}" id="price"><span class="sr">${v.pre ? 'Pre-order price ' : 'Price '}</span><span class="price__num">${money(v.now)}</span></span>
    </div>
    <p class="mono buy__tax">Inclusive of all taxes · Free shipping</p>
    ${v.regular && closes ? `<aside class="pricenote" role="note" aria-label="Price after pre-orders close">
      <div class="pricenote__row"><span class="mono">After ${esc(closes)}</span><span class="pricenote__price">${money(v.regular)}</span></div>
      <p class="pricenote__text">The pre-order price ends when pre-orders close.</p>
    </aside>` : ''}`;
}

// main button once a size is picked; the price part drops on very narrow phones (product.css)
function ctaHTML() {
  if (M.SHOPIFY.enabled && Object.keys(view.bagQuantities).length) {
    return bagSelectionChanged() ? 'Update bag' : 'View bag';
  }
  const price = selectionTotal() || view.price;
  if (M.depositWindow()) {
    const count = Object.values(view.quantities).reduce((n, qty) => n + qty, 0) || 1;
    return `Pre-order @ ${money(count * M.depositRupees)}`;
  }
  // drop window: "Pre-order now · ₹1,199"; narrow phones keep just "Pre-order"
  if (M.saleState(view.product.id) === 'open') return `Pre-order<span class="atc__price"> now · ${money(price)}</span>`;
  return M.isPreorder()
    ? `Pre-order<span class="atc__price"> · ${money(price)}</span>`
    : `Add to bag · ${money(price)}`;
}

function selectSize(size) {
  view.size = size;
  view.quantities[size] = (view.quantities[size] || 0) + 1;
  document.querySelectorAll('.szbtn').forEach(b => {
    const on = !!view.quantities[b.dataset.size];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#sizeOpt').classList.remove('need');
  if (locked()) { syncSticky(); return; }
  const atc = $('#atc');
  atc.innerHTML = ctaHTML();
  showError('');
  atc.classList.add('ready');
  syncSticky();
}

async function addCurrent(btn) {
  if (!selectionCount() && !bagSelectionChanged()) {
    openPurchaseSizes();
    return;
  }
  const p = view.product;
  if (M.SHOPIFY.enabled && !bagSelectionChanged() && selectionCount()) {
    location.href = M.CART_URL;
    return;
  }
  view.saving = true;
  const busy = [$('#atc'), $('#sbBtn')];
  busy.forEach(b => { b.disabled = true; });
  $('#sbSize').disabled = true;
  syncSticky();
  btn.setAttribute('aria-busy', 'true');
  showError('');
  try {
    const items = Object.entries(view.quantities).filter(([,quantity]) => quantity > 0).map(([size, quantity]) => ({
      id: p.id,
      variantId: view.variants?.[size]?.id,
      name: p.name,
      size,
      quantity,
      colour: view.colour?.name,
      image: view.shots[0] ? '/' + view.shots[0].src : null,
      price: sizePrice(size),
    }));
    if (M.SHOPIFY.enabled && productBagLines().length) {
      await M.cart.replaceLines(productBagLines(), items.map(x => ({
        merchandiseId: x.variantId, quantity: x.quantity,
        attributes: x.colour ? [{ key: 'Colour', value: x.colour }] : [],
      })));
      M.flash(btn, 'Bag updated');
      if (items.length) M.openDrawer({ ...items[0], size: selectionLabel(), price: selectionTotal() }, btn);
    } else if (items.length) await M.addToBag(items, btn);
  } catch (err) {
    showError(err.message || "Couldn't add that. Try again.");
  } finally {
    view.saving = false;
    restoreBagSelection(true);
    busy.forEach(b => { b.disabled = false; });
    btn.removeAttribute('aria-busy');
    syncSticky();
    // The confirmation flash restores its old label; refresh it from the saved bag.
    setTimeout(syncSticky, 1500);
  }
}

/* ---------- size guide ------------------------------------------------ */

function sizeGuideHTML() {
  const g = view.garment;
  const chart = g.sizeChart;
  if (!chart || !chart.rows?.length) {
    return `<p class="acc__p">We're measuring the samples ourselves before we publish a chart.
      Guessing isn't a size guide.</p>
      <p class="acc__p mono small">Cut: oversized · drop shoulder · boxy</p>`;
  }
  return `${M.sizeTableHTML(g)}
    <p class="acc__p acc__p--tight">Oversized and boxy with a dropped shoulder. Take your usual size for the oversized look, or one down if you like it closer.</p>
    <a class="linkish mono sct__more" href="/size-guide">How to measure →</a>`;
}

function wireSizeSheet() {
  const sheet = $('#sizeSheet');
  $('#sizeSheetBody').innerHTML = sizeGuideHTML();
  document.addEventListener('click', e => {
    if (e.target.closest('[data-size-guide]')) { e.preventDefault(); sheet.showModal(); }
  });
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-close]') || e.target === sheet) sheet.close();
  });
}

/* ---------- zoom ------------------------------------------------------ */

function openZoom(i) {
  view.zoomAt = i;
  paintZoom();
  $('#zoom').showModal();
}
function paintZoom() {
  const m = view.shots[view.zoomAt];
  const img = $('#zoomImg');
  img.src = '/' + m.src;
  img.alt = m.alt;
  $('#zoomCount').textContent = `${pad2(view.zoomAt + 1)} / ${pad2(view.shots.length)}`;
}
function stepZoom(dir) {
  const n = view.shots.length;
  view.zoomAt = (view.zoomAt + dir + n) % n;
  paintZoom();
}
function wireZoom() {
  const z = $('#zoom');
  z.addEventListener('click', e => {
    const nav = e.target.closest('.zoom__nav');
    if (nav) return stepZoom(Number(nav.dataset.dir));
    if (e.target.closest('[data-close]') || e.target === z) z.close();
  });
  z.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') stepZoom(1);
    if (e.key === 'ArrowLeft') stepZoom(-1);
  });
  let x0 = null;
  z.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  z.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) stepZoom(dx < 0 ? 1 : -1);
    x0 = null;
  });
}

/* ---------- clean front, loud back ----------------------------------- */

// the flat artwork slides, by the naming rule {id}-back.jpg / {id}-front.jpg
function artworkPair(p) {
  const img = p.media.filter(m => m.type === 'img' && !/hanger/.test(m.src));
  const back = img.find(m => /-back\.jpg$/.test(m.src));
  const front = img.find(m => /-front\.jpg$/.test(m.src));
  return back && front ? [back, front] : [];
}

function renderSides(p) {
  if (view.art.length !== 2 || p.print !== 'back') return;
  const [back, front] = view.art;
  const el = $('#sides');
  el.innerHTML = `
    <div class="sides__head">
      <h2>CLEAN FRONT.<em>LOUD BACK.</em></h2>
      <p>Every tee works the same way. The front minds its own business. The back doesn't.</p>
    </div>
    <div class="sides__pair">
      <figure><img src="/${front.src}" alt="${esc(front.alt)}" loading="lazy" width="800" height="1000"><figcaption class="mono">Front</figcaption></figure>
      <figure><img src="/${back.src}" alt="${esc(back.alt)}" loading="lazy" width="800" height="1000"><figcaption class="mono">Back</figcaption></figure>
    </div>`;
  el.hidden = false;
}

/* ---------- related --------------------------------------------------- */

function renderRelated(p, list) {
  const same = list.filter(x => x.id !== p.id && x.series === p.series);
  const rest = list.filter(x => x.id !== p.id && x.series !== p.series);
  const picks = [...same, ...rest].slice(0, 4);
  if (!picks.length) return;
  $('#relatedTitle').textContent = 'MORE';
  $('#rgrid').innerHTML = picks.map(x => {
    const img = x.media.find(m => m.type === 'img');
    return `
    <a class="rcard" href="${M.productUrl(x.id)}">
      <div class="rcard__img">${img ? M.pictureHTML(img, { sizes: RELATED_SIZES }) : ''}</div>
      <div class="rcard__meta">
        <h3>${esc(x.name)}</h3>
        <span class="pprice">${M.depositWindow() ? `Pre-order @ ${money(M.depositRupees)}` : money(x.price)}</span>
      </div>
    </a>`;
  }).join('');
  $('#related').hidden = false;
}

/* ---------- persistent purchase bar ---------------------------------- */

const SIZE_NAMES = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large', XXL: '2X large' };
function productBagLines() {
  return (M.cart.state?.lines.nodes || []).filter(line =>
    line.merchandise.product.handle === view.product.id &&
    (line.attributes.find(a => a.key === 'Colour')?.value || '').toLowerCase() === (view.colour?.name || '').toLowerCase());
}
function bagSelectionChanged() {
  return view.product.sizes.some(({ size }) => (view.quantities[size] || 0) !== (view.bagQuantities[size] || 0));
}
function restoreBagSelection(force = false) {
  if (!M.SHOPIFY.enabled) return;
  const dirty = bagSelectionChanged();
  const quantities = {};
  for (const line of productBagLines()) {
    const size = line.merchandise.selectedOptions.find(o => o.name.toLowerCase() === 'size')?.value;
    if (size) quantities[size] = (quantities[size] || 0) + line.quantity;
  }
  view.bagQuantities = quantities;
  if (force || !dirty) view.quantities = { ...quantities };
  syncSticky();
}
function sizePrice(size) { return view.variants?.[size]?.price ?? view.price; }
function selectionCount() { return Object.values(view.quantities).reduce((n, q) => n + q, 0); }
function selectionTotal() { return Object.entries(view.quantities).reduce((n, [s, q]) => n + sizePrice(s) * q, 0); }
function selectionLabel() {
  return Object.entries(view.quantities).filter(([, q]) => q > 0).map(([s, q]) => q > 1 ? `${s} × ${q}` : s).join(', ');
}

function syncSticky() {
  const p = view.product, main = $('#atc'), btn = $('#sbBtn'), picker = $('#sbSize');
  if (view.variants !== null) {
    for (const size of Object.keys(view.quantities)) {
      if (!view.variants[size]?.available) delete view.quantities[size];
    }
  }
  view.size = Object.keys(view.quantities)[0] || null;
  const count = selectionCount();
  const savedCount = Object.values(view.bagQuantities).reduce((sum, quantity) => sum + quantity, 0);
  const bagStatus = $('#productBagStatus');
  bagStatus.hidden = !savedCount;
  bagStatus.textContent = `${savedCount} shirt${savedCount === 1 ? '' : 's'} already in your bag`;
  $('#sbMeta').textContent = [M.depositWindow() ? `Pre-order @ ${money((count || 1) * M.depositRupees)}` : money(count ? selectionTotal() : view.price), view.colour?.name, selectionLabel()].filter(Boolean).join(' · ');
  picker.disabled = main.disabled || locked();
  btn.disabled = main.disabled || locked();
  picker.innerHTML = `${count ? esc(selectionLabel()) : 'Choose sizes'} <span aria-hidden="true">⌃</span>`;
  document.querySelectorAll('#sizes .szbtn').forEach(b => {
    const size = b.dataset.size, quantity = view.quantities[size] || 0, on = quantity > 0;
    const available = view.variants === null ? p.sizes.find(s => s.size === size)?.available : view.variants[size]?.available;
    b.disabled = !available || main.disabled || locked();
    b.toggleAttribute('aria-disabled', b.disabled);
    b.setAttribute('aria-label', `Add one ${SIZE_NAMES[size] || size} shirt, ${quantity} selected`);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    const tile = b.closest('.szchoice'), badge = tile.querySelector('.szchoice__count'), remove = tile.querySelector('.szchoice__remove');
    badge.textContent = quantity;
    badge.hidden = !on;
    remove.hidden = !on;
    remove.disabled = main.disabled || locked();
    tile.classList.toggle('is-selected', on);
  });
  document.querySelectorAll('[data-purchase-row]').forEach(row => {
    const size = row.dataset.purchaseRow, q = view.quantities[size] || 0;
    const available = view.variants === null ? view.product.sizes.find(s => s.size === size)?.available : view.variants[size]?.available;
    row.querySelector('output').textContent = q;
    row.querySelector('[data-quantity="-1"]').disabled = !q || main.disabled || locked();
    row.querySelector('[data-quantity="1"]').disabled = !available || main.disabled || locked();
    row.querySelector('.sizepick__availability').hidden = !!available;
  });
  $('#purchaseSizesTotal').textContent = `${count} shirt${count === 1 ? '' : 's'} · ${M.depositWindow() ? `${money(count * M.depositRupees)} deposit` : money(selectionTotal())}`;
  if (locked()) { btn.textContent = lockedLabel(); return; }
  if (main.disabled) { btn.textContent = main.textContent; return; }
  if (!main.classList.contains('done')) {
    main.innerHTML = count || bagSelectionChanged() ? ctaHTML() : 'Pick a size';
    main.classList.toggle('ready', !!count);
  }
  if (btn.classList.contains('done')) return;
  const verb = M.saleState(p.id) === 'open' ? 'Pre-order now' : M.isPreorder() ? 'Pre-order' : 'Add to bag';
  btn.textContent = Object.keys(view.bagQuantities).length ? (bagSelectionChanged() ? 'Update bag' : 'View bag') : count ? verb : 'Choose sizes';
}

function positionPurchaseSizes() {
  if (matchMedia('(max-width:760px)').matches) return;
  const rect = $('#sbSize').getBoundingClientRect(), panel = $('#purchaseSizes');
  const width = Math.min(420, innerWidth - 32);
  panel.style.setProperty('--picker-left', `${Math.max(16, Math.min(rect.left, innerWidth - width - 16))}px`);
  panel.style.setProperty('--picker-bottom', `${innerHeight - rect.top + 12}px`);
}

function openPurchaseSizes() {
  if ($('#sbSize').disabled) return;
  const panel = $('#purchaseSizes');
  positionPurchaseSizes();
  if (!panel.open) panel.showModal();
  $('#sbSize').setAttribute('aria-expanded', 'true');
}

function wireStickyBar() {
  const bar = $('#stickybar'), panel = $('#purchaseSizes');
  $('#purchaseSizesRows').innerHTML = view.product.sizes.map(s => {
    const name = SIZE_NAMES[s.size] || s.size;
    return `<div class="sizepick__row" data-purchase-row="${esc(s.size)}">
      <div><span class="sizepick__label">${esc(name)}</span><span class="mono sizepick__code">${esc(s.size)}</span><span class="mono sizepick__availability" hidden>Unavailable</span></div>
      <div class="sizepick__stepper">
        <button type="button" data-quantity="-1" aria-label="Remove one ${esc(name)} shirt">−</button>
        <output aria-label="${esc(name)} quantity">0</output>
        <button type="button" data-quantity="1" aria-label="Add one ${esc(name)} shirt">+</button>
      </div></div>`;
  }).join('');
  $('#purchaseSizesRows').addEventListener('click', e => {
    const button = e.target.closest('[data-quantity]');
    if (!button || button.disabled) return;
    const size = button.closest('[data-purchase-row]').dataset.purchaseRow;
    const quantity = Math.max(0, (view.quantities[size] || 0) + Number(button.dataset.quantity));
    if (quantity) view.quantities[size] = quantity; else delete view.quantities[size];
    showError('');
    syncSticky();
  });
  $('#sbSize').addEventListener('click', openPurchaseSizes);
  $('#sbBtn').addEventListener('click', () => selectionCount() || bagSelectionChanged() ? addCurrent($('#sbBtn')) : openPurchaseSizes());
  $('#purchaseSizesClose').addEventListener('click', () => panel.close());
  $('#purchaseSizesDone').addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => {
    $('#sbSize').setAttribute('aria-expanded', 'false');
    $('#sbSize').focus({ preventScroll: true });
  });
  panel.addEventListener('click', e => {
    if (e.target !== panel) return;
    const r = panel.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) panel.close();
  });
  addEventListener('resize', () => { if (panel.open) positionPurchaseSizes(); }, { passive: true });
  bar.classList.add('on');
  bar.setAttribute('aria-hidden', 'false');
  bar.inert = false;
  syncSticky();
}

/* ---------- not found ------------------------------------------------- */

function renderMissing(id) {
  document.title = 'Not found · Mudra';
  $('.pdp-grid').innerHTML = `
    <div class="missing">
      <h1>THAT ONE DOESN'T EXIST.<em>YET.</em></h1>
      <p class="mono">${id ? `No tee called “${esc(id)}”.` : 'No tee picked.'}</p>
      <a class="btn" href="/#shop">See what does</a>
    </div>`;
}

init();
