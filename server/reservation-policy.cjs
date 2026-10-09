'use strict';

// All amounts are paise. Reservations belong to paid orders, never to a browser bag.
const DEPOSIT_PAISE = 19900;
class ReservationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new ReservationError(code, message); }

function quoteReservation(lines, products, drop, now = Date.now()) {
  const time = Number(now);
  if (!Number.isFinite(time) || time < Date.parse(drop.opens) || time > Date.parse(drop.closes)) {
    fail('WINDOW_CLOSED', 'The pre-order deposit window is closed.');
  }
  if (!Array.isArray(lines) || !lines.length || lines.length > 35) fail('INVALID_LINES', 'Choose at least one tee.');
  const selected = new Map();
  for (const line of lines) {
    const product = products.find(p => p.id === line.productId);
    if (!product || (drop.products !== 'all' && !drop.products.includes(product.id))) fail('UNKNOWN_PRODUCT', 'That tee is not available for reservation.');
    const size = product.sizes.find(s => s.size === line.size && s.available);
    const colour = product.colours?.find(c => c.sellable && c.name === line.colour);
    if (!size || !colour) fail('INVALID_OPTION', 'Choose an available size and colour.');
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) fail('INVALID_QUANTITY', 'Choose between 1 and 20 tees per size.');
    const pricePaise = Math.round(Number(product.price) * 100);
    if (!Number.isSafeInteger(pricePaise) || pricePaise <= DEPOSIT_PAISE) fail('INVALID_PRICE', 'This tee cannot be reserved right now.');
    const key = `${product.id}:${size.size}:${colour.key}`;
    const quantity = (selected.get(key)?.quantity || 0) + line.quantity;
    if (quantity > 20) fail('INVALID_QUANTITY', 'Choose at most 20 tees per size.');
    selected.set(key, { productId: product.id, name: product.name, size: size.size,
      colour: colour.name, quantity, pricePaise, depositPaise: DEPOSIT_PAISE,
      image: product.media.find(m => m.type === 'img')?.src || null });
  }
  const items = [...selected.values()];
  if (items.reduce((n, x) => n + x.quantity, 0) > 50) fail('INVALID_QUANTITY', 'Reserve at most 50 tees at a time.');
  return { currency: 'INR', closes: drop.closes, shipsBy: drop.shipsBy,
    createdAt: new Date(time).toISOString(), items,
    totalPaise: items.reduce((n, x) => n + x.pricePaise * x.quantity, 0),
    depositPaise: items.reduce((n, x) => n + x.depositPaise * x.quantity, 0),
    balancePaise: items.reduce((n, x) => n + (x.pricePaise - x.depositPaise) * x.quantity, 0) };
}

function verifyDeposit(reservation, order, customerId) {
  if (!order) fail('UNPAID', 'The deposit has not been confirmed as paid.');
  if (!customerId || reservation.customerId !== customerId || order.customerId !== customerId) fail('FORBIDDEN', 'This reservation belongs to another account.');
  if (order.id !== reservation.depositOrderId) fail('INVALID_ORDER', 'The deposit payment does not match this reservation.');
  if (order.currency !== 'INR' || order.paidPaise !== reservation.depositPaise) fail('INVALID_PAYMENT', 'The paid deposit does not match this reservation.');
  if (order.cancelled || order.refundedPaise > 0) fail('CANCELLED', 'This reservation needs review after cancellation or refund.');
  if (order.status !== 'PAID' || !order.paidAt || !Number.isFinite(Date.parse(order.paidAt))) fail('UNPAID', 'The deposit has not been confirmed as paid.');
  if (Date.parse(order.paidAt) > Date.parse(reservation.closes)) fail('LATE_PAYMENT', 'This deposit was paid after the reservation window closed. Contact us for a refund.');
  return true;
}

function quoteBalance(reservation, order, customerId) {
  verifyDeposit(reservation, order, customerId);
  if (reservation.balancePaid || reservation.cancelled) fail('ALREADY_SETTLED', 'This reservation is already settled or cancelled.');
  // Use the saved per-unit prices, not today's catalogue or customer-submitted totals.
  const items = reservation.items.map(item => ({ ...item, balanceUnitPaise: item.pricePaise - item.depositPaise }));
  const amountPaise = items.reduce((n, x) => n + x.balanceUnitPaise * x.quantity, 0);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise !== reservation.balancePaise) fail('INVALID_BALANCE', 'The reservation balance needs review.');
  return { currency: 'INR', amountPaise, items };
}

function publicPrice(product, drop, now = Date.now()) {
  return Number(now) > Date.parse(drop.closes) ? product.regularPrice : product.price;
}

module.exports = { DEPOSIT_PAISE, ReservationError, quoteReservation, verifyDeposit, quoteBalance, publicPrice };
