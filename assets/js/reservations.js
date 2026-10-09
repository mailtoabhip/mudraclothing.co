(() => {
  const status = document.getElementById('reservationStatus');
  const content = document.getElementById('reservationContent');
  const M = window.Mudra;
  let account;
  async function pay(body, button) {
    button.disabled = true;
    status.textContent = 'Preparing your secure Shopify checkout.';
    try {
      const response = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mudra-CSRF': account.csrf }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not prepare checkout.');
      if (body.action === 'deposit') {
        try { localStorage.setItem('mudra-pending-reservation', JSON.stringify({ id: result.id, cartId: M.cart.state.id,
          lines: M.cart.state.lines.nodes.map(line => ({ id: line.id, quantity: line.quantity })) })); } catch {}
      }
      location.assign(result.checkoutUrl);
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  }
  function bagLines() {
    return (M.cart.state?.lines?.nodes || []).map(line => ({ productId: line.merchandise.product.handle,
      size: line.merchandise.selectedOptions.find(o => o.name.toLowerCase() === 'size')?.value,
      colour: line.attributes?.find(a => a.key === 'Colour')?.value, quantity: line.quantity }));
  }
  async function clearPaidBag(records) {
    let pending;
    try { pending = JSON.parse(localStorage.getItem('mudra-pending-reservation')); } catch {}
    if (!pending || !records.some(r => r.id === pending.id && ['paid', 'settled'].includes(r.status))) return;
    for (const reserved of pending.lines) {
      const line = M.cart.state?.id === pending.cartId && M.cart.state.lines.nodes.find(l => l.id === reserved.id);
      // Remove only unchanged original lines. New additions and changed bags are kept.
      if (line && line.quantity === reserved.quantity) await M.cart.remove(line.id);
    }
    try { localStorage.removeItem('mudra-pending-reservation'); localStorage.removeItem('mudra-deposit-request'); } catch {}
  }
  function renderRecord(record) {
    const card = document.createElement('article'); card.className = 'reservation';
    card.innerHTML = `<h2>Reserved tees</h2><ul>${record.items.map(item => `<li>${M.esc(item.name)} · ${M.esc(item.colour)} · ${M.esc(item.size)} × ${item.quantity} <span>${M.money(item.pricePaise / 100)} each</span></li>`).join('')}</ul>
      <dl><div><dt>Locked total</dt><dd>${M.money(record.totalPaise / 100)}</dd></div><div><dt>Deposit ${['paid','settled'].includes(record.status) ? 'paid' : 'due'}</dt><dd>${M.money(record.depositPaise / 100)}</dd></div>
      <div><dt>Balance ${record.balancePaid ? 'paid' : 'remaining'}</dt><dd>${M.money(record.balancePaise / 100)}</dd></div></dl>
      <p>${record.status === 'review' ? 'Payment or cancellation needs review. Please contact us.' : record.balancePaid ? 'Fully paid. Your shirts are reserved.' : record.status === 'paid' ? 'Deposit confirmed. Your sizes, quantities and price are locked.' : 'Your reservation is confirmed only after the deposit is paid.'}</p>`;
    if (record.status === 'pending' && record.checkoutUrl) {
      const link = document.createElement('a'); link.className = 'btn'; link.href = record.checkoutUrl; link.textContent = 'Pay deposit'; card.append(link);
    }
    if (record.status === 'paid' && !record.balancePaid) {
      const button = document.createElement('button'); button.className = 'btn'; button.type = 'button'; button.textContent = `Pay balance · ${M.money(record.balancePaise / 100)}`;
      button.addEventListener('click', () => pay({ action: 'balance', id: record.id }, button)); card.append(button);
    }
    content.append(card);
  }
  async function load() {
    M.wireHeader({ solid: true });
    await Promise.all([M.loadSprite(), M.loadCatalogue(), M.loadDrop(), M.cart.load()]);
    const response = await fetch('/api/customer/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in is unavailable. Please try again later.');
    account = await response.json();
    if (!account.signedIn) {
      status.textContent = new URLSearchParams(location.search).has('error') ? 'Sign-in could not be completed. Please try again.' : 'Sign in to view your reserved tees across devices.';
      const link = document.createElement('a');
      link.className = 'btn'; link.href = '/api/customer/login'; link.textContent = 'Sign in'; content.append(link);
      return;
    }
    const result = await fetch('/api/reservations', { cache: 'no-store' });
    const saved = await result.json();
    if (!result.ok) throw new Error(saved.error || 'Could not load your reservations.');
    await clearPaidBag(saved.reservations);
    status.textContent = saved.reservations.length ? 'Your pre-order reservations.' : 'No reservations yet. Your bag is ready when you are.';
    saved.reservations.forEach(renderRecord);
    const lines = bagLines();
    if (lines.length && M.dropPhase() === 'open' && !saved.reservations.some(r => ['creating','pending'].includes(r.status))) {
      const count = lines.reduce((n, l) => n + l.quantity, 0);
      const box = document.createElement('article'); box.className = 'reservation';
      const catalogue = await M.loadCatalogue();
      const total = lines.reduce((n, l) => n + catalogue.products.find(p => p.id === l.productId).price * l.quantity, 0);
      box.innerHTML = `<h2>Reserve your bag</h2><p>${count} tee${count === 1 ? '' : 's'}. Deposit ${M.money(count * 199)} now, balance ${M.money(total - count * 199)} before dispatch. Full total ${M.money(total)}.</p><p>Your deposit locks these exact tees, sizes and quantities at the current pre-order price. Additional purchases use their current price. Deposits are refundable before dispatch.</p>`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = `Pay deposit · ${M.money(count * 199)}`;
      button.addEventListener('click', () => {
        let key; const fingerprint = JSON.stringify(lines);
        try { const prior = JSON.parse(localStorage.getItem('mudra-deposit-request')); if (prior?.fingerprint === fingerprint) key = prior.key; } catch {}
        key ||= crypto.randomUUID();
        try { localStorage.setItem('mudra-deposit-request', JSON.stringify({ fingerprint, key })); } catch {}
        pay({ action: 'deposit', lines, requestKey: key }, button);
      });
      box.append(button); content.append(box);
    }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = 'Sign out';
    button.addEventListener('click', async () => {
      const result = await fetch('/api/customer/session', { method: 'POST', headers: { 'X-Mudra-CSRF': account.csrf } });
      if (result.ok) location.reload(); else status.textContent = 'Could not sign out. Refresh and try again.';
    });
    content.append(button);
  }
  load().catch(error => { status.textContent = error.message; });
})();
