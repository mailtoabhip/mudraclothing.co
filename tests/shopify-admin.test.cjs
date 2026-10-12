'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('a throttled Shopify call is retried, not failed', async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = 'id';
  process.env.SHOPIFY_APP_CLIENT_SECRET = 'secret';
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async url => {
    if (String(url).includes('/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    calls++;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    if (calls === 2) return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }) };
    return { ok: true, status: 200, json: async () => ({ data: { shop: { name: 'Mudra' } } }) };
  };
  try {
    const { admin } = require('../server/shopify-admin.cjs');
    assert.deepEqual(await admin('{ shop { name } }'), { shop: { name: 'Mudra' } });
    assert.equal(calls, 3);
  } finally { global.fetch = realFetch; }
});
