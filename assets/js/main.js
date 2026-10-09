/* ==========================================================================
   Mudra: catalogue (home page)
   Renders the grid from data/products.json. Shared plumbing lives in shop.js.
   ========================================================================== */

const { productUrl, loadCatalogue, loadSprite, money, priceView, esc, pictureHTML, CARD_SIZES, wireHeader, initBag, sellableColours, ORDERING, isPreorder,
  loadDrop, saleState, dropDates, tickerItems, heroTag } = window.Mudra;

const state = {
  products: [],
  filters: { sizes: [], series: [], colour: [], print: [], stock: [] },
  sort: 'feat',
};

/* ---------- boot ---------------------------------------------------- */

async function init() {
  const [, data] = await Promise.all([loadSprite(), loadCatalogue(), loadDrop(), window.Mudra.loadReservations()]);
  state.products = data.products;
  renderDropCopy();
  wireHeroCarousel();
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
  if (window.Mudra.depositWindow()) return { tag: `Orders open ${dropDates().launchShort}`, btn: `<a class="atc" href="${url}">Pre-order @ ${money(window.Mudra.depositFor(p.id))}</a>` };
  const st = saleState(p.id), d = dropDates();
  if (st === 'teaser') return { tag: '', btn: `<a class="atc" href="${url}">Opens ${d.opensShort}</a>` };
  if (st === 'open') return { tag: `Closes ${d.closesShort}`, btn: `<a class="atc" href="${url}">Pre-order now</a>` };
  if (st === 'closed') return { tag: '', btn: `<a class="atc" href="${url}">Closed</a>` };
  if (st === 'notInDrop') return { tag: '', btn: '<button class="atc" disabled>Not available yet</button>' };
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
  if (window.Mudra.depositWindow()) return `<div class="pprice"><span class="pprice__now is-pre">${money(v.now)}</span><span class="deposit-tag">Pre-order at ${money(window.Mudra.depositFor(p.id))} today!</span></div>`;
  return `<div class="pprice">`
    + (v.mrp ? `<s class="pprice__mrp"><span class="sr">MRP </span>${money(v.mrp)}</s>` : '')
    + `<span class="pprice__now">${money(v.now)}</span>`
    + (v.pre ? '<span class="pprice__po mono">Pre-order</span>' : '')
    + `</div>`;
}

function mediaHTML(m, i) {
  const on = i === 0 ? ' is-on' : '';
  if (m.type === 'img') {
    return pictureHTML(m, { cls: 'slide' + on, loading: i === 0 ? 'eager' : 'lazy', sizes: CARD_SIZES });
  }
  const vb = m.viewBox || '0 0 300 375';
  return `<svg class="slide${on}" viewBox="${vb}" role="img" aria-label="${esc(m.alt)}"><use href="${m.ref}"/></svg>`;
}

// colour swatches on the cards are off for now; flip to true to bring them back
// (scripts/build_seo.py has the same switch for the pre-rendered grid)
const CARD_SWATCHES = false;

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
  const swatches = !CARD_SWATCHES ? '' : sellableColours(p).map((c, i) =>
    `<button class="pswatch${i === 0 ? ' on' : ''}" data-colour="${c.key}"
       style="--sw:${c.hex}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');

  return `
  <article class="pcard" data-id="${p.id}" data-series="${p.series}" data-colour="${p.colour}"
           data-print="${p.print}" data-stock="${stockTags.join(' ')}"
           data-sizes="${available.map(s => s.size).join(' ')}"
           data-price="${priceView(p).now}" data-name="${esc(p.name)}" data-url="${url}">
    <div class="pcard__media" tabindex="0" aria-label="${esc(p.name)}, view product">
      ${badge}
      <div class="slides">${slides}</div>
      <button class="navbtn prev" aria-label="Previous image">&#8249;</button>
      <button class="navbtn next" aria-label="Next image">&#8250;</button>
      <div class="dots">${dots}</div>
    </div>
    <div class="pcard__info">
      <h3><a href="${url}">${esc(p.name)}</a></h3>
      ${cardPrice(p)}
      ${cta.tag ? `<div class="ptag mono pcard__po">${cta.tag}</div>` : ''}
      ${swatches ? `<div class="pswatches">${swatches}</div>` : ''}
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
  // a series with every shirt archived has nothing to filter to
  const live = new Set(state.products.map(p => p.series));
  document.querySelectorAll('.fchips[data-key="series"] button').forEach(b => { b.hidden = !live.has(b.dataset.v); });
  applyFilters();
}

/* ---------- carousel: hover advances and stays ----------------------- */

const armer = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('armed'); armer.unobserve(en.target); }
    }), { rootMargin: '300px 0px' })
  : null;
const armSoon = media => (armer ? armer.observe(media) : media.classList.add('armed'));

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

  // Only the first photo of each card loads with the page; the others are
  // display:none (so their lazy images wait) until the card comes near the screen.
  armSoon(media);

  // The first photo stays put; the rest play in a random order, fresh on every
  // page load. Hover, either arrow and either arrow key all move one step
  // forward through that order, so no photo comes back within the next
  // (count - 1) steps.
  const order = [0, ...shuffle([...slides.keys()].slice(1))];
  let pos = 0;

  const show = i => {
    if (i === cur) return;
    slides[cur].classList.remove('is-on');
    slides[i].classList.add('is-on');
    dots[cur]?.classList.remove('is-on');
    dots[i]?.classList.add('is-on');
    cur = i;
  };
  const step = () => { pos = (pos + 1) % order.length; show(order[pos]); };

  media.addEventListener('mouseenter', step);
  media.addEventListener('click', e => {
    if (!e.target.closest('.navbtn')) return;
    e.preventDefault();
    step();
  });
  media.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(); }
  });
}

// Fisher–Yates, in place
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  const filtered = Object.values(state.filters).some(values => values.length);
  document.getElementById('showing').textContent = filtered ? `Showing (${shown})` : 'Showing all';
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

/* Campaign banners: manual navigation, no automatic motion. */
function wireHeroCarousel() {
  const hero = document.querySelector('.hero--carousel');
  if (!hero) return;
  const slides = [...hero.querySelectorAll('[data-hero-slide]')];
  const controls = hero.querySelector('.hero__controls');
  let current = 0;
  controls.hidden = slides.length < 2;
  function show(next) {
    current = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== current; slide.classList.toggle('is-active', i === current); });
    hero.querySelector('[data-hero-status]').textContent = `${current + 1} / ${slides.length}`;
  }
  hero.querySelector('[data-hero-prev]').addEventListener('click', () => show(current - 1));
  hero.querySelector('[data-hero-next]').addEventListener('click', () => show(current + 1));
  hero.addEventListener('click', event => {
    const link = event.target.closest('a[href="#shop"]');
    if (!link) return;
    event.preventDefault();
    document.getElementById('shop').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#shop');
  });
}
