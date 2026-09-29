/* ==========================================================================
   Mudra Studios: product page
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
  ]);
  view.site = site || {};
  M.initBag();

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
  if (M.SHOPIFY.enabled) loadLive(p);
}

/* ---------- live price + availability from Shopify -------------------- */

async function loadLive(p) {
  const atc = $('#atc');
  atc.disabled = true;
  atc.textContent = 'One moment';
  let live;
  try {
    live = await M.liveProduct(p.id);
  } catch (err) {
    showError(err.message);
    atc.textContent = 'Unavailable';
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
}

function showError(msg) {
  const el = $('#atcErr');
  el.textContent = msg || '';
  el.hidden = !msg;
}

/* ---------- head ------------------------------------------------------ */

function setMeta(p) {
  if (document.querySelector('link[rel="canonical"]')) return;   // pre-built page
  const title = `${p.name} · ${p.seriesLabel} series · Mudra Studios`;
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
    ? `${p.name}, from the ${p.seriesLabel} series. A small stamp on the chest, the whole graphic on the back.`
    : `${p.name}, from the ${p.seriesLabel} series. Chest print only.`;
}

const pad2 = n => String(n).padStart(2, '0');

/* ---------- crumb ----------------------------------------------------- */

function renderCrumb(p) {
  $('#crumb').insertAdjacentHTML('beforeend',
    ` <span>/</span> <a href="/#shop">${esc(p.seriesLabel)}</a> <span>/</span> <strong>${esc(p.name)}</strong>`);
}

/* ---------- gallery --------------------------------------------------- */

function renderGallery(p) {
  const track = $('#track');
  track.innerHTML = view.shots.map((m, i) => `
    <button class="gshot" data-i="${i}" aria-label="Enlarge image ${i + 1} of ${view.shots.length}">
      <img src="/${m.src}" alt="${esc(m.alt)}" width="800" height="1000"
           loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async"${i === 0 ? ' fetchpriority="high"' : ''}>
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
  const total = 16;
  const sizes = p.sizes.map(s => `
    <button class="szbtn" data-size="${s.size}" ${s.available ? '' : 'disabled aria-disabled="true"'}
            aria-pressed="false">${s.size}</button>`).join('');
  const swatches = view.colours.map(c => `
    <button class="cswatch${view.colour && c.key === view.colour.key ? ' on' : ''}" data-colour="${c.key}"
            style="--sw:${c.hex}" aria-label="${esc(c.name)}" title="${esc(c.name)}"
            aria-pressed="${view.colour && c.key === view.colour.key}"></button>`).join('');
  const anyStock = p.sizes.some(s => s.available);

  const details = (g.details || []).map(([k, v]) =>
    `<div><dt class="mono">${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const care = (g.care || []).map(c => `<li>${esc(c)}</li>`).join('');

  $('#buy').innerHTML = `
    <div class="buy__top">
      ${p.no ? `<span class="pno mono">Nº ${pad2(p.no)} <em>/ ${total}</em></span>` : ''}
      <span class="mono buy__series">${esc(p.seriesLabel)} series</span>
    </div>

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
      <details>
        <summary class="mono">Size &amp; fit</summary>
        <div class="acc__body" data-size-body></div>
      </details>
      <details>
        <summary class="mono">Care</summary>
        <ul class="acc__list">${care}</ul>
      </details>
      <details>
        <summary class="mono">Shipping</summary>
        <p class="acc__p">${esc(shippingText(p))}</p>
      </details>
      <details>
        <summary class="mono">Returns</summary>
        <p class="acc__p">${esc(g.returns || '')}</p>
      </details>
    </div>`;

  // the "Take your usual size" hint is a fit claim; only show it once a chart exists
  if (!g.sizeChart) $('#sizeHint').textContent = 'Cut oversized, drop shoulder.';

  document.querySelectorAll('[data-size-body]').forEach(el => { el.innerHTML = sizeGuideHTML(); });

  $('#sizes').addEventListener('click', e => {
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
  if (st === 'notInDrop') return `Not in ${d.name}`;
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
}

// teaser only: calendar file + follow link
function teaserActionsHTML(p) {
  if (M.saleState(p.id) !== 'teaser') return '';
  const ig = view.site.instagram;
  return `
    <div class="dropx">
      <button class="dropx__cal mono" id="icsBtn" type="button">Add to calendar</button>
      ${ig ? `<a class="linkish mono" href="${esc(ig)}" target="_blank" rel="noopener">Follow for the drop</a>` : ''}
    </div>`;
}

// the quiet box under the button: drop facts, or the print-to-order window after launch
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
  if (st === 'teaser') return box(d.name, `Opens ${d.opensLong}`,
    `Pre-orders run ${d.opensShort} to ${d.closesShort}. ${d.name} is made in one run after they close, and ships by ${d.shipsShort}.${prepaid}`);
  if (st === 'open') return box('Pre-orders open', `Ships by ${d.shipsLong}`,
    `${d.name} is made in one run after pre-orders close on ${d.closesShort}. We print what you order, nothing more.${prepaid}`, M.closesIn());
  if (st === 'closed') return box(d.name, `Ships by ${d.shipsLong}`,
    `Printing ${d.name} now. Pre-orders ship by ${d.shipsShort}. Missed it? This design comes back after launch.`);
  if (st === 'notInDrop') return box(`Not in ${d.name}`, '',
    `This design isn't part of ${d.name}. It comes back after launch.`);
  if (!M.isPreorder()) return '';
  return box('Pre-order', `Arrives ${M.arrivalRange().text}`,
    "Printed for you after you order. We're new, so we print to order instead of guessing and bulk-printing. Once we know what you like, we'll keep stock and this gets faster.");
}

// Shipping accordion: drop dates while the drop runs, print-to-order after launch
function shippingText(p) {
  const st = M.saleState(p.id), d = M.dropDates();
  if (['teaser', 'open', 'closed'].includes(st)) {
    const prepaid = M.drop.prepaidOnly ? ' Prepaid only for pre-orders; cash on delivery comes back after launch.' : '';
    return `${d.name} pre-orders run ${d.opensShort} to ${d.closesShort}, are made in one run after they close, and ship by ${d.shipsShort}. Free shipping across India.${prepaid}`;
  }
  return view.garment.shipping || '';
}

// struck MRP, the price (highlighted while pre-orders run), and what it becomes after.
// Keep in step with the static block in scripts/build_seo.py.
function priceHTML(p) {
  const v = M.priceView(p, view.live), d = M.dropDates();
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
  // drop window: "Pre-order now · ₹1,199"; narrow phones keep just "Pre-order"
  if (M.saleState(view.product.id) === 'open') return `Pre-order<span class="atc__price"> now · ${money(view.price)}</span>`;
  return M.isPreorder()
    ? `Pre-order<span class="atc__price"> · ${money(view.price)}</span>`
    : `Add to bag · ${money(view.price)}`;
}

function selectSize(size) {
  view.size = size;
  document.querySelectorAll('.szbtn').forEach(b => {
    const on = b.dataset.size === size;
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
  if (!view.size) {
    const opt = $('#sizeOpt');
    opt.classList.remove('need'); void opt.offsetWidth; opt.classList.add('need');
    opt.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const p = view.product;
  const busy = [$('#atc'), $('#sbBtn')];
  busy.forEach(b => { b.disabled = true; });
  btn.setAttribute('aria-busy', 'true');
  showError('');
  try {
    await M.addToBag({
      id: p.id,
      variantId: view.variants?.[view.size]?.id,
      name: p.name,
      size: view.size,
      colour: view.colour?.name,
      image: view.shots[0] ? '/' + view.shots[0].src : null,
      price: view.price,
    }, btn);
  } catch (err) {
    showError(err.message || "Couldn't add that. Try again.");
  } finally {
    busy.forEach(b => { b.disabled = false; });
    btn.removeAttribute('aria-busy');
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
  const cols = chart.columns;
  return `
    <table class="sizetable">
      <thead><tr><th class="mono">Size</th>${cols.map(c => `<th class="mono">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${chart.rows.map(r => `<tr><th class="mono">${esc(r.size)}</th>${r.values.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="acc__p mono small">Garment measurements in ${esc(g.sizeChartUnit || 'in')}, laid flat.</p>`;
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
  $('#relatedTitle').textContent = same.length ? `MORE ${p.seriesLabel.toUpperCase()}` : 'KEEP LOOKING';
  $('#rgrid').innerHTML = picks.map(x => {
    const img = x.media.find(m => m.type === 'img');
    return `
    <a class="rcard" href="${M.productUrl(x.id)}">
      <div class="rcard__img">${img ? `<img src="/${img.src}" alt="${esc(img.alt)}" loading="lazy" width="800" height="1000">` : ''}</div>
      <div class="rcard__meta">
        <span class="mono">${esc(x.seriesLabel)}</span>
        <h3>${esc(x.name)}</h3>
        <span class="pprice">${money(x.price)}</span>
      </div>
    </a>`;
  }).join('');
  $('#related').hidden = false;
}

/* ---------- mobile sticky bar ---------------------------------------- */

function syncSticky() {
  const p = view.product;
  $('#sbName').textContent = p.name;
  $('#sbMeta').textContent = [money(view.price), view.colour?.name, view.size].filter(Boolean).join(' · ');
  if (locked()) { $('#sbBtn').textContent = lockedLabel(); return; }
  const verb = M.saleState(p.id) === 'open' ? 'Pre-order now' : M.isPreorder() ? 'Pre-order' : 'Add to bag';
  $('#sbBtn').textContent = view.size ? verb : 'Pick a size';
}

function wireStickyBar() {
  const bar = $('#stickybar');
  const btn = $('#sbBtn');
  syncSticky();
  btn.addEventListener('click', () => {
    if (!view.size) {
      $('#sizeOpt').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#sizeOpt').classList.add('need');
      return;
    }
    addCurrent(btn);
  });
  const io = new IntersectionObserver(([en]) => {
    // show the bar only once the real button has scrolled away
    const show = !en.isIntersecting && en.boundingClientRect.top < 0;
    bar.classList.toggle('on', show);
    bar.setAttribute('aria-hidden', String(!show));
    btn.tabIndex = show ? 0 : -1;
  });
  io.observe($('#atc'));
}

/* ---------- not found ------------------------------------------------- */

function renderMissing(id) {
  document.title = 'Not found · Mudra Studios';
  $('.pdp-grid').innerHTML = `
    <div class="missing">
      <h1>THAT ONE DOESN'T EXIST.<em>YET.</em></h1>
      <p class="mono">${id ? `No tee called “${esc(id)}”.` : 'No tee picked.'}</p>
      <a class="btn" href="/#shop">See what does</a>
    </div>`;
}

init();
