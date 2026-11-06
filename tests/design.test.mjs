import assert from 'node:assert/strict';
import test from 'node:test';
import {Window} from 'happy-dom';
import {PRESETS, createDesign, normalizeDesign, resolveDesign, designToStorePatch, safeImageURL, contrastColor} from '../src/design.js';
import {renderStoreShell, renderProductCards} from '../src/store-layout.js';

const parse = markup => {
  const window = new Window({url: 'https://camizetas.test/loja.html', settings: {disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true}});
  window.document.body.innerHTML = markup;
  return window;
};

test('eight presets make independent designs and retain four schema-compatible legacy templates', () => {
  assert.deepEqual(PRESETS.map(p => p.id), ['chic', 'underground', 'rock', 'nerd', 'minimal', 'botanical', 'sport', 'pop']);
  assert.equal(new Set(PRESETS.map(p => `${p.defaults.font}/${p.defaults.hero}/${p.defaults.cardStyle}/${p.defaults.gridColumns}/${p.defaults.radius}`)).size, 8);
  for (const preset of PRESETS) {
    const design = createDesign(preset.id);
    assert.equal(design.preset, preset.id);
    assert.deepEqual(normalizeDesign(design), design);
    assert.ok(['chic','underground','rock','nerd'].includes(designToStorePatch(design).template));
  }
  const changed = createDesign('pop');
  changed.sections[0].visible = false;
  assert.equal(createDesign('pop').sections[0].visible, true);
});

test('legacy stores keep their colors and upgrade to a complete normalized design', () => {
  const design = resolveDesign({template: 'rock', accent: '#ABCDEF', background: '#102030', design: {}});
  assert.equal(design.preset, 'rock');
  assert.equal(design.hero, 'fullbleed');
  assert.equal(design.accent, '#abcdef');
  assert.equal(design.background, '#102030');
  assert.equal(normalizeDesign({preset: 'pop'}, {template: 'chic'}).preset, 'pop');
  assert.equal(normalizeDesign({preset: 'injected'}).preset, 'chic');
  for (const input of [null, false, '', 10, [], {sections: [null, [], false]}]) assert.doesNotThrow(() => normalizeDesign(input));
});

test('design normalization rejects CSS, HTML, unsafe URLs, unsupported enums and duplicate sections', () => {
  const normalized = normalizeDesign({
    preset: 'nerd', accent: '#000000;position:fixed', background: 'red',
    font: 'Arial; color:red', hero: 'javascript', gridColumns: 99, radius: 1000, cardStyle: '<b>',
    heroImage: 'javascript:alert(1)', logoUrl: 'data:image/svg+xml,<svg onload=alert(1)>',
    rawCSS: 'body{display:none}', rawHTML: '<script>alert(1)</script>',
    announcement: 'x'.repeat(250), announcementEnabled: 'true', buttonLabel: 'y'.repeat(100),
    sections: [{id: 'about', visible: true}, {id: 'products', visible: false}, {id: 'about', visible: false}, {id: '<img>', visible: true}],
  });
  assert.equal(normalized.accent, createDesign('nerd').accent);
  assert.equal(normalized.heroImage, '');
  assert.equal(normalized.logoUrl, '');
  assert.equal(normalized.announcement.length, 160);
  assert.equal(normalized.announcementEnabled, false);
  assert.equal(normalized.buttonLabel.length, 48);
  assert.equal(normalized.gridColumns, 4);
  assert.equal(normalized.radius, 8);
  assert.deepEqual(normalized.sections, [{id:'about',visible:true},{id:'collections',visible:true},{id:'products',visible:true},{id:'hero',visible:true}]);
  assert.equal('rawCSS' in normalized, false);
  assert.equal('rawHTML' in normalized, false);
});

