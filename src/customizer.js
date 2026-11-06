import { PRESETS, createDesign, normalizeDesign, resolveDesign } from './design.js';
import { renderStoreShell, renderProductCards } from './store-layout.js';

const LOCAL_PREFIX = 'cz-design-draft:';
const DEMO_KEY = 'camizetas-creative-draft';
const MAX_HISTORY = 30;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const clone = value => JSON.parse(JSON.stringify(value));
const fingerprint = payload => JSON.stringify({brand:payload.brand,design:payload.design});
const paths = {
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  brand:'<path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 21v-4h6v4M9 7h6M9 11h6"/>',
  visual:'<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8"/>',
  sections:'<rect x="4" y="3" width="16" height="5" rx="1"/><rect x="4" y="11" width="7" height="10" rx="1"/><rect x="14" y="11" width="6" height="10" rx="1"/>',
  undo:'<path d="M9 5 4 10l5 5M4 10h9a6 6 0 1 1 0 12"/>',
  redo:'<path d="m15 5 5 5-5 5M20 10h-9a6 6 0 1 0 0 12"/>',
  desktop:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  mobile:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  up:'<path d="m6 14 6-6 6 6"/>',
  down:'<path d="m6 10 6 6 6-6"/>',
  reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  save:'<path d="M4 3h13l3 3v15H4V3Z"/><path d="M8 3v6h8V3M8 21v-8h8v8"/>',
};
const icon = (name, extra='') => `<svg ${extra} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.layers}</svg>`;
const palettes = [
  {label:'Uva e papel',accent:'#6425d4',background:'#faf9f6'},
  {label:'Areia e oliva',accent:'#68664b',background:'#f5f1e8'},
  {label:'Noite elétrica',accent:'#d7f66b',background:'#181d17'},
  {label:'Vermelho e carvão',accent:'#ef6a54',background:'#211b1c'},
  {label:'Lavanda digital',accent:'#6151bc',background:'#f0eddf'},
  {label:'Azul e gelo',accent:'#2459c6',background:'#f2f5f9'},
  {label:'Rosa e cacau',accent:'#c65072',background:'#fcf0ed'},
  {label:'Preto essencial',accent:'#242424',background:'#ffffff'},
];
const fonts = [
  {id:'editorial',label:'Editorial',sample:'Estilo que fica.',family:"'Cormorant Garamond', Georgia, serif"},
  {id:'modern',label:'Moderna',sample:'Seu próximo favorito.',family:"'Space Grotesk', Arial, sans-serif"},
  {id:'mono',label:'Digital',sample:'Feito para o seu mundo.',family:"'Space Mono', monospace"},
  {id:'bold',label:'Impactante',sample:'VISTA SUA VOZ.',family:"'Anton', Impact, sans-serif"},
];
const heroLayouts = [{id:'split',label:'Lado a lado'},{id:'centered',label:'Centralizada'},{id:'fullbleed',label:'Imagem inteira'},{id:'compact',label:'Compacta'}];
const tabData = [
  ['templates','Templates','layers'], ['brand','Sua marca','brand'], ['visual','Visual','visual'], ['sections','Seções','sections'],
];
const text = (value,max) => String(value ?? '').slice(0,max);
function cleanBrand(brand={},store={}) {
  return {name:text(brand.name ?? store.name,80),headline:text(brand.headline ?? store.headline,100),description:text(brand.description ?? store.description,3000)};
}
function validHTTPS(value) {
  try { const url=new URL(String(value).trim());return url.protocol==='https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function normalizePayload(raw,store) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw) || !raw.design || !raw.brand) return null;
  return {version:1,brand:cleanBrand(raw.brand,store),design:normalizeDesign(raw.design,store),updatedAt:typeof raw.updatedAt==='string'?raw.updatedAt:new Date().toISOString()};
}

export class StoreCustomizer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._epoch=0;
    this._configured=false;
    this._activeTab='templates';
    this._viewport='desktop';
    this._beforeUnload=event=>{
      if (this._needsProtection()) {event.preventDefault();event.returnValue='';}
    };
    this.shadowRoot.addEventListener('click',event=>this._handleClick(event));
    this.shadowRoot.addEventListener('input',event=>this._handleInput(event));
    this.shadowRoot.addEventListener('change',event=>this._handleChange(event));
    this.shadowRoot.addEventListener('keydown',event=>this._handleKey(event));
  }

  connectedCallback() {
    window.addEventListener('beforeunload',this._beforeUnload);
    if (this._configured) this._render();
  }

  disconnectedCallback() {
    if (this._configured && this._revision>0) this._persistLocal();
    clearTimeout(this._saveTimer);
    this._saveTimer=null;
    this._pendingSave=null;
    this._savingPromise=null;
    this._saving=false;
    this._uploading={};
    this._uploadSerial={};
    this._publishing=false;
    if(this._configured&&this._revision>0)this._status='Rascunho preservado neste navegador';
    this._epoch++;
    window.removeEventListener('beforeunload',this._beforeUnload);
  }

  configure(configuration={}) {
    if (this._configured && this._revision>0) this._persistLocal();
    clearTimeout(this._saveTimer);
    this._epoch++;
    this._config={cloudReady:true,demo:false,products:[],...configuration};
    this._store=clone(configuration.store || {});
    this._products=Array.isArray(configuration.products)?clone(configuration.products.filter(product=>product&&typeof product==='object'&&product.active!==false)):[];
    this._collections=Array.isArray(configuration.collections)?clone(configuration.collections.filter(collection=>collection&&typeof collection==='object'&&collection.active!==false)):[];
    this._key=this._config.demo?DEMO_KEY:`${LOCAL_PREFIX}${String(configuration.userId||'anonymous')}:${String(this._store.id||'new')}`;
    const live={version:1,brand:cleanBrand({},this._store),design:resolveDesign(this._store),updatedAt:new Date().toISOString()};
    this._state=normalizePayload(configuration.draft,this._store) || live;
    this._publishedFingerprint=fingerprint(live);
    this._localFingerprint=fingerprint(this._state);
    this._revision=0;
    this._cloudSavedRevision=0;
    this._undo=[];
    this._redo=[];
    this._coalesced=null;
    this._pendingSave=null;
    this._savingPromise=null;
    this._saving=false;
    this._publishing=false;
    this._uploading={};
    this._uploadSerial={};
    this._cloudError='';
    this._actionError='';
    this._notice='';
    this._status=configuration.draft?'Rascunho carregado':'Pronto para criar';
    this._recovery=null;
    try {
      const candidate=normalizePayload(JSON.parse(localStorage.getItem(this._key)||'null'),this._store);
      if (candidate && fingerprint(candidate)!==fingerprint(this._state)) this._recovery=candidate;
    } catch {}
    this._configured=true;
    if (this.isConnected) this._render();
    return this;
  }

  get payload() { return this._state?clone(this._state):null; }

  selectPreset(id) {
    if (!this._configured || !PRESETS.some(preset=>preset.id===id)) return;
    const previous=this._state.design;
    const next=createDesign(id);
    // A new composition keeps the merchant's photographs and announcement.
    for (const key of ['logoUrl','announcement','announcementEnabled']) next[key]=previous[key];
    if(previous.heroImage!==createDesign(previous.preset).heroImage)next.heroImage=previous.heroImage;
    this._change(state=>{state.design=next;});
    this._renderControls();
    this._notice='Template aplicado ao rascunho. Sua marca continua sua.';
    this._updateStatus();
  }

  async saveCurrentDraft() {
    if (!this._configured) return null;
    clearTimeout(this._saveTimer);this._saveTimer=null;
    const payload=this.payload;
    const localSaved=this._persistLocal(payload);
    if (this._config.demo || !this._config.cloudReady || typeof this._config.onSaveDraft!=='function') {
      this._status=localSaved?'Rascunho salvo neste navegador':'Rascunho ainda não salvo';this._updateStatus();
      if(!localSaved)throw new Error(this._actionError);
      return payload;
    }
    const epoch=this._epoch;
    this._pendingSave={payload,revision:this._revision};
    if (!this._savingPromise) {
      this._savingPromise=Promise.resolve().then(()=>this._drainSaves(epoch));
    }
    await this._savingPromise;
    if (epoch===this._epoch && this._cloudError) throw new Error(this._cloudError);
    return payload;
  }

  async _drainSaves(epoch) {
    try {
      while (epoch===this._epoch && this._pendingSave) {
        const request=this._pendingSave;this._pendingSave=null;
        this._saving=true;this._cloudError='';this._status='Salvando rascunho…';this._updateStatus();
        try {
          await this._config.onSaveDraft(clone(request.payload));
          if (epoch!==this._epoch) return;
          this._cloudSavedRevision=Math.max(this._cloudSavedRevision,request.revision);
          this._status=this._revision===request.revision?'Rascunho salvo':'Salvando últimas alterações…';
        } catch(error) {
          if (epoch!==this._epoch) return;
          this._cloudError=this._message(error,'Não foi possível salvar na conta. Seu rascunho está neste navegador.');
          this._status='Salvo neste navegador';
        }
      }
    } finally {
      if (epoch===this._epoch) {this._saving=false;this._savingPromise=null;this._updateStatus();}
    }
  }

  _change(mutator,group='') {
    if (!this._configured || this._publishing) return;
    const before=this.payload,next=this.payload;
    mutator(next);next.design=normalizeDesign(next.design,this._store);next.brand=cleanBrand(next.brand,this._store);
    if (fingerprint(before)===fingerprint(next)) return;
    const now=Date.now();
    if (!group || !this._coalesced || this._coalesced.group!==group || now-this._coalesced.at>850) {
      this._undo.push(before);if (this._undo.length>MAX_HISTORY) this._undo.shift();
    }
    this._coalesced={group,at:now};this._redo=[];next.updatedAt=new Date().toISOString();this._state=next;this._revision++;
    this._notice='';this._actionError='';this._status='Alterações no rascunho';
    this._renderPreview();this._scheduleSave();this._updateStatus();
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer=setTimeout(()=>{
      this._saveTimer=null;
      this.saveCurrentDraft().catch(()=>{});
    },650);
  }

  _persistLocal(payload=this.payload) {
    if (!payload) return false;
    try {
      localStorage.setItem(this._key,JSON.stringify(payload));this._localFingerprint=fingerprint(payload);return true;
    } catch {
      this._actionError='Este navegador não conseguiu guardar o rascunho. Mantenha esta página aberta e salve na conta.';
      return false;
    }
  }

  _needsProtection() {
    return this._configured && (this._publishing || Object.values(this._uploading).some(Boolean) || fingerprint(this._state)!==this._localFingerprint);
  }

  _history(direction) {
    if (this._publishing) return;
    const from=direction==='undo'?this._undo:this._redo,to=direction==='undo'?this._redo:this._undo;
    if (!from.length) return;
    to.push(this.payload);if(to.length>MAX_HISTORY)to.shift();this._state=from.pop();this._state.updatedAt=new Date().toISOString();
    this._revision++;this._coalesced=null;this._notice='';this._actionError='';this._status='Alterações no rascunho';
    this._renderControls();this._renderPreview();this._scheduleSave();this._updateStatus();
  }

  _render() {
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="customizer.css"><link rel="stylesheet" href="store-design.css">
      <section class="cz-editor ${this._config.demo?'is-demo':'is-owner'}" aria-label="Espaço criativo da loja">
        <header class="cz-heading"><div><span class="cz-eyebrow">ESPAÇO CRIATIVO</span><h2>Sua marca. <em>Do seu jeito.</em></h2><p>Escolha um ponto de partida e deixe cada detalhe com a sua cara.</p></div><span class="cz-draft-badge">${icon('layers')} Edição em rascunho</span></header>
        <div class="cz-alerts"></div>
        <div class="cz-workbench">
          <aside class="cz-panel" aria-label="Personalização da loja"><nav class="cz-tabs" role="tablist" aria-label="Etapas da personalização">${tabData.map(([id,label,symbol])=>`<button type="button" id="cz-tab-${id}" role="tab" data-tab="${id}" aria-selected="${this._activeTab===id}" aria-controls="cz-controls" tabindex="${this._activeTab===id?'0':'-1'}">${icon(symbol)}<span>${label}</span></button>`).join('')}</nav><div id="cz-controls" class="cz-controls" role="tabpanel"></div><div class="cz-panel-note">${icon('lock')} Você pode experimentar à vontade.<br>As mudanças ficam no rascunho até aplicar.</div></aside>
          <section class="cz-preview-panel" aria-label="Prévia da loja"><div class="cz-preview-toolbar"><div class="cz-preview-label"><span class="cz-live-dot"></span><strong>Prévia da sua loja</strong><span class="cz-preview-hint">Clique para editar</span></div><div class="cz-preview-actions"><div class="cz-device-switch" aria-label="Formato da prévia"><button type="button" data-action="desktop" aria-label="Ver prévia no computador" aria-pressed="${this._viewport==='desktop'}">${icon('desktop')}</button><button type="button" data-action="mobile" aria-label="Ver prévia no celular" aria-pressed="${this._viewport==='mobile'}">${icon('mobile')}</button></div><button class="cz-icon-button cz-expand" type="button" data-action="expand" aria-label="Ampliar prévia">${icon('expand')}</button></div></div><div class="cz-stage"><div class="cz-device ${this._viewport==='mobile'?'is-mobile':''}"><div class="cz-browserbar" aria-hidden="true"><i></i><i></i><i></i><span>Prévia / ${this._config.demo?'sua-marca':esc(this._store.slug||'sua-loja')}</span></div><div class="cz-store-preview"></div></div></div><p class="cz-canvas-caption">${icon('check')} O mesmo visual que seus clientes vão encontrar.</p></section>
        </div>
        <footer class="cz-footer"><div class="cz-footer-left"><div class="cz-history"><button type="button" class="cz-icon-button" data-action="undo" aria-label="Desfazer última alteração" title="Desfazer">${icon('undo')}</button><button type="button" class="cz-icon-button" data-action="redo" aria-label="Refazer última alteração" title="Refazer">${icon('redo')}</button></div><div class="cz-save-state" role="status" aria-live="polite"></div></div><div class="cz-footer-actions"><button type="button" class="cz-button cz-secondary" data-action="save">${icon('save')}<span>Salvar rascunho</span></button><button type="button" class="cz-button cz-primary" data-action="publish"><span>${this._config.demo?'Criar loja com este estilo':'Aplicar na loja'}</span>${icon('arrow')}</button></div></footer>
        <dialog class="cz-full-preview" aria-label="Prévia ampliada da loja"><div class="cz-modal-bar"><span>Prévia da loja</span><button type="button" class="cz-icon-button" data-action="close-preview" aria-label="Fechar prévia">${icon('close')}</button></div><div class="cz-modal-content"></div></dialog>
      </section>`;
    this._renderControls();this._renderPreview();this._updateStatus();
  }

  _renderControls() {
    const target=this.shadowRoot.querySelector('#cz-controls');if(!target)return;
    const design=this._state.design,brand=this._state.brand;
    for (const tab of this.shadowRoot.querySelectorAll('[data-tab]')) {const selected=tab.dataset.tab===this._activeTab;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
    target.setAttribute('aria-labelledby',`cz-tab-${this._activeTab}`);
    if(this._activeTab==='templates') target.innerHTML=`<div class="cz-control-intro"><span class="cz-step">01 / UM PONTO DE PARTIDA</span><h3>Qual é a sua vibe?</h3><p>O template é só o começo. Cores, imagens e composição continuam nas suas mãos.</p></div><div class="cz-templates">${PRESETS.map(preset=>this._templateCard(preset)).join('')}</div><button type="button" class="cz-text-button cz-reset" data-action="reset">${icon('reset')} Restaurar estilo do template</button>`;
    if(this._activeTab==='brand') target.innerHTML=`<div class="cz-control-intro"><span class="cz-step">02 / SUA IDENTIDADE</span><h3>Uma loja com a sua voz.</h3><p>Apresente sua marca com palavras e imagens que façam sentido para você.</p></div>${this._field('Nome da loja','brand.name',brand.name,{max:80,placeholder:'Como sua marca se chama?',id:'cz-brand-name'})}${this._field('Frase de abertura','brand.headline',brand.headline,{max:100,placeholder:'Uma frase que traduza sua marca.',id:'cz-brand-headline',area:true})}${this._field('Sobre a marca','brand.description',brand.description,{max:3000,placeholder:'Conte um pouco da sua história.',area:true,rows:4})}<div class="cz-control-divider"></div>${this._mediaControl('logo','Logo da marca','Sua assinatura no topo da loja.',design.logoUrl)}${this._mediaControl('hero','Imagem de capa','A primeira impressão da sua coleção.',design.heroImage)}`;
    if(this._activeTab==='visual') target.innerHTML=`<div class="cz-control-intro"><span class="cz-step">03 / OS DETALHES FAZEM A MARCA</span><h3>Encontre seu tom.</h3><p>Combine cores e formas. A prévia acompanha cada escolha.</p></div><fieldset class="cz-control-group"><legend>Cores da loja</legend><div class="cz-palettes">${palettes.map((palette,index)=>`<button type="button" class="cz-palette ${design.accent.toLowerCase()===palette.accent.toLowerCase()&&design.background.toLowerCase()===palette.background.toLowerCase()?'is-selected':''}" data-palette="${index}" aria-label="Paleta ${palette.label}" title="${palette.label}" aria-pressed="${design.accent.toLowerCase()===palette.accent.toLowerCase()&&design.background.toLowerCase()===palette.background.toLowerCase()}"><i style="background:${palette.background}"></i><i style="background:${palette.accent}"></i></button>`).join('')}</div><div class="cz-colors">${this._colorControl('Cor de destaque','accent',design.accent)}${this._colorControl('Cor de fundo','background',design.background)}</div></fieldset><fieldset class="cz-control-group"><legend>Tipografia</legend><div class="cz-fonts">${fonts.map(font=>`<button type="button" data-font="${font.id}" class="cz-font ${design.font===font.id?'is-selected':''}" aria-pressed="${design.font===font.id}"><span>${font.label}</span><strong style="font-family:${esc(font.family)}">${font.sample}</strong>${design.font===font.id?icon('check'):''}</button>`).join('')}</div></fieldset><fieldset class="cz-control-group"><legend>Composição da abertura</legend><div class="cz-layouts">${heroLayouts.map(layout=>`<button type="button" class="cz-layout ${design.hero===layout.id?'is-selected':''}" data-hero="${layout.id}" aria-pressed="${design.hero===layout.id}"><span class="cz-layout-illustration layout-${layout.id}" aria-hidden="true"><i></i><b></b></span><span>${layout.label}</span></button>`).join('')}</div></fieldset>${this._field('Texto do botão da abertura','design.buttonLabel',design.buttonLabel,{max:60,placeholder:'Explorar coleção'})}<fieldset class="cz-control-group"><legend>Catálogo</legend>${this._segmented('Peças por linha','gridColumns',[['2','2'],['3','3'],['4','4']],String(design.gridColumns))}${this._segmented('Estilo dos produtos','cardStyle',[['clean','Leve'],['outlined','Contorno'],['soft','Suave']],design.cardStyle)}${this._segmented('Cantos','radius',[['0','Retos'],['8','Suaves'],['20','Redondos']],String(design.radius))}</fieldset>`;
    if(this._activeTab==='sections') target.innerHTML=`<div class="cz-control-intro"><span class="cz-step">04 / A SUA NARRATIVA</span><h3>Cada parte no seu lugar.</h3><p>Organize o caminho de quem chega. Use as setas para mudar a ordem das seções.</p></div><fieldset class="cz-control-group"><legend>Faixa de anúncio</legend><label class="cz-toggle-row"><span>Mostrar anúncio no topo</span><input type="checkbox" data-bind="design.announcementEnabled" ${design.announcementEnabled?'checked':''}><span class="cz-toggle" aria-hidden="true"></span></label>${this._field('Mensagem do anúncio','design.announcement',design.announcement,{max:160,placeholder:'Ex.: Envio para todo o Brasil',disabled:!design.announcementEnabled})}</fieldset><div class="cz-control-divider"></div><div class="cz-section-list">${design.sections.map((section,index)=>this._sectionControl(section,index,design.sections.length)).join('')}</div><p class="cz-help">O catálogo fica sempre visível para seus clientes encontrarem as peças.</p>`;
    if(this._activeTab==='sections'&&!this._collections.some(collection=>collection.featured===true)) {
      const hint=target.ownerDocument.createElement('p');hint.className='cz-help';hint.dataset.collectionsEmpty='';hint.textContent='Marque coleções como destaque no painel.';target.append(hint);
    }
    target.querySelectorAll('input,textarea,button').forEach(control=>{if(this._publishing)control.disabled=true;});
  }

  _templateCard(preset) {
    const design=normalizeDesign(preset.defaults || createDesign(preset.id));
    const active=this._state.design.preset===preset.id;
    const photo={chic:'theme-chic.jpg',underground:'theme-underground.jpg',rock:'theme-rock.jpg',nerd:'theme-nerd.jpg',minimal:'tee.jpg',botanical:'fashion.jpg',sport:'hoodie.jpg',pop:'bag.jpg'}[preset.id];
    return `<button type="button" class="cz-template ${active?'is-selected':''}" data-preset="${esc(preset.id)}" aria-pressed="${active}" aria-label="Usar template ${esc(preset.label)}"><span class="cz-template-scene preset-${esc(preset.id)}" style="--mini-bg:${esc(design.background)};--mini-accent:${esc(design.accent)}"><span class="cz-mini-nav"><b>${esc(preset.demoName||preset.label)}</b><i></i></span><span class="cz-mini-layout"><span class="cz-mini-copy"><small>NOVA COLEÇÃO</small><strong>${esc(preset.demoHeadline||preset.label)}</strong><i></i></span><img src="assets/${photo||'theme-chic.jpg'}" alt="" loading="lazy"></span><span class="cz-mini-bottom"><i></i><i></i><i></i></span>${active?`<span class="cz-template-tick">${icon('check')}</span>`:''}</span><span class="cz-template-caption"><strong>${esc(preset.label)}</strong><span>${esc(preset.description||'Um começo para sua marca.')}</span></span></button>`;
  }

  _field(label,path,value,{max,placeholder='',id='',area=false,rows=2,disabled=false}={}) {
    const attributes=`data-bind="${path}" ${id?`id="${id}"`:''} ${max?`maxlength="${max}"`:''} placeholder="${esc(placeholder)}" ${disabled?'disabled':''}`;
    return `<label class="cz-field"><span>${label}</span>${area?`<textarea ${attributes} rows="${rows}">${esc(value)}</textarea>`:`<input type="text" ${attributes} value="${esc(value)}">`}</label>`;
  }

  _colorControl(label,key,value) {
    return `<label class="cz-color-field"><span>${label}</span><span class="cz-color-input"><input type="color" data-color="${key}" value="${esc(value)}" aria-label="Escolher ${label.toLowerCase()}"><input type="text" data-hex="${key}" value="${esc(value)}" maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="${label} em hexadecimal" spellcheck="false"></span></label>`;
  }

  _segmented(label,key,options,current) {
    return `<div class="cz-segment-group"><span class="cz-control-label">${label}</span><div class="cz-segments">${options.map(([value,title])=>`<button type="button" data-option="${key}" data-value="${value}" aria-pressed="${current===value}" class="${current===value?'is-selected':''}">${title}</button>`).join('')}</div></div>`;
  }

  _mediaControl(kind,title,description,value) {
    const busy=Boolean(this._uploading[kind]),canUpload=typeof this._config.onUpload==='function';
    return `<fieldset class="cz-control-group cz-media" data-media="${kind}"><legend>${title}</legend><p class="cz-help">${description}</p><div class="cz-media-drop ${value?'has-image':''} ${kind==='logo'?'is-logo':''}">${value?`<img src="${esc(value)}" alt="${kind==='logo'?'Logo da marca':'Imagem de capa'}">`:`<span class="cz-media-icon">${icon(kind==='logo'?'brand':'image')}</span>`}<label class="cz-upload-label ${!canUpload?'is-disabled':''}">${icon('upload')}<span>${busy?'Enviando imagem…':!canUpload?'Envio disponível na sua loja':value?'Trocar imagem':'Adicionar imagem'}</span><input type="file" accept="image/png,image/jpeg,image/webp" data-file="${kind}" ${busy||!canUpload?'disabled':''} aria-label="Enviar ${title.toLowerCase()}"></label></div><div class="cz-media-meta"><span>${canUpload?'JPG, PNG ou WebP · até 5 MB':this._config.demo?'Crie ou abra sua loja para enviar imagens.':'Use um link de imagem para personalizar sua marca.'}</span>${value?`<button type="button" class="cz-text-button" data-action="remove-image" data-kind="${kind}">Remover</button>`:''}</div><details class="cz-image-link"><summary>Usar o link de uma imagem</summary><label class="cz-field"><span>Endereço HTTPS da imagem</span><input type="url" data-url="${kind}" value="${esc(/^https:/.test(value||'')?value:'')}" placeholder="https://..." aria-label="Link da ${title.toLowerCase()}"></label><button type="button" class="cz-button cz-secondary" data-action="image-url" data-kind="${kind}">Usar imagem</button></details></fieldset>`;
  }

  _sectionControl(section,index,length) {
    const labels={hero:['Abertura','Sua primeira impressão'],collections:['Coleções em destaque','Mostre os universos da sua marca'],products:['Catálogo','Os produtos da loja'],about:['Sobre a marca','Sua história e propósito']},[label,description]=labels[section.id]||[section.id,''];
    return `<div class="cz-section-row ${!section.visible?'is-hidden':''}"><div class="cz-section-order"><button type="button" class="cz-icon-button" data-move="${section.id}" data-direction="-1" aria-label="Mover ${label.toLowerCase()} para cima" ${index===0?'disabled':''}>${icon('up')}</button><button type="button" class="cz-icon-button" data-move="${section.id}" data-direction="1" aria-label="Mover ${label.toLowerCase()} para baixo" ${index===length-1?'disabled':''}>${icon('down')}</button></div><div class="cz-section-name"><strong>${label}</strong><span>${description}</span></div>${section.id==='products'?`<span class="cz-section-locked" title="O catálogo fica sempre visível">${icon('lock')}<span>Essencial</span></span>`:`<label class="cz-section-visibility"><input type="checkbox" data-section="${section.id}" ${section.visible?'checked':''} aria-label="Mostrar ${label.toLowerCase()}"><span class="cz-toggle" aria-hidden="true"></span></label>`}</div>`;
  }

  _renderPreview() {
    if(!this.isConnected)return;
    const previewStore={...this._store,...this._state.brand,design:this._state.design,accent:this._state.design.accent,background:this._state.design.background};
    for (const target of this.shadowRoot.querySelectorAll('.cz-store-preview,.cz-modal-content')) {
      if(target.classList.contains('cz-modal-content')&&!this.shadowRoot.querySelector('dialog').open)continue;
      target.innerHTML=renderStoreShell(previewStore,{preview:true,products:this._products,collections:this._collections});
      const grid=target.querySelector('.shop-product-grid');
      if(grid && this._products.length) grid.innerHTML=renderProductCards(this._products,{preview:true});
      target.querySelectorAll('a,button,input,select').forEach(element=>{
        element.tabIndex=-1;
        if(element.matches('input,select'))element.disabled=true;
        if(element.matches('a'))element.removeAttribute('href');
      });
      target.querySelectorAll('h1').forEach(element=>{element.dataset.previewEdit='headline';element.title='Editar frase de abertura';element.tabIndex=0;element.setAttribute('role','button');element.setAttribute('aria-label','Editar frase de abertura');});
      target.querySelectorAll('.shop-wordmark,.store-logo,.shop-brand').forEach(element=>{element.dataset.previewEdit='brand';element.title='Editar sua marca';element.tabIndex=0;element.setAttribute('role','button');});
      target.querySelectorAll('.shop-logo').forEach(element=>{element.dataset.previewEdit='brand';element.title='Editar sua marca';});
      target.querySelectorAll('.shop-catalog').forEach(element=>{element.dataset.previewEdit='catalog';element.title='Editar visual do catálogo';element.tabIndex=0;element.setAttribute('role','button');element.setAttribute('aria-label','Editar visual do catálogo');});
      target.querySelectorAll('.shop-collections').forEach(element=>{element.dataset.previewEdit='collections';element.title='Editar seção de coleções em destaque';element.tabIndex=0;element.setAttribute('role','button');element.setAttribute('aria-label','Editar seção de coleções em destaque');});
    }
  }

  _updateStatus() {
    const root=this.shadowRoot;if(!root.querySelector('.cz-editor'))return;
    const changed=fingerprint(this._state)!==this._publishedFingerprint;
    const alerts=[];
    if(!this._config.demo&&!this._config.cloudReady) alerts.push(`<div class="cz-alert cz-setup">${icon('save')}<span>Você já pode criar seu estilo. Para aplicá-lo à loja, conclua a <a href="https://github.com/usarango/camizetas/blob/main/database/design.sql" target="_blank" rel="noopener">configuração do espaço criativo</a>.</span></div>`);
    if(this._recovery) alerts.push(`<div class="cz-alert cz-recovery"><span>Há outro rascunho salvo neste navegador.</span><div><button type="button" class="cz-text-button" data-action="recover">Recuperar rascunho</button><button type="button" class="cz-icon-button" data-action="dismiss-recovery" aria-label="Ignorar rascunho anterior">${icon('close')}</button></div></div>`);
    if(this._actionError||this._cloudError) alerts.push(`<div class="cz-alert cz-error" role="alert"><span>${esc(this._actionError||this._cloudError)}</span>${this._cloudError?'<button type="button" class="cz-text-button" data-action="retry">Tentar salvar</button>':''}</div>`);
    if(this._notice)alerts.push(`<div class="cz-alert cz-notice" role="status">${icon('check')}<span>${esc(this._notice)}</span></div>`);
    root.querySelector('.cz-alerts').innerHTML=alerts.join('');
    root.querySelector('.cz-save-state').innerHTML=`<span class="${this._saving?'is-saving':''}">${this._saving?'<i class="cz-spinner"></i>':icon('check')} ${esc(this._status)}</span><small>${this._config.demo?'Seu estilo vai com você ao criar a loja.':changed?'Sua loja atual continua igual até você aplicar.':'Você está criando a partir do estilo da loja.'}</small>`;
    root.querySelector('[data-action="undo"]').disabled=!this._undo.length||this._publishing;
    root.querySelector('[data-action="redo"]').disabled=!this._redo.length||this._publishing;
    const publish=root.querySelector('[data-action="publish"]');
    publish.disabled=this._publishing||Object.values(this._uploading).some(Boolean)||(!this._config.demo&&!this._config.cloudReady);
    publish.innerHTML=`<span>${this._publishing?(this._config.demo?'Preparando sua loja…':'Aplicando…'):(this._config.demo?'Criar loja com este estilo':'Aplicar na loja')}</span>${this._publishing?'<i class="cz-spinner"></i>':icon('arrow')}`;
    const save=root.querySelector('[data-action="save"]');save.disabled=this._publishing||this._saving;
    save.innerHTML=`${icon('save')}<span>${this._saving?'Salvando…':'Salvar rascunho'}</span>`;
    root.querySelector('.cz-editor').setAttribute('aria-busy',String(this._publishing));
  }

  _handleInput(event) {
    const element=event.target;
    if(this._publishing)return;
    if(element.dataset.bind && element.type!=='checkbox') {
      const [group,key]=element.dataset.bind.split('.');this._change(state=>{state[group][key]=element.value;},element.dataset.bind);
    }
    if(element.dataset.color) {
      const key=element.dataset.color;this._change(state=>{state.design[key]=element.value;},key);
      const hex=this.shadowRoot.querySelector(`[data-hex="${key}"]`);if(hex){hex.value=element.value;hex.removeAttribute('aria-invalid');}
      this._syncPaletteSelection();
    }
    if(element.dataset.hex) {
      const valid=/^#[0-9a-f]{6}$/i.test(element.value);element.setAttribute('aria-invalid',String(!valid));
      if(valid){const key=element.dataset.hex;this._change(state=>{state.design[key]=element.value;},key);this.shadowRoot.querySelector(`[data-color="${key}"]`).value=element.value;this._syncPaletteSelection();}
    }
  }

  _handleChange(event) {
    const element=event.target;
    if(element.dataset.bind && element.type==='checkbox') {
      const [group,key]=element.dataset.bind.split('.');this._change(state=>{state[group][key]=element.checked;});this._renderControls();
    }
    if(element.dataset.section) {this._change(state=>{state.design.sections.find(section=>section.id===element.dataset.section).visible=element.checked;});this._renderControls();}
    if(element.dataset.file && element.files?.[0]) this._upload(element.files[0],element.dataset.file).catch(()=>{});
  }

  _syncPaletteSelection() {
    for(const button of this.shadowRoot.querySelectorAll('[data-palette]')){const palette=palettes[Number(button.dataset.palette)],selected=palette.accent.toLowerCase()===this._state.design.accent.toLowerCase()&&palette.background.toLowerCase()===this._state.design.background.toLowerCase();button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));}
  }

  _handleClick(event) {
    const target=event.target.closest?.('[data-tab],[data-preset],[data-font],[data-hero],[data-palette],[data-option],[data-move],[data-action],[data-preview-edit]');
    if(!target)return;
    if(target.disabled)return;
    if(target.dataset.tab){this._activeTab=target.dataset.tab;this._renderControls();return;}
    if(target.dataset.preset){this.selectPreset(target.dataset.preset);return;}
    if(target.dataset.font){this._change(state=>{state.design.font=target.dataset.font;});this._renderControls();return;}
    if(target.dataset.hero){this._change(state=>{state.design.hero=target.dataset.hero;});this._renderControls();return;}
    if(target.dataset.palette){const palette=palettes[Number(target.dataset.palette)];this._change(state=>{state.design.accent=palette.accent;state.design.background=palette.background;});this._renderControls();return;}
    if(target.dataset.option){const key=target.dataset.option;this._change(state=>{state.design[key]=['gridColumns','radius'].includes(key)?Number(target.dataset.value):target.dataset.value;});this._renderControls();return;}
    if(target.dataset.move){const index=this._state.design.sections.findIndex(section=>section.id===target.dataset.move),next=index+Number(target.dataset.direction);if(next<0||next>=this._state.design.sections.length)return;this._change(state=>{[state.design.sections[index],state.design.sections[next]]=[state.design.sections[next],state.design.sections[index]];});this._renderControls();return;}
    if(target.dataset.previewEdit){event.preventDefault();this._editFromPreview(target.dataset.previewEdit);return;}
    const action=target.dataset.action;
    if(action==='undo'||action==='redo'){this._history(action);return;}
    if(action==='desktop'||action==='mobile') {
      this._viewport=action;this.shadowRoot.querySelector('.cz-device').classList.toggle('is-mobile',action==='mobile');
      for(const button of this.shadowRoot.querySelectorAll('.cz-device-switch button'))button.setAttribute('aria-pressed',String(button.dataset.action===action));return;
    }
    if(action==='reset'){this._change(state=>{state.design=createDesign(state.design.preset);});this._renderControls();this._notice='Estilo original restaurado. Você pode desfazer esta mudança.';this._updateStatus();return;}
    if(action==='save'||action==='retry'){this.saveCurrentDraft().catch(()=>{});return;}
    if(action==='publish'){this._publish().catch(()=>{});return;}
    if(action==='recover'){const recovered=this._recovery;this._recovery=null;this._change(state=>{state.brand=recovered.brand;state.design=recovered.design;});this._renderControls();this._updateStatus();return;}
    if(action==='dismiss-recovery'){this._recovery=null;this._updateStatus();return;}
    if(action==='remove-image'){const kind=target.dataset.kind;this._uploadSerial[kind]=(this._uploadSerial[kind]||0)+1;this._uploading[kind]=false;this._change(state=>{state.design[kind==='logo'?'logoUrl':'heroImage']='';});this._renderControls();this._updateStatus();return;}
    if(action==='image-url') {
      const kind=target.dataset.kind,input=this.shadowRoot.querySelector(`[data-url="${kind}"]`),url=validHTTPS(input.value);
      if(!url){input.setAttribute('aria-invalid','true');this._actionError='Use um link de imagem que comece com https://.';this._updateStatus();input.focus();return;}
      this._change(state=>{state.design[kind==='logo'?'logoUrl':'heroImage']=url;});this._renderControls();return;
    }
    if(action==='expand'){const dialog=this.shadowRoot.querySelector('dialog');if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');this._renderPreview();return;}
    if(action==='close-preview'){const dialog=this.shadowRoot.querySelector('dialog');if(dialog.close)dialog.close();else dialog.removeAttribute('open');}
  }

  _editFromPreview(kind) {
    const dialog=this.shadowRoot.querySelector('dialog');if(dialog.open)dialog.close();
    this._activeTab=kind==='collections'?'sections':kind==='catalog'?'visual':'brand';this._renderControls();
    const focus=this.shadowRoot.querySelector(kind==='collections'?'[data-section="collections"]':kind==='headline'?'#cz-brand-headline':kind==='brand'?'#cz-brand-name':'[data-option="gridColumns"]');
    focus?.focus();focus?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }

  _handleKey(event) {
    if(event.target.dataset.previewEdit&&['Enter',' '].includes(event.key)){event.preventDefault();this._editFromPreview(event.target.dataset.previewEdit);return;}
    if(event.target.matches?.('[role="tab"]') && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();const index=tabData.findIndex(([id])=>id===this._activeTab);let next=event.key==='Home'?0:event.key==='End'?tabData.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabData.length)%tabData.length;
      this._activeTab=tabData[next][0];this._renderControls();this.shadowRoot.querySelector(`[data-tab="${this._activeTab}"]`).focus();
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();this.saveCurrentDraft().catch(()=>{});}
  }

  async _upload(file,kind) {
    if(this._publishing||typeof this._config.onUpload!=='function')return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){this._actionError='Escolha uma imagem JPG, PNG ou WebP.';this._updateStatus();return;}
    if(file.size>5*1024*1024){this._actionError='A imagem pode ter até 5 MB. Escolha um arquivo menor.';this._updateStatus();return;}
    const epoch=this._epoch,serial=(this._uploadSerial[kind]||0)+1;this._uploadSerial[kind]=serial;this._uploading[kind]=true;this._actionError='';
    this._renderControls();this._updateStatus();
    try {
      const uploaded=await this._config.onUpload(file,kind);
      if(epoch!==this._epoch||serial!==this._uploadSerial[kind])return;
      const url=validHTTPS(uploaded);if(!url)throw new Error('O envio não retornou um endereço de imagem válido. Tente novamente.');
      this._change(state=>{state.design[kind==='logo'?'logoUrl':'heroImage']=url;});
      this._notice='Imagem adicionada ao rascunho.';
    } catch(error) {
      if(epoch===this._epoch&&serial===this._uploadSerial[kind])this._actionError=this._message(error,'Não foi possível enviar a imagem. Tente novamente.');
    } finally {
      if(epoch===this._epoch&&serial===this._uploadSerial[kind]){this._uploading[kind]=false;this._renderControls();this._updateStatus();}
    }
  }

  async _publish() {
    if(this._publishing||Object.values(this._uploading).some(Boolean))return;
    if(!this._config.demo&&!this._config.cloudReady)return;
    if(!this._state.brand.name.trim()){this._actionError='Dê um nome à sua loja antes de continuar.';this._activeTab='brand';this._renderControls();this._updateStatus();this.shadowRoot.querySelector('#cz-brand-name')?.focus();return;}
    const callback=this._config.demo?this._config.onDemoContinue:this._config.onPublish;
    if(typeof callback!=='function'){this._actionError='Não foi possível conectar esta ação. Atualize a página e tente novamente.';this._updateStatus();return;}
    const epoch=this._epoch,snapshot=this.payload;
    this._publishing=true;this._actionError='';this._notice='';this._renderControls();this._updateStatus();
    try {
      await this.saveCurrentDraft();
      if(epoch!==this._epoch)return;
      await callback(this._config.demo?clone(snapshot):{brand:clone(snapshot.brand),design:clone(snapshot.design)});
      if(epoch!==this._epoch)return;
      if(!this._config.demo)this._publishedFingerprint=fingerprint(snapshot);
      this._status=this._config.demo?'Estilo pronto para sua loja':'Estilo aplicado à loja';
      this._notice=this._config.demo?'Seu estilo está pronto. Continue a criação da loja.':this._store.published===false?'Visual salvo. Sua loja continua em rascunho; publique-a em Sua loja quando estiver pronta.':'Pronto. Seus clientes já podem ver o novo estilo.';
    } catch(error) {
      if(epoch===this._epoch)this._actionError=this._message(error,'Não foi possível aplicar o estilo. Seu rascunho foi preservado.');
    } finally {
      if(epoch===this._epoch){this._publishing=false;this._renderControls();this._updateStatus();}
    }
  }

  _message(error,fallback) {
    const message=typeof error?.message==='string'?error.message.trim():'';
    return message && message.length<350?message:fallback;
  }
}

if(!customElements.get('store-customizer'))customElements.define('store-customizer',StoreCustomizer);
