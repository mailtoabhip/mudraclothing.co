'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { seal, unseal, requireCsrf, cookie } = require('../server/customer-auth.cjs');
process.env.RESERVATION_SESSION_KEY = crypto.randomBytes(32).toString('base64');
test('session is encrypted and authenticated', () => {
  const value = { customerId: 'customer-1', access: 'example-access', exp: Date.now() + 10000 };
  const sealed = seal(value);
  assert.equal(sealed.includes(value.access), false);
  assert.deepEqual(unseal(sealed), value);
  const bytes = Buffer.from(sealed, 'base64url'); bytes[32] ^= 1;
  assert.equal(unseal(bytes.toString('base64url')), null);
});
test('expired and malformed sessions are rejected', () => {
  assert.equal(unseal(seal({ exp: Date.now() - 1 })), null);
  assert.equal(unseal('invalid'), null);
});
test('writes require both the trusted origin and session CSRF value', () => {
  const saved = { csrf: 'example-csrf' };
  requireCsrf({ headers: { origin: 'https://www.wearmudra.shop', 'x-mudra-csrf': saved.csrf } }, saved);
  assert.throws(() => requireCsrf({ headers: { origin: 'https://attacker.example', 'x-mudra-csrf': saved.csrf } }, saved));
  assert.throws(() => requireCsrf({ headers: { origin: 'https://www.wearmudra.shop' } }, saved));
});
test('cookies cannot be read by frontend code and cannot exceed browser limits', () => {
  const headers = {};
  const res = { getHeader: n => headers[n], setHeader: (n, v) => { headers[n] = v; } };
  cookie(res, '__Host-mudra-session', 'example', 600);
  assert.match(headers['Set-Cookie'][0], /Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.throws(() => cookie(res, '__Host-mudra-session', 'x'.repeat(3900), 600));
});
