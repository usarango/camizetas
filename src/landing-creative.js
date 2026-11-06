import './customizer.js';
import {PRESETS,createDesign,normalizeDesign,designToStorePatch} from './design.js';
const element=document.querySelector('#landing-creative');
const examples=[
 {id:'demo-tee',name:'Camiseta assinatura',price_cents:8990,category:'Camisetas',image_url:'assets/tee.jpg',variants:[{on_hand:8,active:true}]},
 {id:'demo-hoodie',name:'Moletom essencial',price_cents:18990,category:'Moletons',image_url:'assets/hoodie.jpg',variants:[{on_hand:5,active:true}]},
 {id:'demo-bag',name:'Mochila caminhos',price_cents:12990,category:'Acessórios',image_url:'assets/bag.jpg',variants:[{on_hand:4,active:true}]},
];
const exampleCollections=[{id:'demo-essenciais',name:'Essenciais',slug:'essenciais',description:'Peças para combinar com todos os seus dias.',image_url:'assets/tee.jpg',active:true,featured:true,sort_order:0},{id:'demo-caminhos',name:'Novos caminhos',slug:'novos-caminhos',description:'Sua personalidade acompanha você.',image_url:'assets/bag.jpg',active:true,featured:true,sort_order:1}];
if(element){
 const design=createDesign('chic');
 element.configure({store:{id:'demo',name:'Sua marca',slug:'sua-marca',headline:'Sua identidade,\nem cada detalhe.',description:'Uma coleção com a sua assinatura. Encontre peças para vestir a sua própria história.',design},products:examples,collections:exampleCollections,userId:'demo',demo:true,cloudReady:true,onDemoContinue:async payload=>{localStorage.setItem('camizetas-creative-draft',JSON.stringify(payload));localStorage.setItem('camizetas-design',JSON.stringify(designToStorePatch(payload.design,payload.brand)));location.href='painel.html?fromeditor=1&espaco=1'}});
 document.querySelectorAll('[data-open-template]').forEach(button=>button.addEventListener('click',()=>{element.selectPreset(button.dataset.openTemplate);document.querySelector('#personalizar')?.scrollIntoView({behavior:'smooth'})}));
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gallery=document.querySelector('.template-gallery');
if(gallery){
 for(const p of PRESETS.slice(4)){
  const article=document.createElement('article');article.className='template-tile';
  const image=p.defaults.heroImage||'assets/tee.jpg';
  article.innerHTML=`<button class="mini-store extra-template extra-${p.id}" aria-label="Experimentar template ${esc(p.label)}" style="--extra-bg:${p.defaults.background};--extra-accent:${p.defaults.accent}"><span class="extra-nav">${esc(p.demoName)}<span>COLEÇÃO / 2026</span></span><span class="extra-body"><span><small>UMA MARCA. SEU UNIVERSO.</small><strong>${esc(p.demoHeadline)}</strong><i>Explore a coleção ↗</i></span><img src="${image}" alt="Referência do template ${esc(p.label)}" loading="lazy"></span><span class="extra-foot">FEITO DO SEU JEITO.</span></button><div class="tile-caption"><div><h3>${esc(p.label)}</h3><p>${esc(p.description)}</p></div><button class="choose-extra" aria-label="Usar template ${esc(p.label)}">↗</button></div>`;
  article.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{element?.selectPreset(p.id);document.querySelector('#personalizar')?.scrollIntoView({behavior:'smooth'})}));gallery.append(article);
 }
}
