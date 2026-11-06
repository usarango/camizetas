import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../src/data.js',import.meta.url),'utf8'))
  .replace(/^import .*;\s*$/gm,'')
  .replace(/export const /g,'const ')+ '\nglobalThis.testAPI=api;';
const plain=value=>JSON.parse(JSON.stringify(value));

function harness({user={id:'owner-1'},query=()=>({data:[],error:null}),rpc=()=>({data:{},error:null})}={}){
  const queries=[],rpcs=[];
  const client={
    auth:{getSession:async()=>({data:{session:user?{}:null},error:null}),getUser:async()=>({data:{user},error:null})},
    from(table){
      const call={table,filters:[],orders:[]};queries.push(call);
      const builder={
        select(fields){call.fields=fields;return this},
        eq(field,value){call.filters.push([field,value]);return this},
        in(field,values){call.filters.push([field,values]);return this},
        order(field,options){call.orders.push([field,options]);return this},
        limit(value){call.limit=value;return this},
        single(){call.single=true;return this},
        maybeSingle(){call.maybeSingle=true;return this},
        update(value){call.update=value;return this},
        then(resolve,reject){return Promise.resolve().then(()=>query(call)).then(resolve,reject)}
      };return builder;
    },
    rpc:async(name,args)=>{const call={name,args};rpcs.push(call);return rpc(call)}
  };
  const context=vm.createContext({createClient:()=>client,CAMIZETAS_CONFIG:{supabaseUrl:'https://project.supabase.co',supabaseKey:'sb_publishable_test_api_key'},URL,console});
  vm.runInContext(source,context);
  return {api:context.testAPI,queries,rpcs};
}

test('product feature discovery scopes the owner and gracefully detects a missing migration',async()=>{
  const h=harness({query:()=>({data:{id:'store-1',reviews_enabled:true},error:null})});
  assert.deepEqual(plain(await h.api.getProductFeatures('store-1')),{available:true,reviews_enabled:true});
  assert.deepEqual(plain(h.queries[0].filters),[['id','store-1'],['owner_id','owner-1']]);
  assert.equal(h.queries[0].fields,'id,reviews_enabled');
  const missing=harness({query:()=>({data:null,error:{code:'42703',message:'column reviews_enabled does not exist'}})});
  assert.deepEqual(plain(await missing.api.getProductFeatures('store-1')),{available:false,reviews_enabled:false});
  const signedOut=harness({user:null});
  await assert.rejects(signedOut.api.getProductFeatures('store-1'),/Entre na sua conta/);
  assert.equal(signedOut.queries.length,0);
});

test('public reviews never request buyer identities and use the complete database summary',async()=>{
  const h=harness({user:null,query:call=>({data:call.table==='product_reviews'?[{id:'review-1',rating:1,author_name:'Cliente'}]:{review_count:'149',average_rating:'4.85'},error:null})});
  const result=await h.api.getProductReviews('store-1','product-1');
  assert.deepEqual(plain(result.summary),{count:149,average:4.85});
  assert.equal(result.reviews.length,1);
  for(const call of h.queries){
    assert.deepEqual(plain(call.filters),[['store_id','store-1'],['product_id','product-1']]);
    assert.doesNotMatch(call.fields,/\*|buyer_id|email|address|phone/);
  }
  assert.equal(h.queries.find(call=>call.table==='product_reviews').limit,100);
});

test('reviews remain unavailable if the migration is incomplete, but connection errors stay visible',async()=>{
  const h=harness({query:call=>call.table==='product_review_summary'?{data:null,error:{code:'PGRST205',message:'missing view'}}:{data:[{id:'r1'}],error:null}});
  assert.deepEqual(plain(await h.api.getProductReviews('s1','p1')),{available:false,reviews:[],summary:{count:0,average:0}});
  const broken=harness({query:()=>({data:null,error:{message:'Failed to fetch'}})});
  await assert.rejects(broken.api.getProductReviews('s1','p1'),/Confira sua conexão/);
});

test('related collections start from product membership and keep active same-store scopes',async()=>{
  const h=harness({user:null,query:call=>({data:call.table==='collection_products'?[{collection_id:'c1'},{collection_id:'c1'}]:[{id:'c1',items:[{product_id:'p2',sort_order:2},{product_id:'p1',sort_order:0}]}],error:null})});
  const rows=await h.api.getProductCollections('s1','p1');
  assert.deepEqual(plain(h.queries[0].filters),[['store_id','s1'],['product_id','p1']]);
  assert.deepEqual(plain(h.queries[1].filters),[['store_id','s1'],['active',true],['id',['c1']]]);
  assert.deepEqual(plain(rows[0].product_ids),['p1','p2']);
  const empty=harness({query:()=>({data:[],error:null})});
  assert.deepEqual(plain(await empty.api.getProductCollections('s1','p1')),[]);
  assert.equal(empty.queries.length,1);
});

test('review writes authenticate and send product content without a client chosen buyer',async()=>{
  const h=harness();
  await h.api.getProductReviewContext('p1');
  await h.api.saveProductReview('p1',{rating:5,title:'  Boa peça  ',body:'  A camiseta chegou conforme a descrição.  ',author_name:'  Maria  ',buyer_id:'forged'});
  assert.deepEqual(plain(h.rpcs),[
    {name:'product_review_context',args:{p_product_id:'p1'}},
    {name:'save_product_review',args:{p_product_id:'p1',p_rating:5,p_title:'Boa peça',p_body:'A camiseta chegou conforme a descrição.',p_author_name:'Maria'}}
  ]);
  await assert.rejects(h.api.saveProductReview('p1',{rating:6}),/nota de 1 a 5/);
  assert.equal(h.rpcs.length,2);
  const signedOut=harness({user:null});
  await assert.rejects(signedOut.api.getProductReviewContext('p1'),/Entre na sua conta/);
  await assert.rejects(signedOut.api.saveProductReview('p1',{rating:5}),/Entre na sua conta/);
  assert.equal(signedOut.rpcs.length,0);
});

test('review activation is an allowed store update and retains the owner predicate',async()=>{
  const h=harness({query:call=>({data:{id:'s1',...call.update},error:null})});
  const result=await h.api.updateStore('s1',{reviews_enabled:true,owner_id:'forged'});
  assert.equal(result.reviews_enabled,true);
  assert.deepEqual(plain(h.queries[0].update),{reviews_enabled:true});
  assert.deepEqual(plain(h.queries[0].filters),[['id','s1'],['owner_id','owner-1']]);
});
