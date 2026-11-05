import {createClient} from '@supabase/supabase-js';

export const money = cents => (Number(cents || 0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const config=globalThis.CAMIZETAS_CONFIG||{};
const configured=typeof config.supabaseUrl==='string'&&/^https:\/\//.test(config.supabaseUrl)&&typeof config.supabaseKey==='string'&&config.supabaseKey.length>15;
const client=configured?createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}}):null;
const unavailable=()=>{if(!client)throw new Error('Estamos conectando o banco da Camizetas. O painel ficará disponível assim que a configuração for concluída.')};
const errorMessages={
 'Invalid login credentials':'E-mail ou senha incorretos.',
 'Email not confirmed':'Confirme seu e-mail antes de entrar.',
 'User already registered':'Este e-mail já possui uma conta. Entre ou recupere sua senha.',
 'Password should be at least 6 characters.':'Use uma senha com pelo menos 8 caracteres.',
 'Email rate limit exceeded':'Limite de e-mails atingido. Aguarde alguns minutos antes de tentar novamente.',
 'Failed to fetch':'Não foi possível acessar o serviço. Confira sua conexão e tente novamente.',
 'NetworkError when attempting to fetch resource.':'Falha de conexão. Tente novamente.'
};
function check(result){if(result.error){const source=result.error;let msg=errorMessages[source.message]||source.message;
 if(source.code==='23505')msg='Este endereço de loja ou SKU já está em uso. Escolha outro.';
 if(source.code==='42501')msg='Você não tem acesso a esta operação. Entre com a conta responsável pela loja.';
 if(/insufficient stock|stock would become negative|not enough stock/i.test(msg))msg='Estoque insuficiente. Atualize o carrinho ou informe outra quantidade.';
 if(/invalid transition/i.test(msg))msg='O pedido já mudou de etapa. Atualize a fila antes de continuar.';
 if(/idempotency.*different|idempotency.*mismatch/i.test(msg))msg='Este envio já foi registrado com outros dados. Atualize a página e confira seus pedidos.';
 const error=new Error(msg||'Não foi possível concluir a operação.');error.code=source.code;error.status=source.status;throw error}return result.data}
async function user(){unavailable();const {data:sessionData,error}=await client.auth.getSession();if(error)throw error;if(!sessionData.session)return null;return check(await client.auth.getUser())?.user||null}
async function requireUser(){const u=await user();if(!u)throw new Error('Entre na sua conta para continuar.');return u}
async function rpc(name,args){unavailable();return check(await client.rpc(name,args))}
const storeFields=['name','slug','description','template','accent','background','headline','published'];
export const api={
 ready:configured,
 async authUser(){if(!client)return null;return user()},
 async signIn(email,password){unavailable();return check(await client.auth.signInWithPassword({email:email.trim(),password}))},
 async signUp(email,password){unavailable();if(password.length<8)throw new Error('Use uma senha com pelo menos 8 caracteres.');const data=check(await client.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:new URL('painel.html',location.href).href}}));return {...data,needsConfirmation:!data.session}},
 async signOut(){unavailable();check(await client.auth.signOut())},
 async resetPassword(email){unavailable();check(await client.auth.resetPasswordForEmail(email.trim(),{redirectTo:new URL('painel.html?recovery=1',location.href).href}))},
 async updatePassword(password){unavailable();if(password.length<8)throw new Error('Use uma senha com pelo menos 8 caracteres.');return check(await client.auth.updateUser({password}))},
 onAuthChange(callback){if(!client)return()=>{};const {data}=client.auth.onAuthStateChange((event,session)=>callback(event,session?.user||null));return ()=>data.subscription.unsubscribe()},
 async uploadProductImage(storeId,file){await requireUser();if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>5*1024*1024)throw new Error('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!({ 'image/png':png,'image/jpeg':jpeg,'image/webp':webp}[file.type]))throw new Error('O arquivo não parece ser uma imagem válida. Escolha outra foto.');const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=`${storeId}/${crypto.randomUUID()}.${ext}`;check(await client.storage.from('camizetas-products').upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false}));return client.storage.from('camizetas-products').getPublicUrl(path).data.publicUrl},
 async getMyStores(){const u=await requireUser();return check(await client.from('stores').select('*').eq('owner_id',u.id).order('created_at',{ascending:true}))},
 async createStore({name,slug}){await requireUser();const store=await rpc('create_store',{p_name:name.trim(),p_slug:slug.trim().toLowerCase()});return store},
 async updateStore(id,patch){await requireUser();const data=Object.fromEntries(storeFields.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,patch[k]]));return check(await client.from('stores').update(data).eq('id',id).select('*').single())},
 async getProducts(storeId){await requireUser();return check(await client.from('products').select('*,variants(*)').eq('store_id',storeId).order('created_at',{ascending:false}))},
 async saveProduct(storeId,product,variants){return rpc('save_product',{p_store_id:storeId,p_product:product,p_variants:variants})},
 async adjustStock(variantId,delta,reason){return rpc('adjust_stock',{p_variant_id:variantId,p_delta:Number(delta),p_reason:reason})},
 async getOrders(storeId){await requireUser();return check(await client.from('orders').select('*,items:order_items(*),events:order_events(*)').eq('store_id',storeId).order('created_at',{ascending:false}).limit(500))},
 async transitionOrder(id,status,trackingCode=null){return rpc('transition_order',{p_order_id:id,p_status:status,p_tracking_code:trackingCode||null})},
 async getInventoryMovements(storeId){await requireUser();const rows=check(await client.from('inventory_movements').select('*,variant:variants(sku,size,color,product:products(name))').eq('store_id',storeId).order('created_at',{ascending:false}).limit(200));return rows.map(r=>({...r,delta:r.quantity,quantity_delta:r.quantity,sku:r.variant?.sku,product_name:r.variant?.product?.name,variant_name:[r.variant?.size,r.variant?.color].filter(Boolean).join(' / ')}))},
 async getPublicStores(){unavailable();return check(await client.from('stores').select('id,name,slug,description,template,accent,background,headline').eq('published',true).order('created_at',{ascending:false}).limit(100))},
 async getPublicStore(slug){unavailable();return check(await client.from('stores').select('id,name,slug,description,template,accent,background,headline').eq('slug',slug).eq('published',true).maybeSingle())},
 async getPublicProducts(storeId){unavailable();const rows=check(await client.from('products').select('*,variants(*)').eq('store_id',storeId).eq('active',true).order('created_at',{ascending:false}));return rows.map(p=>({...p,variants:p.variants.filter(v=>v.active)}))},
 async placeOrder(storeId,items,customer,idempotencyKey){await requireUser();return rpc('place_order',{p_store_id:storeId,p_items:items,p_customer:customer,p_idempotency_key:idempotencyKey})},
 async getBuyerOrders(){const u=await requireUser();return check(await client.from('orders').select('*,store:stores(name,slug),items:order_items(*),events:order_events(*)').eq('buyer_id',u.id).order('created_at',{ascending:false}).limit(100))},
 async getBuyerOrder(id){const u=await requireUser();return check(await client.from('orders').select('*,store:stores(name,slug),items:order_items(*),events:order_events(*)').eq('id',id).eq('buyer_id',u.id).single())}
};
