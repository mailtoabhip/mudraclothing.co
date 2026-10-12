'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const drop = require('../data/drop.json');
const records = new Map();
const store = require('../server/reservation-store.cjs');
store.update = async (customer, edit) => edit(records.get(customer) || []);
store.read = async customer => ({ records: records.get(customer) || [] });
const payments = require('../server/reservation-payments.cjs');
payments.reconcile = async customer => (records.get(customer) || []);
let calls = 0, mode = 'ok';
require('../server/shopify-admin.cjs').admin = async (_q, v) => {
 calls++;
 assert.equal(v.input.notify, false);
 assert.equal(v.input.expiresAt, undefined);
 if (mode === 'timeout') throw new Error('timeout');
 return { storeCreditAccountCredit: { userErrors: [], storeCreditAccountTransaction: { id: 'credit-1', amount: v.input.creditAmount } } };
};
const { convertToCredit } = require('../server/reservation-credit.cjs');
require('../server/reservation-capabilities.cjs').storeCreditReady = async () => true;
const { quoteBalance } = require('../server/reservation-policy.cjs');
function setup(id = 'a', extras = {}) {
 const r = { id, customerId: 'customer-1', status: 'paid', depositOrderId: 'order-1', depositPaise: 19900, balancePaise: 110000, closes: drop.closes,
  items: [{ pricePaise: 129900, depositPaise: 19900, quantity: 1 }],
  depositPayment: { id: 'order-1', customerId: 'customer-1', currency: 'INR', status: 'PAID', paidPaise: 19900, refundedPaise: 0, paidAt: '2026-10-12T12:00:00+05:30' }, ...extras };
 records.set('customer-1', [r]); calls = 0; mode = 'ok'; process.env.MUDRA_STORE_CREDIT_ENABLED = 'true';return r;
}
test('verified credit is issued once, never expires, and releases the reserved balance', async () => {
 const r=setup(); await convertToCredit('customer-1','a'); await convertToCredit('customer-1','a');
 assert.equal(calls,1); assert.equal(r.status,'credited'); assert.equal(r.creditTransactionId,'credit-1');
 assert.throws(()=>quoteBalance(r,r.depositPayment,'customer-1'),{code:'ALREADY_SETTLED'});
});
test('concurrent credit requests never create a second credit', async () => {
 setup(); const results=await Promise.allSettled([convertToCredit('customer-1','a'),convertToCredit('customer-1','a')]);
 assert.equal(calls,1);assert.ok(results.some(x=>x.status==='fulfilled'));
});
test('another customer, unpaid/refunded deposits and outstanding balance checkouts cannot convert', async () => {
 setup();await assert.rejects(()=>convertToCredit('customer-2','a'));assert.equal(calls,0);
 for (const changes of [{status:'pending'}, {balancePaid:true}, {balanceDraftId:'balance-1'}, {balanceCreating:true}, {cancelled:true}]) {
  setup('a',changes);await assert.rejects(()=>convertToCredit('customer-1','a'));assert.equal(calls,0);
 }
 const r=setup();r.depositPayment.refundedPaise=19900;await assert.rejects(()=>convertToCredit('customer-1','a'));assert.equal(calls,0);
});
test('ambiguous Shopify timeout stays blocked for review instead of issuing twice', async () => {
 const r=setup();mode='timeout';await assert.rejects(()=>convertToCredit('customer-1','a'));await assert.rejects(()=>convertToCredit('customer-1','a'));
 assert.equal(calls,1);assert.equal(r.creditStatus,'review');assert.throws(()=>quoteBalance(r,r.depositPayment,'customer-1'));
});
test('conversion remains disabled until production permission and checkout setup are approved',async()=>{
 setup();delete process.env.MUDRA_STORE_CREDIT_ENABLED;await assert.rejects(()=>convertToCredit('customer-1','a'));assert.equal(calls,0);
});
test('a missing Shopify scope cannot create credit or lock the deposit',async()=>{
 const r=setup();const capabilities=require('../server/reservation-capabilities.cjs');
 capabilities.storeCreditReady=async()=>false;
 await assert.rejects(()=>convertToCredit('customer-1','a'),/setup is not complete/);
 assert.equal(calls,0);assert.equal(r.creditStatus,undefined);
 capabilities.storeCreditReady=async()=>true;
});
