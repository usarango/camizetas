import {Window} from 'happy-dom';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStoreShell, renderProductCards} from '../src/store-layout.js';
import {normalizeDesign, resolveDesign, PRESETS} from '../src/design.js';
import * as designTokens from '../src/design.js';
import * as productPageTokens from '../src/product-page.js';

const source=name=>fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const browserSource=name=>source(name).replace(/^import\s[\s\S]*?;\s*$/gm,'');
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const store={id:'s1',name:'<img onerror=alert(1)>',slug:'atelier',description:'Autorais',template:'chic',published:true};
const products=[{id:'p1',name:'Camiseta <b>Linda</b>',description:'A peça',price_cents:8990,category:'Camisetas',active:true,image_url:'javascript:alert(1)',variants:[{id:'v1',size:'M',color:'Preto',on_hand:3,active:true},{id:'v2',size:'G',color:'Preto',on_hand:0,active:true}]}];
const customer={name:'Nome privado da compradora',phone:'11999999999',address:{postal_code:'01001000',state:'SP',street:'Rua privada da compradora',number:'1',complement:'',neighborhood:'Centro',city:'São Paulo'},notes:'Observação privada'};
const pendingFor=(userId='buyer-a')=>({key:'existing-key',userId,items:[{variant_id:'v1',quantity:1}],customer});

function makeWindow(url,html,api){const window=new Window({url,settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableComputedStyleRendering:true}});window.document.write(html);window.HTMLDialogElement.prototype.showModal=function(){this.open=true};window.HTMLDialogElement.prototype.close=function(){this.open=false};Object.assign(window,{...designTokens,...productPageTokens,api,escapeHTML,esc:escapeHTML,money,renderStoreShell,renderProductCards,normalizeDesign,resolveDesign,PRESETS});return window}
async function cleanup(window){await window.happyDOM.abort();window.close()}
async function storefront(options={}){let session=options.user===undefined?{id:'buyer-a'}:options.user;const authCallbacks=new Set();const emitAuth=(event,user)=>{for(const callback of authCallbacks)callback(event,user)};const calls=[],collectionCalls=[];const api={ready:true,getPublicStore:async()=>options.store||store,getPublicProducts:async()=>options.products||products,getManagedStore:async()=>session&&options.managedStore?.owner_id===session.id?options.managedStore:null,authUser:async()=>session,onAuthChange:callback=>{authCallbacks.add(callback);return()=>authCallbacks.delete(callback)},signOut:async()=>{session=null;emitAuth('SIGNED_OUT',null)},signIn:async()=>{session={id:'buyer-a'};emitAuth('SIGNED_IN',session)},signUp:async()=>({needsConfirmation:true}),placeOrder:async(...args)=>{calls.push(args);if(options.placeOrder)return options.placeOrder(...args);return {id:'o1',order_number:42,total_cents:8990}}};if(!options.legacyCollectionsAPI){api.getPublicCollections=async()=>options.collections||[];api.getPublicCollection=async(storeId,collectionSlug)=>{collectionCalls.push([storeId,collectionSlug]);return typeof options.getPublicCollection==='function'?options.getPublicCollection(storeId,collectionSlug):options.collection||null}}Object.assign(api,options.api||{});const url='https://camizetas.test/loja.html?loja=atelier'+(options.collectionRoute===undefined?'':'&colecao='+encodeURIComponent(options.collectionRoute))+(options.search||'');const window=makeWindow(url,'<div class="demo-bar"></div><main id="standalone-store"></main>',api);const navigations=[];window.location.assign=value=>navigations.push(String(value));if(options.cart||options.pending)window.localStorage.setItem('cz-cart:s1',JSON.stringify(options.cart||[{variant_id:'v1',quantity:1}]));if(options.pending)window.sessionStorage.setItem('cz-checkout:s1',JSON.stringify(options.pending));window.eval(browserSource('src/storefront.js'));await tick();await tick();return {window,document:window.document,calls,collectionCalls,navigations,setUser(user,emit=false){session=user;if(emit)emitAuth(user?'SIGNED_IN':'SIGNED_OUT',user)}}}
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


