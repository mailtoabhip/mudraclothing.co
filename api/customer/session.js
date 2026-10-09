const { session, secureHeaders, requireCsrf, clearSession } = require('../../server/customer-auth.cjs');
module.exports = async (req, res) => {
  secureHeaders(res);
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  const saved = await session(req, res);
  if (req.method === 'POST') {
    try { requireCsrf(req, saved); clearSession(res); return res.status(200).json({ signedIn: false }); }
    catch { return res.status(403).json({ error: 'Please refresh and try again.' }); }
  }
  return res.status(200).json({ signedIn: !!saved, csrf: saved?.csrf || null });
};
