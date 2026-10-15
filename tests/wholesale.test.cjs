'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

async function page(site, allowed = false) {
  const nodes = new Map(), events = [], opened = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {hidden: true, dataset: {}, handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      classList: {add() {}}, focus() {}, querySelector() { return node('invalid'); }});
    return nodes.get(selector);
  }
  const wa = node('.ws-hero [data-ws-method="whatsapp"]'); wa.dataset.wsMethod = 'whatsapp';
  const mail = node('.ws-hero [data-ws-method="email"]'); mail.dataset.wsMethod = 'email';
  const buttons = ['whatsapp', 'email'].map(method => Object.assign(node('send-' + method), {dataset: {wsMethod: method}}));
  const form = node('#wsForm'); form.valid = true; form.checkValidity = () => form.valid;
  form.fields = {store: 'Test & Store', city: 'Mumbai', name: 'Tester', phone: '+919999999999', email: 'test@example.com', link: '@test', storeType: 'Streetwear', designs: ['Face Card', 'Atlas'], message: 'A & B?'};
  const location = {};
  const window = {MudraAnalytics: {allowed: () => allowed}, gtag: (...args) => events.push(args), open: (...args) => opened.push(args)};
  class FormData {
    constructor(f) { this.fields = f.fields; }
    get(k) { return this.fields[k] || ''; }
    getAll(k) { return this.fields[k] || []; }
  }
  const data = {'/data/site.json': site, '/data/wholesale.json': {why: [], terms: [], storeTypes: ['Streetwear']}, '/data/products.json': {products: [{name: 'Face Card'}, {name: 'Atlas'}]}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/wholesale.js'), 'utf8'), {
    window, location, FormData, document: {querySelector: node, querySelectorAll: () => buttons},
    fetch: async url => ({ok: true, json: async () => data[url]}),
  });
  await new Promise(resolve => setImmediate(resolve));
  return {node, form, mail, wa, events, opened, location, submit(method) { form.handlers.submit({preventDefault() {}, submitter: {dataset: {wsMethod: method}}}); }};
}

test('email enquiry preserves selected designs and punctuation without analytics before consent', async () => {
  const p = await page({wholesaleEmail: 'abhijeet@wearmudra.shop'});
  assert.equal(p.mail.hidden, false); assert.equal(p.wa.hidden, true);
  p.submit('email');
  const link = new URL(p.location.href);
  assert.equal(link.pathname, 'abhijeet@wearmudra.shop');
  assert.match(link.searchParams.get('body'), /Designs: Face Card, Atlas/);
  assert.match(link.searchParams.get('body'), /A & B\?/);
  assert.equal(p.events.length, 0);
});

test('invalid forms do not navigate; consented events contain method only', async () => {
  const p = await page({whatsappBusiness: '+91 99999 99999'}, true);
  p.form.valid = false; p.submit('whatsapp');
  assert.equal(p.opened.length, 0); assert.equal(p.events.length, 0);
  assert.equal(p.node('#wsErr').hidden, false);
  p.form.valid = true; p.submit('whatsapp');
  assert.match(p.opened[0][0], /^https:\/\/wa.me\/919999999999\?text=/);
  assert.equal(JSON.stringify(p.events), JSON.stringify([['event', 'wholesale_enquiry', {method: 'whatsapp'}]]));
});

test('missing contact destinations leave enquiries unavailable without a broken link', async () => {
  const p = await page({wholesaleEmail: 'invalid'});
  assert.equal(p.mail.hidden, true); assert.equal(p.wa.hidden, true);
  assert.equal(p.node('[data-ws="send"]').hidden, true);
  assert.equal(p.node('[data-ws="off"]').hidden, false);
  p.submit('email'); assert.equal(p.location.href, undefined);
});
