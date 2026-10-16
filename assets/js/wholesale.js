/* ==========================================================================
   Mudra: wholesale page (/wholesale)
   Copy and terms from data/wholesale.json, price tables from
   data/wholesale-pricing.json (designs per band from each tee's "tier" in
   data/products.json); contact targets from data/site.json
   (whatsappBusiness, wholesaleEmail). A missing value hides its buttons.
   Submitting opens WhatsApp or the mail app with the form prefilled: there is
   no backend and no third-party form service.
   ========================================================================== */
(() => {
const M = window.Mudra;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = M ? M.esc : s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));

let wa = '', mail = '';

// GA4: one event per click, only when analytics was allowed (consent.js)
function track(method) {
  if (!window.MudraAnalytics?.allowed?.() || typeof window.gtag !== 'function') return;
  window.gtag('event', 'wholesale_enquiry', { method });
}

const waLink = text => `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
const mailLink = (subject, body) => `mailto:${mail}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;

function render(w, designs) {
  if (w.sub) $('[data-ws="sub"]').textContent = w.sub;
  $('[data-ws="why"]').innerHTML = (w.why || []).map((x, i) => `
    <li><span class="mono">${String(i + 1).padStart(2, '0')}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></li>`).join('');
  $('[data-ws="terms"]').innerHTML = (w.terms || []).map(t => `
    <div><dt class="mono">${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join('');
  $('[data-ws="storeTypes"]').innerHTML = (w.storeTypes || []).map((t, i) => `
    <label class="ws-chip"><input type="radio" name="storeType" value="${esc(t)}" ${i === 0 ? 'required' : ''}><span>${esc(t)}</span></label>`).join('');
  $('[data-ws="designs"]').innerHTML = designs.map(n => `
    <label class="ws-chip"><input type="checkbox" name="designs" value="${esc(n)}"><span>${esc(n)}</span></label>`).join('');
  const small = [w.smallPrint, w.gstInvoice ? w.gstLine : ''].filter(Boolean).join(' ');
  if (small) $('[data-ws="small"]').textContent = small;
}

// price tables: one per MRP band, the designs in it listed underneath
const rupees = n => `₹${Number(n).toLocaleString('en-IN')}`;
function dateLong(iso) {
  const d = new Date(`${iso}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function renderPrices(wp, products) {
  const box = $('[data-ws="bands"]');
  if (!wp.bands?.length) { box.closest('section').hidden = true; return; }
  if (wp.validFrom) {
    $('[data-ws="priceSub"]').textContent =
      `Per tee, exclusive of GST. Valid for ${wp.validDays || 90} days from ${dateLong(wp.validFrom)}.`;
  }
  box.innerHTML = wp.bands.map((b, i) => {
    const names = products.filter(p => p.tier === b.tier).map(p => p.name);
    const rows = (wp.tiers || []).map((t, j) => {
      const v = b.prices?.[j];
      return `<tr><th scope="row">${esc(t)}</th><td>${v == null ? 'On quote' : rupees(v)}</td></tr>`;
    }).join('');
    return `
    <div class="ws-band">
      <table class="ws-ptable" aria-describedby="ws-band-${i}-note">
        <caption class="mono">${esc(b.label)}</caption>
        <thead><tr><th scope="col" class="mono">Pieces per design</th><th scope="col" class="mono">Price per tee (excl. GST)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="ws-band__note mono" id="ws-band-${i}-note">Exclusive of GST. 5% GST extra.</p>
      ${names.length ? `<p class="ws-band__designs"><span class="mono">Designs</span>${names.map(esc).join(', ')}</p>` : ''}
    </div>`;
  }).join('');
}

function wireContact() {
  // hero buttons: a plain hello, no form contents
  const hello = 'Hi Mudra, I run a store and would like the wholesale price list.';
  const heroWa = $('.ws-hero [data-ws-method="whatsapp"]'), heroMail = $('.ws-hero [data-ws-method="email"]');
  if (wa) { heroWa.href = waLink(hello); heroWa.hidden = false; }
  if (mail) { heroMail.href = mailLink('Wholesale enquiry', hello); heroMail.hidden = false; }
  $('[data-ws="cta"]').hidden = !(wa || mail);
  [heroWa, heroMail].forEach(a => a.addEventListener('click', () => track(a.dataset.wsMethod)));

  $$('.ws-send [data-ws-method]').forEach(b => { b.hidden = !(b.dataset.wsMethod === 'whatsapp' ? wa : mail); });
  $('[data-ws="send"]').hidden = !(wa || mail);
  $('[data-ws="off"]').hidden = !!(wa || mail);
}

function message(f) {
  const d = new FormData(f);
  const v = k => (d.get(k) || '').toString().trim();
  const designs = d.getAll('designs').join(', ');
  const lines = [
    'Wholesale enquiry',
    '',
    `Store: ${v('store')}`,
    `City / area: ${v('city')}`,
    `Name: ${v('name')}`,
    `Phone / WhatsApp: ${v('phone')}`,
    `Email: ${v('email')}`,
    `Instagram / website: ${v('link')}`,
    `Store type: ${v('storeType')}`,
    designs ? `Designs: ${designs}` : '',
    v('message') ? `\nMessage:\n${v('message')}` : '',
  ].filter(x => x !== '');
  return { subject: `Wholesale enquiry: ${v('store')}, ${v('city')}`, body: lines.join('\n') };
}

function wireForm() {
  const f = $('#wsForm'), err = $('#wsErr');
  f.addEventListener('submit', e => {
    e.preventDefault();
    const method = e.submitter?.dataset.wsMethod || (wa ? 'whatsapp' : 'email');
    if (!f.checkValidity()) {
      err.textContent = 'A few fields are missing. They are marked.';
      err.hidden = false;
      f.classList.add('tried');
      f.querySelector(':invalid')?.focus();
      return;
    }
    err.hidden = true;
    const { subject, body } = message(f);
    track(method);
    if (method === 'whatsapp' && wa) window.open(waLink(body), '_blank', 'noopener');
    else if (mail) location.href = mailLink(subject, body);
  });
}

async function init() {
  const [w, site, cat, wp] = await Promise.all([get('/data/wholesale.json'), get('/data/site.json'), get('/data/products.json'),
    get('/data/wholesale-pricing.json')]);
  wa = String(site.whatsappBusiness || '').replace(/\D/g, '');
  mail = String(site.wholesaleEmail || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) mail = '';
  render(w || {}, (cat.products || []).map(p => p.name));
  renderPrices(wp || {}, cat.products || []);
  wireContact();
  wireForm();
}

init();
})();
