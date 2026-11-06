import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
test('landing offers eight templates and preserves a new preset in the store-creation handoff',async()=>{
 const window=new Window({url:'https://camizetas.test/index.html',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableComputedStyleRendering:true,navigation:{disableMainFrameNavigation:true}}});
 try{
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.document.write(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
  window.eval(await readFile(new URL('../dist/landing-creative.js',import.meta.url),'utf8'));
  const editor=window.document.querySelector('#landing-creative');
  assert.ok(editor.shadowRoot);assert.equal(window.document.querySelectorAll('.template-gallery .template-tile').length,8);
  assert.equal(editor.shadowRoot.querySelectorAll('button[data-preset]').length,8);
  window.document.querySelector('.extra-minimal').click();assert.equal(editor.payload.design.preset,'minimal');
  await editor.saveCurrentDraft();assert.equal(JSON.parse(window.localStorage.getItem('camizetas-creative-draft')).design.preset,'minimal');
  window.document.querySelector('[data-open-template="rock"]').click();assert.equal(editor.payload.design.preset,'rock');
  editor.selectPreset('botanical');await editor._config.onDemoContinue(editor.payload);
  const saved=JSON.parse(window.localStorage.getItem('camizetas-creative-draft'));assert.equal(saved.design.preset,'botanical');
  const legacy=JSON.parse(window.localStorage.getItem('camizetas-design'));assert.equal(legacy.template,'chic');assert.equal(legacy.design.preset,'botanical');
 }finally{await window.happyDOM.abort();window.close()}
});
