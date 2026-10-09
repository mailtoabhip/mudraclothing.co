const { login, secureHeaders } = require('../../server/customer-auth.cjs');
module.exports = (req, res) => {
  secureHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try { login(req, res); } catch { res.redirect(302, '/reservations?error=unavailable'); }
};
