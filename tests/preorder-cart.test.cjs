'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function checkout({ signedIn = true, open = true, fail = false } = {}) {
  const nodes = new Map();
  const element = () => ({ hidden: true, textContent: '', append() {}, addEventListener() {} });
  const storage = new Map();
  const posted = [], navigated = [];
  const M = { SHOPIFY: { enabled: true }, cartReady: Promise.resolve(), depositWindow: () => open,
    depositFor: () => 1, cart: { state: { id: 'bag-1', lines: { nodes: [{ id: 'line-1', quantity: 2,
      merchandise: { product: { handle: 'face-card' }, selectedOptions: [{ name: 'Size', value: 'S' }] },
      attributes: [{ key: 'Colour', value: 'Maroon' }] }] } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/reservations.js'), 'utf8'), {
    window: { Mudra: M }, document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    location: { search: '', assign: url => navigated.push(url) }, URLSearchParams,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'test-request-key-123456' },
    fetch: async (url, options = {}) => {
      if (url === '/api/customer/session') return { ok: true, json: async () => ({ signedIn, csrf: 'test-csrf' }) };
      if (options.method !== 'POST') return { ok: true, json: async () => ({ reservations: [] }) };
      posted.push({ body: JSON.parse(options.body), csrf: options.headers['X-Mudra-CSRF'] });
      return { ok: !fail, json: async () => fail ? { error: 'Checkout unavailable.' } : { id: 'record-1', checkoutUrl: 'https://checkout.wearmudra.shop/test' } };
    }
  });
  return { M, posted, navigated, storage, nodes };
}
test('bag sends selected tees and CSRF directly to deposit checkout, preserving the bag snapshot', async () => {
  const c = checkout();
  await c.M.preorders.checkout({ disabled: false });
  assert.equal(c.posted.length, 1);
  assert.equal(c.posted[0].csrf, 'test-csrf');
  assert.equal(c.posted[0].body.action, 'deposit');
  assert.deepEqual(c.posted[0].body.lines, [{ productId: 'face-card', size: 'S', colour: 'Maroon', quantity: 2 }]);
  assert.deepEqual(c.navigated, ['https://checkout.wearmudra.shop/test']);
  assert.deepEqual(JSON.parse(c.storage.get('mudra-pending-reservation')).lines, [{ id: 'line-1', quantity: 2 }]);
});
test('signed-out checkout starts sign-in without creating a deposit', async () => {
  const c = checkout({ signedIn: false });
  await c.M.preorders.checkout({ disabled: false });
  assert.deepEqual(c.navigated, ['/api/customer/login']);
  assert.equal(c.posted.length, 0);
});
test('closed window and checkout errors do not redirect to a payment page', async () => {
  for (const options of [{ open: false }, { fail: true }]) {
    const c = checkout(options), button = { disabled: false };
    await c.M.preorders.checkout(button);
    assert.equal(c.navigated.length, 0);
    assert.equal(button.disabled, false);
    assert.ok(c.nodes.get('reservationStatus').textContent);
  }
});
