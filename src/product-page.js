import {resolveDesign, contrastColor, safeImageURL} from './design.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const bag='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>';
const arrow='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>';

export function productPhotos(product={}) {
  const gallery=Array.isArray(product.image_urls)?product.image_urls:[];
  const photos=[product.image_url,...gallery].map(url=>safeImageURL(url)).filter(Boolean);
  return [...new Set(photos)].slice(0,10).length?[...new Set(photos)].slice(0,10):['assets/product-placeholder.svg'];
}

function pageFrame(store,body) {
  const design=resolveDesign(store),name=store.name||'Loja independente';
  const href=`loja.html?loja=${encodeURIComponent(store.slug||'')}`;
  return `<div id="store-top" class="design-store real-store product-page preset-${design.preset} font-${design.font} cards-${design.cardStyle}" data-preset="${design.preset}" style="--shop-bg:${design.background};--shop-fg:${contrastColor(design.background)};--shop-accent:${design.accent};--accent-fg:${contrastColor(design.accent)};--store-radius:${design.radius}px;--store-columns:4">
    ${design.announcementEnabled&&design.announcement?`<div class="shop-topline">${esc(design.announcement)}</div>`:''}
    <header class="shop-header"><a class="shop-wordmark${design.logoUrl?' has-logo':''}" href="${esc(href)}" data-product-back aria-label="${esc(name)}, início">${design.logoUrl?`<img class="shop-logo" src="${esc(design.logoUrl)}" alt="${esc(name)}">`:esc(name)}</a><nav class="shop-nav" aria-label="Navegação da loja"><a href="${esc(href)}#collection" data-product-back>Explorar a coleção</a></nav><div class="shop-header-actions"><a href="painel.html?compras=1" class="shop-orders-link">Meus pedidos</a><button class="shop-bag-button" type="button" aria-label="Abrir sacola">${bag}<span class="shop-bag-label">Sacola</span><span class="shop-bag-count">0</span></button></div></header>
    <div class="store-alert" role="status" aria-live="polite"></div>${body}
    <footer class="shop-footer product-page-footer"><div><a class="shop-footer-brand" href="${esc(href)}" data-product-back>${esc(name)}</a><span>Uma marca independente. Do seu jeito.</span></div><a class="shop-platform-link" href="lojas.html">feito com <strong>camizetas<span>.</span></strong> ↗</a></footer>
  </div>`;
}

export function renderProductUnavailable(store,backHref) {
  return pageFrame(store,`<section class="product-unavailable"><p class="product-eyebrow">PEÇA INDISPONÍVEL</p><h1>Essa peça não está na vitrine.</h1><p>Ela pode ter saído do catálogo ou o endereço pode ter mudado.</p><a href="${esc(backHref)}" data-product-back>${arrow} Voltar para a loja</a></section>`);
}

