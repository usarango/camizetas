import {Window} from 'happy-dom';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStoreShell, renderProductCards} from '../src/store-layout.js';
import {normalizeDesign, resolveDesign, PRESETS} from '../src/design.js';
import * as designTokens from '../src/design.js';

const source=name=>fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const browserSource=name=>source(name).replace(/^import\s[\s\S]*?;\s*$/gm,'');
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const store={id:'s1',name:'<img onerror=alert(1)>',slug:'atelier',description:'Autorais',template:'chic',published:true};
const products=[{id:'p1',name:'Camiseta <b>Linda</b>',description:'A peça',price_cents:8990,category:'Camisetas',active:true,image_url:'javascript:alert(1)',variants:[{id:'v1',size:'M',color:'Preto',on_hand:3,active:true},{id:'v2',size:'G',color:'Preto',on_hand:0,active:true}]}];
const customer={name:'Nome privado da compradora',phone:'11999999999',address:{postal_code:'01001000',state:'SP',street:'Rua privada da compradora',number:'1',complement:'',neighborhood:'Centro',city:'São Paulo'},notes:'Observação privada'};
const pendingFor=(userId='buyer-a')=>({key:'existing-key',userId,items:[{variant_id:'v1',quantity:1}],customer});

function makeWindow(url,html,api){const window=new Window({url,settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableComputedStyleRendering:true}});window.document.write(html);window.HTMLDialogElement.prototype.showModal=function(){this.open=true};window.HTMLDialogElement.prototype.close=function(){this.open=false};Object.assign(window,{...designTokens,api,escapeHTML,esc:escapeHTML,money,renderStoreShell,renderProductCards,normalizeDesign,resolveDesign,PRESETS});return window}
async function cleanup(window){await window.happyDOM.abort();window.close()}
async function storefront(options={}){let session=options.user===undefined?{id:'buyer-a'}:options.user;const authCallbacks=new Set();const emitAuth=(event,user)=>{for(const callback of authCallbacks)callback(event,user)};const calls=[];const api={ready:true,getPublicStore:async()=>options.store||store,getPublicProducts:async()=>products,getManagedStore:async()=>session&&options.managedStore?.owner_id===session.id?options.managedStore:null,authUser:async()=>session,onAuthChange:callback=>{authCallbacks.add(callback);return()=>authCallbacks.delete(callback)},signOut:async()=>{session=null;emitAuth('SIGNED_OUT',null)},signIn:async()=>{session={id:'buyer-a'};emitAuth('SIGNED_IN',session)},signUp:async()=>({needsConfirmation:true}),placeOrder:async(...args)=>{calls.push(args);if(options.placeOrder)return options.placeOrder(...args);return {id:'o1',order_number:42,total_cents:8990}}};const window=makeWindow('https://camizetas.test/loja.html?loja=atelier','<div class="demo-bar"></div><main id="standalone-store"></main>',api);if(options.cart||options.pending)window.localStorage.setItem('cz-cart:s1',JSON.stringify(options.cart||[{variant_id:'v1',quantity:1}]));if(options.pending)window.sessionStorage.setItem('cz-checkout:s1',JSON.stringify(options.pending));window.eval(browserSource('src/storefront.js'));await tick();await tick();return {window,document:window.document,calls,setUser(user,emit=false){session=user;if(emit)emitAuth(user?'SIGNED_IN':'SIGNED_OUT',user)}}}
async function openCheckout(h){h.document.querySelector('.shop-bag-button').click();h.document.querySelector('#start-checkout').click();await tick();await tick();return h.document.querySelector('#checkout-form')}
function fillCustomer(form,window){for(const[key,value]of Object.entries({name:customer.name,phone:customer.phone,...customer.address,notes:customer.notes}))if(form.elements[key])form.elements[key].value=value}
const submit=(form,window)=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));

test('published directory searches and escapes store names',async()=>{const window=makeWindow('https://camizetas.test/lojas.html',source('dist/lojas.html'),{ready:true,getPublicStores:async()=>[store]});try{window.eval(browserSource('src/shops.js'));await tick();assert.equal(window.document.querySelectorAll('.store-card').length,1);assert.equal(window.document.querySelectorAll('.store-card img').length,0);assert.equal(window.document.querySelector('.store-card h3').textContent,store.name);const input=window.document.querySelector('#store-search');input.value='inexistente';input.dispatchEvent(new window.Event('input'));assert.equal(window.document.querySelectorAll('.store-card').length,0);assert.equal(window.document.querySelector('#directory-status').hidden,false)}finally{await cleanup(window)}});

