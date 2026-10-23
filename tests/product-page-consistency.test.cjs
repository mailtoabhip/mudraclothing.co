'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {products}=require('../data/products.json');
const read=p=>fs.readFileSync(p,'utf8');
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
const field=(s,tag)=>decode(s.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1]||'');

test('each searchable product variant lands on its own colour and size with the matching image and price',()=>{
 let total=0;const ids=new Set();
 for(const p of products){
  const scripts=[...read('p/'+p.id+'.html').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
  const group=scripts.find(j=>j['@type']==='ProductGroup');
  const colours=p.colours.filter(c=>c.sellable);
  assert.equal(group.hasVariant.length,colours.length*p.sizes.length,p.id);
  for(const v of group.hasVariant){
   assert(!ids.has(v.sku));ids.add(v.sku);
   const page=new URL(v.url),c=colours.find(c=>c.key===page.searchParams.get('c'));
   assert(c,p.id+' sellable colour');assert.equal(v.color,c.name);assert.equal(v.size,page.searchParams.get('size'));
   assert(p.sizes.some(s=>s.size===v.size));
   assert.equal(v.image,'https://www.wearmudra.shop/'+p.media.find(m=>m.type==='img'&&(!m.colour||m.colour===c.key)).src);
   assert.equal(v.offers.url,v.url);assert.equal(Number(v.offers.price),p.price);total++;
  }
 }
 assert.equal(total,90);
});

test('shopping feed has exactly the same colour-size-image-price combinations and retains the existing 50 item IDs',()=>{
 const feed=read('feeds/google-merchant.xml');const items=[...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>m[1]);assert.equal(items.length,90);
 const ids=new Set(items.map(i=>field(i,'g:id')));assert.equal(ids.size,90);
 for(const p of products)for(const s of p.sizes)assert(ids.has(p.id+'-'+s.size.toLowerCase()),'Existing ID retained: '+p.id+' '+s.size);
 for(const item of items){
  const p=products.find(p=>p.id===field(item,'g:item_group_id'));const page=new URL(field(item,'link'));
  const c=p.colours.find(c=>c.sellable&&c.key===page.searchParams.get('c'));
  assert(c);assert.equal(field(item,'g:color'),c.name);assert.equal(field(item,'g:size'),page.searchParams.get('size'));
  assert.equal(field(item,'g:image_link'),'https://www.wearmudra.shop/'+p.media.find(m=>m.type==='img'&&(!m.colour||m.colour===c.key)).src);
  assert.equal(Number((field(item,'g:sale_price')||field(item,'g:price')).split(' ')[0]),p.price);
 }
});
