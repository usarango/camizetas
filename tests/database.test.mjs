import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// These are real PostgreSQL statements, policies and PL/pgSQL functions in PGlite.
// Authentication is stubbed only at the auth.users/auth.uid boundary.
const users = {
  owner: '00000000-0000-4000-8000-000000000001',
  otherOwner: '00000000-0000-4000-8000-000000000002',
  buyer: '00000000-0000-4000-8000-000000000003',
  otherBuyer: '00000000-0000-4000-8000-000000000004',
};
let db, publicStore, privateStore, otherStore;

async function asUser(userId, callback, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    const result = await callback();
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
async function rpc(name, values) {
  const definitions = {
    create_store: ['text', 'text'],
    save_product: ['uuid', 'jsonb', 'jsonb'],
    adjust_stock: ['uuid', 'integer', 'text'],
    place_order: ['uuid', 'jsonb', 'jsonb', 'uuid'],
    transition_order: ['uuid', 'text', 'text'],
  };
  const types = definitions[name];
  const params = values.map((value, index) => types[index] === 'jsonb' ? JSON.stringify(value) : value);
  const result = await db.query(`select public.${name}(${types.map((type, i) => `$${i+1}::${type}`).join(',')}) as value`, params);
  return result.rows[0].value;
}
async function product({ stock = 10, store = publicStore, owner = users.owner, price = 8990, active = true } = {}) {
  return asUser(owner, () => rpc('save_product', [store.id, {
    name: 'Camiseta ' + randomUUID().slice(0, 8),
    description: 'Algodão confortável', category: 'Camisetas', image_url: 'assets/tee.jpg', price_cents: price, active,
  }, [{ size: 'M', color: 'Preto', sku: 'SKU-' + randomUUID(), on_hand: stock }]]));
}
const customer = {
  name: 'Cliente Teste', phone: '(11) 99999-9999',
  address: { street: 'Rua Exemplo', number: '12', city: 'São Paulo', state: 'SP', postal_code: '01001-000' },
  notes: 'Pedido de teste sem pagamento',
};
async function place(p, quantity = 1, key = randomUUID(), extra = {}) {
  return asUser(users.buyer, () => rpc('place_order', [publicStore.id, [{ variant_id: p.variants[0].id, quantity, ...extra }], customer, key]));
}
async function balance(variantId) {
  return asUser(users.owner, async () => (await db.query('select on_hand from public.variants where id=$1', [variantId])).rows[0].on_hand);
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const id of Object.values(users)) await db.query('insert into auth.users(id) values($1)', [id]);
  await db.exec(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
  privateStore = await asUser(users.owner, () => rpc('create_store', ['Loja Privada', 'loja-privada']));
  publicStore = await asUser(users.owner, () => rpc('create_store', ['Loja Pública', 'loja-publica']));
  otherStore = await asUser(users.otherOwner, () => rpc('create_store', ['Outra Loja', 'outra-loja']));
  await asUser(users.owner, () => db.query('update public.stores set published=true where id=$1', [publicStore.id]));
});
after(async () => { if (db) await db.close(); });

test('RLS is enabled on every application table; only private implementations are SECURITY DEFINER', async () => {
  const tables = await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
  assert.equal(tables.rows.length, 7);
  assert.ok(tables.rows.every(row => row.relrowsecurity));
  const exposed = await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef");
  assert.deepEqual(exposed.rows, []);
});

test('unpublished catalog is visible only to its owner; published catalog is anonymous', async () => {
  const secret = await product({ store: privateStore });
  const live = await product();
  for (const [id, role] of [[null, 'anon'], [users.otherOwner, 'authenticated'], [users.buyer, 'authenticated']]) {
    await asUser(id, async () => {
      assert.equal((await db.query('select id from public.stores where id=$1', [privateStore.id])).rows.length, 0);
      assert.equal((await db.query('select id from public.products where id=$1', [secret.product.id])).rows.length, 0);
      assert.equal((await db.query('select id from public.variants where id=$1', [secret.variants[0].id])).rows.length, 0);
      assert.equal((await db.query('select id from public.products where id=$1', [live.product.id])).rows.length, 1);
    }, role);
  }
  await asUser(users.owner, async () => {
    assert.equal((await db.query('select id from public.products where id=$1', [secret.product.id])).rows.length, 1);
  });
});