test('storefront stock, cart, checkout and same-account retry retain one idempotency key',async()=>{let reject=true;const h=await storefront({placeOrder:async()=>{if(reject){reject=false;throw new Error('Falha de rede')}return {id:'o1',order_number:42,total_cents:8990}}});const {window,document}=h;try{assert.equal(document.querySelector('.shop-wordmark').textContent,store.name);assert.equal(document.querySelector('.shop-product-card h3').textContent,products[0].name);assert.ok(document.querySelector('.shop-product-photo img').src.endsWith('assets/product-placeholder.svg'));document.querySelector('[data-product]').click();assert.equal(document.querySelector('select[name=variant] option[value=v2]').disabled,true);submit(document.querySelector('#product-choice'),window);assert.equal(document.querySelector('.shop-bag-count').textContent,'1');const form=await openCheckout(h);fillCustomer(form,window);submit(form,window);await tick();assert.equal(h.calls.length,1);const saved=JSON.parse(window.sessionStorage.getItem('cz-checkout:s1'));assert.equal(saved.userId,'buyer-a');assert.equal(form.elements.name.readOnly,true);assert.match(document.querySelector('.message').textContent,/mesmo pedido/);const key=h.calls[0][3];assert.ok(key);submit(form,window);await tick();await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1][3],key);assert.equal(JSON.stringify(h.calls[1][1]),JSON.stringify([{variant_id:'v1',quantity:1}]));assert.equal(h.calls[1][2].address.city,'São Paulo');assert.match(document.querySelector('.order-success-number').textContent,/#42/);assert.equal(document.querySelector('.shop-bag-count').textContent,'0');assert.equal(window.sessionStorage.getItem('cz-checkout:s1'),null)}finally{await cleanup(window)}});

test('pending checkout is hidden and cannot be resumed by a different buyer',async()=>{const h=await storefront({pending:pendingFor(),user:{id:'buyer-b'}});try{assert.equal(await openCheckout(h),null);assert.match(h.document.querySelector('.shop-modal h2').textContent,/conta original/);assert.equal(h.document.body.textContent.includes(customer.name),false);assert.equal(h.document.body.textContent.includes(customer.address.street),false);assert.equal(h.calls.length,0);assert.equal(JSON.parse(h.window.sessionStorage.getItem('cz-checkout:s1')).userId,'buyer-a');h.document.querySelector('#original-account').click();await tick();assert.ok(h.document.querySelector('#buyer-auth'));const auth=h.document.querySelector('#buyer-auth');auth.elements.email.value='buyer-a@example.test';auth.elements.password.value='valid-password';submit(auth,h.window);await tick();await tick();assert.equal(h.document.querySelector('#checkout-form').elements.name.value,customer.name)}finally{await cleanup(h.window)}});

test('account switch between form open and submit discards old form without placing order',async()=>{const h=await storefront({cart:[{variant_id:'v1',quantity:1}]});try{const form=await openCheckout(h);fillCustomer(form,h.window);h.setUser({id:'buyer-b'});submit(form,h.window);await tick();assert.equal(h.calls.length,0);assert.equal(h.document.querySelector('#checkout-form'),null);assert.equal(h.document.body.textContent.includes(customer.name),false);assert.equal(h.window.sessionStorage.getItem('cz-checkout:s1'),null);assert.match(h.document.querySelector('.shop-modal h2').textContent,/sessão mudou/)}finally{await cleanup(h.window)}});

test('sign-out before submit requires reauthentication and sends no request',async()=>{const h=await storefront({cart:[{variant_id:'v1',quantity:1}]});try{const form=await openCheckout(h);fillCustomer(form,h.window);h.setUser(null);submit(form,h.window);await tick();assert.equal(h.calls.length,0);assert.equal(h.document.querySelector('#checkout-form'),null);assert.equal(h.document.body.textContent.includes(customer.name),false)}finally{await cleanup(h.window)}});

test('auth change immediately removes pending customer data and old form cannot send',async()=>{const h=await storefront({pending:pendingFor()});try{const form=await openCheckout(h);assert.equal(form.elements.name.value,customer.name);h.setUser({id:'buyer-b'},true);assert.equal(h.document.querySelector('#checkout-form'),null);assert.equal(h.document.body.textContent.includes(customer.name),false);submit(form,h.window);await tick();assert.equal(h.calls.length,0);assert.match(h.document.querySelector('.shop-modal h2').textContent,/conta original/)}finally{await cleanup(h.window)}});

test('account change during request does not reveal result or erase original retry data',async()=>{let resolveOrder;const response=new Promise(resolve=>{resolveOrder=resolve});const h=await storefront({cart:[{variant_id:'v1',quantity:1}],placeOrder:()=>response});try{const form=await openCheckout(h);fillCustomer(form,h.window);submit(form,h.window);await tick();assert.equal(h.calls.length,1);h.setUser({id:'buyer-b'},true);resolveOrder({id:'o1',order_number:42,total_cents:8990});await tick();await tick();assert.equal(h.document.querySelector('.order-success-number'),null);assert.equal(h.document.body.textContent.includes(customer.name),false);assert.equal(JSON.parse(h.window.sessionStorage.getItem('cz-checkout:s1')).userId,'buyer-a');assert.equal(h.document.querySelector('.shop-bag-count').textContent,'1')}finally{await cleanup(h.window)}});

test('legacy pending payload without user binding is discarded and never displayed or sent',async()=>{const legacy=pendingFor();delete legacy.userId;const h=await storefront({pending:legacy,user:{id:'buyer-b'}});try{assert.equal(h.window.sessionStorage.getItem('cz-checkout:s1'),null);const form=await openCheckout(h);assert.ok(form);assert.equal(form.elements.name.value,'');assert.equal(h.document.body.textContent.includes(customer.name),false);assert.equal(h.calls.length,0)}finally{await cleanup(h.window)}});


const ownerbar=document=>document.querySelector('.store-ownerbar, .owner-bar');

test('public visitors and ordinary buyers do not see merchant owner controls',async()=>{
  for(const user of [null,{id:'buyer-a'}]){
    const h=await storefront({user});
    try{assert.equal(ownerbar(h.document),null);assert.equal(h.document.querySelector('a[href="painel.html?loja=s1&espaco=1"]'),null)}finally{await cleanup(h.window)}
  }
});

test('owner-only managed store result exposes the store-space link',async()=>{
  const h=await storefront({managedStore:{...store,owner_id:'buyer-a'}});
  try{const bar=ownerbar(h.document);assert.ok(bar);const link=bar.querySelector('a[href="painel.html?loja=s1&espaco=1"]');assert.ok(link);assert.match(bar.textContent,/loja|espaço|editar|gerenciar/i)}finally{await cleanup(h.window)}
});

test('editor preview and published shell use the same normalized identity and hero settings',async()=>{
  const configured={...store,name:'Loja Autoral',headline:'Uma coleção só nossa.',description:'Da ideia à peça.',design:normalizeDesign({preset:'pop',font:'mono',hero:'fullbleed',accent:'#a03462',background:'#fff2df',logoUrl:'https://example.test/brand-logo.png',heroImage:'https://example.test/collection.jpg',announcement:'Coleção nova toda sexta.',announcementEnabled:true,buttonLabel:'Conhecer minhas peças',gridColumns:2,cardStyle:'soft',radius:20,sections:[{id:'hero',visible:true},{id:'products',visible:true},{id:'about',visible:true}]})};
  const preview=makeWindow('https://camizetas.test/preview',renderStoreShell(configured,{preview:true,products}),{});
  const h=await storefront({store:configured});
  try{
    for(const selector of ['.shop-topline','.shop-kicker','.shop-hero h1','.shop-hero-description','.shop-hero-cta','.shop-about h2']){
      assert.equal(h.document.querySelector(selector)?.textContent.trim(),preview.document.querySelector(selector)?.textContent.trim(),selector);
    }
    assert.equal(h.document.querySelector('.shop-logo')?.getAttribute('src'),'https://example.test/brand-logo.png');
    assert.equal(h.document.querySelector('.shop-logo')?.getAttribute('alt'),'Loja Autoral');
    assert.equal(h.document.querySelector('.shop-hero-visual img')?.getAttribute('src'),'https://example.test/collection.jpg');
    assert.equal(h.document.querySelector('.shop-hero')?.className,preview.document.querySelector('.shop-hero')?.className);
    const live=h.document.querySelector('.design-store');
    assert.equal(live?.getAttribute('data-preset'),'pop');assert.ok(live?.classList.contains('font-mono'));assert.ok(live?.classList.contains('cards-soft'));
    assert.equal(live?.style.getPropertyValue('--store-columns'),'2');assert.equal(live?.style.getPropertyValue('--store-radius'),'20px');
    assert.equal(h.document.querySelectorAll('.shop-product-card').length,preview.document.querySelectorAll('.shop-product-card').length);
    assert.equal(h.document.querySelector('.shop-wordmark')?.getAttribute('href'),'loja.html?loja=atelier');
  }finally{await cleanup(h.window);await cleanup(preview)}
});


test('managed result for another store cannot expose owner controls here',async()=>{
  const h=await storefront({managedStore:{...store,id:'other-store',owner_id:'buyer-a'}});
  try{assert.equal(ownerbar(h.document),null)}finally{await cleanup(h.window)}
});

test('owner controls are removed after owner signs out',async()=>{
  const h=await storefront({managedStore:{...store,owner_id:'buyer-a'}});
  try{assert.ok(ownerbar(h.document));h.setUser(null,true);await tick();await tick();assert.equal(ownerbar(h.document),null)}finally{await cleanup(h.window)}
});
