const { session, secureHeaders, requireCsrf } = require('../server/customer-auth.cjs');
const { createDeposit, createBalance, reconcile, publicRecord, retryUnpaid } = require('../server/reservation-payments.cjs');
const store = require('../server/reservation-store.cjs');
const { cleanIds } = require('../server/analytics.cjs');

// Remember the visitor's GA4 ids on the pre-order, so the payment webhook can credit the same visit.
async function rememberGa(customerId, id, ga) {
  const ids = cleanIds(ga);
  if (!ids || !id) return;
  try { await store.update(customerId, records => { const r = records.find(x => x.id === id); if (r) r.ga = ids; }); } catch {}
}
module.exports = async (req, res) => {
  secureHeaders(res);
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  const saved = await session(req, res);
  if (!saved) return res.status(401).json({ error: 'Sign in to view or create your pre-order.' });
  try {
    if (req.method === 'GET') {
      const records = await reconcile(saved.customerId);
      let creditReady = false;
      try { creditReady = await require('../server/reservation-capabilities.cjs').storeCreditReady(); } catch {}
      return res.status(200).json({ reservations: records.map(r => publicRecord(r, creditReady)) });
    }
    requireCsrf(req, saved);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(body || {}).length > 15000) return res.status(413).json({ error: 'This request is too large.' });
    if (body?.action === 'forget-analytics') {
      await store.update(saved.customerId, records => { for (const record of records) delete record.ga; });
      return res.status(200).json({ forgotten: true });
    }
    if (body?.action === 'deposit') {
      const result = await createDeposit(saved.customerId, body.lines, body.requestKey);
      await rememberGa(saved.customerId, result.id, body.ga);
      return res.status(200).json(result);
    }
    if (body?.action === 'balance' && typeof body.id === 'string') {
      const result = await createBalance(saved.customerId, body.id);
      await rememberGa(saved.customerId, body.id, body.ga);
      return res.status(200).json(result);
    }
    if (body?.action === 'credit' && typeof body.id === 'string') {
      return res.status(200).json(await require('../server/reservation-credit.cjs').convertToCredit(saved.customerId, body.id));
    }
    if (body?.action === 'retry' && typeof body.id === 'string') return res.status(200).json(await retryUnpaid(saved.customerId, body.id));
    return res.status(400).json({ error: 'Choose a pre-order payment.' });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not complete the pre-order. Please try again.' });
  }
};