test('owner cannot mutate another store, spoof ownership or insert directly', async () => {
  const p = await product();
  await assert.rejects(asUser(users.otherOwner, () => rpc('save_product', [publicStore.id, p.product, p.variants])), /administra/);
  await assert.rejects(asUser(users.otherOwner, () => rpc('adjust_stock', [p.variants[0].id, 10, 'Tentativa cruzada'])), /administra/);
  await asUser(users.otherOwner, async () => {
    const result = await db.query('update public.stores set name=$1 where id=$2 returning id', ['Não permitido', publicStore.id]);
    assert.equal(result.rows.length, 0);
  });
  await assert.rejects(asUser(users.owner, () => db.query('update public.stores set owner_id=$1 where id=$2', [users.otherOwner, publicStore.id])), /permission denied/);
  await assert.rejects(asUser(users.owner, () => db.query('insert into public.stores(owner_id,name,slug) values($1,$2,$3)', [users.owner, 'Bypass', 'bypass'])), /permission denied/);
  await assert.rejects(asUser(null, () => rpc('create_store', ['Anônima', 'anonima']), 'anon'), /permission denied/);
});

test('product variants are validated, initial balances audited, and stock cannot bypass adjustment RPC', async () => {
  const p = await product({ stock: 7 });
  await asUser(users.owner, async () => {
    const movements = await db.query('select quantity,balance_after,kind from public.inventory_movements where variant_id=$1', [p.variants[0].id]);
    assert.deepEqual(movements.rows, [{ quantity: 7, balance_after: 7, kind: 'initial' }]);
  });
  await assert.rejects(asUser(users.owner, () => db.query('update public.variants set on_hand=500 where id=$1', [p.variants[0].id])), /permission denied/);
  await assert.rejects(asUser(users.owner, () => rpc('save_product', [publicStore.id, p.product, [{ ...p.variants[0], on_hand: 999 }]])), /ajuste de estoque/);
  assert.equal(await balance(p.variants[0].id), 7);
  const adjusted = await asUser(users.owner, () => rpc('adjust_stock', [p.variants[0].id, -2, 'Conferência física']));
  assert.equal(adjusted.on_hand, 5);
  await assert.rejects(asUser(users.owner, () => rpc('adjust_stock', [p.variants[0].id, -6, 'Saldo insuficiente'])), /estoque inválido/);
  assert.equal(await balance(p.variants[0].id), 5);
  await asUser(users.buyer, async () => assert.equal((await db.query('select * from public.inventory_movements')).rows.length, 0));
});

test('checkout aggregates duplicate lines, ignores client prices, snapshots catalogue data and decrements once', async () => {
  const p = await product({ stock: 10, price: 12345 });
  const id = p.variants[0].id;
  const items = [{ variant_id: id, quantity: 2, price_cents: 1 }, { variant_id: id, quantity: 3, unit_price_cents: 1 }];
  const key = randomUUID();
  const order = await asUser(users.buyer, () => rpc('place_order', [publicStore.id, items, customer, key]));
  assert.equal(order.total_cents, 5 * 12345);
  assert.equal(order.status, 'new');
  assert.equal(await balance(id), 5);
  await asUser(users.buyer, async () => {
    const result = await db.query('select quantity,unit_price_cents,product_name from public.order_items where order_id=$1', [order.id]);
    assert.deepEqual(result.rows, [{ quantity: 5, unit_price_cents: 12345, product_name: p.product.name }]);
  });
  const retried = await asUser(users.buyer, () => rpc('place_order', [publicStore.id, items, customer, key]));
  assert.equal(retried.id, order.id);
  assert.equal(await balance(id), 5);
  await assert.rejects(asUser(users.buyer, () => rpc('place_order', [publicStore.id, [{ variant_id: id, quantity: 1 }], customer, key])), /identificador já foi usado/);
  await asUser(users.otherBuyer, async () => {
    assert.equal((await db.query('select id from public.orders where id=$1', [order.id])).rows.length, 0);
    assert.equal((await db.query('select id from public.order_items where order_id=$1', [order.id])).rows.length, 0);
    assert.equal((await db.query('select id from public.order_events where order_id=$1', [order.id])).rows.length, 0);
  });
  await asUser(users.owner, async () => assert.equal((await db.query('select id from public.orders where id=$1', [order.id])).rows.length, 1));
});

