/* ==========================================================================
   Mudra: /cart
   Renders the Storefront API cart. Checkout is Shopify's, via cart.checkoutUrl.
   ========================================================================== */

(() => {
const M = window.Mudra;
const { esc, money } = M;
const $ = s => document.querySelector(s);

let names = {};   // handle → our product name, from products.json

async function init() {
  M.wireHeader({ solid: true });
  const [, data] = await Promise.all([M.loadSprite(), M.loadCatalogue().catch(() => ({ products: [] })), M.loadDrop(), M.loadReservations()]);
  (data.products || []).forEach(p => { names[p.id] = p.name; });

  if (!M.SHOPIFY.enabled) return renderClosed();

  M.cart.onChange(render);
  try {
    await M.cart.load();
  } catch (err) {
    showError(err.message);
  }
  render(M.cart.state);
  wire();
}

/* ---------- rendering ------------------------------------------------- */

function renderClosed() {
  M.renderBag();
  setBusy(false);
  $('#bagCount').textContent = '';
  $('#bagBody').innerHTML = `
    <div class="bag__empty">
      <p class="bag__emptytitle">Checkout isn't open yet.</p>
      <p>The tees are ready. The till isn't. It opens with the drop.</p>
      <a class="btn" href="/#shop">Look at the tees</a>
    </div>`;
}

function render(c) {
  setBusy(false);
  const lines = c?.lines?.nodes || [];
  const qty = c?.totalQuantity || 0;
  $('#bagCount').textContent = qty ? `${qty} item${qty === 1 ? '' : 's'}` : '';

  if (!lines.length) {
    $('#bagBody').innerHTML = `
      <div class="bag__empty">
        <p class="bag__emptytitle">Empty. For now.</p>
        <a class="btn" href="/#shop">Shop the tees</a>
      </div>`;
    return;
  }

  const sub = c.cost.subtotalAmount;
  const block = M.checkoutBlock();   // outside the pre-order window, no checkout
  const deposit = M.depositWindow() ? lines.reduce((n, line) => n + line.quantity * M.depositFor(line.merchandise.product.handle), 0) : 0;
  const depositRates = new Set(lines.map(line => M.depositFor(line.merchandise.product.handle)));
  $('#bagBody').innerHTML = `
    <ul class="blines" aria-label="Items in your bag">${lines.map(lineHTML).join('')}</ul>
    <aside class="bsum" aria-label="Order summary">
      ${deposit ? `<h2 class="bsum__deposit">${depositRates.size === 1 ? `Pre-order @ ${money([...depositRates][0])}` : 'Pre-order deposits'}</h2><p class="bsum__po">Orders open ${esc(M.dropDates().launchShort)}.</p>` : ''}
      <dl class="bsum__rows">
        <div><dt class="mono">${deposit ? 'Full tee total' : 'Subtotal'}</dt><dd class="mono">${money(sub.amount)}</dd></div>
        ${deposit ? `<div class="bsum__hl"><dt class="mono">Pre-order amount</dt><dd class="mono">${money(deposit)}</dd></div>
        <div><dt class="mono">On launch, you pay<small class="bsum__sub">${esc(launchLong())} onwards</small></dt><dd class="mono">${money(Number(sub.amount) - deposit)}</dd></div>` : ''}
        <div><dt class="mono">Shipping</dt><dd class="mono">Free</dd></div>
        ${M.codNow() ? `<div><dt class="mono">Cash on delivery</dt><dd class="mono">Available</dd></div>` : ''}
      </dl>
      ${summaryNote() ? `<p class="bsum__po">${esc(summaryNote())}</p>` : ''}
      <p class="mono bsum__note">${deposit ? 'A paid deposit locks only these tees, sizes and quantities. Refundable before dispatch. Sign-in may be required to save your pre-order.' : 'Taxes included. Final total at checkout.'}</p>
      ${block
        ? `<button class="bsum__checkout mono" type="button" disabled>${esc(block)}</button>`
        : deposit ? `<button class="bsum__checkout mono" type="button" data-preorder-pay>Pay ${money(deposit)} for pre-order</button>`
        : `<a class="bsum__checkout mono" href="${esc(c.checkoutUrl)}">Checkout</a>`}
      <p class="bsum__help">Payment failed, or money gone and no order? <a href="/payment-help">Read this first</a>.</p>
    </aside>`;
}

// launch day written out ("1 November"), IST, from data/drop.json
function launchLong() {
  const l = M.drop && M.drop.launch;
  return l ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(l))
           : M.dropDates().launchShort;
}

// one line under the totals: drop terms while it runs, the 7–10 day delivery window after
function summaryNote() {
  const ph = M.dropPhase();
  if (M.drop && ph !== 'launched') {
    return M.drop.prepaidOnly ? 'Prepaid only for pre-orders. COD comes back when we have stock.' : '';
  }
  return M.isPreorder() ? `Pre-order items arrive in ${M.ORDERING.minDays}–${M.ORDERING.maxDays} days.` : '';
}

function lineHTML(l) {
  const v = l.merchandise;
  const handle = v.product?.handle;
  const name = names[handle] || v.product?.title || 'Tee';
  const size = v.selectedOptions?.find(o => o.name.toLowerCase() === 'size')?.value || v.title;
  const colour = l.attributes?.find(a => a.key === 'Colour')?.value;
  const url = handle ? M.productUrl(handle) : '/#shop';
  const img = v.image?.url;
  return `
    <li class="bline" data-line="${esc(l.id)}">
      <a class="bline__img" href="${url}" tabindex="-1" aria-hidden="true">
        ${img ? `<img src="${esc(img)}" alt="" width="96" height="120">` : ''}
      </a>
      <div class="bline__info">
        <a class="bline__name" href="${url}">${esc(name)}</a>
        <p class="mono bline__meta">${['Size ' + esc(size), colour && esc(colour)].filter(Boolean).join(' · ')}</p>
        ${M.lineNote(handle) ? `<p class="mono bline__po">${esc(M.lineNote(handle))}</p>` : ''}
        <div class="bline__ctl">
          <div class="qty" role="group" aria-label="Quantity for ${esc(name)}, size ${esc(size)}">
            <button class="qty__btn" data-act="dec" aria-label="One less">−</button>
            <span class="qty__n mono" aria-live="polite">${l.quantity}</span>
            <button class="qty__btn" data-act="inc" aria-label="One more">+</button>
          </div>
          <button class="bline__rm mono" data-act="rm" aria-label="Remove ${esc(name)}, size ${esc(size)}">Remove</button>
        </div>
      </div>
      <span class="bline__price mono">${M.depositWindow() ? `${money(l.quantity * M.depositFor(handle))} deposit` : money(l.cost.totalAmount.amount)}</span>
    </li>`;
}

/* ---------- actions --------------------------------------------------- */

function wire() {
  $('#bagBody').addEventListener('click', async e => {
    const checkout = e.target.closest('[data-preorder-pay]');
    if (checkout) { await M.preorders.checkout(checkout); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const li = b.closest('.bline');
    const lineId = li.dataset.line;
    const line = M.cart.state.lines.nodes.find(x => x.id === lineId);
    if (!line) return;
    const act = b.dataset.act;
    const focusAfter = act === 'rm' ? null : act;
    setBusy(true, li);
    showError('');
    try {
      if (act === 'rm') await M.cart.remove(lineId);
      else await M.cart.update(lineId, line.quantity + (act === 'inc' ? 1 : -1));
      // keep keyboard focus on the same control after the re-render
      const again = document.querySelector(`.bline[data-line="${CSS.escape(lineId)}"] [data-act="${focusAfter}"]`);
      (again || $('.bline__name') || $('.bag__empty a'))?.focus();
    } catch (err) {
      showError(err.message || "That didn't go through. Try again.");
      setBusy(false);
    }
  });
}

function setBusy(on, li) {
  $('#bagBody').setAttribute('aria-busy', String(on));
  document.querySelectorAll('.bline [data-act]').forEach(b => { b.disabled = on; });
  li?.classList.toggle('is-busy', on);
}

function showError(msg) {
  const el = $('#bagErr');
  el.textContent = msg || '';
  el.hidden = !msg;
}

M.cartReady = init();
})();