test('images accept exact local assets and HTTPS without accepting traversal, credentials or executable protocols', () => {
  assert.equal(safeImageURL('assets/theme-chic.jpg'), 'assets/theme-chic.jpg');
  assert.equal(safeImageURL('https://example.com/a.jpg?q=1'), 'https://example.com/a.jpg?q=1');
  for (const input of ['assets/../config.js', 'assets/missing.svg', '//evil.test/a', 'http://evil.test/a', 'https://user:pass@evil.test/a', 'data:image/png;base64,xyz', 'javascript:alert(1)', 'https:\n//evil.test/a']) {
    assert.equal(safeImageURL(input), '', input);
  }
  assert.equal(contrastColor('#000000'), '#ffffff');
  assert.equal(contrastColor('#ffffff'), '#000000');
});

test('store patch trims brand text, respects database field limits and keeps new presets in design JSON', () => {
  const patch = designToStorePatch(createDesign('botanical'), {name: `  ${'n'.repeat(100)}  `, headline: 'h'.repeat(180), description: 'd'.repeat(4000), owner_id: 'other-owner', published: true});
  assert.equal(patch.name.length, 80);
  assert.equal(patch.headline.length, 100);
  assert.equal(patch.description.length, 3000);
  assert.equal(patch.template, 'chic');
  assert.equal(patch.design.preset, 'botanical');
  assert.equal('owner_id' in patch, false);
  assert.equal('published' in patch, false);
});

test('shared store shell follows section order, keeps purchase hooks and safely renders hostile text', async () => {
  const hostile = '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const design = {...createDesign('pop'), announcement: hostile, announcementEnabled: true, buttonLabel: hostile,
    heroImage: 'javascript:alert(1)', logoUrl: 'data:image/svg+xml,<svg>',
    sections: [{id:'about', visible:true}, {id:'products', visible:false}, {id:'hero', visible:true}]};
  const window = parse(renderStoreShell({name: hostile, headline: hostile, description: hostile, slug: hostile, design}, {preview:true, products:[{id: hostile, name: hostile, category: hostile, image_url:'javascript:alert(1)', price_cents:8990, variants:[]}]}));
  try {
    const doc = window.document;
    assert.equal(doc.querySelectorAll('script, [onerror], [onclick]').length, 0);
    assert.equal(doc.querySelector('.shop-wordmark').textContent, hostile);
    assert.equal(doc.querySelector('h1').textContent, hostile);
    assert.deepEqual([...doc.querySelector('.shop-main').children].map(el => el.dataset.designSection), ['about','products','hero']);
    assert.equal(doc.querySelectorAll('.shop-product-card').length, 1);
    assert.equal(doc.querySelector('.shop-product-card h3').textContent, hostile);
    assert.equal(doc.querySelector('.shop-product-photo').dataset.product, hostile);
    assert.ok(doc.querySelector('.shop-product-photo img').src.endsWith('/assets/product-placeholder.svg'));
    for (const selector of ['.design-store.real-store', '.shop-bag-button .shop-bag-count', '.store-alert', '.shop-category', '.shop-product-grid', '.shop-empty', '.shop-footer']) assert.ok(doc.querySelector(selector), selector);
    assert.equal(doc.querySelector('.shop-hero-cta').getAttribute('href'), '#collection');
  } finally { await window.happyDOM.abort(); window.close(); }
});

test('published and preview cards preserve real stock decisions and the same purchase attributes', async () => {
  const products = [{id:'p1',name:'Disponível',price_cents:12000,variants:[{on_hand:1}]},{id:'p2',name:'Esgotada',price_cents:6000,variants:[{on_hand:0}]},{id:'p3',name:'Sem variações',price_cents:8000,variants:[]},{id:'p4',name:'Arquivado',active:false,price_cents:9000,variants:[{on_hand:99}]}];
  for (const preview of [true, false]) {
    const window = parse(renderProductCards(products, {preview}));
    try {
      const cards = window.document.querySelectorAll('.shop-product-card');
      assert.equal(cards.length,3);assert.equal(window.document.body.textContent.includes('Arquivado'),false);
      assert.equal(cards[0].querySelector('.shop-add').disabled, false);
      assert.equal(cards[1].querySelector('.shop-add').disabled, true);
      assert.equal(cards[2].querySelector('.shop-add').disabled, true);
      assert.equal(cards[0].querySelector('.shop-add').dataset.product, 'p1');
      assert.ok(cards[1].querySelector('.shop-soldout'));
    } finally { await window.happyDOM.abort(); window.close(); }
  }
});

