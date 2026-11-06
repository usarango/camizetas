import {PRESETS, resolveDesign, contrastColor, safeImageURL, designText} from './design.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const money = cents => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format((Number.isSafeInteger(cents) && cents >= 0 ? cents : 0) / 100);
const bagIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const kickerByPreset = {
  chic: 'Uma nova forma de vestir', underground: 'Independente por natureza',
  rock: 'Volume alto. Identidade própria.', nerd: '[ Seu próximo universo ]',
  minimal: 'Peças para todos os seus dias', botanical: 'No seu tempo, do seu jeito',
  sport: 'Feito para seguir em frente', pop: 'Um pouco mais de você',
};

export function renderProductCards(products = [], {preview = false} = {}) {
  return (Array.isArray(products) ? products : []).filter(product => product && typeof product === 'object' && product.active !== false).map((product, index) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const available = variants.some(variant => variant && variant.active !== false && Number.isInteger(variant.on_hand) && variant.on_hand > 0);
    const name = designText(product.name, 160) || 'Peça da coleção';
    const category = designText(product.category, 80);
    return `<article class="shop-product-card"${preview ? ' data-design-section="products"' : ''}>
      <button class="shop-product-photo" type="button" data-product="${esc(product.id)}" aria-label="Ver ${esc(name)}">
        <img src="${esc(safeImageURL(product.image_url, 'assets/product-placeholder.svg'))}" alt="${esc(name)}" loading="lazy" decoding="async">
        <span class="shop-product-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        ${!available ? '<span class="shop-soldout">Esgotado</span>' : ''}
      </button>
      <div class="shop-product-details">${category ? `<span class="shop-product-category">${esc(category)}</span>` : ''}<div class="shop-product-title"><h3>${esc(name)}</h3><p>${money(product.price_cents)}</p></div>
      <button class="shop-add" type="button" data-product="${esc(product.id)}" ${!available ? 'disabled' : ''}>${available ? `Escolher minha peça ${arrow}` : 'Indisponível'}</button></div>
    </article>`;
  }).join('');
}