const otherProduct={id:'p2',name:'Moletom de outra coleção',description:'Conforto',price_cents:18990,category:'Moletons',active:true,image_url:'https://example.test/moletom.jpg',variants:[{id:'v3',size:'G',color:'Azul',on_hand:4,active:true}]};
const publicCollection={id:'c1',store_id:'s1',name:'Coleção de Verão',slug:'verao',description:'Peças leves para os seus dias.',image_url:'https://example.test/verao.jpg',active:true,featured:true,sort_order:1,product_ids:['p1']};

test('direct collection route renders its own hero and only member products and categories',async()=>{
  const h=await storefront({products:[...products,otherProduct],collectionRoute:'verao',collection:publicCollection});
  try{
    assert.equal(JSON.stringify(h.collectionCalls[0]),JSON.stringify(['s1','verao']));
    assert.equal(h.document.querySelector('.shop-hero h1').textContent,publicCollection.name);
    assert.equal(h.document.querySelector('.shop-hero-description').textContent,publicCollection.description);
    assert.equal(h.document.querySelector('.shop-hero-visual img')?.getAttribute('src'),publicCollection.image_url);
    assert.equal(h.document.querySelectorAll('.shop-product-card').length,1);
    assert.equal(h.document.querySelector('.shop-product-card h3').textContent,products[0].name);
    const categories=[...h.document.querySelectorAll('.shop-category option')].map(option=>option.value);
    assert.equal(JSON.stringify(categories),JSON.stringify(['Todos','Camisetas']));
    assert.ok(h.document.querySelector('a[href="loja.html?loja=atelier#collection"]'));
    assert.match(h.document.title,/Coleção de Verão/);
  }finally{await cleanup(h.window)}
});

test('unavailable, inactive and cross-store collections never fall back to the full catalogue',async()=>{
  for(const collection of [null,{...publicCollection,active:false},{...publicCollection,store_id:'other-store'},{...publicCollection,product_ids:undefined}]){
    const h=await storefront({products:[...products,otherProduct],collectionRoute:'verao',collection});
    try{
      assert.match(h.document.querySelector('#standalone-store').textContent,/coleção não está disponível/i);
      assert.equal(h.document.querySelectorAll('.shop-product-card').length,0);
      assert.equal(h.document.querySelector('.shop-bag-button'),null);
      assert.ok(h.document.querySelector('a[href="loja.html?loja=atelier#collection"]'));
    }finally{await cleanup(h.window)}
  }
  const emptyRoute=await storefront({collectionRoute:'',collection:publicCollection});
  try{assert.equal(emptyRoute.collectionCalls.length,0);assert.match(emptyRoute.document.body.textContent,/coleção não está disponível/i)}finally{await cleanup(emptyRoute.window)}
});

test('collection filter does not remove cart products from the rest of the store',async()=>{
  const h=await storefront({products:[...products,otherProduct],collectionRoute:'verao',collection:publicCollection,cart:[{variant_id:'v3',quantity:2}]});
  try{
    assert.equal(h.document.querySelectorAll('.shop-product-card').length,1);
    h.document.querySelector('.shop-bag-button').click();
    assert.equal(h.document.querySelector('.shop-line-item h3').textContent,otherProduct.name);
    assert.match(h.document.querySelector('.cart-summary').textContent,/379,80/);
    assert.equal(h.document.querySelector('#start-checkout').disabled,false);
    h.document.querySelector('#start-checkout').click();await tick();await tick();
    const form=h.document.querySelector('#checkout-form');fillCustomer(form,h.window);submit(form,h.window);await tick();await tick();
    assert.equal(JSON.stringify(h.calls[0][1]),JSON.stringify([{variant_id:'v3',quantity:2}]));
  }finally{await cleanup(h.window)}
});