test('collection section upgrades old saved designs before products without reordering existing sections', () => {
  assert.deepEqual(createDesign('chic').sections.map(section => section.id), ['hero','collections','products','about']);
  for (const savedOrder of [['hero','products','about'], ['about','products','hero'], ['products','hero','about']]) {
    const design = normalizeDesign({sections:savedOrder.map(id => ({id,visible:id !== 'hero'}))});
    assert.deepEqual(design.sections.filter(section => section.id !== 'collections').map(section => section.id), savedOrder);
    const collectionIndex = design.sections.findIndex(section => section.id === 'collections');
    assert.equal(design.sections[collectionIndex].visible, true);
    assert.equal(design.sections[collectionIndex + 1].id, 'products');
    assert.equal(design.sections.find(section => section.id === 'hero').visible, false);
  }
  const explicit = normalizeDesign({sections:[{id:'collections',visible:false},{id:'products',visible:false},{id:'collections',visible:true}]});
  assert.equal(explicit.sections.filter(section => section.id === 'collections').length, 1);
  assert.equal(explicit.sections.find(section => section.id === 'collections').visible, false);
  assert.equal(explicit.sections.find(section => section.id === 'products').visible, true);
});

test('featured collections are opt-in, safely rendered and stably ordered without hiding other public collection filters', async () => {
  const hostile = '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const collections = [
    {id:'z',slug:'later',name:'Mais tarde',featured:true,sort_order:5,image_url:'assets/fashion.jpg'},
    {id:'b',slug:hostile,name:hostile,description:hostile,image_url:'javascript:alert(1)',featured:true,sort_order:0},
    {id:'a',slug:'primeira',name:'Primeira',description:'Peças da primeira coleção',image_url:'https://images.test/cover.jpg',featured:true,sort_order:0},
    {id:'archived',slug:'arquivada',name:'Não pode vazar',active:false,featured:true,sort_order:-1},
    {id:'plain',slug:'sem-destaque',name:'Sem destaque',featured:false,sort_order:1},
    {id:'string',slug:'sem-booleano',name:'Sem booleano',featured:'true',sort_order:2},
  ];
  const window = parse(renderStoreShell({name:'Marca',slug:'minha & marca',design:createDesign('chic')},{collections}));
  try {
    const doc = window.document;
    assert.equal(doc.querySelectorAll('.shop-collection-card').length, 3);
    assert.deepEqual([...doc.querySelectorAll('.shop-collection-card h3')].map(element => element.textContent), ['Primeira',hostile,'Mais tarde']);
    assert.equal(doc.querySelectorAll('script,[onerror]').length, 0);
    assert.equal(doc.body.textContent.includes('Não pode vazar'), false);
    assert.equal(doc.querySelectorAll('.shop-collection-card')[1].querySelector('img'), null);
    const unsafeLink = doc.querySelectorAll('.shop-collection-link')[1];
    const url = new URL(unsafeLink.href);
    assert.equal(url.searchParams.get('loja'), 'minha & marca');
    assert.equal(url.searchParams.get('colecao'), hostile);
    assert.equal(doc.querySelector('.shop-collection').options.length, 6);
    assert.equal(doc.querySelector('.shop-collection').value, '');
    assert.ok([...doc.querySelector('.shop-collection').options].some(option => option.value === 'sem-destaque'));
    assert.ok(doc.querySelector('.shop-catalog-filters .shop-category'));
  } finally { await window.happyDOM.abort(); window.close(); }
});

