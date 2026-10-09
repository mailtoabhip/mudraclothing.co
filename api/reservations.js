const { session, secureHeaders, requireCsrf } = require('../server/customer-auth.cjs');
const { createDeposit, createBalance, reconcile, publicRecord, retryUnpaid } = require('../server/reservation-payments.cjs');
module.exports = async (req, res) => {
  secureHeaders(res);
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  const saved = await session(req, res);
  if (!saved) return res.status(401).json({ error: 'Sign in to view or create your reservation.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ reservations: (await reconcile(saved.customerId)).map(publicRecord) });
    requireCsrf(req, saved);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(body || {}).length > 15000) return res.status(413).json({ error: 'This request is too large.' });
    if (body?.action === 'deposit') return res.status(200).json(await createDeposit(saved.customerId, body.lines, body.requestKey));
    if (body?.action === 'balance' && typeof body.id === 'string') return res.status(200).json(await createBalance(saved.customerId, body.id));
    if (body?.action === 'retry' && typeof body.id === 'string') return res.status(200).json(await retryUnpaid(saved.customerId, body.id));
    return res.status(400).json({ error: 'Choose a reservation payment.' });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not complete the reservation. Please try again.' });
  }
};