export function renderStoreShell(store = {}, options = {}) {
  store = store && typeof store === 'object' ? store : {};
  const design = resolveDesign(store);
  const preset = PRESETS.find(p => p.id === design.preset);
  const name = designText(store.name, 80) || preset.demoName;
  const headline = designText(store.headline, 100) || name;
  const description = designText(store.description, 3000) || 'Uma coleção com a nossa identidade. Encontre a peça que combina com a sua.';
  const products = Array.isArray(options.products) ? options.products.filter(product => product && typeof product === 'object' && product.active !== false) : [];
  const activeCollection = options.activeCollection && typeof options.activeCollection === 'object' && !Array.isArray(options.activeCollection) && options.activeCollection.active !== false ? options.activeCollection : null;
  const publicCollections = (Array.isArray(options.collections) ? options.collections : [])
    .filter(collection => collection && typeof collection === 'object' && collection.active !== false)
    .slice().sort((a, b) => {
      const order = (Number.isFinite(a.sort_order) ? a.sort_order : 0) - (Number.isFinite(b.sort_order) ? b.sort_order : 0);
      return order || String(a.id || a.name || '').localeCompare(String(b.id || b.name || ''), 'pt-BR') || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
  const featuredCollections = publicCollections.filter(collection => collection.featured === true);
  const collectionName = activeCollection ? designText(activeCollection.name, 120) || 'Coleção' : '';
  const heroHeadline = activeCollection ? collectionName : headline;
  const heroDescription = activeCollection ? designText(activeCollection.description, 3000) : description;
  const heroImage = activeCollection ? safeImageURL(activeCollection.image_url) : design.heroImage;
  const heroLayout = activeCollection && heroImage && design.hero === 'compact' ? 'split' : design.hero;
  const collectionsVisible = design.sections.some(section => section.id === 'collections' && section.visible) && featuredCollections.length > 0;
  const aboutVisible = design.sections.some(section => section.id === 'about' && section.visible);
  const category = designText(options.category, 80) || 'Todos';
  const categories = ['Todos', ...new Set(products.map(product => designText(product?.category, 80)).filter(value => value && value !== 'Todos'))];
  const preview = options.preview === true;
  const rootStoreHref = `loja.html?loja=${encodeURIComponent(designText(store.slug, 80))}`;
  const storeHref = preview ? '#store-top' : rootStoreHref;
  const backLinks = activeCollection ? `<nav class="shop-collection-trail" aria-label="Navegação da coleção"><a class="shop-collection-back" href="${esc(rootStoreHref)}#collection">${arrow} Todos os produtos</a>${collectionsVisible ? `<a href="${esc(rootStoreHref)}#collections">Ver coleções</a>` : ''}</nav>` : '';
  const logo = design.logoUrl ? `<img class="shop-logo" src="${esc(design.logoUrl)}" alt="${esc(name)}">` : esc(name);
  const hero = `<section class="shop-hero hero-${heroLayout}${heroImage ? ' has-hero-image' : ''}" id="store-hero" data-design-section="hero">
    <div class="shop-hero-copy"><p class="shop-kicker"><span class="shop-kicker-line" aria-hidden="true"></span>${esc(activeCollection ? `Coleção / ${name}` : kickerByPreset[design.preset])}</p><h1>${esc(heroHeadline)}</h1>${heroDescription ? `<p class="shop-hero-description">${esc(heroDescription)}</p>` : ''}<a class="shop-hero-cta" href="#collection">${esc(design.buttonLabel)} ${arrow}</a><span class="shop-hero-edition" aria-hidden="true">${esc(activeCollection ? name : design.preset === 'nerd' ? 'COLLECTION_01 / ONLINE' : `Coleção independente / ${new Date().getFullYear()}`)}</span></div>
    ${heroImage && heroLayout !== 'compact' ? `<figure class="shop-hero-visual"><img src="${esc(heroImage)}" alt="${esc(activeCollection ? `Coleção ${collectionName}` : `Universo da marca ${name}`)}" fetchpriority="${preview ? 'auto' : 'high'}"><figcaption><span>${esc(activeCollection ? collectionName : name)}</span><span>${activeCollection ? esc(name) : design.preset === 'nerd' ? 'LEVEL 01' : 'Coleção autoral'}</span></figcaption></figure>` : ''}
    <span class="shop-hero-mark" aria-hidden="true">${design.preset === 'sport' ? 'GO' : design.preset === 'pop' ? 'oi.' : design.preset === 'nerd' ? '01' : ''}</span>
  </section>`;
  const featured = !activeCollection && collectionsVisible ? `<section class="shop-collections" id="collections" data-design-section="collections"><div class="shop-collections-heading"><div><p class="shop-section-kicker">Explore por coleção</p><h2>Coleções em destaque<span class="shop-title-dot" aria-hidden="true">.</span></h2></div><p>Encontre o seu próximo estilo.</p></div><div class="shop-collection-grid" style="--collection-count:${Math.min(3, featuredCollections.length)}">${featuredCollections.map(collection => {
    const title = designText(collection.name, 120) || 'Coleção';
    const summary = designText(collection.description, 180);
    const image = safeImageURL(collection.image_url);
    const href = `${rootStoreHref}&colecao=${encodeURIComponent(designText(collection.slug, 100))}`;
    return `<article class="shop-collection-card"><a class="shop-collection-link" href="${esc(href)}" aria-label="Explorar coleção ${esc(title)}"><div class="shop-collection-image${image ? '' : ' is-empty'}">${image ? `<img src="${esc(image)}" alt="${esc(title)}" loading="lazy" decoding="async">` : `<span aria-hidden="true">${esc(title)}</span>`}</div><div class="shop-collection-copy"><div><h3>${esc(title)}</h3>${summary ? `<p>${esc(summary)}</p>` : ''}</div><span class="shop-collection-arrow" aria-hidden="true">${arrow}</span></div></a></article>`;
  }).join('')}</div></section>` : '';
  const filteredProducts = products.filter(product => category === 'Todos' || product.category === category);
  const emptyMessage = products.length ? 'Nenhuma peça nesta categoria por enquanto.' : activeCollection ? 'Esta coleção ainda não tem peças disponíveis.' : 'Nossa próxima coleção está chegando. Volte em breve.';
  const collectionFilter = publicCollections.length ? `<label class="shop-collection-label"><span>Coleção</span><select class="shop-collection" aria-label="Filtrar produtos por coleção"><option value=""${!activeCollection ? ' selected' : ''}>Todos os produtos</option>${publicCollections.map(collection => `<option value="${esc(designText(collection.slug, 100))}"${activeCollection && collection.slug === activeCollection.slug ? ' selected' : ''}>${esc(designText(collection.name, 120) || 'Coleção')}</option>`).join('')}</select></label>` : '';
  const catalog = `<section class="shop-catalog" id="collection" data-design-section="products"><div class="shop-catalog-tools"><div><p class="shop-section-kicker">${design.preset === 'nerd' ? '// INVENTÁRIO' : 'Encontre a sua próxima peça'}</p><h2>${esc(activeCollection ? collectionName : 'Nossa coleção')}<span class="shop-title-dot" aria-hidden="true">.</span></h2></div><div class="shop-catalog-filters">${collectionFilter}<label class="shop-category-label"><span>Categoria</span><select class="shop-category" aria-label="Filtrar produtos por categoria">${categories.map(value => `<option value="${esc(value)}"${value === category ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select></label></div></div><div class="shop-product-grid">${renderProductCards(filteredProducts, {preview})}</div><div class="shop-empty"${filteredProducts.length ? ' hidden' : ''}>${emptyMessage}</div></section>`;
  const about = `<section class="shop-about" id="about" data-design-section="about"><div><p class="shop-section-kicker">Por trás da marca</p><h2>Prazer, ${esc(name)}<span class="shop-title-dot" aria-hidden="true">.</span></h2></div><div><p>${esc(description)}</p><a href="#collection" class="shop-about-link">Encontre algo que é a sua cara ${arrow}</a></div></section>`;
  const sections = {hero, collections: featured, products: catalog, about};
  const body = activeCollection ? hero + catalog + (aboutVisible ? about : '') : design.sections.filter(section => section.visible).map(section => sections[section.id]).join('');
  return `<div id="store-top" class="design-store real-store preset-${design.preset} font-${design.font} cards-${design.cardStyle}${preview ? ' is-preview' : ''}${activeCollection ? ' is-collection-page' : ''}" data-preset="${design.preset}" style="--shop-bg:${design.background};--shop-fg:${contrastColor(design.background)};--shop-accent:${design.accent};--accent-fg:${contrastColor(design.accent)};--store-radius:${design.radius}px;--store-columns:${design.gridColumns}">
    ${design.announcementEnabled && design.announcement ? `<div class="shop-topline" data-design-section="hero">${esc(design.announcement)}</div>` : ''}
    <header class="shop-header"><a class="shop-wordmark${design.logoUrl ? ' has-logo' : ''}" href="${esc(storeHref)}" aria-label="${esc(name)}, início">${logo}</a><nav class="shop-nav" aria-label="Navegação da loja"><a href="${activeCollection ? `${esc(rootStoreHref)}#collection` : '#collection'}">${activeCollection ? 'Todos os produtos' : 'Produtos'}</a>${collectionsVisible ? `<a href="${activeCollection ? esc(rootStoreHref) : ''}#collections">Coleções</a>` : ''}${aboutVisible ? '<a href="#about">Nossa história</a>' : ''}</nav><div class="shop-header-actions"><a href="painel.html?compras=1" class="shop-orders-link">Meus pedidos</a><button class="shop-bag-button" type="button" aria-label="Abrir sacola">${bagIcon}<span class="shop-bag-label">Sacola</span><span class="shop-bag-count">0</span></button></div></header>
    <div class="store-alert" role="status" aria-live="polite"></div>
    <div class="shop-main">${backLinks}${body}</div>
    <footer class="shop-footer"><div><a class="shop-footer-brand" href="#store-top">${esc(name)}</a><span>Uma marca independente. Do seu jeito.</span></div><a class="shop-platform-link" href="lojas.html">feito com <strong>camizetas<span>.</span></strong> ${arrow}</a></footer>
  </div>`;
}
