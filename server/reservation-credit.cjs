'use strict';
const store = require('./reservation-store.cjs');
const { admin } = require('./shopify-admin.cjs');
const { verifyDeposit } = require('./reservation-policy.cjs');

// A customer opts out of their reserved tees. Never credit an unverified deposit,
// a settled balance, or a pre-order with an outstanding balance invoice.
async function convertToCredit(customerId, id) {
  if (process.env.MUDRA_STORE_CREDIT_ENABLED !== 'true') throw new Error('Please contact Mudra to convert your deposit to store credit.');
  if (!await require('./reservation-capabilities.cjs').storeCreditReady()) throw new Error('Store credit setup is not complete. Please contact Mudra.');
  await require('./reservation-payments.cjs').reconcile(customerId);
  let claimed = false;
  const record = await store.update(customerId, records => {
    claimed = false;
    const r = records.find(x => x.id === id);
    if (!r || r.customerId !== customerId) throw new Error('Pre-order was not found.');
    if (r.creditStatus === 'credited') return r;
    if (r.creditStatus) throw new Error('Your store credit is being checked. Please contact Mudra before retrying.');
    verifyDeposit(r, r.depositPayment, customerId);
    if (r.status !== 'paid' || r.balancePaid || r.cancelled || r.balanceCreating || r.balanceDraftId) throw new Error('This pre-order needs review before it can become store credit.');
    r.creditStatus = 'processing'; r.creditRequestedAt = new Date().toISOString();
    claimed = true;
    return r;
  });
  if (record.creditStatus === 'credited') return { status: 'credited', amountPaise: record.depositPaise };
  if (!claimed) throw new Error('Store credit is already being prepared.');
  let result;
  try {
    result = await admin(`mutation($id: ID!, $input: StoreCreditAccountCreditInput!) {
      storeCreditAccountCredit(id: $id, creditInput: $input) {
        storeCreditAccountTransaction { id amount { amount currencyCode } }
        userErrors { message }
      }
    }`, { id: customerId, input: { creditAmount: { amount: (record.depositPaise / 100).toFixed(2), currencyCode: 'INR' }, notify: false } });
    const credited = result.storeCreditAccountCredit;
    if (credited.userErrors.length || !credited.storeCreditAccountTransaction) throw new Error('Store credit needs review.');
    const transaction = credited.storeCreditAccountTransaction;
    if (transaction.amount.currencyCode !== 'INR' || Math.round(Number(transaction.amount.amount) * 100) !== record.depositPaise) throw new Error('Store credit amount needs review.');
    await store.update(customerId, records => {
      const r = records.find(x => x.id === id);
      r.creditStatus = 'credited'; r.creditTransactionId = transaction.id;
      r.creditIssuedAt = new Date().toISOString(); r.status = 'credited';
    });
    return { status: 'credited', amountPaise: record.depositPaise };
  } catch {
    // Shopify doesn't offer an idempotency key for this mutation. A timeout may
    // mean credit was issued; never repeat it automatically or unlock the tees.
    await store.update(customerId, records => {
      const r = records.find(x => x.id === id);
      if (r.creditStatus !== 'credited') r.creditStatus = 'review';
    });
    throw new Error('Your store credit needs a manual check. Please contact Mudra; do not request it again.');
  }
}
module.exports = { convertToCredit };
