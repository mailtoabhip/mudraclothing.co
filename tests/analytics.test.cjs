'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const analytics = require('../server/analytics.cjs');

const record = {
  depositPaise: 39800, balancePaise: 220000, ga: { clientId: '123456.1760000000', sessionId: '1760000001', analyticsConsent: true },
  items: [{ productId: 'face-card', name: 'Face Card', colour: 'Blue', size: 'M', quantity: 2, pricePaise: 129900, depositPaise: 19900 }],
};

function capture(fn) {
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  return fn().finally(() => { global.fetch = realFetch; }).then(() => sent);
}

test('sends nothing without GA_API_SECRET', async () => {
  delete process.env.GA_API_SECRET;
  const sent = await capture(() => analytics.depositPaid(record, 1));
  assert.equal(sent.length, 0);
});

test('deposit_paid carries the deposit value, items and the visit ids', async () => {
  process.env.GA_API_SECRET = 'test';
  const [{ url, body }] = await capture(() => analytics.depositPaid(record, 42));
  assert.match(url, /measurement_id=G-KR05NW0DGN/);
  assert.equal(body.client_id, '123456.1760000000');
  const e = body.events[0];
  assert.equal(e.name, 'deposit_paid');
  assert.equal(e.params.value, 398);
  assert.equal(e.params.currency, 'INR');
  assert.equal(e.params.session_id, '1760000001');
  assert.deepEqual(e.params.items[0], { item_id: 'face-card', item_name: 'Face Card', item_brand: 'Mudra', item_category: 'T-shirts', price: 199, quantity: 2, item_variant: 'Blue / M' });
});

test('balance purchase is the remaining amount, priced per tee', async () => {
  process.env.GA_API_SECRET = 'test';
  const [{ body }] = await capture(() => analytics.balancePaid(record, 77));
  const e = body.events[0];
  assert.equal(e.name, 'purchase');
  assert.equal(e.params.value, 2200);
  assert.equal(e.params.transaction_id, '77');
  assert.equal(e.params.items[0].price, 1100);
});

test('ids that are not GA cookie values are dropped', () => {
  assert.equal(analytics.cleanIds({ clientId: 'abc' }), null);
  assert.deepEqual(analytics.cleanIds({ clientId: '1.2', sessionId: 'x', analyticsConsent: true }), { clientId: '1.2', sessionId: null, analyticsConsent: true });
});

test('payment tracking sends nothing without an explicit analytics opt-in', async () => {
  process.env.GA_API_SECRET = 'test';
  for (const ga of [null, {clientId:'1.2'}, {clientId:'1.2',analyticsConsent:false}]) {
    const sent = await capture(() => analytics.depositPaid({...record,ga},88));assert.equal(sent.length,0);
  }
});
