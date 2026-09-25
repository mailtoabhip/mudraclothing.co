/* ==========================================================================
   Mudra Studios: catalogue (home page)
   Renders the grid from data/products.json. Shared plumbing lives in shop.js.
   ========================================================================== */

const { productUrl, loadCatalogue, loadSprite, money, priceView, esc, wireHeader, initBag, sellableColours, ORDERING, isPreorder,
  loadDrop, saleState, dropDates, tickerItems, heroTag } = window.Mudra;

const state = {
  products: [],
  lines: null,      // data/lines.json
  site: {},         // data/site.json (instagram)
  line: 'all',      // shop line switcher
  filters: { sizes: [], series: [], colour: [], print: [], stock: [] },
  sort: 'feat',
};

/* ---------- boot ---------------------------------------------------- */

async function init() {
  const [, data, , lines, site] = await Promise.all([loadSprite(), loadCatalogue(), loadDrop(),
    getJSON('/data/lines.json'), getJSON('/data/site.json')]);
  state.products = data.products;
  state.lines = lines;
  state.site = site || {};
  renderDropCopy();
  renderLines();
  renderGrid();
  wireFilters();
  wireLineSwitch();
  wireSort();
  wireHeader();
  initBag();
}

const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Drop 01 copy: ticker + hero tag -------------------------- */

function renderDropCopy() {
  const track = document.querySelector('.ticker__track');
  if (track) {
    const row = tickerItems().map(t => `<span>${esc(t)}</span><span>✳</span>`).join('');
    track.innerHTML = row + row;   // twice, for the seamless loop
  }
  const tag = document.querySelector('.hero__tag');
  if (tag) tag.textContent = heroTag();
}

// card tag + button per phase. Keep identical to card_html() in scripts/build_seo.py
function cardCta(p, url, inStock) {
  const st = saleState(p.id), d = dropDates();
  if (st === 'teaser') return { tag: '', btn: `<a class="atc" href="${url}">Opens ${d.opensShort}</a>` };
  if (st === 'open') return { tag: `Closes ${d.closesShort}`, btn: `<a class="atc" href="${url}">Pre-order now</a>` };
  if (st === 'closed') return { tag: '', btn: `<a class="atc" href="${url}">Closed</a>` };
  if (st === 'notInDrop') return { tag: '', btn: `<button class="atc" disabled>Not in ${esc(d.name)}</button>` };
  return {
    tag: isPreorder() ? `Pre-order · ${ORDERING.minDays}–${ORDERING.maxDays} days` : '',
    btn: inStock
      ? `<a class="atc" href="${url}">${isPreorder() ? 'Pre-order' : 'Choose size'}</a>`
      : '<button class="atc" disabled>Sold out</button>',
  };
}

/* ---------- rendering ------------------------------------------------ */

// struck MRP · price · PRE-ORDER. Keep identical to card_price() in scripts/build_seo.py
function cardPrice(p) {
  const v = priceView(p);
  return `<div class="pprice">`
    + (v.mrp ? `<s class="pprice__mrp"><span class="sr">MRP </span>${money(v.mrp)}</s>` : '')
    + `<span class="pprice__now">${money(v.now)}</span>`
    + (v.pre ? '<span class="pprice__po mono">Pre-order</span>' : '')
    + `</div>`;
}

function mediaHTML(m, i, lazy) {
  const on = i === 0 ? ' is-on' : '';
  if (m.type === 'img') {
    return `<img class="slide${on}" src="/${m.src}" alt="${esc(m.alt)}"
      loading="${i === 0 && !lazy ? 'eager' : 'lazy'}" decoding="async" width="800" height="1000">`;
  }
  const vb = m.viewBox || '0 0 300 375';
  return `<svg class="slide${on}" viewBox="${vb}" role="img" aria-label="${esc(m.alt)}"><use href="${m.ref}"/></svg>`;
}