export function renderProductPage(store,product,{backHref,collection=null}={}) {
  const photos=productPhotos(product),variants=(Array.isArray(product.variants)?product.variants:[]).filter(v=>v.active!==false);
  const available=variants.some(v=>Number.isInteger(v.on_hand)&&v.on_hand>0);
  const name=product.name||'Peça da coleção',description=product.description||'';
  const storeHref=`loja.html?loja=${encodeURIComponent(store.slug)}`;
  backHref=backHref||storeHref;
  return pageFrame(store,`<nav class="product-breadcrumb" aria-label="Navegação do produto"><a href="${esc(backHref)}" data-product-back>${arrow} ${collection?`Voltar para ${esc(collection.name)}`:'Voltar para a loja'}</a><span>${esc(product.category||'Coleção')} <span aria-hidden="true">/</span> <span aria-current="page">${esc(name)}</span></span></nav>
    <section class="product-detail" aria-labelledby="product-title">
      <div class="product-gallery" aria-label="Fotos do produto"><div class="product-image-stage"><button type="button" class="product-zoom-trigger" aria-label="Ampliar foto de ${esc(name)}"><img class="product-main-image" src="${esc(photos[0])}" alt="${esc(name)} — foto 1 de ${photos.length}" fetchpriority="high" decoding="async"></button><div class="product-photo-meta"><span class="product-photo-count" aria-live="polite">01 / ${String(photos.length).padStart(2,'0')}</span><span aria-hidden="true">Ampliar ↗</span></div>${photos.length>1?'<div class="product-gallery-controls"><button class="product-gallery-prev" type="button" aria-label="Foto anterior">←</button><button class="product-gallery-next" type="button" aria-label="Próxima foto">→</button></div>':''}</div>${photos.length>1?`<div class="product-thumbnails" aria-label="Escolher foto">${photos.map((url,index)=>`<button type="button" data-photo="${index}" class="${index===0?'is-active':''}" aria-label="Ver foto ${index+1}" aria-pressed="${index===0}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`:''}</div>
      <div class="product-summary"><p class="product-eyebrow">${esc(store.name)} <span aria-hidden="true">/</span> ${esc(product.category||'Coleção')}</p><h1 id="product-title" class="product-title" tabindex="-1">${esc(name)}</h1>${store.reviews_enabled===true?'<a class="product-rating-link" href="#product-reviews" hidden></a>':''}<p class="product-price">${price(product.price_cents)}</p>${description?`<p class="product-description-short">${esc(description.length>220?description.slice(0,217)+'…':description)}</p><a class="product-description-link" href="#product-details">Todos os detalhes ↓</a>`:''}
        <form id="product-choice"><label class="product-variant-label">Tamanho e cor<select name="variant" required ${!available?'disabled':''}>${variants.map(v=>`<option value="${esc(v.id)}" ${!Number.isInteger(v.on_hand)||v.on_hand<1?'disabled':''}>${esc([v.size,v.color].filter(Boolean).join(' / ')||v.sku||'Única')}${!Number.isInteger(v.on_hand)||v.on_hand<1?' — esgotada':''}</option>`).join('')}</select></label><div class="product-variant-options" aria-label="Variações disponíveis">${variants.map(v=>`<button type="button" data-variant="${esc(v.id)}" aria-pressed="false" ${!Number.isInteger(v.on_hand)||v.on_hand<1?'disabled':''}>${esc([v.size,v.color].filter(Boolean).join(' / ')||'Única')}</button>`).join('')}</div><div class="product-purchase-row"><label class="product-quantity-label">Quantidade<input type="number" name="quantity" value="1" min="1" max="99" step="1" inputmode="numeric" required></label><p class="product-stock" id="variant-stock" role="status"></p></div><button class="product-add-button" type="submit" ${!available?'disabled':''}>${available?'Adicionar à sacola ↗':'Peça esgotada'}</button><p class="product-feedback" role="status" aria-live="polite"></p><div class="product-added" hidden><span>Já está na sua sacola.</span><button type="button" class="product-open-bag">Ver minha sacola ↗</button></div></form><p class="product-service-note">Pagamento, frete e entrega são combinados diretamente com a loja após o envio do pedido.</p>
      </div>
    </section>
    ${description?`<section class="product-details-section" id="product-details"><div class="product-section-heading"><p class="product-eyebrow">DE PERTO</p><h2>Os detalhes fazem a peça.</h2></div><div class="product-details-copy">${esc(description)}</div></section>`:''}
    ${store.reviews_enabled===true?`<section class="product-reviews-section" id="product-reviews" aria-labelledby="product-reviews-title"><div class="product-section-heading"><p class="product-eyebrow">QUEM JÁ VESTIU</p><h2 id="product-reviews-title">Avaliações da peça.</h2><p>Opiniões de compradores com pedido concluído.</p></div><div class="product-reviews-content" aria-live="polite"><p>Buscando avaliações…</p></div><div class="product-review-context"></div></section>`:''}
    <section class="product-related-section" aria-labelledby="product-related-title" hidden><div class="product-related-heading"><div><p class="product-eyebrow">NO MESMO UNIVERSO</p><h2 id="product-related-title">Continue a coleção.</h2></div><div class="product-collection-links"></div></div><div class="product-related-grid"></div></section>`);
}
