'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function page(saved) {
 const store=new Map();if(saved)store.set('mudra-analytics-choice-v1',JSON.stringify(saved));
 const scripts=[],elements=[],removed=[],window={addEventListener(){}};let reloads=0;
 function element(){const handlers={},children={};return {hidden:false,setAttribute(){},addEventListener:(n,f)=>handlers[n]=f,handlers,focus(){},querySelector(s){return children[s] ||= element();}};}
 const document={currentScript:{dataset:{gaId:'G-KR05NW0DGN'}},head:{append:e=>scripts.push(e)},body:{append:e=>elements.push(e)},createElement:element,querySelector:()=>({append:e=>elements.push(e)})};
 Object.defineProperty(document,'cookie',{get:()=> '_ga=GA1.1.123.456',set:s=>removed.push(s)});
 const location={hostname:'www.wearmudra.shop',origin:'https://www.wearmudra.shop',pathname:'/p/face-card',reload:()=>reloads++};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/consent.js'),'utf8'),{window,document,location,localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},fetch:async()=>({ok:true,json:async()=>({signedIn:false})}),Date,JSON});
 return {window,scripts,elements,removed,store,reloads:()=>reloads};
}
test('no Google tag loads before a choice or after declining',async()=>{
 const p=page();assert.equal(p.scripts.length,0);assert.equal(p.window.MudraAnalytics.allowed(),false);assert.equal(p.elements[0].hidden,false);
 await p.elements[0].querySelector('[data-choice="no"]').handlers.click();assert.equal(p.scripts.length,0);assert.equal(p.elements[0].hidden,true);
 assert.equal(JSON.parse(p.store.get('mudra-analytics-choice-v1')).allowed,false);
});
test('an explicit opt-in loads one tag, with advertising off and sensitive URL queries excluded',async()=>{
 const p=page();await p.elements[0].querySelector('[data-choice="yes"]').handlers.click();await p.elements[0].querySelector('[data-choice="yes"]').handlers.click();
 assert.equal(p.scripts.length,1);assert.match(p.scripts[0].src,/G-KR05NW0DGN$/);assert.equal(p.window.MudraAnalytics.allowed(),true);
 const config=p.window.dataLayer.find(x=>x[0]==='config')[2];assert.equal(config.page_location,'https://www.wearmudra.shop/p/face-card');assert.equal(config.allow_google_signals,false);
});
test('saved decline persists; old consent expires; withdrawal disables the tag and removes its cookies',async()=>{
 const declined=page({allowed:false,at:Date.now()});assert.equal(declined.scripts.length,0);assert.equal(declined.elements[0].hidden,true);
 const expired=page({allowed:true,at:Date.now()-181*86400000});assert.equal(expired.scripts.length,0);assert.equal(expired.elements[0].hidden,false);
 const accepted=page({allowed:true,at:Date.now()});assert.equal(accepted.scripts.length,1);
 await accepted.elements[0].querySelector('[data-choice="no"]').handlers.click();assert.equal(accepted.window.MudraAnalytics.allowed(),false);assert.equal(accepted.window['ga-disable-G-KR05NW0DGN'],true);assert.equal(accepted.reloads(),1);assert.ok(accepted.removed.some(s=>s.includes('Max-Age=0')));
});
