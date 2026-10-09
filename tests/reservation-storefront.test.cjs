'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const drop = require('../data/drop.json');

function storefront(settings) {
  const context = {
    window: {}, location: { protocol: 'https:', hostname: 'www.wearmudra.shop', search: '' },
    document: { querySelector: () => null, addEventListener() {} }, addEventListener() {},
    URLSearchParams, Intl, Date, console,
    fetch: async url => ({ ok: true, json: async () => url.includes('reservations') ? settings : drop }),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/shop.js'), 'utf8'), context);
  return context.window.Mudra;
}
test('storefront deposits stay off until enabled and stop at the configured cutoff', async () => {
  const disabled = storefront({ enabled: false, depositRupees: 199 });
  await Promise.all([disabled.loadDrop(), disabled.loadReservations()]);
  assert.equal(disabled.depositWindow(Date.parse(drop.opens)), false);
  const enabled = storefront({ enabled: true, depositRupees: 199 });
  await Promise.all([enabled.loadDrop(), enabled.loadReservations()]);
  assert.equal(enabled.depositRupees, 199);
  assert.equal(enabled.depositWindow(Date.parse(drop.opens) - 1), false);
  assert.equal(enabled.depositWindow(Date.parse(drop.opens)), true);
  assert.equal(enabled.depositWindow(Date.parse(drop.closes)), true);
  assert.equal(enabled.depositWindow(Date.parse(drop.closes) + 1), false);
  assert.equal(enabled.dropPhase(Date.parse(drop.launch)), 'launched');
});
test('invalid reservation settings cannot enable the deposit CTA', async () => {
  const M = storefront({ enabled: true, depositRupees: -1 });
  await Promise.all([M.loadDrop(), M.loadReservations()]);
  assert.equal(M.depositWindow(Date.parse(drop.opens)), false);
});
