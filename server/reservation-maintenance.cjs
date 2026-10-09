'use strict';
const { admin } = require('./shopify-admin.cjs');
const store = require('./reservation-store.cjs');
const catalogue = require('../data/products.json');
const drop = require('../data/drop.json');
async function closeDraft(id) {
  const result = await admin('mutation($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { message } } }', { input: { id } });
  if (result.draftOrderDelete.userErrors.length) throw new Error('An expired checkout needs review.');
}
async function maintain(now = Date.now()) {
  if (now <= Date.parse(drop.closes)) return { windowOpen: true, repriced: 0, expired: 0 };
  let repriced = 0, expired = 0;
  // Idempotent: only the seven live tees and variants with a different price are updated.
  for (const product of catalogue.products) {
    const result = await admin('query($query: String!) { products(first: 1, query: $query) { nodes { id handle variants(first: 100) { nodes { id price } } } } }', { query: `handle:${product.id}` });
    const remote = result.products.nodes.find(p => p.handle === product.id);
    if (!remote) throw new Error('A catalogue product needs review before repricing.');
    const variants = remote.variants.nodes.filter(v => Number(v.price) !== product.regularPrice).map(v => ({ id: v.id, price: product.regularPrice.toFixed(2) }));
    if (!variants.length) continue;
    const updated = await admin('mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $id, variants: $variants) { productVariants { id price } userErrors { message } } }', { id: remote.id, variants });
    if (updated.productVariantsBulkUpdate.userErrors.length) throw new Error('Public price update needs review.');
    repriced += variants.length;
  }
  let after = null;
  do {
    const result = await admin('query($after: String) { draftOrders(first: 100, after: $after, query: "tag:mudra-reservation AND (status:open OR status:invoice_sent)") { pageInfo { hasNextPage endCursor } nodes { id status customer { id } customAttributes { key value } } } }', { after });
    const page = result.draftOrders;
    for (const draft of page.nodes) {
      const stage = draft.customAttributes.find(a => a.key === 'Payment stage')?.value;
      const id = draft.customAttributes.find(a => a.key === 'Mudra reservation')?.value;
      if (stage !== 'deposit' || !id || !draft.customer?.id || draft.status === 'COMPLETED') continue;
      const close = await store.update(draft.customer.id, records => {
        const record = records.find(r => r.id === id);
        if (!record || record.depositDraftId !== draft.id || ['paid','settled'].includes(record.status)) return false;
        record.status = 'expired'; record.depositCheckoutUrl = null; record.depositRetired = true;
        return true;
      });
      if (!close) continue;
      await closeDraft(draft.id); expired++;
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return { windowOpen: false, repriced, expired };
}
module.exports = { maintain, closeDraft };