test('collection metadata stays plain text and unsafe image URLs are rejected',async()=>{
  const collection={...publicCollection,name:'<img src=x onerror=alert(1)>',description:'<script>private()</script>',image_url:'javascript:alert(1)'};
  const h=await storefront({collectionRoute:'verao',collection});
  try{
    assert.equal(h.document.querySelector('.shop-hero h1').textContent,collection.name);
    assert.equal(h.document.querySelector('.shop-hero-description').textContent,collection.description);
    assert.equal(h.document.querySelectorAll('.shop-hero script,.shop-hero [onerror]').length,0);
    assert.equal(!!h.document.querySelector('.shop-hero-visual img')?.src.startsWith('javascript:'),false);
  }finally{await cleanup(h.window)}
});

test('old stores keep a complete catalogue when the collections API is absent',async()=>{
  const h=await storefront({legacyCollectionsAPI:true,products:[...products,otherProduct]});
  try{assert.equal(h.document.querySelectorAll('.shop-product-card').length,2);assert.equal(h.document.querySelector('.shop-hero h1').textContent,store.name)}finally{await cleanup(h.window)}
  const direct=await storefront({legacyCollectionsAPI:true,collectionRoute:'verao'});
  try{assert.match(direct.document.body.textContent,/coleção não está disponível/i);assert.equal(direct.document.querySelectorAll('.shop-product-card').length,0)}finally{await cleanup(direct.window)}
});


const collectionMetadata=({product_ids,...metadata})=>metadata;
const featuredStore={...store,design:normalizeDesign({sections:[{id:'hero',visible:true},{id:'collections',visible:true},{id:'products',visible:true},{id:'about',visible:false}]})};

test('featured home collections are active featured cards, while all active collections are discoverable in selector',async()=>{
  const secondary={...publicCollection,id:'c2',name:'Outra coleção',slug:'essenciais',featured:false};
  const inactive={...publicCollection,id:'c3',name:'Coleção oculta',slug:'oculta',active:false};
  const h=await storefront({store:featuredStore,collections:[collectionMetadata(publicCollection),collectionMetadata(secondary),collectionMetadata(inactive)]});
  try{
    assert.equal(h.document.querySelectorAll('.shop-collection-card').length,1);
    assert.match(h.document.querySelector('.shop-collection-card').textContent,/Coleção de Verão/);
    assert.ok(h.document.querySelector('.shop-collection-card a[href="loja.html?loja=atelier&colecao=verao"],a.shop-collection-card[href="loja.html?loja=atelier&colecao=verao"]'));
    const options=[...h.document.querySelectorAll('.shop-collection option')].map(option=>option.value);
    assert.equal(JSON.stringify(options),JSON.stringify(['','verao','essenciais']));
    assert.equal(h.document.querySelector('[value="oculta"]'),null);
  }finally{await cleanup(h.window)}
  const hidden=await storefront({store:{...store,design:normalizeDesign({sections:[{id:'collections',visible:false}]})},collections:[collectionMetadata(publicCollection)]});
  try{assert.equal(hidden.document.querySelector('.shop-collections'),null);assert.ok(hidden.document.querySelector('.shop-collection option[value="verao"]'))}finally{await cleanup(hidden.window)}
});

