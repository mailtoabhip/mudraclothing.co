'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quoteReservation: configuredQuote, quoteBalance, publicPrice } = require('../server/reservation-policy.cjs');
const quoteReservation = (lines, products, drop, now) => configuredQuote(lines, products, drop, now, { depositRupees: 199 });
const catalogue = require('../data/products.json');
const drop = require('../data/drop.json');
const now = Date.parse('2026-10-09T22:00:00+05:30');
const face = catalogue.products.find(p => p.id === 'face-card');
const colour = face.colours.find(c => c.sellable).name;
const selected = [{ productId: face.id, size: 'S', colour, quantity: 2 }, { productId: face.id, size: 'M', colour, quantity: 1 }];
function paid() {
  const reservation = { ...quoteReservation(selected, catalogue.products, drop, now), customerId: 'customer-1', depositOrderId: 'order-1' };
  const order = { id: 'order-1', customerId: 'customer-1', status: 'PAID', currency: 'INR', paidPaise: reservation.depositPaise, refundedPaise: 0, paidAt: new Date(now).toISOString() };
  return { reservation, order };
}
test('deposit is INR 199 per tee across mixed sizes', () => {
  const q = quoteReservation(selected, catalogue.products, drop, now);
  assert.equal(q.depositPaise, 59700);
  assert.equal(q.totalPaise, 389700);
  assert.equal(q.balancePaise, 330000);
});
test('temporary INR 1 override applies only to Face Card and leaves saved balances intact', () => {
  const neo = catalogue.products.find(p => p.id === 'neo-bombay');
  const lines = [{ productId: face.id, size: 'S', colour, quantity: 1 },
    { productId: neo.id, size: 'S', colour: neo.colours.find(c => c.sellable).name, quantity: 1 }];
  const q = configuredQuote(lines, catalogue.products, drop, now, { depositRupees: 199, temporaryOverrides: { 'face-card': 1 } });
  assert.equal(q.items[0].depositPaise, 100);
  assert.equal(q.items[1].depositPaise, 19900);
  assert.equal(q.depositPaise, 20000);
  assert.equal(q.totalPaise - q.depositPaise, q.balancePaise);
  assert.equal(quoteReservation([lines[0]], catalogue.products, drop, now).depositPaise, 19900);
});
test('prices and totals supplied by a visitor are ignored', () => {
  const q = quoteReservation([{ ...selected[0], pricePaise: 1, depositPaise: 1 }], catalogue.products, drop, now);
  assert.equal(q.items[0].pricePaise, 129900);
  assert.equal(q.depositPaise, 39800);
});
test('duplicate selections merge without bypassing quantity limits', () => {
  const q = quoteReservation([selected[0], selected[0]], catalogue.products, drop, now);
  assert.equal(q.items.length, 1); assert.equal(q.items[0].quantity, 4);
  assert.throws(() => quoteReservation([{ ...selected[0], quantity: 20 }, selected[0]], catalogue.products, drop, now), { code: 'INVALID_QUANTITY' });
});
test('IST cutoff is shared with the website, including exact boundary', () => {
  quoteReservation(selected, catalogue.products, drop, Date.parse(drop.closes));
  assert.throws(() => quoteReservation(selected, catalogue.products, drop, Date.parse(drop.closes) + 1), { code: 'WINDOW_CLOSED' });
  assert.equal(publicPrice(face, drop, Date.parse(drop.closes) + 1), 1499);
});
test('unknown products, unavailable options and invalid quantities are rejected', () => {
  for (const replacement of [{ productId: 'made-up' }, { size: 'XS' }, { colour: 'Blue' }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 21 }]) {
    assert.throws(() => quoteReservation([{ ...selected[0], ...replacement }], catalogue.products, drop, now));
  }
});
test('reserved balance survives public price increases', () => {
  const { reservation, order } = paid();
  assert.equal(quoteBalance(reservation, order, 'customer-1').amountPaise, 330000);
  assert.equal(publicPrice(face, drop, Date.parse(drop.closes) + 1), 1499);
});
test('another account cannot claim a price lock', () => {
  const { reservation, order } = paid();
  assert.throws(() => quoteBalance(reservation, order, 'customer-2'), { code: 'FORBIDDEN' });
});
test('unpaid, mismatched, late, refunded and cancelled deposits grant no balance checkout', () => {
  for (const change of [{ status: 'PENDING' }, { id: 'other-order' }, { paidPaise: 1 }, { currency: 'USD' }, { cancelled: true }, { refundedPaise: 19900 }, { paidAt: new Date(Date.parse(drop.closes) + 1).toISOString() }]) {
    const { reservation, order } = paid();
    assert.throws(() => quoteBalance(reservation, { ...order, ...change }, 'customer-1'));
  }
});
test('settled balances and corrupted records cannot be charged again', () => {
  const { reservation, order } = paid();
  assert.throws(() => quoteBalance({ ...reservation, balancePaid: true }, order, 'customer-1'), { code: 'ALREADY_SETTLED' });
  assert.throws(() => quoteBalance({ ...reservation, balancePaise: 1 }, order, 'customer-1'), { code: 'INVALID_BALANCE' });
});
