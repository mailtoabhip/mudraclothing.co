'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function page() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', value: '', attrs: {}, handlers: {},
      addEventListener(event, fn) { this.handlers[event] = fn; },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, focus() {} });
    return nodes.get(id);
  };
  const state = { id: 'cart-1', totalQuantity: 1, checkoutUrl: 'https://checkout.example/bag',
    cost: { subtotalAmount: { amount: '1299' }, totalAmount: { amount: '1299' } }, discountCodes: [],
    lines: { nodes: [{ id: 'line-1', quantity: 1, cost: { totalAmount: { amount: '1299' } },
      merchandise: { title: 'M', selectedOptions: [{ name: 'Size', value: 'M' }], product: { handle: 'face-card', title: 'Face Card' } } }] } };
  let changed;
  const calls = [];
  const M = { SHOPIFY: { enabled: true }, wireHeader() {}, loadSprite: async () => {},
    loadCatalogue: async () => ({ products: [] }), loadDrop: async () => {}, loadReservations: async () => {},
    checkoutBlock: () => '', depositWindow: () => false, depositFor: () => 199,
    codNow: () => true, lineNote: () => '', dropPhase: () => 'launched', isPreorder: () => false,
    productUrl: id => '/p/' + id, esc: value => String(value).replaceAll('<', '&lt;').replaceAll('"', '&quot;'), money: value => 'INR ' + value,
    cart: { state, onChange(fn) { changed = fn; }, async load() { changed(state); },
      async setDiscountCodes(codes) {
        calls.push(codes);
        if (codes.includes('OFFLIN')) throw new Error('No connection to the shop.');
        state.discountCodes = codes.map(code => ({ code, applicable: code.toLowerCase() === 'mudr10' }));
        state.cost.totalAmount.amount = state.discountCodes.some(x => x.applicable) ? '1169.10' : '1299';
        changed(state); return state;
      } } };
  vm.runInNewContext(fs.readFileSync('assets/js/cart.js', 'utf8'), {
    window: { Mudra: M }, document: { querySelector: node, querySelectorAll: () => [] }, Intl, Date,
  });
  await M.cartReady;
  return { M, calls, html: () => node('#bagBody').innerHTML,
    async submit(code) { node('#couponCode').value = code;
      await node('#bagBody').handlers.submit({ target: { matches: () => true }, preventDefault() {} }); },
    async remove(code) { await node('#bagBody').handlers.click({ target: { closest: selector => selector === '[data-coupon-remove]' ? { dataset: { couponRemove: code } } : null } }); } };
}

test('accepted Shopify code updates total, survives re-render and can be removed', async () => {
  const p = await page();
  await p.submit('  MUDR10  ');
  assert.equal(p.calls[0][0], 'MUDR10');
  assert.match(p.html(), /MUDR10 · Applied/);
  assert.match(p.html(), /INR 1169.10/);
  assert.match(p.html(), /https:\/\/checkout.example\/bag/);
  await p.remove('MUDR10');
  assert.equal(p.calls[1].length, 0);
  assert.doesNotMatch(p.html(), /MUDR10 · Applied/);
  assert.match(p.html(), /Coupon removed/);
});

test('invalid, empty and connection failures never claim a discount was applied', async () => {
  const p = await page();
  await p.submit(''); assert.equal(p.calls.length, 0);
  assert.match(p.html(), /Enter a coupon code first/);
  await p.submit('BAD123');
  assert.match(p.html(), /invalid, expired/);
  assert.doesNotMatch(p.html(), /· Applied|INR 1169.10/);
  await p.submit('OFFLIN');
  assert.match(p.html(), /No connection/);
  assert.doesNotMatch(p.html(), /· Applied/);
});


test('only six alphanumeric characters are sent to Shopify, normalized to uppercase', async () => {
  const p = await page();
  for (const code of ['A1', 'TOOLONG', 'AB-CD1', 'ABC 12']) {
    await p.submit(code);
    assert.match(p.html(), /exactly 6 letters or numbers/);
  }
  assert.equal(p.calls.length, 0);
  await p.submit('  mudr10  ');
  assert.equal(p.calls[0][0], 'MUDR10');
  assert.match(p.html(), /MUDR10 · Applied/);
});
