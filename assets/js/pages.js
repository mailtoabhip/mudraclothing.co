/* ==========================================================================
   Mudra Studios — content pages (about, help, legal, 404)
   ========================================================================== */

(() => {
const M = window.Mudra;
const { esc, money } = M;

async function init() {
  M.wireHeader({ solid: true });
  reviewMode();
  wireToc();
  const needsData = document.getElementById('sgChart') || document.getElementById('picks');
  const [, data] = await Promise.all([M.loadSprite(), needsData ? M.loadCatalogue() : null]);
  M.renderBag();
  if (data) {
    renderSizeChart(data.garment || {});
    renderPicks(data.products || []);
  }
}

/* ?review=1 highlights every unconfirmed placeholder (<span class="tbd">) */
function reviewMode() {
  if (!new URLSearchParams(location.search).has('review')) return;
  document.body.classList.add('review');
  const n = document.querySelectorAll('.tbd').length;
  const flag = document.createElement('div');
  flag.className = 'review-flag mono';
  flag.textContent = `Review mode · ${n} placeholder${n === 1 ? '' : 's'}`;
  document.body.appendChild(flag);
}

/* highlight the section you're reading in the contents rail */
function wireToc() {
  const links = [...document.querySelectorAll('.toc a')];
  if (!links.length) return;
  const byId = new Map(links.map(a => [a.hash.slice(1), a]));
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      links.forEach(a => a.classList.remove('on'));
      byId.get(en.target.id)?.classList.add('on');
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.doc__body h2[id]').forEach(h => io.observe(h));
}

/* size guide: real numbers only, from products.json → garment.sizeChart */
function renderSizeChart(g) {
  const box = document.getElementById('sgChart');
  const chart = g.sizeChart;
  if (!box || !chart || !chart.rows?.length) return;
  document.getElementById('sgUnit').textContent = `Garment, laid flat · ${g.sizeChartUnit || 'in'}`;
  box.innerHTML = `
    <table class="sgt">
      <thead><tr><th>Size</th>${chart.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${chart.rows.map(r => `<tr><th>${esc(r.size)}</th>${r.values.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

/* 404: four tees that do exist */
function renderPicks(products) {
  const wrap = document.getElementById('picks');
  if (!wrap || !products.length) return;
  const picks = [...products].sort(() => Math.random() - .5).slice(0, 4);
  document.getElementById('picksGrid').innerHTML = picks.map(x => {
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
  wrap.hidden = false;
}

init();
})();
