/* ==========================================================================
   Mudra Studios: catalogue (home page)
   Renders the grid from data/products.json. Shared plumbing lives in shop.js.
   ========================================================================== */

const { productUrl, loadCatalogue, loadSprite, money, esc, wireHeader, initBag, sellableColours, ORDERING, isPreorder,
  loadDrop, saleState, dropDates, tickerItems, heroTag } = window.Mudra;

const state = {
  products: [],
  filters: { sizes: [], series: [], colour: [], print: [], stock: [] },
  sort: 'feat',
};

/* ---------- boot ---------------------------------------------------- */

async function init() {
  const [, data] = await Promise.all([loadSprite(), loadCatalogue(), loadDrop()]);
  state.products = data.products;
  renderDropCopy();
  renderGrid();
  wireFilters();
  wireSort();
  wireHeader();
  initBag();
}

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

function mediaHTML(m, i) {
  const on = i === 0 ? ' is-on' : '';
  if (m.type === 'img') {
    return `<img class="slide${on}" src="/${m.src}" alt="${esc(m.alt)}"
      loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" width="800" height="1000">`;
  }
  const vb = m.viewBox || '0 0 300 375';
  return `<svg class="slide${on}" viewBox="${vb}" role="img" aria-label="${esc(m.alt)}"><use href="${m.ref}"/></svg>`;
}

function cardHTML(p) {
  const available = p.sizes.filter(s => s.available);
  const inStock = available.length > 0;
  const stockTags = [inStock ? 'in' : 'out'];
  if (p.badge && p.badge.type === 'low') stockTags.push('low');
  const url = productUrl(p.id);
  const cta = cardCta(p, url, inStock);

  const badge = p.badge ? `<span class="pbadge ${p.badge.type}">${esc(p.badge.label)}</span>` : '';
  const slides = p.media.map(mediaHTML).join('');
  const dots = p.media.map((_, i) => (i === 0 ? '<i class="is-on"></i>' : '<i></i>')).join('');
  const swatches = sellableColours(p).map((c, i) =>
    `<button class="pswatch${i === 0 ? ' on' : ''}" data-colour="${c.key}"
       style="--sw:${c.hex}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');

  return `
  <article class="pcard" data-id="${p.id}" data-series="${p.series}" data-colour="${p.colour}"
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
      <div class="pprice">${money(p.price)}</div>
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
  const cards = document.querySelectorAll('.pcard');
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

  document.getElementById('empty').hidden = shown > 0;
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
