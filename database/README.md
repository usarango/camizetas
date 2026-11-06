# Camizetas database contract

`schema.sql` is the reviewed source of the initial schema, not an auto-generated migration filename. Apply it only to a dedicated Camizetas Supabase project after inspecting that project's existing schemas. Generate the tracked migration using `supabase migration new camizetas_commerce`, then copy the schema into that CLI-created file. Supabase CLI version and flags must be checked with `--help` before use.

## Data model

All tables are in `public` with RLS enabled. Mutation implementations are in `private` (which must remain outside the Supabase exposed-schema list). Exposed RPC wrappers are `SECURITY INVOKER`; the narrow mutation implementations are `SECURITY DEFINER` with a fixed empty `search_path`, explicit `auth.uid()` authorization, PUBLIC/anon execution revoked and execution granted only to authenticated users.

- `stores`: `id`, `owner_id`, `name`, unique `slug`, `description`, `template`, `accent`, `background`, `headline`, `published`, timestamps. Templates: `chic`, `underground`, `rock`, `nerd`. New stores start unpublished. An owner may manage several stores.
- `products`: store-scoped product records, `price_cents` (integer BRL cents), name/description/category/image URL, `active` and timestamps. Image URLs accept HTTPS/HTTP, local `assets/...`, or blank. Archiving is `active=false`, not deletion.
- `variants`: product/store, unique SKU per store, size/color, integer `on_hand`, `active`, timestamps. Composite foreign keys prevent moving variants to a different store.
- `orders`: buyer/store, generated `order_number`, customer contact and normalized address snapshot, notes, computed `total_cents`, status/tracking, idempotency key/request hash, timestamps. No payment is processed by this schema.
- `order_items`: immutable product/variant/name/SKU/size/color/quantity/unit-price snapshots. The current catalogue price cannot be supplied by the browser.
- `inventory_movements`: append-only initial stock, adjustments, sales and cancellations, with resulting balance, actor and optional order.
- `order_events`: append-only order-state history visible to the buyer and store owner.

## Read and write permissions

Anonymous visitors may read published stores, their active products and active variants. An owner also sees archived/unpublished records for their stores. A buyer only sees their own orders, items and state history; an owner sees these for their stores. Inventory history is owner-only.

Clients may directly update only these store columns: `name`, `slug`, `description`, `template`, `accent`, `background`, `headline`, `published`. An owner cannot reassign `owner_id` or store IDs. Other mutations use the RPCs below; no client has table-level insert/delete or direct stock/order-write access.

## RPC contracts

All RPCs require Supabase authentication and return one JSON object. Unexpected or unauthorized IDs fail server-side. They do not accept user IDs from the browser.

### `create_store(p_name text, p_slug text)`

Returns the new store row. Name is 2–80 trimmed characters; slug is 3–50 lowercase ASCII letters/digits/hyphens, beginning and ending with a letter/digit. Unique slugs are enforced by the database.

### `save_product(p_store_id uuid, p_product jsonb, p_variants jsonb)`

Returns `{ "product": { ... }, "variants": [ ... ] }`. Product input is a full form:

```json
{
  "id": "optional-existing-product-uuid",
  "name": "Camiseta Essencial",
  "description": "Algodão, modelagem regular",
  "category": "Camisetas",
  "image_url": "assets/tee.jpg",
  "price_cents": 8990,
  "active": true
}
```

Variants must contain 1–100 rows:

```json
[
  { "size": "M", "color": "Preto", "sku": "ESS-M-PRETO", "on_hand": 10, "active": true },
  { "id": "optional-existing-variant-uuid", "size": "G", "color": "Preto", "sku": "ESS-G-PRETO", "active": true }
]
```

Omit `id` to create a row. For new variants, blank SKU is generated, omitted stock defaults to zero and initial stock is audited. For existing variants, omit `on_hand`; changing stock through this endpoint is rejected. Existing variants omitted from the submitted list are archived, preserving historical references. Missing product fields reset to defaults, so send the complete product form.

### `adjust_stock(p_variant_id uuid, p_delta integer, p_reason text)`

Returns the updated variant. Delta is nonzero, between -1,000,000 and +1,000,000; the resulting stock must remain nonnegative. A 2–250 character reason is required. Changes are row-locked and audited. This is the only client-accessible stock-adjustment path.

### `place_order(p_store_id uuid, p_items jsonb, p_customer jsonb, p_idempotency_key uuid)`

Returns the order row. The browser generates a fresh UUID once per checkout attempt and retains it for retries. Retries with the same buyer/key and identical input return the original order, without decrementing stock twice. Reusing a key for a different payload is rejected.

```json
{
  "p_items": [{ "variant_id": "variant-uuid", "quantity": 2 }],
  "p_customer": {
    "name": "Nome do comprador",
    "phone": "(11) 99999-9999",
    "address": {
      "street": "Rua Exemplo",
      "number": "100",
      "complement": "Apto 2",
      "neighborhood": "Centro",
      "city": "São Paulo",
      "state": "SP",
      "postal_code": "01001-000"
    },
    "notes": "Observação opcional"
  }
}
```

