'use strict';
const { admin } = require('../server/shopify-admin.cjs');
const settings = require('../data/reservations.json');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  // No customer/order data or credentials are returned by this readiness probe.
  try {
    const result = await admin('{ currentAppInstallation { accessScopes { handle } } }');
    const scopes = new Set(result.currentAppInstallation.accessScopes.map(s => s.handle));
    const storeConnected = ['read_products', 'read_orders', 'read_customers', 'write_customers', 'write_draft_orders'].every(s => scopes.has(s));
    return res.status(200).json({ storeConnected, priceUpdatesAllowed: scopes.has('write_products'), enabled: settings.enabled === true, message: settings.enabled ? 'Reservation checkout is enabled.' : 'Reservation checkout is being verified.' });
  } catch {
    return res.status(503).json({ storeConnected: false, enabled: false, message: 'Reservation checkout is not ready.' });
  }
};