test('collection selector navigates safely and preserves the per-store cart',async()=>{
  const secondary={...publicCollection,id:'c2',slug:'essenciais',name:'Essenciais',featured:false};
  const cart=[{variant_id:'v3',quantity:2}];
  const h=await storefront({products:[...products,otherProduct],collections:[collectionMetadata(publicCollection),collectionMetadata(secondary)],collectionRoute:'verao',collection:publicCollection,cart,search:'&utm_source=boletim&code=do-not-forward'});
  try{
    const select=h.document.querySelector('.shop-collection');assert.equal(select.value,'verao');
    select.value='essenciais';select.dispatchEvent(new h.window.Event('change'));
    assert.equal(h.navigations.length,1);const next=new URL(h.navigations[0]);
    assert.equal(next.origin,'https://camizetas.test');assert.equal(next.pathname,'/loja.html');assert.equal(next.searchParams.get('loja'),'atelier');assert.equal(next.searchParams.get('colecao'),'essenciais');assert.equal(next.searchParams.get('utm_source'),'boletim');assert.equal(next.searchParams.has('code'),false);
    assert.equal(h.window.localStorage.getItem('cz-cart:s1'),JSON.stringify(cart));
    select.value='';select.dispatchEvent(new h.window.Event('change'));
    const allProducts=new URL(h.navigations[1]);assert.equal(allProducts.searchParams.has('colecao'),false);assert.equal(allProducts.searchParams.get('loja'),'atelier');assert.equal(h.window.localStorage.getItem('cz-cart:s1'),JSON.stringify(cart));
  }finally{await cleanup(h.window)}
});

test('featured metadata links encode query values and keep names as plain text',async()=>{
  const malicious={...publicCollection,name:'<svg onload=alert(1)>',slug:'novas&peças',description:'<img src=x onerror=alert(1)>'};
  const h=await storefront({store:featuredStore,collections:[collectionMetadata(malicious)]});
  try{
    const card=h.document.querySelector('.shop-collection-card');assert.ok(card);assert.equal(card.querySelector('svg[onload],img[onerror],script'),null);assert.ok(card.textContent.includes(malicious.name));
    const link=card.matches('a')?card:card.querySelector('a');const url=new URL(link.getAttribute('href'),'https://camizetas.test/');assert.equal(url.searchParams.get('colecao'),malicious.slug);assert.equal(url.searchParams.get('loja'),'atelier');assert.equal(url.protocol,'https:');
  }finally{await cleanup(h.window)}
});

test('owner controls include collection management only for the owner',async()=>{
  const h=await storefront({managedStore:{...store,owner_id:'buyer-a'}});
  try{assert.ok(ownerbar(h.document).querySelector('a[href="painel.html?loja=s1&colecoes=1"]'))}finally{await cleanup(h.window)}
});

test('category filtering intersects collection membership and preserves collection product order',async()=>{
  const outside={...otherProduct,id:'p3',name:'Acessório fora da coleção',category:'Acessórios',variants:[{id:'v4',size:'Único',color:'Verde',on_hand:2,active:true}]};
  const h=await storefront({products:[...products,otherProduct,outside],collectionRoute:'verao',collection:{...publicCollection,product_ids:['p2','p1','p2']}});
  try{
    assert.equal(JSON.stringify([...h.document.querySelectorAll('.shop-product-card h3')].map(el=>el.textContent)),JSON.stringify([otherProduct.name,products[0].name]));
    assert.equal(h.document.querySelector('.shop-category option[value="Acessórios"]'),null);
    const category=h.document.querySelector('.shop-category');category.value='Moletons';category.dispatchEvent(new h.window.Event('change'));
    assert.equal(h.document.querySelectorAll('.shop-product-card').length,1);assert.equal(h.document.querySelector('.shop-product-card h3').textContent,otherProduct.name);
  }finally{await cleanup(h.window)}
});

