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
  const category = designText(options.category, 80) || 'Todos';
  const categories = ['Todos', ...new Set(products.map(product => designText(product?.category, 80)).filter(value => value && value !== 'Todos'))];
  const preview = options.preview === true;
  const storeHref = preview ? '#store-top' : `loja.html?loja=${encodeURIComponent(designText(store.slug, 80))}`;
  const logo = design.logoUrl ? `<img class="shop-logo" src="${esc(design.logoUrl)}" alt="${esc(name)}">` : esc(name);
  const hero = `<section class="shop-hero hero-${design.hero}${design.heroImage ? ' has-hero-image' : ''}" id="store-hero" data-design-section="hero">
    <div class="shop-hero-copy"><p class="shop-kicker"><span class="shop-kicker-line" aria-hidden="true"></span>${esc(kickerByPreset[design.preset])}</p><h1>${esc(headline)}</h1><p class="shop-hero-description">${esc(description)}</p><a class="shop-hero-cta" href="#collection">${esc(design.buttonLabel)} ${arrow}</a><span class="shop-hero-edition" aria-hidden="true">${design.preset === 'nerd' ? 'COLLECTION_01 / ONLINE' : `Coleção independente / ${new Date().getFullYear()}`}</span></div>
    ${design.heroImage && design.hero !== 'compact' ? `<figure class="shop-hero-visual"><img src="${esc(design.heroImage)}" alt="Universo da marca ${esc(name)}" fetchpriority="${preview ? 'auto' : 'high'}"><figcaption><span>${esc(name)}</span><span>${design.preset === 'nerd' ? 'LEVEL 01' : 'Coleção autoral'}</span></figcaption></figure>` : ''}
    <span class="shop-hero-mark" aria-hidden="true">${design.preset === 'sport' ? 'GO' : design.preset === 'pop' ? 'oi.' : design.preset === 'nerd' ? '01' : ''}</span>
  </section>`;
  const catalog = `<section class="shop-catalog" id="collection" data-design-section="products"><div class="shop-catalog-tools"><div><p class="shop-section-kicker">${design.preset === 'nerd' ? '// INVENTÁRIO' : 'Encontre a sua próxima peça'}</p><h2>Nossa coleção<span class="shop-title-dot" aria-hidden="true">.</span></h2></div><label class="shop-category-label"><span>Explorar por</span><select class="shop-category" aria-label="Filtrar produtos por categoria">${categories.map(value => `<option value="${esc(value)}"${value === category ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select></label></div><div class="shop-product-grid">${renderProductCards(products.filter(product => category === 'Todos' || product.category === category), {preview})}</div><div class="shop-empty"${products.length ? ' hidden' : ''}>Nossa próxima coleção está chegando. Volte em breve.</div></section>`;
  const about = `<section class="shop-about" id="about" data-design-section="about"><div><p class="shop-section-kicker">Por trás da marca</p><h2>Prazer, ${esc(name)}<span class="shop-title-dot" aria-hidden="true">.</span></h2></div><div><p>${esc(description)}</p><a href="#collection" class="shop-about-link">Encontre algo que é a sua cara ${arrow}</a></div></section>`;
  const sections = {hero, products: catalog, about};
  return `<div id="store-top" class="design-store real-store preset-${design.preset} font-${design.font} cards-${design.cardStyle}${preview ? ' is-preview' : ''}" data-preset="${design.preset}" style="--shop-bg:${design.background};--shop-fg:${contrastColor(design.background)};--shop-accent:${design.accent};--accent-fg:${contrastColor(design.accent)};--store-radius:${design.radius}px;--store-columns:${design.gridColumns}">
    ${design.announcementEnabled && design.announcement ? `<div class="shop-topline" data-design-section="hero">${esc(design.announcement)}</div>` : ''}
    <header class="shop-header"><a class="shop-wordmark${design.logoUrl ? ' has-logo' : ''}" href="${esc(storeHref)}" aria-label="${esc(name)}, início">${logo}</a><nav class="shop-nav" aria-label="Navegação da loja"><a href="#collection">Coleção</a>${design.sections.some(section => section.id === 'about' && section.visible) ? '<a href="#about">Nossa história</a>' : ''}</nav><div class="shop-header-actions"><a href="painel.html?compras=1" class="shop-orders-link">Meus pedidos</a><button class="shop-bag-button" type="button" aria-label="Abrir sacola">${bagIcon}<span class="shop-bag-label">Sacola</span><span class="shop-bag-count">0</span></button></div></header>
    <div class="store-alert" role="status" aria-live="polite"></div>
    <div class="shop-main">${design.sections.filter(section => section.visible).map(section => sections[section.id]).join('')}</div>
    <footer class="shop-footer"><div><a class="shop-footer-brand" href="#store-top">${esc(name)}</a><span>Uma marca independente. Do seu jeito.</span></div><a class="shop-platform-link" href="lojas.html">feito com <strong>camizetas<span>.</span></strong> ${arrow}</a></footer>
  </div>`;
}