test('insufficient stock, foreign variants and invalid customers roll back the entire checkout', async () => {
  const one = await product({ stock: 2 });
  const zero = await product({ stock: 0 });
  const foreign = await product({ store: otherStore, owner: users.otherOwner });
  const before = (await db.query('select count(*)::integer as n from public.orders')).rows[0].n;
  await assert.rejects(asUser(users.buyer, () => rpc('place_order', [publicStore.id, [
    { variant_id: one.variants[0].id, quantity: 1 }, { variant_id: zero.variants[0].id, quantity: 1 },
  ], customer, randomUUID()])), /Estoque insuficiente/);
  assert.equal(await balance(one.variants[0].id), 2);
  await assert.rejects(asUser(users.buyer, () => rpc('place_order', [publicStore.id, [{ variant_id: foreign.variants[0].id, quantity: 1 }], customer, randomUUID()])), /não pertence/);
  await assert.rejects(asUser(users.buyer, () => rpc('place_order', [publicStore.id, [{ variant_id: one.variants[0].id, quantity: 1 }], { ...customer, phone: '--------' }, randomUUID()])), /telefone/);
  await assert.rejects(asUser(users.buyer, () => rpc('place_order', [publicStore.id, [{ variant_id: one.variants[0].id, quantity: 1 }], { ...customer, address: { ...customer.address, state: 'ZZ' } }, randomUUID()])), /Confira o endereço/);
  assert.equal((await db.query('select count(*)::integer as n from public.orders')).rows[0].n, before);
  await assert.rejects(place(one, 3), /Estoque insuficiente/);
  assert.equal(await balance(one.variants[0].id), 2);
});

test('order cancellation restores archived variants once and preserves immutable snapshots', async () => {
  const p = await product({ stock: 5, price: 7777 });
  const order = await place(p, 2);
  assert.equal(await balance(p.variants[0].id), 3);
  await asUser(users.owner, () => rpc('save_product', [publicStore.id, { ...p.product, name: 'Nome alterado', price_cents: 9999, active: false }, [{ ...p.variants[0], on_hand: 3, active: false }]]));
  await assert.rejects(asUser(users.buyer, () => rpc('transition_order', [order.id, 'cancelled', null])), /administra/);
  await assert.rejects(asUser(users.otherOwner, () => rpc('transition_order', [order.id, 'cancelled', null])), /administra/);
  const cancelled = await asUser(users.owner, () => rpc('transition_order', [order.id, 'cancelled', null]));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await balance(p.variants[0].id), 5);
  await asUser(users.owner, () => rpc('transition_order', [order.id, 'cancelled', null]));
  assert.equal(await balance(p.variants[0].id), 5);
  const movements = await db.query("select count(*)::integer as n from public.inventory_movements where order_id=$1 and kind='cancellation'", [order.id]);
  assert.equal(movements.rows[0].n, 1);
  await asUser(users.buyer, async () => {
    const item = (await db.query('select product_name,unit_price_cents from public.order_items where order_id=$1', [order.id])).rows[0];
    assert.deepEqual(item, { product_name: p.product.name, unit_price_cents: 7777 });
  });
  await asUser(null, async () => {
    assert.equal((await db.query('select id from public.products where id=$1', [p.product.id])).rows.length, 0);
    assert.equal((await db.query('select id from public.variants where id=$1', [p.variants[0].id])).rows.length, 0);
  }, 'anon');
});