test('post-order refresh does not expose full catalogue if active collection becomes unavailable',async()=>{
  let collectionReads=0;
  const h=await storefront({products:[...products,otherProduct],collectionRoute:'verao',getPublicCollection:()=>++collectionReads===1?publicCollection:null,cart:[{variant_id:'v1',quantity:1}]});
  try{
    const form=await openCheckout(h);fillCustomer(form,h.window);submit(form,h.window);await tick();await tick();await tick();
    assert.equal(h.calls.length,1);assert.ok(collectionReads>=2);assert.match(h.document.querySelector('#standalone-store').textContent,/coleção não está disponível/i);assert.equal(h.document.querySelectorAll('.shop-product-card').length,0);assert.match(h.document.querySelector('.order-success-number').textContent,/#42/);
  }finally{await cleanup(h.window)}
});

test('products open as full pages with safe shareable URLs, gallery and cart limits',async()=>{
  const product={...products[0],image_url:'https://example.test/front.jpg',image_urls:['https://example.test/front.jpg','https://example.test/back.jpg','javascript:alert(1)','https://example.test/detail.jpg']};
  const h=await storefront({products:[product],search:'&utm_source=lookbook&code=private-auth-code'});
  try{
    h.document.querySelector('[data-product]').click();
    assert.ok(h.document.querySelector('.product-page'));assert.equal(h.document.querySelector('.shop-modal'),null);
    assert.equal(new URL(h.window.location.href).searchParams.get('produto'),'p1');assert.equal(new URL(h.window.location.href).searchParams.get('utm_source'),'lookbook');assert.equal(new URL(h.window.location.href).searchParams.has('code'),false);
    assert.equal(h.document.querySelector('#product-title').textContent,product.name);
    assert.equal(h.document.querySelectorAll('[data-photo]').length,3);assert.match(h.document.querySelector('.product-main-image').src,/front.jpg$/);
    h.document.querySelector('[data-photo="1"]').click();assert.match(h.document.querySelector('.product-main-image').src,/back.jpg$/);assert.equal(h.document.querySelector('[data-photo="1"]').getAttribute('aria-pressed'),'true');
    h.document.querySelector('.product-gallery-next').click();assert.match(h.document.querySelector('.product-main-image').src,/detail.jpg$/);
    h.document.querySelector('.product-zoom-trigger').click();assert.ok(h.document.querySelector('.product-lightbox[open]'));h.document.querySelector('.product-lightbox').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.match(h.document.querySelector('.product-lightbox-image').src,/back.jpg$/);h.document.querySelector('.product-lightbox-close').click();
    const form=h.document.querySelector('#product-choice');form.elements.quantity.value='3';submit(form,h.window);assert.equal(h.document.querySelector('.shop-bag-count').textContent,'3');assert.equal(form.querySelector('[type=submit]').disabled,true);assert.equal(h.document.querySelector('.product-added').hidden,false);
    submit(form,h.window);assert.equal(JSON.parse(h.window.localStorage.getItem('cz-cart:s1'))[0].quantity,3);
    h.document.querySelector('.product-breadcrumb [data-product-back]').click();assert.ok(h.document.querySelector('.shop-product-grid'));assert.equal(new URL(h.window.location.href).searchParams.has('produto'),false);assert.equal(h.document.querySelector('.shop-bag-count').textContent,'3');
    h.window.history.pushState({},'','loja.html?loja=atelier&produto=p1');h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));assert.ok(h.document.querySelector('.product-page'));assert.equal(h.document.querySelector('#product-title').textContent,product.name);
  }finally{await cleanup(h.window)}
});

test('direct product links preserve collection context and reject unavailable or foreign products',async()=>{
  const h=await storefront({collectionRoute:'verao',collection:publicCollection,search:'&produto=p1'});
  try{assert.ok(h.document.querySelector('.product-page'));assert.equal(h.document.querySelector('.product-breadcrumb a').getAttribute('href'),'/loja.html?loja=atelier&colecao=verao');assert.match(h.document.title,/Camiseta/);assert.match(h.document.querySelector('.product-main-image').src,/product-placeholder.svg$/)}finally{await cleanup(h.window)}
  for(const product of [null,{...products[0],active:false},{...products[0],store_id:'foreign-store'}]){
    const unavailable=await storefront({products:product?[product]:[],search:'&produto=p1'});
    try{assert.match(unavailable.document.querySelector('.product-unavailable').textContent,/não está na vitrine/);assert.equal(unavailable.document.querySelector('#product-choice'),null);assert.equal(unavailable.document.querySelector('.shop-product-grid'),null)}finally{await cleanup(unavailable.window)}
  }
});

