'use strict';
const { admin } = require('./shopify-admin.cjs');
const NAMESPACE = '$app:mudra_reservations';
const KEY = 'registry';
class Conflict extends Error {}
async function read(customerId) {
  const result = await admin(`query($id: ID!) { customer(id: $id) { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value compareDigest } } }`, { id: customerId });
  if (!result.customer) throw new Error('Customer account was not found.');
  const field = result.customer.metafield;
  const records = field ? JSON.parse(field.value) : [];
  if (!Array.isArray(records)) throw new Error('Your reservations need review.');
  return { records, digest: field?.compareDigest || null };
}
async function save(customerId, records, digest) {
  const value = JSON.stringify(records);
  if (Buffer.byteLength(value) > 100000) throw new Error('Please contact us to manage further reservations.');
  const result = await admin(`mutation($fields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $fields) { metafields { compareDigest } userErrors { code } } }`, {
    fields: [{ ownerId: customerId, namespace: NAMESPACE, key: KEY, type: 'json', value, compareDigest: digest }]
  });
  if (result.metafieldsSet.userErrors.some(e => ['INVALID_COMPARE_DIGEST', 'STALE_OBJECT'].includes(e.code))) throw new Conflict();
  if (result.metafieldsSet.userErrors.length) throw new Error('Could not save your reservation.');
}
async function update(customerId, edit) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { records, digest } = await read(customerId);
    const result = edit(records);
    try { await save(customerId, records, digest); return result; }
    catch (error) { if (!(error instanceof Conflict)) throw error; }
  }
  throw new Error('Another update is in progress. Please try again.');
}
module.exports = { read, update };
