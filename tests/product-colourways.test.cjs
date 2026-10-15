'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalogue = require('../data/products.json');
const drop = require('../data/drop.json');
const { quoteReservation } = require('../server/reservation-policy.cjs');
const product = catalogue.products.find(p => p.id === 'the-overthinker');

test('all four Overthinker colourways remain distinct through reservation pricing and thumbnails', () => {
  const lines = product.colours.flatMap(c => product.sizes.map(s => ({
    productId: product.id, size: s.size, colour: c.name, quantity: 1,
  })));
  const quote = quoteReservation(lines, catalogue.products, drop, Date.parse(drop.opens), { depositRupees: 199 });
  assert.equal(quote.items.length, 20);
  assert.equal(quote.totalPaise, product.price * 100 * 20);
  assert.equal(quote.depositPaise, 19900 * 20);
  for (const colour of product.colours) {
    const gallery = product.media.filter(m => m.colour === colour.key);
    assert.equal(gallery.length, 6);
    for (const item of quote.items.filter(item => item.colour === colour.name)) {
      assert.equal(item.image, gallery[0].src);
    }
    for (const media of gallery) assert.ok(fs.existsSync(media.src));
  }
  assert.deepEqual(product.colours.map(c => c.name), ['Bone / Blue', 'Black / Blue', 'Black / Oxblood Red', 'Bone / Oxblood Red']);
  assert.ok(product.colours.every(c => !c.key.includes('white')));
});

test('split swatches place garment above print while ordinary colour swatches stay solid', () => {
  const context = { window: {}, location: { protocol: 'https:', hostname: 'www.wearmudra.shop', search: '' },
    document: { querySelector: () => null, addEventListener() {} }, addEventListener() {}, URLSearchParams, Intl, Date, console };
  vm.runInNewContext(fs.readFileSync('assets/js/shop.js', 'utf8'), context);
  const M = context.window.Mudra;
  assert.equal(M.swatchFill(product.colours.find(c => c.key === 'black-red')), 'linear-gradient(135deg, #1A1A1A 0% 50%, #982D3E 50% 100%)');
  assert.equal(M.swatchFill(product.colours[3]), 'linear-gradient(135deg, #E8E4DA 0% 50%, #982D3E 50% 100%)');
  assert.equal(M.swatchFill({ hex: '#650C17' }), '#650C17');
});