function cardHTML(p, lazy = false) {
  const available = p.sizes.filter(s => s.available);
  const inStock = available.length > 0;
  const stockTags = [inStock ? 'in' : 'out'];
  if (p.badge && p.badge.type === 'low') stockTags.push('low');
  const url = productUrl(p.id);
  const cta = cardCta(p, url, inStock);

  const badge = p.badge ? `<span class="pbadge ${p.badge.type}">${esc(p.badge.label)}</span>` : '';
  const slides = p.media.map((m, i) => mediaHTML(m, i, lazy)).join('');
  const dots = p.media.map((_, i) => (i === 0 ? '<i class="is-on"></i>' : '<i></i>')).join('');
  const swatches = sellableColours(p).map((c, i) =>
    `<button class="pswatch${i === 0 ? ' on' : ''}" data-colour="${c.key}"
       style="--sw:${c.hex}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');

  return `
  <article class="pcard" data-id="${p.id}" data-line="${esc(p.line || '')}" data-series="${p.series}" data-colour="${p.colour}"
           data-print="${p.print}" data-stock="${stockTags.join(' ')}"
           data-sizes="${available.map(s => s.size).join(' ')}"
           data-price="${p.price}" data-name="${esc(p.name)}" data-url="${url}">
    <div class="pcard__media" tabindex="0" aria-label="${esc(p.name)}, view product">
      ${badge}
      <div class="slides">${slides}</div>
      <button class="navbtn prev" aria-label="Previous image">&#8249;</button>
      <button class="navbtn next" aria-label="Next image">&#8250;</button>
      <div class="dots">${dots}</div>
    </div>
    <div class="pcard__info">
      <div class="ptag mono">${esc(p.seriesLabel)} · ${p.print === 'back' ? 'Back print' : 'Chest only'}</div>
      <h3><a href="${url}">${esc(p.name)}</a></h3>
      ${cardPrice(p)}
      ${cta.tag ? `<div class="ptag mono pcard__po">${cta.tag}</div>` : ''}
      <div class="pswatches">${swatches}</div>
      ${cta.btn}
    </div>
  </article>`;
}

function renderGrid() {
  const grid = document.getElementById('pgrid');
  grid.replaceChildren();                       // never append onto a previous render
  grid.innerHTML = state.products.map(cardHTML).join('');
  grid.querySelectorAll('.pcard').forEach(wireCarousel);
  wireCards(grid);
  applyFilters();
}

/* ---------- three lines: homepage tabs ------------------------------- */
// Keep identical to lines_html() / line_intro() / line_strip() in scripts/build_seo.py

function lineProducts(ln) {
  const mine = state.products.filter(p => p.line === ln.key);
  const pick = (ln.strip || []).map(id => mine.find(p => p.id === id)).filter(Boolean);
  return { strip: pick.length ? pick : mine.slice(0, 6), count: mine.length };
}

function lineVisualHTML(ln, hasProducts) {
  const f = ln.feature;
  if (hasProducts && f) {
    // falls back to the second photo if the first one is ever missing
    const fb = f.fallback ? ` data-fallback="/${esc(f.fallback)}" data-fallback-alt="${esc(f.fallbackAlt || f.alt)}"` : '';
    return `<div class="lvis lvis--photo"><img src="/${esc(f.src)}" alt="${esc(f.alt)}" width="800" height="1000" `
      + `loading="lazy" decoding="async"${fb}></div>`;
  }
  return `<div class="lvis lvis--type lvis--${esc(ln.block || 'blue')}" aria-hidden="true">`
    + `<span class="lvis__name">${esc(ln.name)}</span></div>`;
}

function lineIntroHTML(ln, count) {
  const L = state.lines, ig = state.site.instagram;
  const act = count
    ? `<a class="btn lines__cta" href="/?line=${esc(ln.key)}#shop" data-line-link="${esc(ln.key)}">${esc(ln.cta)}</a>`
    : `<p class="mono lines__soon">${esc(L.teaser)}</p>`
      + (ig ? `<a class="linkish mono lines__follow" href="${esc(ig)}" target="_blank" rel="noopener">${esc(L.follow)}</a>` : '');
  return `<div class="lines__intro"><div class="lines__copy">`
    + `<p class="mono lines__name">${esc(ln.name)}</p>`
    + `<p class="lines__text">${esc(ln.copy)}</p>`
    + `<div class="lines__act">${act}</div></div>`
    + lineVisualHTML(ln, count > 0) + `</div>`;
}

function lineStripHTML(ln, strip) {
  if (!strip.length) return '';
  return `<div class="lstrip"><div class="lstrip__track" tabindex="-1">`
    + strip.map(p => cardHTML(p, true)).join('')
    + `</div><div class="lstrip__nav">`
    + `<button class="lstrip__btn" data-dir="-1" aria-label="Scroll ${esc(ln.name)} tees back">&#8249;</button>`
    + `<button class="lstrip__btn" data-dir="1" aria-label="Scroll ${esc(ln.name)} tees forward">&#8250;</button>`
    + `</div></div>`;
}

function renderLines() {
  const box = document.getElementById('lines');
  if (!box || !state.lines) return;
  const tabs = [...box.querySelectorAll('[role="tab"]')];
  state.lines.lines.forEach(ln => {
    const panel = document.getElementById(`lpanel-${ln.key}`);
    if (!panel) return;
    const { strip, count } = lineProducts(ln);
    panel.innerHTML = lineIntroHTML(ln, count) + lineStripHTML(ln, strip);
    panel.querySelectorAll('.pcard').forEach(wireCarousel);
    const track = panel.querySelector('.lstrip__track');
    if (track) wireCards(track);
  });
  box.querySelectorAll('.lvis--photo img[data-fallback]').forEach(img =>
    img.addEventListener('error', () => {
      img.alt = img.dataset.fallbackAlt;
      img.src = img.dataset.fallback;
      img.removeAttribute('data-fallback');
    }, { once: true }));

  const select = (tab, focus) => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (!panel) return;
      if (on && panel.hidden) {
        panel.hidden = false;
        if (!reduceMotion()) {
          panel.classList.remove('is-entering');
          void panel.offsetWidth;          // restart the animation
          panel.classList.add('is-entering');
        }
      } else if (!on) panel.hidden = true;
    });
    if (focus) tab.focus();
  };
  box.querySelector('[role="tablist"]').addEventListener('click', e => {
    const t = e.target.closest('[role="tab"]');
    if (t) select(t, false);
  });
  box.querySelector('[role="tablist"]').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(tabs[(to + tabs.length) % tabs.length], true);
  });
  box.addEventListener('animationend', e => e.target.classList?.remove('is-entering'));

  // strip arrows: one card-width-ish page at a time
  box.addEventListener('click', e => {
    const b = e.target.closest('.lstrip__btn');
    if (!b) return;
    const track = b.closest('.lstrip').querySelector('.lstrip__track');
    track.scrollBy({ left: Number(b.dataset.dir) * track.clientWidth * 0.8, behavior: reduceMotion() ? 'auto' : 'smooth' });
  });

  // "Shop all Modern" on this page: switch the shop without a reload
  box.addEventListener('click', e => {
    const a = e.target.closest('[data-line-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    setLine(a.dataset.lineLink, true);
    document.getElementById('shop')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
}

/* ---------- shop: line switcher (?line=modern#shop) ------------------- */

const lineKeys = () => ['all', ...(state.lines?.lines || []).map(l => l.key)];
const lineFromUrl = () => {
  const v = new URLSearchParams(location.search).get('line');
  return lineKeys().includes(v) ? v : 'all';
};

function wireLineSwitch() {
  const sw = document.getElementById('lineSwitch');
  if (!sw) return;
  sw.addEventListener('click', e => {
    const b = e.target.closest('button[data-line]');
    if (b) setLine(b.dataset.line, true);
  });
  window.addEventListener('popstate', () => setLine(lineFromUrl(), false));
  setLine(lineFromUrl(), false);
}

function setLine(line, push) {
  state.line = lineKeys().includes(line) ? line : 'all';
  document.querySelectorAll('#lineSwitch button').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.line === state.line ? 'true' : 'false'));
  if (push) {
    const u = new URL(location.href);
    if (state.line === 'all') u.searchParams.delete('line'); else u.searchParams.set('line', state.line);
    u.hash = 'shop';
    if (u.href !== location.href) history.pushState({ line: state.line }, '', u);
  }
  // series chips: only the ones in this line, with their counts
  const inLine = state.products.filter(p => state.line === 'all' || p.line === state.line);
  document.querySelectorAll('.fchips[data-key="series"] button').forEach(b => {
    const n = inLine.filter(p => p.series === b.dataset.v).length;
    b.hidden = !n;
    const c = b.querySelector('.fcount');
    if (c) c.textContent = n;
    if (!n && b.classList.contains('on')) {
      b.classList.remove('on');
      state.filters.series = state.filters.series.filter(v => v !== b.dataset.v);
    }
  });
  // a line with nothing in it yet gets the same teaser as its homepage panel
  const empty = document.getElementById('lineEmpty');
  const ln = state.lines?.lines.find(l => l.key === state.line);
  const none = !!ln && !inLine.length;
  if (empty) {
    empty.innerHTML = none ? lineIntroHTML(ln, 0) : '';
    empty.hidden = !none;
  }
  document.querySelector('.catalogue')?.classList.toggle('is-lineempty', none);
  applyFilters();
}