test('queue enforces transitions and tracking, rejects cancellation after shipping and direct edits', async () => {
  const p = await product({ stock: 3 });
  const order = await place(p);
  await assert.rejects(asUser(users.owner, () => rpc('transition_order', [order.id, 'completed', null])), /não é permitida/);
  for (const status of ['confirmed', 'packing', 'shipped', 'completed']) {
    const changed = await asUser(users.owner, () => rpc('transition_order', [order.id, status, status === 'shipped' ? 'BR123456789' : null]));
    assert.equal(changed.status, status);
    if (['shipped', 'completed'].includes(status)) assert.equal(changed.tracking_code, 'BR123456789');
    if (status === 'shipped') await assert.rejects(asUser(users.owner, () => rpc('transition_order', [order.id, 'cancelled', null])), /não é permitida/);
  }
  assert.equal(await balance(p.variants[0].id), 2);
  await assert.rejects(asUser(users.owner, () => db.query("update public.orders set status='cancelled' where id=$1", [order.id])), /permission denied/);
  await assert.rejects(asUser(users.buyer, () => db.query('update public.order_items set unit_price_cents=1 where order_id=$1', [order.id])), /permission denied/);
  await assert.rejects(asUser(users.owner, () => db.query("insert into public.inventory_movements(store_id,variant_id,quantity,balance_after,reason,kind,created_by) values($1,$2,99,99,'Bypass','adjustment',$3)", [publicStore.id, p.variants[0].id, users.owner])), /permission denied/);
  await asUser(users.buyer, async () => {
    const events = await db.query('select status from public.order_events where order_id=$1 order by created_at,id', [order.id]);
    assert.equal(events.rows.length, 5);
    assert.ok(events.rows.some(event => event.status === 'completed'));
  });
});

test('last available unit cannot be sold twice, and unpublished stores reject checkout', async () => {
  const p = await product({ stock: 1 });
  const order = await place(p);
  assert.equal(order.total_cents, p.product.price_cents);
  assert.equal(await balance(p.variants[0].id), 0);
  await assert.rejects(asUser(users.otherBuyer, () => rpc('place_order', [publicStore.id, [{ variant_id: p.variants[0].id, quantity: 1 }], customer, randomUUID()])), /Estoque insuficiente/);
  assert.equal(await balance(p.variants[0].id), 0);
  const privateProduct = await product({ stock: 4, store: privateStore });
  await assert.rejects(asUser(users.buyer, () => rpc('place_order', [privateStore.id, [{ variant_id: privateProduct.variants[0].id, quantity: 1 }], customer, randomUUID()])), /não está recebendo/);
  const stock = (await db.query('select on_hand from public.variants where id=$1', [privateProduct.variants[0].id])).rows[0].on_hand;
  assert.equal(stock, 4);
});

test('RPC execute permissions reject anon and explicit missing-identity authenticated calls', async () => {
  const permissions = await db.query(`select
    has_function_privilege('anon','public.place_order(uuid,jsonb,jsonb,uuid)','execute') as anon_public,
    has_function_privilege('anon','private.place_order(uuid,jsonb,jsonb,uuid)','execute') as anon_private,
    has_function_privilege('authenticated','public.place_order(uuid,jsonb,jsonb,uuid)','execute') as buyer_public`);
  assert.deepEqual(permissions.rows, [{ anon_public: false, anon_private: false, buyer_public: true }]);
  await assert.rejects(asUser(null, () => rpc('create_store', ['Sem identidade', 'sem-identidade'])), /Entre na sua conta/);
  const p = await product();
  await assert.rejects(asUser(null, () => rpc('place_order', [publicStore.id, [{ variant_id: p.variants[0].id, quantity: 1 }], customer, randomUUID()]), 'anon'), /permission denied/);
});
