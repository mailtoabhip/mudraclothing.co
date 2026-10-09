'use strict';
const crypto = require('node:crypto');
const { orderSnapshot, applyPayment } = require('../server/reservation-payments.cjs');
const { read } = require('../server/reservation-store.cjs');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-shopify-shop-domain'] !== 'q0xhyi-ac.myshopify.com') return res.status(401).end();
  if (!['orders/paid', 'orders/updated', 'orders/cancelled'].includes(req.headers['x-shopify-topic'])) return res.status(400).end();
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 2000000) return res.status(413).end(); chunks.push(chunk); }
    const raw = Buffer.concat(chunks);
    const expected = crypto.createHmac('sha256', process.env.SHOPIFY_APP_CLIENT_SECRET).update(raw).digest();
    const supplied = Buffer.from(req.headers['x-shopify-hmac-sha256'] || '', 'base64');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).end();
    const event = JSON.parse(raw.toString());
    const id = event.note_attributes?.find(a => a.name === 'Mudra reservation')?.value;
    const kind = event.note_attributes?.find(a => a.name === 'Payment stage')?.value;
    if (!id || !['deposit', 'balance'].includes(kind) || !event.customer?.id) return res.status(200).end();
    const customerId = `gid://shopify/Customer/${event.customer.id}`;
    const record = (await read(customerId)).records.find(r => r.id === id);
    if (!record) return res.status(200).end();
    // A signed event alone is not sufficient: verify the app-created draft owns this order.
    const { admin } = require('../server/shopify-admin.cjs');
    const result = await admin('query($id: ID!) { draftOrder(id: $id) { order { id } } }', { id: record[`${kind}DraftId`] });
    const orderId = `gid://shopify/Order/${event.id}`;
    const ownedTag = `${kind === 'deposit' ? 'md' : 'mb'}-${id.replaceAll('-', '')}`;
    const ownedRetired = kind === 'deposit' && record.depositRetired && String(event.tags || '').split(',').map(t => t.trim()).includes(ownedTag);
    if (result.draftOrder?.order?.id !== orderId && !ownedRetired) return res.status(200).end();
    if (record[`${kind}Payment`]?.paidAt && Date.now() - Date.parse(record[`${kind}Payment`].paidAt) > 58 * 86400000) {
      if (event.cancelled_at || event.refunds?.length || ['refunded','partially_refunded','voided'].includes(event.financial_status)) {
        await applyPayment(customerId, id, kind, { ...record[`${kind}Payment`], cancelled: true });
      }
      return res.status(200).end();
    }
    const snapshot = await orderSnapshot(orderId);
    if (!snapshot) return res.status(503).end();
    await applyPayment(customerId, id, kind, snapshot);
    return res.status(200).end();
  } catch { return res.status(503).end(); }
};
module.exports.config = { api: { bodyParser: false } };