/* ---------- carousel: hover advances and stays ----------------------- */

function wireCarousel(card) {
  const media = card.querySelector('.pcard__media');
  const slides = media.querySelectorAll('.slide');
  const dots = media.querySelectorAll('.dots i');

  // clicking the picture (not an arrow) opens the product
  media.addEventListener('click', e => {
    if (e.target.closest('.navbtn')) return;
    location.href = card.dataset.url;
  });
  media.addEventListener('keydown', e => {
    if (e.key === 'Enter') location.href = card.dataset.url;
  });

  if (slides.length < 2) return;
  let cur = 0;

  const show = i => {
    if (i === cur) return;
    slides[cur].classList.remove('is-on');
    slides[i].classList.add('is-on');
    dots[cur]?.classList.remove('is-on');
    dots[i]?.classList.add('is-on');
    cur = i;
  };
  const step = dir => show((cur + dir + slides.length) % slides.length);

  media.addEventListener('mouseenter', () => step(1));
  media.addEventListener('click', e => {
    const btn = e.target.closest('.navbtn');
    if (!btn) return;
    e.preventDefault();
    step(btn.classList.contains('next') ? 1 : -1);
  });
  media.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
  });
}

/* ---------- colour swatches (size is picked on the product page) ----- */

function wireCards(grid) {
  grid.addEventListener('click', e => {
    const sw = e.target.closest('.pswatch');
    if (!sw) return;
    sw.closest('.pswatches').querySelectorAll('.pswatch').forEach(b => b.classList.remove('on'));
    sw.classList.add('on');
    // carry the chosen colour through to the product page
    const card = sw.closest('.pcard');
    const url = `${productUrl(card.dataset.id)}${productUrl('x').includes('?') ? '&' : '?'}c=${sw.dataset.colour}`;
    card.dataset.url = url;
    card.querySelectorAll('h3 a, a.atc').forEach(a => { a.href = url; });
  });
}

