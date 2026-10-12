'use strict';

const SHOP = 'q0xhyi-ac.myshopify.com';
const VERSION = '2026-10';
let credential;

async function accessToken() {
  if (credential && credential.until > Date.now()) return credential.value;
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Shopify backend is not configured.');
  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error('Shopify backend authentication failed.');
  credential = { value: result.access_token, until: Date.now() + (Number(result.expires_in) - 300) * 1000 };
  return credential.value;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Shopify limits how fast the store can be queried. In a launch rush it answers "throttled"
// (HTTP 429, or a THROTTLED error); wait and try again instead of failing the customer.
async function admin(query, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken() },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(() => ({}));
    const throttled = response.status === 429 || result.errors?.some?.(e => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < 5) {
      // back off 0.5s, 1s, 2s, 4s, 8s, plus a little jitter so retries don't arrive together
      await sleep(500 * 2 ** attempt + Math.random() * 250);
      continue;
    }
    if (!response.ok || result.errors?.length) throw new Error('Shopify request could not be completed.');
    return result.data;
  }
}

module.exports = { admin, SHOP, VERSION };
