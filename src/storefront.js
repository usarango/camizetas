import {api,money,escapeHTML as esc} from './data.js';
import {renderStoreShell,renderProductCards} from './store-layout.js';
import {renderProductPage,renderProductUnavailable,productPhotos} from './product-page.js';
const routeParams=new URLSearchParams(location.search);
const slug=routeParams.get('loja');
const collectionSlug=routeParams.get('colecao');
const hasCollectionRoute=routeParams.has('colecao');
const mount=document.querySelector('#standalone-store');
const approvedThemes=['chic','underground','rock','nerd'];
const validColor=(value,fallback)=>/^#[a-f\d]{6}$/i.test(value||'')?value:fallback;
const imageURL=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:'assets/product-placeholder.svg'}catch{return 'assets/product-placeholder.svg'}};
function contrast(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#000000':'#ffffff'}
const readJSON=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem(key)||'null')??fallback}catch{return fallback}};
let store,products=[],collections=[],activeCollection=null,cart=[],pending=null,busy=false,currentUser=null,category='Todos',modal=null,modalVersion=0;
let productViewVersion=0,reviewContextVersion=0,reviewAuthEpoch=0,reviewUserId=null,refreshProductChoice=null;
const itemVariant=id=>{for(const product of products){const variant=(product.variants||[]).find(v=>v.id===id);if(variant)return {product,variant}}return null};
const activeVariant=v=>v.active!==false&&Number.isInteger(v.on_hand)&&v.on_hand>0;
const stockMessage='A disponibilidade mudou. Confira sua sacola antes de enviar o pedido.';
function saveCart(){try{localStorage.setItem(`cz-cart:${store.id}`,JSON.stringify(cart))}catch{}updateCount();refreshProductChoice?.()}
function loadCart(){const rows=readJSON(localStorage,`cz-cart:${store.id}`,[]);cart=Array.isArray(rows)?rows.filter(x=>x&&typeof x.variant_id==='string'&&Number.isInteger(x.quantity)&&x.quantity>0&&x.quantity<=99):[];pending=readJSON(sessionStorage,`cz-checkout:${store.id}`,null);if(pending&&(!pending.key||typeof pending.userId!=='string'||!pending.userId||!Array.isArray(pending.items)||!pending.customer)){pending=null;try{sessionStorage.removeItem(`cz-checkout:${store.id}`)}catch{}}}
function storePending(value){pending=value;try{if(value)sessionStorage.setItem(`cz-checkout:${store.id}`,JSON.stringify(value));else sessionStorage.removeItem(`cz-checkout:${store.id}`)}catch{}}
function updateCount(){const el=mount.querySelector('.shop-bag-count');if(el)el.textContent=String(cart.reduce((n,i)=>n+i.quantity,0))}
function alert(text){const el=mount.querySelector('.store-alert');if(el)el.textContent=text}
function pendingNotice(){alert('Há um pedido aguardando confirmação de envio. Abra sua sacola e tente o mesmo envio para evitar duplicatas.');openCart()}
function openModal(content){if(modal?.open)modal.close();modal?.remove();modal=document.createElement('dialog');modal.className='shop-modal';modal.innerHTML=`<button class="shop-modal-close" aria-label="Fechar">×</button>${content}`;document.body.append(modal);modal.querySelector('.shop-modal-close').onclick=()=>{if(!busy)modal.close()};modal.addEventListener('cancel',e=>{if(busy)e.preventDefault()});modal.addEventListener('click',e=>{if(e.target===modal&&!busy){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close()}});modal.showModal();modalVersion++;return modal}
function setMessage(dialog,text,isError=false){const el=dialog.querySelector('.message');if(el){el.textContent=text;el.classList.toggle('error',isError)}}
let ownerBarVersion=0;
async function refreshOwnerBar(){if(!store||!mount||typeof api.getManagedStore!=='function')return;const version=++ownerBarVersion;try{const managed=await api.getManagedStore(store.id);if(version!==ownerBarVersion)return;mount.querySelector('.store-ownerbar')?.remove();if(!managed||managed.id!==store.id)return;const bar=document.createElement('div');bar.className='store-ownerbar';bar.innerHTML=`<span>Você está vendo a sua loja.</span><a href="painel.html?loja=${encodeURIComponent(store.id)}&espaco=1">Personalizar minha loja ↗</a><a href="painel.html?loja=${encodeURIComponent(store.id)}&colecoes=1">Gerenciar coleções ↗</a>`;mount.prepend(bar)}catch{if(version===ownerBarVersion)mount.querySelector('.store-ownerbar')?.remove()}}
function visibleProducts(){
  const catalogue=products.filter(product=>product&&product.active!==false);
  if(!hasCollectionRoute)return catalogue;
  if(!activeCollection)return [];
  const byId=new Map(catalogue.map(product=>[product.id,product]));
  return [...new Set(activeCollection.product_ids)].map(id=>byId.get(id)).filter(Boolean);
}
function render(){
  const params=new URLSearchParams(location.search);
  if(params.has('produto')){renderProductRoute(params.get('produto'));return}
  document.body.classList.remove('product-detail-open');
  productViewVersion++;reviewContextVersion++;reviewUserId=null;refreshProductChoice=null;
  document.title=`${activeCollection?activeCollection.name+' — ':''}${store.name} — Camizetas`;
  const viewProducts=visibleProducts();
  if(category!=='Todos'&&!viewProducts.some(product=>product.category===category))category='Todos';
  mount.innerHTML=renderStoreShell(store,{products:viewProducts,collections,activeCollection,category});
  mount.querySelector('.shop-category').onchange=e=>{category=e.target.value;renderProducts()};
  mount.querySelector('.shop-bag-button').onclick=openCart;
  const collectionSelect=mount.querySelector('.shop-collection');
  if(collectionSelect)collectionSelect.onchange=()=>navigateToCollection(collectionSelect.value);
  renderProducts();updateCount();refreshOwnerBar();
  mount.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src='assets/product-placeholder.svg'});
}
function navigateToCollection(value){
  if(value&&!collections.some(collection=>collection.slug===value&&collection.active!==false))return;
  const destination=new URL('loja.html',location.href);
  destination.searchParams.set('loja',store.slug);
  for(const key of ['utm_source','utm_medium','utm_campaign','ref']){
    const original=routeParams.get(key);
    if(original&&original.length<=200)destination.searchParams.set(key,original);
  }
  if(value)destination.searchParams.set('colecao',value);
  saveCart();
  location.assign(destination.href);
}
function renderProducts(){
  const viewProducts=visibleProducts();
  const list=viewProducts.filter(product=>category==='Todos'||product.category===category);
  mount.querySelector('.shop-product-grid').innerHTML=renderProductCards(list);
  const empty=mount.querySelector('.shop-empty');
  empty.hidden=list.length>0;
  empty.textContent=viewProducts.length?'Nenhum produto nesta categoria por enquanto.':activeCollection?'Esta coleção ainda não tem peças disponíveis. Confira as outras peças da loja.':'Nossa próxima coleção está chegando. Volte em breve.';
  mount.querySelectorAll('[data-product]').forEach(button=>button.onclick=()=>openProduct(button.dataset.product));
  mount.querySelectorAll('.shop-product-photo img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src='assets/product-placeholder.svg'});
}
/* Product pages are rendered in the document, keeping the complete store catalogue for the cart. */
function productRouteURL(id=null){
  const url=new URL('loja.html',location.href);url.searchParams.set('loja',store.slug);
  if(hasCollectionRoute&&collectionSlug)url.searchParams.set('colecao',collectionSlug);
  for(const key of ['utm_source','utm_medium','utm_campaign','ref']){const value=routeParams.get(key);if(value&&value.length<=200)url.searchParams.set(key,value)}
  if(id!==null)url.searchParams.set('produto',id);
  return url;
}
function closeProductModal(){if(modal?.open)modal.close();modal?.remove();modal=null;modalVersion++}
function openProduct(id){
  if(busy)return;
  const product=products.find(p=>p.id===id&&p.active!==false&&(!p.store_id||p.store_id===store.id));if(!product)return;
  closeProductModal();saveCart();history.pushState({camizetasProduct:true},'',productRouteURL(id).href);render();
  document.querySelector('#product-title')?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
}
function backToCatalogue(event){
  if(event&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button>0))return;
  if(event&&hasCollectionRoute&&!new URL(event.currentTarget.href,location.href).searchParams.has('colecao'))return;
  event?.preventDefault();if(busy)return;
  closeProductModal();history.pushState({camizetasProduct:false},'',productRouteURL().href);render();window.scrollTo({top:0,behavior:'instant'});
}
function productViewCurrent(id,version){return version===productViewVersion&&new URLSearchParams(location.search).get('produto')===id&&!!mount.querySelector('.product-page')}
function bindProductImages(root){root.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src='assets/product-placeholder.svg'})}
function renderProductRoute(id){
  document.body.classList.add('product-detail-open');
  const version=++productViewVersion;reviewContextVersion++;reviewUserId=null;refreshProductChoice=null;
  const product=products.find(p=>p.id===id&&p.active!==false&&(!p.store_id||p.store_id===store.id));
  const backHref=productRouteURL().pathname+productRouteURL().search;
  if(!product){mount.innerHTML=renderProductUnavailable(store,backHref);document.title=`Peça indisponível — ${store.name} — Camizetas`;mount.querySelectorAll('[data-product-back]').forEach(link=>link.onclick=backToCatalogue);mount.querySelector('.shop-bag-button').onclick=openCart;updateCount();refreshOwnerBar();return}
  document.title=`${product.name} — ${store.name} — Camizetas`;
  mount.innerHTML=renderProductPage(store,product,{backHref,collection:activeCollection});
  mount.querySelectorAll('[data-product-back]').forEach(link=>link.onclick=backToCatalogue);
  mount.querySelector('.shop-bag-button').onclick=openCart;
  bindProductGallery(product,version);bindProductPurchase(product,version);bindProductImages(mount);updateCount();refreshOwnerBar();
  loadRelatedProducts(product,version);
  if(store.reviews_enabled===true){loadProductReviews(product,version);loadProductReviewContext(product,version)}
}
function bindProductGallery(product,version){
  const photos=productPhotos(product);let index=0;
  const setPhoto=value=>{if(!productViewCurrent(product.id,version))return;index=(value+photos.length)%photos.length;const image=mount.querySelector('.product-main-image');image.src=photos[index];image.alt=`${product.name} — foto ${index+1} de ${photos.length}`;mount.querySelector('.product-photo-count').textContent=`${String(index+1).padStart(2,'0')} / ${String(photos.length).padStart(2,'0')}`;mount.querySelectorAll('[data-photo]').forEach(button=>{const selected=Number(button.dataset.photo)===index;button.classList.toggle('is-active',selected);button.setAttribute('aria-pressed',String(selected))})};
  mount.querySelectorAll('[data-photo]').forEach(button=>button.onclick=()=>setPhoto(Number(button.dataset.photo)));
  mount.querySelector('.product-gallery-prev')?.addEventListener('click',()=>setPhoto(index-1));mount.querySelector('.product-gallery-next')?.addEventListener('click',()=>setPhoto(index+1));
  mount.querySelector('.product-zoom-trigger').onclick=()=>{
    const dialog=openModal(`<button type="button" class="product-lightbox-prev" aria-label="Foto anterior" ${photos.length<2?'hidden':''}>←</button><img class="product-lightbox-image" src="${esc(photos[index])}" alt="${esc(product.name)}"><button type="button" class="product-lightbox-next" aria-label="Próxima foto" ${photos.length<2?'hidden':''}>→</button><p class="product-lightbox-caption"></p>`);dialog.className='product-lightbox';dialog.setAttribute('aria-label',`Fotos de ${product.name}`);dialog.querySelector('.shop-modal-close').classList.add('product-lightbox-close');
    const update=value=>{setPhoto(value);dialog.querySelector('.product-lightbox-image').src=photos[index];dialog.querySelector('.product-lightbox-image').alt=`${product.name} — foto ${index+1} de ${photos.length}`;dialog.querySelector('.product-lightbox-caption').textContent=`${product.name} · ${index+1} / ${photos.length}`};
    dialog.querySelector('.product-lightbox-prev').onclick=()=>update(index-1);dialog.querySelector('.product-lightbox-next').onclick=()=>update(index+1);dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();update(index-1)}if(event.key==='ArrowRight'){event.preventDefault();update(index+1)}});bindProductImages(dialog);update(index);
  };
}
function bindProductPurchase(product,version){
  const variants=(product.variants||[]).filter(v=>v.active!==false),available=variants.filter(activeVariant),form=mount.querySelector('#product-choice');
  if(available.length)form.elements.variant.value=available[0].id;
  const feedback=text=>{const el=form.querySelector('.product-feedback');el.textContent=text;el.classList.toggle('error',!!text)};
  const update=()=>{const variant=variants.find(v=>v.id===form.elements.variant.value),inBag=cart.find(i=>i.variant_id===variant?.id)?.quantity||0,limit=Math.max(0,Math.min(99,(variant?.on_hand||0)-inBag));form.elements.quantity.max=String(limit||1);form.querySelector('#variant-stock').textContent=limit?`${limit} unidade(s) disponível(is) para adicionar.`:'Esta variação já está toda na sua sacola ou está esgotada.';form.querySelector('[type=submit]').disabled=limit<1;form.querySelectorAll('[data-variant]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.variant===variant?.id)))};
  refreshProductChoice=()=>{if(productViewCurrent(product.id,version))update()};
  form.elements.variant.onchange=()=>{feedback('');update()};form.querySelectorAll('[data-variant]').forEach(button=>button.onclick=()=>{form.elements.variant.value=button.dataset.variant;feedback('');update()});update();
  form.querySelector('.product-open-bag').onclick=openCart;
  form.onsubmit=event=>{event.preventDefault();if(!productViewCurrent(product.id,version)||busy)return;if(pending){pendingNotice();return}const id=form.elements.variant.value,variant=variants.find(v=>v.id===id),quantity=Number(form.elements.quantity.value),existing=cart.find(item=>item.variant_id===id);if(!variant||!activeVariant(variant)||!Number.isInteger(quantity)||quantity<1||quantity+(existing?.quantity||0)>Math.min(99,variant.on_hand)){feedback('Escolha uma quantidade disponível.');return}if(existing)existing.quantity+=quantity;else cart.push({variant_id:id,quantity});saveCart();feedback('');form.querySelector('.product-added').hidden=false;alert(`${product.name} foi adicionada à sacola.`);update()};
}
async function loadRelatedProducts(product,version){
  let memberships=[];
  try{if(typeof api.getProductCollections==='function')memberships=await api.getProductCollections(store.id,product.id);else if(activeCollection?.product_ids?.includes(product.id))memberships=[activeCollection]}catch{return}
  if(!productViewCurrent(product.id,version))return;
  const groups=(Array.isArray(memberships)?memberships:[]).filter(group=>group&&group.active!==false&&(!group.store_id||group.store_id===store.id)&&Array.isArray(group.product_ids)&&group.product_ids.includes(product.id));
  groups.sort((a,b)=>Number(b.slug===activeCollection?.slug)-Number(a.slug===activeCollection?.slug));
  const candidates=new Map(products.filter(item=>item.id!==product.id&&item.active!==false&&(!item.store_id||item.store_id===store.id)).map(item=>[item.id,item]));
  const related=[...new Set(groups.flatMap(group=>group.product_ids))].map(id=>candidates.get(id)).filter(Boolean).slice(0,4);
  if(!related.length)return;
  const section=mount.querySelector('.product-related-section');section.hidden=false;section.querySelector('.product-related-grid').innerHTML=renderProductCards(related);section.querySelectorAll('[data-product]').forEach(button=>button.onclick=()=>openProduct(button.dataset.product));section.querySelector('.product-collection-links').innerHTML=groups.slice(0,3).map(group=>`<a href="loja.html?loja=${encodeURIComponent(store.slug)}&amp;colecao=${encodeURIComponent(group.slug)}">${esc(group.name)} ↗</a>`).join('');bindProductImages(section);
}
function reviewDate(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}):''}
async function loadProductReviews(product,version){
  const target=mount.querySelector('.product-reviews-content');if(!target)return;
  try{
    if(typeof api.getProductReviews!=='function'){target.innerHTML='<p>As avaliações estarão disponíveis em breve.</p>';return}
    const result=await api.getProductReviews(store.id,product.id);if(!productViewCurrent(product.id,version))return;
    if(result?.available===false){target.innerHTML='<p>As avaliações estarão disponíveis em breve.</p>';return}
    const rows=(Array.isArray(result?.reviews)?result.reviews:[]).filter(row=>row&&Number.isInteger(row.rating)&&row.rating>=1&&row.rating<=5);
    const total=Number.isSafeInteger(Number(result?.summary?.count))&&Number(result.summary.count)>=0?Number(result.summary.count):rows.length;
    const rawAverage=Number(result?.summary?.average),average=total&&Number.isFinite(rawAverage)&&rawAverage>=1&&rawAverage<=5?rawAverage:rows.length?rows.reduce((sum,row)=>sum+row.rating,0)/rows.length:0;
    const score=average.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
    const ratingLink=mount.querySelector('.product-rating-link');if(total){ratingLink.hidden=false;ratingLink.textContent=`${score} / 5 · ${total} ${total===1?'avaliação':'avaliações'}`}
    target.innerHTML=`<div class="product-reviews-layout"><aside class="product-review-score"><strong>${total?esc(score):'—'}</strong><span>${total?'de 5':'Ainda sem nota'}</span><p>${total?`${total} ${total===1?'avaliação':'avaliações'} de compradores`:'Seja a primeira pessoa a contar como foi.'}</p></aside><div class="product-review-list">${rows.length?rows.map(row=>`<article class="product-review"><div class="product-review-meta"><span class="review-rating" aria-label="Nota ${row.rating} de 5">${row.rating} / 5</span><time class="review-date">${esc(reviewDate(row.created_at))}</time></div>${row.title?`<h3 class="review-title">${esc(row.title)}</h3>`:''}<p class="review-body">${esc(row.body||'')}</p><div class="review-author">${esc(row.author_name||'Comprador')} <small class="review-verified">Compra verificada</small></div></article>`).join(''):'<p class="product-review-empty">As primeiras histórias com essa peça começam aqui.</p>'}</div></div>`;
  }catch(error){if(productViewCurrent(product.id,version))target.innerHTML=`<p role="status">Não foi possível carregar as avaliações. <button type="button" class="product-review-retry">Tentar novamente</button></p>`;target.querySelector('.product-review-retry')?.addEventListener('click',()=>loadProductReviews(product,version))}
}
async function loadProductReviewContext(product,version){
  const contextVersion=++reviewContextVersion,authEpoch=reviewAuthEpoch,target=mount.querySelector('.product-review-context');if(!target)return;
  const current=()=>productViewCurrent(product.id,version)&&contextVersion===reviewContextVersion&&authEpoch===reviewAuthEpoch;
  target.innerHTML='<p class="product-review-context-status" role="status">Conferindo sua conta…</p>';
  try{
    const user=await api.authUser();if(!current())return;reviewUserId=user?.id||null;
    if(!user){target.innerHTML='<div class="review-context-box"><h3>Já tem essa peça?</h3><p>Entre na sua conta Camizetas para avaliar um produto de um pedido concluído.</p><a href="painel.html?compras=1">Entrar na minha conta ↗</a></div>';return}
    if(typeof api.getProductReviewContext!=='function'){target.innerHTML='';return}
    const context=await api.getProductReviewContext(product.id);if(!current())return;
    const contextUser=await api.authUser();if(!current())return;if(contextUser?.id!==user.id){reviewContextVersion++;target.innerHTML='<p role="status">Sua conta mudou. Confira sua sessão antes de avaliar.</p>';return}
    if(!context?.can_review){target.innerHTML=`<div class="review-context-box"><p>${esc(context?.reason||'Você poderá avaliar esta peça quando seu pedido estiver concluído.')}</p><a href="painel.html?compras=1">Acompanhar meus pedidos ↗</a></div>`;return}
    const own=context.my_review||{};
    target.innerHTML=`<div class="product-review-form"><div><p class="product-eyebrow">SUA EXPERIÊNCIA CONTA</p><h3>${own.id?'Atualize sua avaliação.':'Como foi vestir essa peça?'}</h3><p>Sua opinião aparece com o nome que você escolher abaixo.</p></div><form id="product-review-form"><label>Como você avalia esta peça?<select name="rating" required><option value="">Selecione uma nota</option>${[5,4,3,2,1].map(value=>`<option value="${value}" ${own.rating===value?'selected':''}>${value} / 5${value===5?' — Adorei':value===1?' — Não gostei':''}</option>`).join('')}</select></label><label>Nome público<input name="author_name" value="${esc(own.author_name||'')}" required minlength="2" maxlength="60" autocomplete="nickname" placeholder="Como você quer aparecer"></label><label>Título<input name="title" value="${esc(own.title||'')}" maxlength="120" placeholder="Resuma sua experiência"></label><label>Sua avaliação<textarea name="body" required minlength="20" maxlength="2000" rows="4" placeholder="Conte sobre o caimento, o tecido e os detalhes da peça.">${esc(own.body||'')}</textarea><small>De 20 a 2.000 caracteres.</small></label><button type="submit">${own.id?'Salvar avaliação':'Publicar minha avaliação'} ↗</button><p class="review-feedback" role="status"></p></form></div>`;
    const form=target.querySelector('form'),userId=user.id;
    form.onsubmit=async event=>{
      event.preventDefault();if(!current()||form.getAttribute('aria-busy')==='true')return;
      const feedback=form.querySelector('.review-feedback'),button=form.querySelector('[type=submit]');feedback.textContent='';feedback.classList.remove('error');form.setAttribute('aria-busy','true');button.disabled=true;
      try{
        const verifiedUser=await api.authUser();if(!current())return;if(verifiedUser?.id!==userId){reviewContextVersion++;target.innerHTML='<p role="status">Sua conta mudou. Confira sua sessão antes de avaliar.</p>';return}
        const data=Object.fromEntries(new FormData(form)),rating=Number(data.rating),body=String(data.body||'').trim(),authorName=String(data.author_name||'').trim();
        if(!Number.isInteger(rating)||rating<1||rating>5||body.length<20||body.length>2000||authorName.length<2||authorName.length>60)throw new Error('Escolha uma nota, um nome público e escreva uma avaliação de pelo menos 20 caracteres.');
        await api.saveProductReview(product.id,{rating,title:String(data.title||'').trim(),body,author_name:authorName});
        const responseUser=await api.authUser();if(!current()||responseUser?.id!==userId)return;
        feedback.textContent='Sua avaliação foi salva. Obrigado por compartilhar.';button.textContent='Salvar avaliação ↗';loadProductReviews(product,version);
      }catch(error){if(current()){feedback.textContent=error.message||'Não foi possível salvar sua avaliação.';feedback.classList.add('error')}}finally{if(current()){form.removeAttribute('aria-busy');button.disabled=false}}
    };
  }catch(error){if(current())target.innerHTML=`<p class="product-review-context-status" role="status">Não foi possível conferir sua permissão para avaliar. <button type="button" class="product-review-context-retry">Tentar novamente</button></p>`;target.querySelector('.product-review-context-retry')?.addEventListener('click',()=>loadProductReviewContext(product,version))}
}