/* ---------- filters + sort ------------------------------------------- */

function wireFilters() {
  document.querySelectorAll('.fchips').forEach(box => {
    const key = box.dataset.key;
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      b.classList.toggle('on');
      const v = b.dataset.v, arr = state.filters[key];
      const i = arr.indexOf(v);
      i > -1 ? arr.splice(i, 1) : arr.push(v);
      applyFilters();
    });
  });

  document.querySelectorAll('.fhead').forEach(h => {
    h.addEventListener('click', () =>
      h.setAttribute('aria-expanded', h.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'));
  });

  document.getElementById('fToggle')?.addEventListener('click', () =>
    document.getElementById('filters').classList.toggle('open'));

  document.getElementById('clearAll')?.addEventListener('click', () => {
    document.querySelectorAll('.fchips button.on').forEach(b => b.classList.remove('on'));
    Object.keys(state.filters).forEach(k => state.filters[k] = []);
    applyFilters();
  });
}

function applyFilters() {
  const all = [...document.querySelectorAll('#pgrid .pcard')];
  const cards = all.filter(c => state.line === 'all' || c.dataset.line === state.line);
  all.forEach(c => { c.hidden = !cards.includes(c); });
  let shown = 0;

  cards.forEach(card => {
    const ok = Object.entries(state.filters).every(([key, want]) => {
      if (!want.length) return true;
      const have = (card.dataset[key] || '').split(' ');
      return want.some(v => have.includes(v));
    });
    card.hidden = !ok;
    if (ok) shown++;
  });

  document.getElementById('empty').hidden = shown > 0 || !cards.length;
  document.getElementById('showing').textContent = `Showing ${shown} of ${cards.length}`;
  document.getElementById('count').textContent = `${shown} ${shown === 1 ? 'piece' : 'pieces'}`;
}

function wireSort() {
  const sel = document.getElementById('sort');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const grid = document.getElementById('pgrid');
    const list = [...grid.querySelectorAll('.pcard')];
    const v = sel.value;
    if (v === 'lo') list.sort((a, b) => a.dataset.price - b.dataset.price);
    if (v === 'hi') list.sort((a, b) => b.dataset.price - a.dataset.price);
    if (v === 'az') list.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
    if (v === 'new') list.reverse();
    list.forEach(c => grid.appendChild(c));
  });
}

init();
