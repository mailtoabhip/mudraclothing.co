'use strict';
const crypto = require('node:crypto');
const { admin } = require('./shopify-admin.cjs');
const store = require('./reservation-store.cjs');
const { quoteReservation, quoteBalance, verifyDeposit } = require('./reservation-policy.cjs');
const catalogue = require('../data/products.json');
const drop = require('../data/drop.json');
const ORIGIN = 'https://www.wearmudra.shop';
const FIELD = `id invoiceUrl status totalPriceSet { presentmentMoney { amount currencyCode } } order { id }`;
let subscriptionsReady = false;

function paise(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Payment amount needs review.');
  const [whole, decimal = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Payment amount needs review.');
  return result;
}
function rupees(amount) { return (amount / 100).toFixed(2); }
function tag(id, kind) { return `mudra-${kind}-${id}`; }
async function ensureSubscriptions() {
  if (subscriptionsReady) return;
  const uri = `${ORIGIN}/api/reservation-webhook`;
  const topics = ['ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_CANCELLED'];
  const result = await admin('{ webhookSubscriptions(first: 100) { nodes { topic uri } } }');
  for (const topic of topics) {
    if (result.webhookSubscriptions.nodes.some(x => x.topic === topic && x.uri === uri)) continue;
    const created = await admin('mutation($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) { userErrors { message } } }', { topic, input: { uri, format: 'JSON' } });
    if (created.webhookSubscriptionCreate.userErrors.length) throw new Error('Payment confirmations are not ready. Please try again later.');
  }
  subscriptionsReady = true;
}
async function getDraft(id) {
  return (await admin(`query($id: ID!) { draftOrder(id: $id) { ${FIELD} } }`, { id })).draftOrder;
}
async function findDraft(id, kind) {
  const result = await admin(`query($query: String!) { draftOrders(first: 2, query: $query) { nodes { ${FIELD} } } }`, { query: `tag:${tag(id, kind)}` });
  if (result.draftOrders.nodes.length > 1) throw new Error('This payment needs review. Please contact us.');
  return result.draftOrders.nodes[0] || null;
}
async function createDraft(input) {
  const result = await admin(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${FIELD} } userErrors { message } } }`, { input });
  if (result.draftOrderCreate.userErrors.length || !result.draftOrderCreate.draftOrder) {
    console.warn('Reservation draft validation failed', result.draftOrderCreate.userErrors.map(e => e.message));
    const error = new Error('Could not create your checkout. Please try again.');
    error.code = 'DRAFT_REJECTED'; throw error;
  }
  return result.draftOrderCreate.draftOrder;
}
function assertDraft(draft, expected) {
  if (!draft || draft.totalPriceSet.presentmentMoney.currencyCode !== 'INR' || paise(draft.totalPriceSet.presentmentMoney.amount) !== expected) throw new Error('Checkout total needs review. Please contact us.');
  if (draft.status === 'COMPLETED') throw new Error('This checkout is already completed. Refresh your reservations.');
  const url = new URL(draft.invoiceUrl);
  if (url.protocol !== 'https:' || !['checkout.wearmudra.shop', 'q0xhyi-ac.myshopify.com'].includes(url.hostname)) throw new Error('Checkout link could not be verified.');
}
function baseDraft(record, kind) {
  return { purchasingEntity: { customerId: record.customerId }, presentmentCurrencyCode: 'INR',
    acceptAutomaticDiscounts: false, allowDiscountCodesInCheckout: false,
    tags: ['mudra-reservation', tag(record.id, kind)],
    customAttributes: [{ key: 'Mudra reservation', value: record.id }, { key: 'Payment stage', value: kind },
      { key: 'Full tee total (INR)', value: rupees(record.totalPaise) }, { key: 'Deposit (INR)', value: rupees(record.depositPaise) },
      { key: 'Remaining balance (INR)', value: rupees(record.balancePaise) }, { key: 'Ships by', value: record.shipsBy }],
    note: kind === 'deposit' ? 'Pre-order deposit only. No physical shirts to fulfil. The balance is payable before dispatch.' : `Balance payment. Deposit already paid separately. Reservation ${record.id}.` };
}

async function createDeposit(customerId, lines, requestKey) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey || '')) throw new Error('Refresh your bag and try again.');
  const quote = quoteReservation(lines, catalogue.products, drop);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(quote.items)).digest('hex');
  await ensureSubscriptions();
  let claimed = false;
  const record = await store.update(customerId, records => {
    claimed = false;
    const existing = records.find(r => r.requestKey === requestKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Your bag changed. Start a new reservation.');
      if (existing.status === 'failed') { existing.status = 'creating'; existing.creatingAt = new Date().toISOString(); claimed = true; }
      return existing;
    }
    if (records.length >= 30 || records.some(r => ['creating', 'pending'].includes(r.status))) throw new Error('You already have an unfinished reservation. Open it below, or contact us to change it.');
    const next = { ...quote, id: crypto.randomUUID(), customerId, requestKey, fingerprint, status: 'creating', creatingAt: new Date().toISOString() };
    records.push(next); claimed = true; return next;
  });
  if (record.status === 'paid' || record.cancelled) throw new Error('This reservation is already paid or cancelled.');
  let draft = record.depositDraftId ? await getDraft(record.depositDraftId) : await findDraft(record.id, 'deposit');
  if (!draft && !claimed) throw new Error('Your checkout is still being prepared. Try again in a moment.');
  if (!draft) {
    const input = baseDraft(record, 'deposit');
    input.lineItems = record.items.map(item => ({ title: `Pre-order deposit · ${item.name} · ${item.size} · ${item.colour}`,
      quantity: item.quantity, originalUnitPriceWithCurrency: { amount: rupees(item.depositPaise), currencyCode: 'INR' },
      requiresShipping: false, taxable: false, customAttributes: [{ key: 'Size', value: item.size }, { key: 'Colour', value: item.colour },
        { key: 'Tee price (INR)', value: rupees(item.pricePaise) }, { key: 'Balance per tee (INR)', value: rupees(item.pricePaise - item.depositPaise) }] }));
    try { draft = await createDraft(input); }
    catch (error) {
      if (error.code === 'DRAFT_REJECTED') await store.update(customerId, records => { records.find(r => r.id === record.id).status = 'failed'; });
      throw error;
    }
  }
  assertDraft(draft, record.depositPaise);
  await store.update(customerId, records => {
    const saved = records.find(r => r.id === record.id);
    saved.depositDraftId = draft.id; saved.depositCheckoutUrl = draft.invoiceUrl;
    if (saved.status === 'creating') saved.status = 'pending';
  });
  return { id: record.id, checkoutUrl: draft.invoiceUrl, depositPaise: record.depositPaise, balancePaise: record.balancePaise, totalPaise: record.totalPaise };
}

async function orderSnapshot(id) {
  const result = await admin(`query($id: ID!) { order(id: $id) { id customer { id } cancelledAt displayFinancialStatus
    totalPriceSet { presentmentMoney { amount currencyCode } } totalReceivedSet { presentmentMoney { amount currencyCode } }
    totalRefundedSet { presentmentMoney { amount currencyCode } } transactions { kind status processedAt } } }`, { id });
  const o = result.order;
  if (!o) return null;
  const received = o.totalReceivedSet.presentmentMoney;
  const paidAt = o.transactions.filter(t => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS').map(t => t.processedAt).sort().at(-1);
  return { id: o.id, customerId: o.customer?.id, cancelled: !!o.cancelledAt, status: o.displayFinancialStatus,
    currency: received.currencyCode, paidPaise: paise(received.amount), refundedPaise: paise(o.totalRefundedSet.presentmentMoney.amount), paidAt };
}
async function reconcile(customerId) {
  const { records } = await store.read(customerId);
  for (const record of records) {
    for (const kind of ['deposit', 'balance']) {
      const draftId = record[`${kind}DraftId`];
      if (!draftId) continue;
      // Events persist verified payments for later access beyond Shopify's 60-day order window.
      // Recent orders are refreshed to catch delayed events; older paid records remain intact.
      const snapshot = record[`${kind}Payment`];
      if (snapshot?.paidAt && Date.now() - Date.parse(snapshot.paidAt) > 58 * 86400000) continue;
      const draft = await getDraft(draftId);
      if (!draft?.order?.id) continue;
      const order = await orderSnapshot(draft.order.id);
      if (!order) continue;
      await applyPayment(customerId, record.id, kind, order);
    }
  }
  return (await store.read(customerId)).records;
}
async function applyPayment(customerId, id, kind, order) {
  await store.update(customerId, records => {
    const record = records.find(r => r.id === id);
    if (!record || record.customerId !== customerId || order.customerId !== customerId) throw new Error('Payment identity mismatch.');
    if (record[`${kind}OrderId`] && record[`${kind}OrderId`] !== order.id) throw new Error('Payment reference mismatch.');
    record[`${kind}OrderId`] = order.id; record[`${kind}Payment`] = order;
    // Cancellation/refund flags are sticky even if an older paid webhook is replayed.
    if (order.cancelled || order.refundedPaise > 0) { record.cancelled = true; record.status = 'review'; return; }
    if (record.cancelled) return;
    if (kind === 'deposit') {
      try { verifyDeposit(record, order, customerId); record.status = 'paid'; }
      catch (error) { record.status = error.code === 'UNPAID' ? 'pending' : 'review'; }
    } else if (order.status === 'PAID' && order.currency === 'INR' && order.paidPaise === record.balancePaise) {
      record.balancePaid = true; record.status = 'settled';
    }
  });
}

async function createBalance(customerId, id) {
  await reconcile(customerId);
  let claimed = false;
  const record = await store.update(customerId, records => {
    claimed = false;
    const saved = records.find(r => r.id === id);
    if (!saved) throw new Error('Reservation was not found.');
    quoteBalance(saved, saved.depositPayment, customerId);
    if (!saved.balanceCreating && !saved.balanceDraftId) { saved.balanceCreating = true; claimed = true; }
    return saved;
  });
  let draft = record.balanceDraftId ? await getDraft(record.balanceDraftId) : await findDraft(record.id, 'balance');
  if (!draft && !claimed) throw new Error('Your balance checkout is still being prepared. Please try again.');
  if (!draft) {
    const input = baseDraft(record, 'balance');
    input.shippingLine = { title: 'Free courier shipping', priceWithCurrency: { amount: '0.00', currencyCode: 'INR' } };
    input.lineItems = [];
    for (const item of record.items) {
      const result = await admin(`query($query: String!) { products(first: 1, query: $query) { nodes { handle status variants(first: 100) { nodes { id selectedOptions { name value } } } } } }`, { query: `handle:${item.productId}` });
      const product = result.products.nodes.find(p => p.handle === item.productId && p.status === 'ACTIVE');
      const variant = product?.variants.nodes.find(v => v.selectedOptions.some(o => o.name.toLowerCase() === 'size' && o.value === item.size));
      if (!variant) throw new Error('That reserved size needs review. Please contact us.');
      input.lineItems.push({ variantId: variant.id, quantity: item.quantity,
        priceOverride: { amount: rupees(item.pricePaise - item.depositPaise), currencyCode: 'INR' },
        customAttributes: [{ key: 'Colour', value: item.colour }, { key: 'Reservation', value: record.id }] });
    }
    draft = await createDraft(input);
  }
  assertDraft(draft, record.balancePaise);
  await store.update(customerId, records => { const saved = records.find(r => r.id === id); saved.balanceDraftId = draft.id; saved.balanceCheckoutUrl = draft.invoiceUrl; });
  return { checkoutUrl: draft.invoiceUrl, balancePaise: record.balancePaise };
}
function publicRecord(record) {
  return { id: record.id, items: record.items, totalPaise: record.totalPaise, depositPaise: record.depositPaise, balancePaise: record.balancePaise,
    status: record.status, shipsBy: record.shipsBy, closes: record.closes, balancePaid: !!record.balancePaid,
    checkoutUrl: record.status === 'pending' && Date.now() <= Date.parse(record.closes) ? record.depositCheckoutUrl : null };
}
async function retryUnpaid(customerId, id) {
  const record = (await store.read(customerId)).records.find(r => r.id === id);
  if (!record || record.depositDraftId || !['creating', 'failed'].includes(record.status)) throw new Error('Open the existing reservation instead.');
  if (record.status === 'creating' && Date.now() - Date.parse(record.creatingAt || record.createdAt) < 300000) throw new Error('Checkout is still being prepared. Please wait a few minutes.');
  // Check recent drafts directly as well as the tag search, before resetting a failed setup.
  const recent = await admin(`{ draftOrders(first: 100, sortKey: ID, reverse: true) { nodes { id tags } } }`);
  if (recent.draftOrders.nodes.some(d => d.tags.includes(tag(record.id, 'deposit'))) || await findDraft(record.id, 'deposit')) throw new Error('A checkout already exists. Please contact us to recover its link.');
  await store.update(customerId, records => {
    const saved = records.find(r => r.id === id);
    if (saved.depositDraftId || (saved.status === 'creating' && Date.now() - Date.parse(saved.creatingAt || saved.createdAt) < 300000)) throw new Error('Checkout is still being prepared.');
    saved.status = 'failed';
  });
  return { retried: true };
}
module.exports = { createDeposit, createBalance, reconcile, applyPayment, orderSnapshot, publicRecord, paise, retryUnpaid };