A store must be published and all products/variants active. There are at most 50 input lines and 99 aggregate units per variant. Repeated lines for the same variant are aggregated. Variant row locks are acquired in UUID order. Total and item prices come from the database, and stock is deducted in the same transaction as the order, items, history and movement records. Any error rolls everything back.

### `transition_order(p_order_id uuid, p_status text, p_tracking_code text default null)`

Returns the order row. Only the store owner may transition it. Allowed transitions:

| Current | Next |
| --- | --- |
| `new` | `confirmed`, `cancelled` |
| `confirmed` | `packing`, `cancelled` |
| `packing` | `shipped`, `cancelled` |
| `shipped` | `completed` |
| `completed`, `cancelled` | terminal |

Repeating the current state is a no-op. A tracking code is optional when entering `shipped`. Cancellation restores each item quantity once, even when the variation was archived. An order row lock and movement uniqueness prevent duplicate returns. Buyers cannot transition or cancel orders directly.

Portuguese UI labels: `new` = Novo; `confirmed` = Confirmado; `packing` = Em separação; `shipped` = Enviado; `completed` = Concluído; `cancelled` = Cancelado.

## Required verification before production

Run SQL syntax/schema creation against an isolated database; run Supabase advisors; test as at least two owners, a buyer and anon. Verify cross-store denials, unpublished catalogue privacy, stock race for the last item, idempotent retries, transaction rollback on insufficient stock, immutable item prices, cancellation restoration exactly once, invalid transitions and rejected direct table mutations. Never test by inserting fake orders into an unrelated production project.

The schema does not implement online payment, taxes, shipping-rate calculation, shipment-carrier integration, staff membership or AI image generation.

## Executed local SQL tests

`tests/database.test.mjs` executes this schema in PostgreSQL via PGlite, with an isolated `auth.users`/`auth.uid()` stub and separate `anon`/`authenticated` role sessions. Run:

```sh
node --test --test-isolation=none tests/database.test.mjs
```

Ten tests pass for RLS/catalogue isolation, restricted mutation privileges, stock audit and rollback, duplicate-line aggregation, server-side pricing, idempotency/mismatch, immutable snapshots after archive, cancellation restoration, queue transitions/tracking and the final unit becoming unavailable to another buyer. The `--test-isolation=none` flag avoids PGlite/Node worker isolation reporting only the enclosing file.

This is actual SQL/PLpgSQL/RLS execution, not a mocked database. It does not replace hosted Supabase advisor checks, Auth email-flow verification or a native PostgreSQL test with genuinely concurrent independent connections.

## Product image storage

Apply `storage.sql` as a separate Supabase-only migration after the commerce schema. It configures only `camizetas-products`: a public bucket allowing JPEG, PNG and WebP files up to 5 MiB. Other buckets and Supabase's ownership, RLS enablement and grants are unchanged.

Upload a new filename on every change, with `upsert: false`:

```js
const path = `${storeId}/${crypto.randomUUID()}.webp`;
await supabase.storage.from('camizetas-products').upload(path, file, {
  contentType: 'image/webp', upsert: false,
});
```

Only the authenticated store owner may insert under that store UUID folder. Names must have exactly two path components and a UUID filename ending in `.jpg`, `.jpeg`, `.png` or `.webp`. The owner check compares `stores.id::text` with `storage.foldername(name)[1]`; malformed folders are rejected without UUID cast errors. Anyone may read this public bucket, including its object metadata. Only the store owner may delete a file. There is no UPDATE policy, so replacement/upsert is deliberately unsupported.

Storage API enforces the bucket's content-type and size settings. PostgreSQL policies enforce authorization and object paths; they do not inspect binary image contents. The browser must validate/decode the image too. Public images must never contain private customer data.

`tests/storage.test.mjs` tests the real policies in PGlite with a minimal Supabase Storage schema/function stub. Four tests pass for bucket settings, other-bucket preservation, owner-only paths, malformed/foreign-path rejection, anonymous read/upload restrictions, no object UPDATE and owner-only cleanup:

```sh
node --test --test-isolation=none tests/storage.test.mjs
```

This isolated policy test does not replace an actual hosted Storage upload or MIME/size enforcement check through Supabase Storage API.

## Collections upgrade

`collections.sql` adds `collections` and `collection_products`. Public reads require an active collection and published store; membership additionally hides inactive products. Owners see their own drafts and inactive relationships. There are no direct client mutations. `save_collection(p_store_id uuid,p_collection jsonb,p_product_ids uuid[])` calls an authorized private implementation and atomically replaces membership without changing products, stock or orders. A product may belong to multiple collections; slugs are unique within each store. Full collection form: optional `id`, `name`, `slug`, `description`, `image_url`, `active`, `featured`, `sort_order`; up to 500 product IDs are accepted and deduplicated while preserving first occurrence. Returns collection JSON plus ordered `product_ids`.
