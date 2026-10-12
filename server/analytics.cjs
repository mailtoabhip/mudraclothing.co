'use strict';

// GA4 Measurement Protocol: payment events sent from the order webhook, the only place a payment is
// confirmed. Needs GA_API_SECRET in Vercel (GA4 → Admin → Data streams → Measurement Protocol API secrets).
// Without it, nothing is sent. Never throws: analytics must not break payment handling.

const MEASUREMENT_ID = 'G-KR05NW0DGN';   // same as scripts/site_config.py GA_MEASUREMENT_ID

// Only the ids the browser read from GA's own cookies, in their known shape.
function cleanIds(ga) {
  if (ga?.analyticsConsent !== true) return null;
  const clientId = /^\d{1,20}\.\d{1,20}$/.test(ga?.clientId || '') ? ga.clientId : null;
  if (!clientId) return null;
  const sessionId = /^\d{1,20}$/.test(ga?.sessionId || '') ? ga.sessionId : null;
  return { clientId, sessionId, analyticsConsent: true };
}

const rupees = paise => Math.round(paise) / 100;

async function send(ga, name, params) {
  const secret = process.env.GA_API_SECRET;
  if (!secret) return false;
  const ids = cleanIds(ga);
  if (!ids) return false;
  const clientId = ids.clientId;
  const body = { client_id: clientId, events: [{ name, params: {
    ...params, engagement_time_msec: 1, ...(ids?.sessionId ? { session_id: ids.sessionId } : {}),
  } }] };
  try {
    const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(secret)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch { return false; }
}

const item = (id, name, pricePaise, quantity, colour, size) => ({
  item_id: id, item_name: name, item_brand: 'Mudra', item_category: 'T-shirts',
  price: rupees(pricePaise), quantity, item_variant: [colour, size].filter(Boolean).join(' / '),
});

// ₹199-per-tee deposit, confirmed paid
function depositPaid(record, orderId) {
  return send(record.ga, 'deposit_paid', {
    currency: 'INR', value: rupees(record.depositPaise), transaction_id: `deposit-${orderId}`,
    items: record.items.map(x => item(x.productId, x.name, x.depositPaise, x.quantity, x.colour, x.size)),
  });
}

// the remaining balance on a pre-order, confirmed paid: that's the purchase of the tees
function balancePaid(record, orderId) {
  return send(record.ga, 'purchase', {
    currency: 'INR', value: rupees(record.balancePaise), transaction_id: String(orderId), payment_type: 'pre-order balance',
    items: record.items.map(x => item(x.productId, x.name, x.pricePaise - x.depositPaise, x.quantity, x.colour, x.size)),
  });
}

// a normal Shopify checkout (after launch). items carry our product id (the handle) like the site's events.
function orderPaid(event, handles) {
  const attr = key => event.note_attributes?.find(a => a.name === key)?.value;
  return send({ clientId: attr('_ga_client_id'), sessionId: attr('_ga_session_id'), analyticsConsent: attr('_ga_consent') === 'granted' }, 'purchase', {
    currency: event.currency || 'INR', value: Number(event.current_total_price ?? event.total_price) || 0,
    transaction_id: String(event.id), shipping: Number(event.total_shipping_price_set?.shop_money?.amount) || 0,
    tax: Number(event.current_total_tax ?? event.total_tax) || 0,
    items: (event.line_items || []).map(l => ({
      item_id: handles[l.product_id] || String(l.product_id || l.title), item_name: l.title, item_brand: 'Mudra',
      item_category: 'T-shirts', price: Number(l.price) || 0, quantity: l.quantity,
      item_variant: [l.properties?.find(p => p.name === 'Colour')?.value, l.variant_title].filter(Boolean).join(' / '),
    })),
  });
}

module.exports = { cleanIds, depositPaid, balancePaid, orderPaid };