test('product page suggestions include only other active products in a shared active collection',async()=>{
  const third={...otherProduct,id:'p3',name:'Produto sem coleção em comum'},inactive={...otherProduct,id:'p4',active:false},foreign={...otherProduct,id:'p5',store_id:'another-store'};
  const h=await storefront({products:[...products,otherProduct,third,inactive,foreign],search:'&produto=p1',api:{getProductCollections:async()=>[{...publicCollection,product_ids:['p1','p2','p2','p4','p5']},{...publicCollection,id:'c2',slug:'sem-vinculo',product_ids:['p3']},{...publicCollection,id:'c3',active:false,product_ids:['p1','p3']}]}});
  try{await tick();assert.equal(h.document.querySelector('.product-related-section').hidden,false);assert.equal(h.document.querySelectorAll('.product-related-grid .shop-product-card').length,1);assert.equal(h.document.querySelector('.product-related-grid h3').textContent,otherProduct.name);h.document.querySelector('.product-related-grid [data-product]').click();assert.equal(h.document.querySelector('#product-title').textContent,otherProduct.name);assert.equal(new URL(h.window.location.href).searchParams.get('produto'),'p2')}finally{await cleanup(h.window)}
  const unrelated=await storefront({products:[...products,otherProduct],search:'&produto=p1',api:{getProductCollections:async()=>[]}});
  try{assert.equal(unrelated.document.querySelector('.product-related-section').hidden,true);assert.equal(unrelated.document.querySelector('.product-related-grid').children.length,0)}finally{await cleanup(unrelated.window)}
});

test('product pages inherit all eight merchant identities and keep cart products outside the viewed collection',async()=>{
  for(const preset of PRESETS){
    const h=await storefront({store:{...store,design:normalizeDesign({...preset.defaults,preset:preset.id})},products:[...products,otherProduct],cart:[{variant_id:'v3',quantity:2}],search:'&produto=p1'});
    try{assert.equal(h.document.querySelector('.product-page').getAttribute('data-preset'),preset.id);assert.equal(h.document.querySelector('.product-page').style.getPropertyValue('--shop-accent'),preset.defaults.accent);h.document.querySelector('.shop-bag-button').click();assert.equal(h.document.querySelector('.shop-line-item h3').textContent,otherProduct.name);assert.equal(h.document.querySelector('#start-checkout').disabled,false)}finally{await cleanup(h.window)}
  }
});

const review={id:'r1',author_name:'Maria <img onerror=alert(1)>',rating:5,title:'Caimento <b>perfeito</b>',body:'Adorei esta peça. O tecido é muito confortável.',created_at:'2026-11-01T10:00:00Z'};

test('reviews are optional and display real safe ratings and verified buyer opinions',async()=>{
  let calls=0;
  const disabled=await storefront({search:'&produto=p1',api:{getProductReviews:async()=>{calls++;return {available:true,reviews:[review],summary:{count:1,average:5}}}}});
  try{assert.equal(disabled.document.querySelector('.product-reviews-section'),null);assert.equal(calls,0)}finally{await cleanup(disabled.window)}
  const h=await storefront({store:{...store,reviews_enabled:true},search:'&produto=p1',user:null,api:{getProductReviews:async()=>({available:true,reviews:[review],summary:{count:1,average:5}})}});
  try{await tick();assert.equal(h.document.querySelector('.review-title').textContent,review.title);assert.ok(h.document.querySelector('.review-author').textContent.includes(review.author_name));assert.equal(h.document.querySelector('.product-reviews-section script,.product-reviews-section img[onerror]'),null);assert.match(h.document.querySelector('.product-rating-link').textContent,/5,0 \/ 5 · 1 avaliação/);assert.match(h.document.querySelector('.review-verified').textContent,/Compra verificada/);assert.equal(h.document.querySelector('#product-review-form'),null);assert.match(h.document.querySelector('.review-context-box').textContent,/Entre na sua conta/)}finally{await cleanup(h.window)}
});