test('empty or disabled featured sections stay absent from published and preview storefronts', async () => {
  const hiddenDesign = createDesign('nerd');hiddenDesign.sections.find(section => section.id === 'collections').visible = false;
  for (const options of [
    {design:createDesign('chic'),collections:[]},
    {design:createDesign('chic'),collections:[{id:'c',slug:'normal',name:'Normal',featured:false}]},
    {design:hiddenDesign,collections:[{id:'c',slug:'destacada',name:'Destacada',featured:true}]},
  ]) {
    for (const preview of [true,false]) {
      const window = parse(renderStoreShell({slug:'loja',design:options.design},{collections:options.collections,preview}));
      try { assert.equal(window.document.querySelector('.shop-collections'),null);assert.ok(window.document.querySelector('.shop-product-grid')); }
      finally { await window.happyDOM.abort();window.close(); }
    }
  }
});

test('collection pages use collection identity and a mandatory hero before products, with truthful empty state and safe return links', async () => {
  const design = createDesign('minimal');
  design.sections = [{id:'about',visible:true},{id:'products',visible:false},{id:'hero',visible:false},{id:'collections',visible:true}];
  const activeCollection = {id:'c',slug:'colecao-especial',name:'Outra <coleção>',description:'Feita para dias livres.',image_url:'https://images.test/collection.jpg',featured:false};
  const products = [{id:'p',name:'Peça da coleção',category:'Acessórios',price_cents:9000,variants:[{on_hand:2}]}];
  const window = parse(renderStoreShell({name:'Marca',slug:'minha-marca',headline:'Frase da marca',description:'História da marca.',design}, {activeCollection,products,collections:[activeCollection,{id:'f',slug:'destaque',name:'Destaque',featured:true}]}));
  try {
    const doc = window.document;
    assert.equal(doc.querySelector('.shop-hero h1').textContent, activeCollection.name);
    assert.equal(doc.querySelector('.shop-hero-description').textContent, activeCollection.description);
    assert.equal(doc.querySelector('.shop-hero-visual img').getAttribute('src'), activeCollection.image_url);
    assert.ok(doc.querySelector('.shop-hero.hero-split'));
    assert.equal(doc.querySelector('.shop-catalog h2').firstChild.textContent, activeCollection.name);
    assert.equal(doc.querySelector('.shop-collections'), null);
    assert.deepEqual([...doc.querySelectorAll('.shop-main > section')].map(element => element.dataset.designSection), ['hero','products','about']);
    assert.match(doc.querySelector('.shop-about').textContent, /História da marca/);
    assert.equal(doc.querySelector('.shop-collection-back').getAttribute('href'), 'loja.html?loja=minha-marca#collection');
    assert.equal(doc.querySelector('.shop-collection').value, activeCollection.slug);
    assert.deepEqual([...doc.querySelector('.shop-category').options].map(option => option.textContent), ['Todos','Acessórios']);
    assert.equal(doc.querySelectorAll('.shop-product-card').length,1);
  } finally { await window.happyDOM.abort();window.close(); }
  const empty = parse(renderStoreShell({name:'Marca',slug:'marca',design},{activeCollection:{...activeCollection,name:'<script>x</script>',description:'<img src=x onerror=alert(1)>',image_url:'javascript:alert(1)'},products:[]}));
  try {
    assert.equal(empty.document.querySelectorAll('script,[onerror]').length,0);
    assert.equal(empty.document.querySelector('.shop-hero-visual'),null);
    assert.equal(empty.document.querySelector('.shop-hero h1').textContent,'<script>x</script>');
    assert.equal(empty.document.querySelector('.shop-empty').hidden,false);
    assert.match(empty.document.querySelector('.shop-empty').textContent,/ainda não tem peças disponíveis/);
  } finally { await empty.happyDOM.abort();empty.close(); }
});
