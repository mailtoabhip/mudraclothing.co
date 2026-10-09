const crypto = require('node:crypto');
const { maintain } = require('../server/reservation-maintenance.cjs');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const actual = Buffer.from(req.headers.authorization || '');
  if (!process.env.CRON_SECRET || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return res.status(401).end();
  try { return res.status(200).json(await maintain()); }
  catch { return res.status(503).json({ error: 'Pre-order maintenance needs review.' }); }
};
