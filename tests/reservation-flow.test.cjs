'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const adminModule = require('../server/shopify-admin.cjs');
const fields = new Map(); const drafts = new Map(); let draftCount = 0;
const inputs = [];
adminModule.admin = async (query, variables = {}) => {
  if (query.includes('webhookSubscriptions')) return { webhookSubscriptions: { nodes: ['ORDERS_PAID','ORDERS_UPDATED','ORDERS_CANCELLED'].map(topic => ({ topic, uri: 'https://www.wearmudra.shop/api/reservation-webhook' })) } };
  if (query.includes('metafieldsSet')) {
    const value = variables.fields[0]; const old = fields.get(value.ownerId);
    if ((old?.compareDigest || null) !== value.compareDigest) return { metafieldsSet: { userErrors: [{ code: 'STALE_OBJECT' }] } };
    const next = { value: value.value, compareDigest: String(Number(old?.compareDigest || 0) + 1) };
    fields.set(value.ownerId, next); return { metafieldsSet: { metafields: [next], userErrors: [] } };
  }
  if (query.includes('customer(id:')) return { customer: { metafield: fields.get(variables.id) || null } };
  if (query.includes('draftOrderCreate')) {
    inputs.push(variables.input); draftCount++;
    const amount = variables.input.lineItems.reduce((n, l) => n + Number((l.priceOverride || l.originalUnitPriceWithCurrency).amount) * l.quantity, 0).toFixed(2);
    const draft = { id: `draft-${draftCount}`, invoiceUrl: `https://checkout.wearmudra.shop/invoice/${draftCount}`, status: 'OPEN',
      totalPriceSet: { presentmentMoney: { amount, currencyCode: 'INR' } }, order: null, tags: variables.input.tags };
    drafts.set(draft.id, draft); return { draftOrderCreate: { draftOrder: draft, userErrors: [] } };
  }
  if (query.includes('draftOrders(')) return { draftOrders: { nodes: [...drafts.values()].filter(d => d.tags.includes(variables.query.slice(4))) } };
  if (query.includes('draftOrder(id:')) return { draftOrder: drafts.get(variables.id) };
  if (query.includes('products(')) return { products: { nodes: [{ handle: variables.query.slice(7), status: 'ACTIVE', variants: { nodes: ['S','M'].map(size => ({ id: `variant-${size}`, selectedOptions: [{ name: 'Size', value: size }] })) } }] } };
  throw new Error('Unexpected test request.');
};
const payments = require('../server/reservation-payments.cjs');
const store = require('../server/reservation-store.cjs');
const customerId = 'gid://shopify/Customer/123';
const lines = [{ productId: 'face-card', size: 'S', colour: 'Maroon', quantity: 2 }, { productId: 'face-card', size: 'M', colour: 'Maroon', quantity: 1 }];

test('payment flow protects price locks, concurrent checkout requests and refunds', async () => {
  const attempts = await Promise.allSettled([payments.createDeposit(customerId, lines, 'test-request-123456789'), payments.createDeposit(customerId, lines, 'test-request-123456789')]);
  const checkout = attempts.find(r => r.status === 'fulfilled').value;
  assert.equal(draftCount, 1, 'concurrent calls must create at most one payable invoice');
  assert.equal(checkout.depositPaise, 59700); assert.equal(checkout.balancePaise, 330000);
  assert.equal(inputs[0].tags.every(t => t.length <= 40), true, 'Shopify tag lengths are bounded');
  assert.equal(inputs[0].lineItems.every(l => l.requiresShipping === false && !l.variantId), true, 'deposit is not a physical shirt order');
  const again = await payments.createDeposit(customerId, lines, 'test-request-123456789');
  assert.equal(again.checkoutUrl, checkout.checkoutUrl); assert.equal(draftCount, 1);
  assert.equal((await payments.createDeposit(customerId, lines, 'different-request-123456')).checkoutUrl, checkout.checkoutUrl, 'the same unpaid bag reuses its invoice across request keys');
  await assert.rejects(() => payments.createBalance(customerId, checkout.id), /not been confirmed as paid/);
  assert.equal((await store.read('gid://shopify/Customer/999')).records.length, 0);
  const paid = { id: 'order-1', customerId, status: 'PAID', currency: 'INR', paidPaise: 59700, refundedPaise: 0, paidAt: new Date().toISOString() };
  await assert.rejects(() => payments.applyPayment(customerId, checkout.id, 'deposit', { ...paid, customerId: 'other' }), /identity mismatch/);
  await payments.applyPayment(customerId, checkout.id, 'deposit', paid);
  await payments.applyPayment(customerId, checkout.id, 'deposit', paid);
  await assert.rejects(() => payments.createBalance(customerId, checkout.id, Date.parse(require('../data/drop.json').launch) - 1), /Orders open/);
  const launchNow = Date.parse(require('../data/drop.json').launch);
  const balance = await payments.createBalance(customerId, checkout.id, launchNow);
  assert.equal(balance.balancePaise, 330000); assert.equal(draftCount, 2);
  assert.equal(inputs[1].lineItems.every(l => l.variantId && l.priceOverride.amount === '1100.00'), true);
  assert.equal((await payments.createBalance(customerId, checkout.id, launchNow)).checkoutUrl, balance.checkoutUrl);
  assert.equal(draftCount, 2, 'balance requests reuse one checkout');
  await payments.applyPayment(customerId, checkout.id, 'balance', { ...paid, id: 'order-2', paidPaise: 330000 });
  await assert.rejects(() => payments.createBalance(customerId, checkout.id), /already settled/);
  await payments.applyPayment(customerId, checkout.id, 'deposit', { ...paid, refundedPaise: 19900 });
  await payments.applyPayment(customerId, checkout.id, 'deposit', paid);
  const record = (await store.read(customerId)).records[0];
  assert.equal(record.cancelled, true, 'older paid events cannot reverse a refund');
  await assert.rejects(() => payments.createBalance(customerId, checkout.id), /already settled/);
});
