'use strict';
const { admin } = require('./shopify-admin.cjs');
let cached;
async function storeCreditPermission() {
  if (cached && cached.until > Date.now()) return cached.allowed;
  const result = await admin('{ currentAppInstallation { accessScopes { handle } } }');
  const allowed = result.currentAppInstallation?.accessScopes?.some(s => s.handle === 'write_store_credit_account_transactions') === true;
  cached = { allowed, until: Date.now() + 60000 };
  return allowed;
}
async function storeCreditReady() {
  return process.env.MUDRA_STORE_CREDIT_ENABLED === 'true' && await storeCreditPermission();
}
module.exports = { storeCreditPermission, storeCreditReady };
