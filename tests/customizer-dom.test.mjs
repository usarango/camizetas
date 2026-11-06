import {Window} from 'happy-dom';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createDesign} from '../src/design.js';

const bundle=(await build({entryPoints:[new URL('../src/customizer.js',import.meta.url).pathname],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})).outputFiles[0].text;
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
const baseStore={id:'store-1',slug:'minha-marca',name:'Minha marca',headline:'Vista suas ideias.',description:'Uma marca independente.',template:'chic',design:createDesign('chic')};
function setup(configuration={}) {
  const window=new Window({url:'https://camizetas.test/painel.html',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  window.eval(bundle);
  const editor=window.document.createElement('store-customizer');
  editor.configure({store:baseStore,products:[],userId:'owner-1',...configuration});
  window.document.body.append(editor);
  return {window,editor,root:editor.shadowRoot,close:async()=>{editor.remove();await window.happyDOM.abort();window.close();}};
}
function input(window,root,selector,value) {
  const field=root.querySelector(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));return field;
}

test('creative editor: real previews, eight templates, accessible controls and reversible changes',async()=>{
  const context=setup(),{window,editor,root}=context;
  assert.equal(root.querySelectorAll('.cz-template').length,8);
  assert.equal(root.querySelectorAll('.shop-product-card').length,0);
  assert.match(root.querySelector('.shop-empty').textContent,/coleção está chegando/);
  root.querySelector('[data-preset="rock"]').click();
  assert.equal(editor.payload.design.preset,'rock');
  assert.equal(editor.payload.design.heroImage,'assets/theme-rock.jpg');
  assert.equal(editor.payload.brand.name,'Minha marca');
  root.querySelector('[data-action="undo"]').click();assert.equal(editor.payload.design.preset,'chic');
  root.querySelector('[data-action="redo"]').click();assert.equal(editor.payload.design.preset,'rock');
  root.querySelector('.shop-wordmark').click();assert.equal(root.querySelector('[data-tab="brand"]').getAttribute('aria-selected'),'true');
  input(window,root,'[data-bind="brand.name"]','Marca <autoral>');
  assert.equal(root.querySelector('.shop-wordmark').textContent,'Marca <autoral>');assert.equal(root.querySelector('.shop-wordmark autoral'),null);
  root.querySelector('.shop-hero h1').click();assert.equal(root.activeElement.id,'cz-brand-headline');
  input(window,root,'#cz-brand-headline','Nossa nova coleção');assert.equal(root.querySelector('.shop-hero h1').textContent,'Nossa nova coleção');
  root.querySelector('.shop-catalog').click();assert.equal(root.querySelector('[data-tab="visual"]').getAttribute('aria-selected'),'true');
  root.querySelector('[data-font="mono"]').click();assert.equal(editor.payload.design.font,'mono');
  root.querySelector('[data-option="radius"][data-value="20"]').click();assert.equal(editor.payload.design.radius,20);
  const previous=editor.payload.design.accent;
  const invalid=input(window,root,'[data-hex="accent"]','nope');assert.equal(invalid.getAttribute('aria-invalid'),'true');assert.equal(editor.payload.design.accent,previous);
  input(window,root,'[data-hex="accent"]','#112233');assert.equal(editor.payload.design.accent,'#112233');
  root.querySelector('[data-action="mobile"]').click();assert.ok(root.querySelector('.cz-device.is-mobile'));
  root.querySelector('[data-tab="sections"]').click();
  const visible=root.querySelector('[data-section="about"]');visible.checked=true;visible.dispatchEvent(new window.Event('change',{bubbles:true}));assert.ok(root.querySelector('.shop-about'));
  root.querySelector('[data-move="about"][data-direction="-1"]').click();assert.deepEqual([...editor.payload.design.sections.map(section=>section.id)],['hero','about','products']);
  assert.equal(root.querySelector('[data-section="products"]'),null);
  root.querySelector('[data-action="expand"]').click();assert.equal(root.querySelector('dialog').open,true);root.querySelector('[data-action="close-preview"]').click();assert.equal(root.querySelector('dialog').open,false);
  await context.close();
});

test('creative editor: hydration and local recovery never publish; cloud drafts save sequentially',async()=>{
  const calls=[],releases=[];let inFlight=0,maxInFlight=0,published=0;
  const context=setup({onSaveDraft:async payload=>{calls.push(payload);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(resolve=>releases.push(resolve));inFlight--;},onPublish:async()=>{published++;}}),{window,editor,root}=context;
  await tick();assert.equal(calls.length,0);
  root.querySelector('[data-tab="brand"]').click();
  input(window,root,'[data-bind="brand.name"]','Primeira edição');
  const first=editor.saveCurrentDraft();await tick();assert.equal(calls.length,1);
  input(window,root,'[data-bind="brand.name"]','Última edição');
  const second=editor.saveCurrentDraft();await tick();assert.equal(calls.length,1);
  releases.shift()();await tick();assert.equal(calls.length,2);assert.equal(calls[1].brand.name,'Última edição');
  releases.shift()();await Promise.all([first,second]);assert.equal(maxInFlight,1);assert.equal(published,0);
  assert.equal(JSON.parse(window.localStorage.getItem('cz-design-draft:owner-1:store-1')).brand.name,'Última edição');
  editor.configure({store:baseStore,products:[],userId:'owner-1',onSaveDraft:async payload=>calls.push(payload),onPublish:async()=>published++});
  assert.equal(editor.payload.brand.name,'Minha marca');assert.ok(root.querySelector('[data-action="recover"]'));
  assert.equal(published,0);assert.equal(calls.length,2);
  root.querySelector('[data-action="recover"]').click();assert.equal(editor.payload.brand.name,'Última edição');
  assert.equal(published,0);await editor.saveCurrentDraft();assert.equal(calls.length,3);
  await context.close();
});

test('creative editor: failed writes, successful apply, missing setup and demo handoff are honest',async()=>{
  let publish=0;
  const context=setup({onSaveDraft:async()=>{},onPublish:async()=>{publish++;throw new Error('Não foi possível aplicar agora.');}}),{window,editor,root}=context;
  await editor._publish();assert.equal(publish,1);assert.match(root.querySelector('.cz-error').textContent,/Não foi possível aplicar/);assert.equal(root.querySelector('.cz-notice'),null);
  let release;
  editor.configure({store:baseStore,products:[],userId:'owner-1',onSaveDraft:async()=>{},onPublish:()=>new Promise(resolve=>release=resolve)});
  const apply=editor._publish();await tick();assert.equal(root.querySelector('[data-action="publish"]').disabled,true);assert.equal(root.querySelector('.cz-notice'),null);
  release();await apply;assert.match(root.querySelector('.cz-notice').textContent,/clientes já podem ver/);
  editor.configure({store:baseStore,products:[],userId:'owner-1',cloudReady:false,onPublish:async()=>publish++});
  editor.selectPreset('pop');await editor.saveCurrentDraft();assert.equal(root.querySelector('[data-action="publish"]').disabled,true);assert.ok(root.querySelector('.cz-setup a'));assert.equal(editor.payload.design.preset,'pop');
  let handedOff=null;
  editor.configure({store:baseStore,products:[],demo:true,onDemoContinue:async payload=>{handedOff=payload;}});editor.selectPreset('minimal');await editor._publish();
  assert.equal(handedOff.design.preset,'minimal');assert.equal(JSON.parse(window.localStorage.getItem('camizetas-creative-draft')).design.preset,'minimal');
  editor.configure({store:baseStore,products:[],userId:'owner-1',onSaveDraft:async()=>{throw new Error('Falha ao salvar o rascunho.');},onPublish:async()=>publish++});
  await assert.rejects(editor.saveCurrentDraft(),/Falha ao salvar/);assert.match(root.querySelector('.cz-error').textContent,/Falha ao salvar/);
  const count=publish;await editor._publish();assert.equal(publish,count);
  await context.close();
});

test('creative editor: uploads are validated and discarded after store/user changes',async()=>{
  const uploads=[];let release;
  const context=setup({onUpload:(file,kind)=>{uploads.push([file.name,kind]);return new Promise(resolve=>release=resolve);}}),{window,editor,root}=context;
  await editor._upload(new window.File(['bad'],'vector.svg',{type:'image/svg+xml'}),'logo');assert.equal(uploads.length,0);assert.match(root.querySelector('.cz-error').textContent,/JPG, PNG ou WebP/);
  const pending=editor._upload(new window.File(['pixels'],'foto.png',{type:'image/png'}),'hero');await tick();assert.deepEqual(uploads,[['foto.png','hero']]);
  editor.configure({store:{...baseStore,id:'store-2',name:'Outra loja'},products:[],userId:'owner-2'});
  release('https://images.test/first-store.jpg');await pending;assert.notEqual(editor.payload.design.heroImage,'https://images.test/first-store.jpg');assert.equal(editor.payload.brand.name,'Outra loja');
  editor.configure({store:baseStore,products:[],userId:'owner-1',onUpload:async()=> 'https://images.test/logo.png'});
  await editor._upload(new window.File(['pixels'],'logo.png',{type:'image/png'}),'logo');assert.equal(editor.payload.design.logoUrl,'https://images.test/logo.png');
  root.querySelector('[data-tab="brand"]').click();assert.equal(root.querySelector('.shop-logo').getAttribute('src'),'https://images.test/logo.png');
  root.querySelector('[data-action="remove-image"][data-kind="logo"]').click();assert.equal(editor.payload.design.logoUrl,'');
  await context.close();
});

test('creative editor: pending drafts and uploads protect navigation, disconnect flushes local data',async()=>{
  const context=setup({onSaveDraft:async()=>{}}),{window,editor,root}=context;
  editor.selectPreset('botanical');
  const unload=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
  await editor.saveCurrentDraft();const saved=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(saved);assert.equal(saved.defaultPrevented,false);
  root.querySelector('[data-tab="brand"]').click();input(window,root,'[data-bind="brand.name"]','Rascunho ao sair');editor.remove();
  assert.equal(JSON.parse(window.localStorage.getItem('cz-design-draft:owner-1:store-1')).brand.name,'Rascunho ao sair');
  window.document.body.append(editor);await editor.saveCurrentDraft();assert.match(root.querySelector('.cz-save-state').textContent,/salvo/);
  await context.close();
});
