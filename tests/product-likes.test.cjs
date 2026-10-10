'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const auth = require('../server/customer-auth.cjs');
const store = require('../server/product-likes.cjs');
const handler = require('../api/product-likes.js');
const report = require('../api/product-like-stats.js');
const shopify = require('../server/shopify-admin.cjs');
process.env.RESERVATION_SESSION_KEY = crypto.randomBytes(32).toString('base64');
process.env.UPSTASH_REDIS_REST_URL = 'https://example.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only-placeholder';
function response() {
  return { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
    status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
}
const request = (body, extra = {}) => ({ method: 'POST', headers: { origin: auth.ORIGIN, 'content-type': 'application/json' }, body, ...extra });
test('signed browser cookie survives refresh and cannot be forged', () => {
  const res = response(), id = store.visitor({ headers: {} }, res);
  const cookie = res.headers['Set-Cookie'][0].split(';')[0];
  assert.match(res.headers['Set-Cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(store.visitor({ headers: { cookie } }, response()), id);
  assert.notEqual(store.visitor({ headers: { cookie: cookie + 'x' } }, response()), id);
});
test('wrong origin, invalid product, nonboolean state and unsupported methods are rejected', async () => {
  for (const [req, code] of [
    [request({ product: 'atlas', liked: true }, { headers: { origin: 'https://elsewhere.invalid' } }), 403],
    [request({ product: 'archived', liked: true }), 400],
    [request({ product: 'atlas', liked: 'true' }), 400],
    [request({}, { method: 'DELETE' }), 405]
  ]) { const res = response(); await handler(req, res); assert.equal(res.code, code); }
});
test('GET returns browser state only, no popularity totals', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ result: store.products.map(p => p.id === 'atlas' ? 1 : 0) }) });
  try { const res = response(); await handler({ method: 'GET', headers: {} }, res); assert.deepEqual(res.body, { liked: ['atlas'] }); }
  finally { global.fetch = original; }
});
test('writes use atomic membership, desired state and two short-lived rate limits', async () => {
  const original = global.fetch; let command;
  global.fetch = async (url, options) => { command = JSON.parse(options.body); return { ok: true, json: async () => ({ result: 1 }) }; };
  try {
    const res = response(); await handler(request({ product: 'atlas', liked: true }), res);
    assert.deepEqual(res.body, { product: 'atlas', liked: true });
    assert.equal(command[0], 'EVAL'); assert.equal(command[2], 3); assert.equal(command.at(-1), '1');
    assert.match(command[1], /SADD/); assert.match(command[1], /SREM/); assert.match(command[1], /EXPIRE/);
    assert.doesNotMatch(command.join(' '), /undefined/);
    global.fetch = async () => ({ ok: true, json: async () => ({ result: -1 }) });
    const limited = response(); await handler(request({ product: 'atlas', liked: true }), limited);
    assert.equal(limited.code, 429); assert.equal(limited.headers['Retry-After'], '60');
  } finally { global.fetch = original; }
});
test('storage failure produces a generic error, never credentials', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error('sensitive provider details'); };
  try { const res = response(); await handler(request({ product: 'atlas', liked: false }), res); assert.equal(res.code, 503); assert.doesNotMatch(JSON.stringify(res.body), /sensitive/); }
  finally { global.fetch = original; }
});
test('private totals require the allowlisted customer identity', async () => {
  process.env.LIKES_OWNER_CUSTOMER_ID = 'gid://shopify/Customer/123';
  const original = auth.session, fetch = global.fetch;
  try {
    for (const saved of [null, { customerId: 'gid://shopify/Customer/999' }]) {
      auth.session = async () => saved;
      const res = response(); await report({ method: 'GET', headers: {} }, res); assert.equal(res.code, 403);
    }
    auth.session = async () => ({ customerId: process.env.LIKES_OWNER_CUSTOMER_ID });
    global.fetch = async () => ({ ok: true, json: async () => ({ result: store.products.map(() => 2) }) });
    const res = response(); await report({ method: 'GET', headers: {} }, res);
    assert.equal(res.body.products.length, 7); assert.equal(res.body.products[0].likes, 2);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally { auth.session = original; global.fetch = fetch; }
});
test('email allowlist is checked against Shopify, never a browser claim', async () => {
  delete process.env.LIKES_OWNER_CUSTOMER_ID;
  process.env.LIKES_OWNER_EMAIL = 'owner@example.invalid';
  const session = auth.session, admin = shopify.admin, fetch = global.fetch;
  auth.session = async () => ({ customerId: 'gid://shopify/Customer/123' });
  global.fetch = async () => ({ ok: true, json: async () => ({ result: store.products.map(() => 0) }) });
  try {
    shopify.admin = async (query, variables) => {
      assert.deepEqual(variables, { id: 'gid://shopify/Customer/123' });
      return { customer: { email: 'someone@example.invalid' } };
    };
    const denied = response(); await report({ method: 'GET', headers: {} }, denied); assert.equal(denied.code, 403);
    shopify.admin = async () => ({ customer: { email: 'OWNER@example.invalid' } });
    const allowed = response(); await report({ method: 'GET', headers: {} }, allowed); assert.equal(allowed.code, 200);
    assert.equal(allowed.body.products.length, 7);
  } finally { auth.session = session; shopify.admin = admin; global.fetch = fetch; delete process.env.LIKES_OWNER_EMAIL; }
});
