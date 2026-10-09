const { callback, secureHeaders } = require('../../server/customer-auth.cjs');
module.exports = async (req, res) => {
  secureHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try { await callback(req, res); } catch { res.redirect(302, '/cart?error=signin'); }
};
