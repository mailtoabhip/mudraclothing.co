'use strict';
const likes = require('../server/product-likes.cjs');
const { ORIGIN, secureHeaders } = require('../server/customer-auth.cjs');
module.exports = async function handler(req, res) {
  secureHeaders(res);
  res.setHeader('Vary', 'Cookie');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!likes.configured()) return res.status(503).json({ error: 'Likes are not available yet.' });
  if (req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
      return res.status(403).json({ error: 'Please use the Mudra website.' });
    }
    const body = req.body;
    if (Number(req.headers['content-length'] || 0) > 1024 || !body || typeof body !== 'object'
      || Buffer.byteLength(JSON.stringify(body)) > 1024
      || typeof body.liked !== 'boolean' || !likes.products.some(p => p.id === body.product)) {
      return res.status(400).json({ error: 'Choose a current product.' });
    }
  }
  try {
    const id = likes.visitor(req, res);
    if (req.method === 'GET') return res.json({ liked: await likes.state(id) });
    const result = await likes.update(req, id, req.body.product, req.body.liked);
    if (result === -1) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Please wait a minute before trying again.' }); }
    return res.json({ product: req.body.product, liked: result === 1 });
  } catch { return res.status(503).json({ error: 'Could not save your like. Please try again.' }); }
};
