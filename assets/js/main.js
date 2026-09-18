/* ==========================================================================
   Mudra Studios — storefront
   Renders the catalogue from data/products.json and hands checkout to Shopify.
   ========================================================================== */

const SHOPIFY = {
  // Fill these in from Shopify admin → Sales channels → Buy Button
  domain: 'your-store.myshopify.com',
  storefrontAccessToken: 'REPLACE_ME',
  enabled: false, // flip to true once the two values above are real
};

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const state = {
  products: [],
  filters: { sizes: [], series: [], colour: [], print: [], stock: [] },
  sort: 'feat',
};

/* ---------- boot ---------------------------------------------------- */

async function init() {
  const [sprite, data] = await Promise.all([
    fetch('assets/svg/sprite.svg?v=351f9262').then(r => r.text()),
    fetch('data/products.json', { cache: 'no-cache' }).then(r => r.json()),
  ]);

  // inject the svg symbol sprite so <use> works
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML = sprite;
  document.body.prepend(holder);

  state.products = data.products;
  renderGrid();
  wireFilters();
  wireSort();
  wireHeader();
  if (SHOPIFY.enabled) loadShopify();
}

/* ---------- rendering ------------------------------------------------ */

function mediaHTML(m, i) {
  const on = i === 0 ? ' is-on' : '';
  if (m.type === 'img') {
    return `<img class="slide${on}" src="${m.src}" alt="${m.alt}"
      loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" width="800" height="1000">`;
  }
  const vb = m.viewBox || '0 0 300 375';
  return `<svg class="slide${on}" viewBox="${vb}" role="img" aria-label="${m.alt}"><use href="${m.ref}"/></svg>`;
}

function cardHTML(p) {
  const available = p.sizes.filter(s => s.available);
  const inStock = available.length > 0;
  const stockTags = [inStock ? 'in' : 'out'];
  if (p.badge && p.badge.type === 'low') stockTags.push('low');

  const badge = p.badge ? `<span class="pbadge ${p.badge.type}">${p.badge.label}</span>` : '';
  const slides = p.media.map(mediaHTML).join('');
  const dots = p.media.map((_, i) => (i === 0 ? '<i class="is-on"></i>' : '<i></i>')).join('');
  const swatches = (p.colours || []).map((c, i) =>
    `<button class="pswatch${i === 0 ? ' on' : ''}" data-colour="${c.key}"
       style="--sw:${c.hex}" title="${c.name}" aria-label="${c.name}"></button>`).join('');

  return `
  <article class="pcard" data-id="${p.id}" data-series="${p.series}" data-colour="${p.colour}"
           data-print="${p.print}" data-stock="${stockTags.join(' ')}"
           data-sizes="${available.map(s => s.size).join(' ')}"
           data-price="${p.price}" data-name="${p.name}">
    <div class="pcard__media" tabindex="0">
      ${badge}
      <div class="slides">${slides}</div>
      <button class="navbtn prev" aria-label="Previous image">&#8249;</button>
      <button class="navbtn next" aria-label="Next image">&#8250;</button>
      <div class="dots">${dots}</div>
    </div>
    <div class="pcard__info">
      <div class="ptag mono">${p.seriesLabel} · ${p.print === 'back' ? 'Back print' : 'Chest only'}</div>
      <h3>${p.name}</h3>
      <div class="pprice">₹${p.price.toLocaleString('en-IN')}</div>
      <div class="pswatches">${swatches}</div>
      <button class="atc" ${inStock ? '' : 'disabled'}>${inStock ? 'Add to cart' : 'Sold out'}</button>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = document.getElementById('pgrid');
  grid.replaceChildren();                       // never append onto a previous render
  grid.innerHTML = state.products.map(cardHTML).join('');
  grid.querySelectorAll('.pcard').forEach(wireCarousel);
  wireCart(grid);
  applyFilters();
}

/* ---------- carousel: hover advances and stays ----------------------- */

function wireCarousel(card) {
  const media = card.querySelector('.pcard__media');
  const slides = media.querySelectorAll('.slide');
  const dots = media.querySelectorAll('.dots i');
  if (slides.length < 2) return;

  let base = 0, cur = 0;

  const show = i => {
    if (i === cur) return;
    slides[cur].classList.remove('is-on');
    slides[i].classList.add('is-on');
    dots[cur]?.classList.remove('is-on');
    dots[i]?.classList.add('is-on');
    cur = i;
  };
  const step = dir => {
    base = (cur + dir + slides.length) % slides.length;
    show(base);
  };

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

/* ---------- size selection + cart ------------------------------------ */

function wireCart(grid) {
  grid.addEventListener('click', e => {
    const sw = e.target.closest('.pswatch');
    if (sw) {
      sw.closest('.pswatches').querySelectorAll('.pswatch').forEach(b => b.classList.remove('on'));
      sw.classList.add('on');
      return;
    }

    const btn = e.target.closest('.atc');
    if (!btn || btn.disabled) return;

    const card = btn.closest('.pcard');
    const colour = card.querySelector('.pswatch.on');
    // size is chosen on the product page; the card only picks a colourway
    addToCart(colour ? colour.dataset.colour : null, btn);
  });
}

function flash(btn, msg) {
  const was = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, 1400);
}

let localCount = 0;

function addToCart(_selection, btn) {
  if (SHOPIFY.enabled && window.mudraCart) {
    window.mudraCart.addVariantToCart({ id: _selection, quantity: 1 });
    flash(btn, 'Added');
    return;
  }
  // fallback while Shopify isn't wired up yet
  localCount++;
  document.querySelector('.cart').textContent = `Bag (${localCount})`;
  flash(btn, 'Added');
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

/* ---------- header ---------------------------------------------------- */

function wireHeader() {
  const h = document.querySelector('header');
  let ticking = false;
  const sync = () => { h.classList.toggle('scrolled', window.scrollY > 12); ticking = false; };
  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(sync); }
  }, { passive: true });
  sync();
}

/* ---------- Shopify Buy Button --------------------------------------- */

function loadShopify() {
  const src = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js';
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
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

init();