function cartRows(){return cart.map(item=>{const found=itemVariant(item.variant_id);return {...item,...found}})}
function validateCart(){if(!cart.length)return 'Sua sacola está vazia.';for(const row of cartRows()){if(!row.product||!row.variant||row.product.active===false||row.variant.active===false||row.quantity>row.variant.on_hand)return stockMessage}return ''}
function openCart(){const rows=cartRows(),total=rows.reduce((n,row)=>n+(row.product?.price_cents||0)*row.quantity,0);const issue=validateCart();const dialog=openModal(`<h2>Sua sacola.</h2><p class="shop-modal-intro">${esc(store.name)} · ${cart.reduce((n,i)=>n+i.quantity,0)} peça(s)</p><div class="cart-lines">${rows.length?rows.map(row=>`<div class="shop-line-item"><img src="${esc(imageURL(row.product?.image_url))}" alt=""><div><h3>${esc(row.product?.name||'Produto indisponível')}</h3><p>${esc([row.variant?.size,row.variant?.color].filter(Boolean).join(' / '))}</p><strong>${money((row.product?.price_cents||0)*row.quantity)}</strong></div><div class="shop-line-controls"><button data-change="-1" data-id="${esc(row.variant_id)}" aria-label="Diminuir quantidade" ${pending?'disabled':''}>−</button><span>${row.quantity}</span><button data-change="1" data-id="${esc(row.variant_id)}" aria-label="Aumentar quantidade" ${pending||row.quantity>=(row.variant?.on_hand||0)||row.quantity>=99?'disabled':''}>+</button><button class="line-remove" data-remove="${esc(row.variant_id)}" ${pending?'disabled':''}>Remover</button></div></div>`).join(''):'<p class="shop-modal-intro">Escolha as peças que combinam com você.</p>'}</div>${rows.length?`<div class="cart-summary"><span>Produtos</span><span>${money(total)}</span></div><p class="checkout-hint">O envio deste pedido não realiza cobrança. Pagamento e entrega serão combinados com a loja; frete não está incluído neste total.</p><button class="cz-button" id="start-checkout" ${issue&&!pending?'disabled':''}>${pending?'Retomar envio do pedido':'Continuar para o pedido'} ↗</button>`:''}<p class="message ${issue?'error':''}" role="status">${esc(pending?'Um envio anterior está sem confirmação. Vamos repetir a mesma solicitação com segurança.':issue)}</p>`);dialog.querySelectorAll('[data-change]').forEach(b=>b.onclick=()=>{if(pending)return;const item=cart.find(i=>i.variant_id===b.dataset.id);const variant=itemVariant(b.dataset.id)?.variant;const next=item.quantity+Number(b.dataset.change);if(next<1)cart=cart.filter(i=>i!==item);else if(variant&&next<=Math.min(99,variant.on_hand))item.quantity=next;saveCart();openCart()});dialog.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(pending)return;cart=cart.filter(i=>i.variant_id!==b.dataset.remove);saveCart();openCart()});dialog.querySelector('#start-checkout')?.addEventListener('click',()=>beginCheckout())}
async function beginCheckout(){if(busy)return;const version=modalVersion;try{currentUser=await api.authUser();if(version!==modalVersion||!modal?.open)return;if(!currentUser){openAuth();return}openCheckout()}catch(error){if(version===modalVersion&&modal?.open)setMessage(modal,error.message||'Não foi possível verificar sua conta.',true)}}
function openAuth(mode='signin'){const signup=mode==='signup';const dialog=openModal(`<h2>${signup?'Crie sua conta.':'Entre para enviar seu pedido.'}</h2><p class="shop-modal-intro">Sua conta é da Camizetas, com e-mail e senha. Ela permite acompanhar seus pedidos.</p><div class="auth-switch"><button data-mode="signin" class="${!signup?'active':''}">Já tenho conta</button><button data-mode="signup" class="${signup?'active':''}">Criar conta</button></div><form id="buyer-auth"><label>E-mail<input type="email" name="email" required autocomplete="email"></label><label>Senha<input type="password" name="password" required minlength="8" maxlength="128" autocomplete="${signup?'new-password':'current-password'}"></label><button class="cz-button" type="submit">${signup?'Criar conta':'Entrar e continuar'} ↗</button><p class="message" role="status"></p></form>`);dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(!busy)openAuth(b.dataset.mode)});dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy)return;const form=e.target,submit=form.querySelector('[type=submit]'),email=form.elements.email.value.trim(),password=form.elements.password.value;busy=true;submit.disabled=true;setMessage(dialog,'Verificando sua conta…');try{if(signup){const result=await api.signUp(email,password);if(result?.needsConfirmation){setMessage(dialog,'Confira seu e-mail e confirme a conta. Depois, volte e entre para concluir seu pedido.');return}}else await api.signIn(email,password);currentUser=await api.authUser();if(!currentUser){setMessage(dialog,'Conta criada. Entre com seu e-mail e senha para continuar.');return}busy=false;openCheckout()}catch(error){setMessage(dialog,error.message||'Não foi possível acessar sua conta.',true)}finally{busy=false;if(submit.isConnected)submit.disabled=false}}}
function openPendingAccountGate(){const dialog=openModal('<h2>Entre na conta original.</h2><p class="shop-modal-intro">Há um envio de pedido vinculado a outra sessão. Para retomá-lo, entre na mesma conta usada no primeiro envio. Os dados desse pedido ficam ocultos nesta conta.</p><button class="cz-button" id="original-account">Entrar na conta original ↗</button><button class="cz-button secondary" id="return-shop">Voltar à loja</button><p class="message" role="status"></p>');dialog.querySelector('#return-shop').onclick=()=>dialog.close();dialog.querySelector('#original-account').onclick=async()=>{if(busy)return;busy=true;const button=dialog.querySelector('#original-account');button.disabled=true;try{await api.signOut();currentUser=null;busy=false;openAuth()}catch(error){setMessage(dialog,error.message||'Não foi possível trocar de conta.',true)}finally{busy=false;if(button.isConnected)button.disabled=false}}}
function openAccountChanged(){const dialog=openModal('<h2>Sua sessão mudou.</h2><p class="shop-modal-intro">Para proteger seus dados, este preenchimento foi fechado. Abra novamente a sacola e entre na conta que deseja usar para o pedido.</p><button class="cz-button" id="reopen-cart">Voltar à sacola ↗</button>');dialog.querySelector('#reopen-cart').onclick=openCart}
function watchCheckoutAccount(){if(typeof api.onAuthChange!=='function')return;const unsubscribe=api.onAuthChange((_event,user)=>{const previous=currentUser;currentUser=user||null;if(previous&&previous.id!==currentUser?.id&&modal?.open&&modal.querySelector('#checkout-form')){if(pending)openPendingAccountGate();else openAccountChanged()}});if(typeof unsubscribe==='function')window.addEventListener('pagehide',unsubscribe,{once:true})}
const field=(name,label,value='',attributes='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${attributes}></label>`;
function customerForm(customer={}){const a=customer.address||{};return `<div class="shop-form-grid"><div class="full">${field('name','Seu nome',customer.name,'required minlength="2" maxlength="120" autocomplete="name"')}</div><div class="full">${field('phone','Celular / WhatsApp',customer.phone,'required minlength="8" maxlength="24" type="tel" autocomplete="tel"')}</div><div>${field('postal_code','CEP',a.postal_code,'required maxlength="12" autocomplete="postal-code"')}</div><div>${field('state','UF',a.state,'required minlength="2" maxlength="2" autocomplete="address-level1"')}</div><div class="full">${field('street','Rua / avenida',a.street,'required maxlength="160" autocomplete="address-line1"')}</div><div>${field('number','Número',a.number,'required maxlength="20"')}</div><div>${field('complement','Complemento',a.complement,'maxlength="100"')}</div><div>${field('neighborhood','Bairro',a.neighborhood,'required maxlength="100"')}</div><div>${field('city','Cidade',a.city,'required maxlength="100" autocomplete="address-level2"')}</div><label class="full">Observações<textarea name="notes" rows="2" maxlength="500">${esc(customer.notes||'')}</textarea></label></div>`}
function openCheckout(){if(!currentUser){openAuth();return}if(pending&&pending.userId!==currentUser.id){openPendingAccountGate();return}const checkoutUserId=currentUser.id;const issue=validateCart();if(issue&&!pending){openCart();return}const customer=pending?.customer||{},dialog=openModal(`<h2>${pending?'Retomar seu pedido.':'Falta pouco para ser seu.'}</h2><p class="shop-modal-intro">${esc(store.name)} · seus dados serão compartilhados com esta loja para o atendimento do pedido.</p><form id="checkout-form">${customerForm(customer)}<div class="checkout-review"><p><strong>Produtos: ${money(cartRows().reduce((n,r)=>n+(r.product?.price_cents||0)*r.quantity,0))}</strong></p><p>Sem cobrança online. A loja combinará o pagamento, o frete e a entrega com você.</p></div>${pending?'<p class="checkout-hint">Este pedido já foi enviado, mas a confirmação não chegou. Os dados foram mantidos para repetir o mesmo envio sem criar outro pedido.</p>':''}<button class="cz-button" type="submit">${pending?'Repetir o mesmo envio':'Enviar pedido'} ↗</button><p class="message" role="status"></p></form>`);const form=dialog.querySelector('form');if(pending)form.querySelectorAll('input,textarea').forEach(el=>el.readOnly=true);form.onsubmit=async e=>{e.preventDefault();if(busy)return;const submit=form.querySelector('[type=submit]');busy=true;submit.disabled=true;setMessage(dialog,'Enviando seu pedido…');try{const verifiedUser=await api.authUser();if(!verifiedUser||verifiedUser.id!==checkoutUserId||(pending&&pending.userId!==verifiedUser.id)){currentUser=verifiedUser;busy=false;if(pending)openPendingAccountGate();else openAccountChanged();return}currentUser=verifiedUser;if(!pending){const data=Object.fromEntries(new FormData(form));const customer={name:data.name.trim(),phone:data.phone.trim(),address:Object.fromEntries(['street','number','complement','neighborhood','city','state','postal_code'].map(k=>[k,String(data[k]||'').trim()])),notes:data.notes.trim()};const key=crypto.randomUUID();storePending({key,userId:verifiedUser.id,items:cart.map(i=>({...i})),customer})}const submitted=pending,order=await api.placeOrder(store.id,submitted.items,submitted.customer,submitted.key);if(!order?.id)throw new Error('O servidor não confirmou o pedido. Tente novamente para consultar o mesmo envio.');const responseUser=await api.authUser();currentUser=responseUser;if(!responseUser||responseUser.id!==submitted.userId){busy=false;openPendingAccountGate();return}const sameCart=JSON.stringify(cart)===JSON.stringify(submitted.items);if(sameCart){cart=[];saveCart()}storePending(null);busy=false;showSuccess(order);refreshProducts().catch(()=>{})}catch(error){const code=String(error.code||'');const confirmedDatabaseRejection=/^(P\d{4}|2[23]\d{3}|42\d{3}|42501)$/.test(code);if(confirmedDatabaseRejection){storePending(null);await refreshProducts().catch(()=>{});form.querySelectorAll('input,textarea').forEach(el=>el.readOnly=false);setMessage(dialog,error.message||'Revise os dados e a disponibilidade da sua sacola.',true)}else{setMessage(dialog,`${error.message||'Não recebemos a confirmação.'} Tente novamente: o mesmo pedido será consultado sem duplicar o envio.`,true);form.querySelectorAll('input,textarea').forEach(el=>el.readOnly=true);submit.textContent='Repetir o mesmo envio ↗'}}finally{busy=false;if(submit.isConnected)submit.disabled=false}}}
function showSuccess(order){const number=order.order_number??order.id.slice(0,8),dialog=openModal(`<div class="order-success-symbol"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="m14 24 7 7 13-14" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h2>Seu pedido chegou à loja.</h2><p class="order-success-number">Pedido #${esc(number)}</p><p class="shop-modal-intro">${esc(store.name)} recebeu suas escolhas e seus dados de contato. O pagamento ainda será combinado; este envio não realizou cobrança.</p><div class="checkout-review"><p>Total de produtos: <strong>${money(order.total_cents)}</strong></p><p>Status: recebido</p></div><a class="cz-button" href="painel.html?compras=1">Acompanhar meus pedidos ↗</a><button class="cz-button secondary" id="keep-shopping">Continuar explorando</button>`);dialog.querySelector('#keep-shopping').onclick=()=>dialog.close();alert(`Pedido #${number} enviado. Acompanhe pelo link “Meus pedidos”.`)}
function collectionMatchesStore(collection){
  return !!collection&&typeof collection==='object'&&!Array.isArray(collection)&&collection.active!==false&&collection.slug===collectionSlug&&(!collection.store_id||collection.store_id===store.id)&&Array.isArray(collection.product_ids);
}
async function loadCollectionMetadata(){
  if(typeof api.getPublicCollections!=='function')return [];
  const rows=await api.getPublicCollections(store.id);
  return Array.isArray(rows)?rows.filter(collection=>collection&&typeof collection==='object'&&collection.active!==false&&(!collection.store_id||collection.store_id===store.id)):[];
}
async function loadActiveCollection(){
  if(!hasCollectionRoute)return null;
  if(!collectionSlug||typeof api.getPublicCollection!=='function')return null;
  const collection=await api.getPublicCollection(store.id,collectionSlug);
  return collectionMatchesStore(collection)?collection:null;
}
function renderCollectionUnavailable(){
  ownerBarVersion++;
  document.title=`Coleção indisponível — ${store.name} — Camizetas`;
  const href=`loja.html?loja=${encodeURIComponent(store.slug)}#collection`;
  mount.innerHTML=`<div class="shop-loading" role="status"><h1>Esta coleção não está disponível.</h1><p>Ela pode ter sido retirada da vitrine ou o endereço pode ter mudado.</p><p><a href="${esc(href)}">Ver todos os produtos de ${esc(store.name)}</a></p></div>`;
}
async function refreshProducts(){
  const [catalogue,metadata]=await Promise.all([api.getPublicProducts(store.id),loadCollectionMetadata()]);
  products=Array.isArray(catalogue)?catalogue:[];collections=metadata;
  activeCollection=await loadActiveCollection();
  if(hasCollectionRoute&&!activeCollection){renderCollectionUnavailable();return}
  render();
}
async function boot(){
  if(!slug||!mount)return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='lojas.css';document.head.append(link);
  const designCSS=document.createElement('link');designCSS.rel='stylesheet';designCSS.href='store-design.css';document.head.append(designCSS);
  const productCSS=document.createElement('link');productCSS.rel='stylesheet';productCSS.href='product-page.css';document.head.append(productCSS);
  document.body.classList.add('live-store-page');
  const bar=document.querySelector('.demo-bar');if(bar)bar.innerHTML='<a href="lojas.html">← Explorar lojas</a><span class="demo-label">CAMIZETAS · MARCAS INDEPENDENTES</span><a href="painel.html?compras=1">Meus pedidos ↗</a>';
  mount.innerHTML='<div class="shop-loading" role="status">Preparando a loja…</div>';
  if(!api.ready){mount.innerHTML='<div class="shop-loading">Esta loja ainda está aguardando a conexão do banco. <a href="lojas.html">Voltar às lojas</a>.</div>';return}
  try{
    store=await api.getPublicStore(slug);
    if(!store){mount.innerHTML='<div class="shop-loading">Esta loja não está disponível. <a href="lojas.html">Conheça outras marcas</a>.</div>';return}
    const [catalogue,metadata]=await Promise.all([api.getPublicProducts(store.id),loadCollectionMetadata()]);
    products=Array.isArray(catalogue)?catalogue:[];collections=metadata;
    activeCollection=await loadActiveCollection();
    if(hasCollectionRoute&&!activeCollection){renderCollectionUnavailable();return}
    document.title=`${activeCollection?activeCollection.name+' — ':''}${store.name} — Camizetas`;
    loadCart();render();watchCheckoutAccount();
    if(pending)alert('Há um envio de pedido sem confirmação. Abra sua sacola para retomá-lo com segurança.');
  }catch(error){mount.innerHTML=`<div class="shop-loading">${esc(error.message||'Não foi possível abrir esta loja.')} <a href="lojas.html">Voltar às lojas</a>.</div>`}
}
window.addEventListener('popstate',()=>{if(!store)return;closeProductModal();render()});
if(slug&&mount&&api.ready&&typeof api.onAuthChange==='function')api.onAuthChange(()=>{
  setTimeout(refreshOwnerBar,0);reviewAuthEpoch++;reviewContextVersion++;reviewUserId=null;
  const target=mount.querySelector('.product-review-context');if(target)target.innerHTML='<p role="status">Atualizando sua sessão…</p>';
  const productId=new URLSearchParams(location.search).get('produto'),product=products.find(item=>item.id===productId);
  if(product&&store?.reviews_enabled===true)loadProductReviewContext(product,productViewVersion);
});
boot();
