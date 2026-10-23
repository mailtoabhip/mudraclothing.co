'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function storefront(nodes) {
  let requests = 0;
  const context = { window: {}, location: {protocol:'https:',hostname:'www.wearmudra.shop',search:''}, document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},addEventListener(){},URLSearchParams,Intl,Date,console,
    fetch: async () => { requests++; return {ok:true,json:async()=>({data:{product:{variants:{nodes}}}})}; } };
  vm.runInNewContext(fs.readFileSync('assets/js/shop.js','utf8'),context);
  return {M:context.window.Mudra, requests:()=>requests};
}
const variant=(id,colour,size='M')=>({id,availableForSale:true,price:{amount:'1299'},selectedOptions:[{name:'Size',value:size},...(colour?[{name:'Colour',value:colour}]:[])]});
test('same-size colourways resolve to different native variants without cross-colour fallback',async()=>{
 const {M,requests}=storefront([variant('maroon','Maroon'),variant('blue','Blue'),variant('brown','Brown')]);
 assert.equal((await M.liveProduct('face-card','Maroon')).variants.M.id,'maroon');
 assert.equal((await M.liveProduct('face-card','Blue')).variants.M.id,'blue');
 assert.equal((await M.liveProduct('face-card','Brown')).variants.M.id,'brown');
 assert.deepEqual(Object.keys((await M.liveProduct('face-card','Bone')).variants),[]);
 assert.equal(requests(),1);
});
test('size-only products remain usable during migration; compound print colours match exactly',async()=>{
 const old=storefront([variant('legacy')]);
 assert.equal((await old.M.liveProduct('face-card','Blue')).variants.M.id,'legacy');
 const updated=storefront([variant('blue','Bone / Blue'),variant('red','Bone / Oxblood Red')]);
 assert.equal((await updated.M.liveProduct('the-overthinker','Bone / Oxblood Red')).variants.M.id,'red');
 assert.deepEqual(Object.keys((await updated.M.liveProduct('the-overthinker','White / Red')).variants),[]);
});