test('verified buyer can publish and edit their own review without invoking checkout',async()=>{
  const calls=[];
  const h=await storefront({store:{...store,reviews_enabled:true},search:'&produto=p1',api:{getProductReviews:async()=>({available:true,reviews:[review],summary:{count:1,average:5}}),getProductReviewContext:async()=>({can_review:true,my_review:review}),saveProductReview:async(...args)=>calls.push(args)}});
  try{await tick();const form=h.document.querySelector('#product-review-form');assert.ok(form);assert.equal(form.elements.author_name.value,review.author_name);form.elements.rating.value='4';form.elements.body.value='Ficou muito boa! O tecido é agradável e o corte é bonito.';submit(form,h.window);await tick();await tick();assert.equal(calls.length,1);assert.equal(calls[0][0],'p1');assert.equal(calls[0][1].rating,4);assert.equal(h.document.querySelector('#checkout-form'),null);assert.match(h.document.querySelector('.review-feedback').textContent,/foi salva/);assert.equal(h.calls.length,0)}finally{await cleanup(h.window)}
});

test('review permissions and stale product requests never leak across navigation or accounts',async()=>{
  let resolveReviews;const delayed=new Promise(resolve=>{resolveReviews=resolve});
  const h=await storefront({store:{...store,reviews_enabled:true},products:[...products,otherProduct],search:'&produto=p1',api:{getProductReviews:async(_store,id)=>id==='p1'?delayed:{available:true,reviews:[],summary:{count:0,average:null}},getProductReviewContext:async()=>({can_review:false,reason:'Você precisa de um pedido concluído.'})}});
  try{await tick();assert.equal(h.document.querySelector('#product-review-form'),null);assert.match(h.document.querySelector('.review-context-box').textContent,/pedido concluído/);h.window.history.pushState({},'','loja.html?loja=atelier&produto=p2');h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));resolveReviews({available:true,reviews:[review],summary:{count:1,average:5}});await tick();await tick();assert.equal(h.document.querySelector('#product-title').textContent,otherProduct.name);assert.equal(h.document.querySelector('.review-title'),null)}finally{await cleanup(h.window)}
  let release;const pendingContext=new Promise(resolve=>{release=resolve});let reads=0;
  const switched=await storefront({store:{...store,reviews_enabled:true},search:'&produto=p1',api:{getProductReviews:async()=>({available:true,reviews:[],summary:{count:0,average:null}}),getProductReviewContext:async()=>++reads===1?pendingContext:{can_review:false,reason:'Sem compra concluída.'}}});
  try{switched.setUser({id:'buyer-b'},true);release({can_review:true,my_review:review});await tick();await tick();assert.equal(switched.document.querySelector('#product-review-form'),null);assert.equal(switched.document.querySelector('.product-review-context').textContent.includes(review.body),false)}finally{await cleanup(switched.window)}
});

test('account changes immediately hide a review draft and prevent its stale form from saving',async()=>{
  const calls=[];
  const h=await storefront({store:{...store,reviews_enabled:true},search:'&produto=p1',api:{getProductReviews:async()=>({available:true,reviews:[],summary:{count:0,average:null}}),getProductReviewContext:async()=>({can_review:true,my_review:null}),saveProductReview:async(...args)=>calls.push(args)}});
  try{await tick();const form=h.document.querySelector('#product-review-form');form.elements.author_name.value='Nome privado';form.elements.body.value='Esta avaliação estava sendo escrita na conta original.';h.setUser(null,true);assert.equal(h.document.querySelector('#product-review-form'),null);assert.equal(h.document.body.textContent.includes('Nome privado'),false);submit(form,h.window);await tick();assert.equal(calls.length,0)}finally{await cleanup(h.window)}
});
