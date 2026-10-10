'use strict';
const likes = require('../server/product-likes.cjs');
const auth = require('../server/customer-auth.cjs');
const shopify = require('../server/shopify-admin.cjs');
module.exports = async function handler(req, res) {
  auth.secureHeaders(res);
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.' }); }
  try {
    const owner = process.env.LIKES_OWNER_CUSTOMER_ID;
    const email = process.env.LIKES_OWNER_EMAIL;
    if (!owner && !email) return res.status(503).json({ error: 'The owner view is not configured yet.' });
    const saved = await auth.session(req, res);
    let permitted = Boolean(saved && owner && saved.customerId === owner);
    if (saved && !owner && email) {
      const data = await shopify.admin('query LikesOwner($id: ID!) { customer(id: $id) { email } }', { id: saved.customerId });
      permitted = data.customer?.email?.toLowerCase() === email.trim().toLowerCase();
    }
    if (!permitted) return res.status(403).json({ error: 'Sign in with the store owner customer account to see likes.' });
    return res.json({ products: await likes.stats(), updatedAt: new Date().toISOString() });
  } catch { return res.status(503).json({ error: 'Could not load likes. Please try again.' }); }
};
