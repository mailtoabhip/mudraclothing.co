const { session, secureHeaders } = require('../../server/customer-auth.cjs');
module.exports = async (req, res) => {
  secureHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!await session(req, res)) return res.status(401).json({ error: 'Sign in to view account features.' });
  try {
    const credit = require('../../server/reservation-capabilities.cjs');
    return res.status(200).json({ storeCreditPermission: await credit.storeCreditPermission(), storeCreditEnabled: process.env.MUDRA_STORE_CREDIT_ENABLED === 'true' });
  } catch { return res.status(503).json({ error: 'Account features could not be checked.' }); }
};
