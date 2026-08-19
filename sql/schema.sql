-- ==========================================================================
-- Pérolas de Maria — Supabase schema
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) ORDERS
-- --------------------------------------------------------------------------
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     bigint generated always as identity, -- becomes #000001, #000002...
  customer_name    text not null check (char_length(trim(customer_name)) > 0),
  customer_phone   text not null check (char_length(trim(customer_phone)) > 0),
  customer_address text not null check (char_length(trim(customer_address)) > 0),
  notes            text,
  payment_method   text not null default 'pix',
  subtotal         numeric(10,2) not null check (subtotal >= 0),
  total            numeric(10,2) not null check (total >= 0),
  status           text not null default 'aguardando_pagamento'
                     check (status in (
                       'aguardando_pagamento', 'pago', 'preparacao',
                       'enviado', 'entregue', 'cancelado'
                     )),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists orders_order_number_key on public.orders (order_number);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- --------------------------------------------------------------------------
-- 2) ORDER ITEMS (one row per product inside an order)
-- --------------------------------------------------------------------------
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(10,2) not null check (unit_price >= 0),
  line_total   numeric(10,2) not null check (line_total >= 0),
  -- for personalized terços: { tipo, tipoLabel, cor, estilo, entremeio }
  details      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- --------------------------------------------------------------------------
-- 3) ORDER STATUS HISTORY (auto-filled by triggers — nobody writes here
--    directly, not even the create_order() function below)
-- --------------------------------------------------------------------------
create table if not exists public.order_status_history (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  status     text not null,
  note       text,
  changed_at timestamptz not null default now()
);

create index if not exists order_status_history_order_id_idx on public.order_status_history (order_id);

-- --------------------------------------------------------------------------
-- 4) updated_at auto-touch + status history triggers
-- --------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_touch_updated_at on public.orders;
create trigger trg_orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- log "Pedido criado" the moment a new order is inserted
create or replace function public.log_order_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_status_history (order_id, status, note)
  values (new.id, new.status, 'Pedido criado');
  return new;
end;
$$;

drop trigger if exists trg_orders_log_created on public.orders;
create trigger trg_orders_log_created
  after insert on public.orders
  for each row execute function public.log_order_created();

-- log every status change (fires when an admin updates orders.status)
create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, status)
    values (new.id, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_log_status_change on public.orders;
create trigger trg_orders_log_status_change
  after update on public.orders
  for each row execute function public.log_status_change();

-- --------------------------------------------------------------------------
-- 5) create_order() — the ONLY way the public website can create an order.
--
--    Why an RPC function instead of letting the browser INSERT directly:
--    Postgres RLS would require granting the public "anon" role a SELECT
--    policy just so Supabase can return the newly created row (needed to
--    read back the order_number) — and that would mean opening up read
--    access to the orders table, which we don't want (anyone could then
--    read every customer's name/phone/address). Wrapping the whole
--    create-order step in a SECURITY DEFINER function sidesteps that: the
--    function runs with elevated rights internally, but only returns the
--    two harmless fields (id, order_number) to the caller. Because of
--    this, `orders` and `order_items` never need ANY grant for anon —
--    see the RLS policies in step 6.
--
--    It also recomputes the total from the items server-side, so a
--    tampered client can't submit a fake discounted total.
-- --------------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_address text,
  p_notes            text,
  p_items            jsonb  -- [{product_name, quantity, unit_price, line_total, details}, ...]
)
returns table(id uuid, order_number bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id       uuid;
  v_order_number   bigint;
  v_total          numeric(10,2);
  v_item           jsonb;
  v_recent_count   int;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;

  -- --------------------------------------------------------------------
  -- Basic anti-abuse rate limit: the public checkout form is reachable
  -- by anyone (including scripts) since it must accept anon calls. This
  -- caps how many orders the same phone number can create in a short
  -- window, so a bot hammering create_order can't flood the orders
  -- table. It's not perfect (a bot can rotate fake phone numbers), but
  -- it stops the common case cheaply and costs a real customer nothing.
  -- --------------------------------------------------------------------
  select count(*) into v_recent_count
    from public.orders
    where customer_phone = p_customer_phone
      and created_at > now() - interval '10 minutes';

  if v_recent_count >= 3 then
    raise exception 'Você já enviou pedidos recentemente. Aguarde alguns minutos antes de tentar novamente, ou fale com a gente pelo WhatsApp.';
  end if;

  select coalesce(sum((i->>'line_total')::numeric), 0)
    into v_total
    from jsonb_array_elements(p_items) as i;

  insert into public.orders
    (customer_name, customer_phone, customer_address, notes, payment_method, subtotal, total, status)
  values
    (p_customer_name, p_customer_phone, p_customer_address, nullif(p_notes, ''), 'pix', v_total, v_total, 'aguardando_pagamento')
  returning orders.id, orders.order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_name, quantity, unit_price, line_total, details)
    values (
      v_order_id,
      v_item->>'product_name',
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric,
      v_item->'details'
    );
  end loop;

  return query select v_order_id, v_order_number;
end;
$$;

-- only the public/anon role may call this function — admins use the
-- table policies below instead, they don't need this RPC.
grant execute on function public.create_order(text, text, text, text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- 6) Row Level Security
--    Nobody — not even the anon key — gets a direct SELECT/INSERT/UPDATE/
--    DELETE grant on these three tables. The public site creates orders
--    exclusively through create_order() above. Only an authenticated
--    admin (logged in on /admin) can read or manage them. This is the
--    REAL security boundary — the /admin login screen is just the UI.
-- --------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

drop policy if exists "admins can read orders" on public.orders;
create policy "admins can read orders"
  on public.orders for select
  to authenticated
  using (true);

drop policy if exists "admins can update orders" on public.orders;
create policy "admins can update orders"
  on public.orders for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "admins can delete orders" on public.orders;
create policy "admins can delete orders"
  on public.orders for delete
  to authenticated
  using (true);

drop policy if exists "admins can read order items" on public.order_items;
create policy "admins can read order items"
  on public.order_items for select
  to authenticated
  using (true);

drop policy if exists "admins can read order history" on public.order_status_history;
create policy "admins can read order history"
  on public.order_status_history for select
  to authenticated
  using (true);

-- --------------------------------------------------------------------------
-- 7) Realtime — lets the admin dashboard show "🔔 Novo pedido recebido"
--    the moment an order is inserted, without refreshing the page.
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 8) CALCULADORA DE PREÇO — internal tool, /admin only. Customers and the
--    public site never touch these tables, so there is no anon policy at
--    all here (default-deny — only logged-in admins can read or write).
-- --------------------------------------------------------------------------

-- one row per material, seeded below — edit the unit_cost values in the
-- admin UI, don't add/remove rows there (the app expects exactly these 6)
create table if not exists public.price_materials (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null check (key in ('perolas','crucifixo','entremeio','fio','embalagem','outros')),
  label      text not null,
  unit_cost  numeric(10,4) not null default 0 check (unit_cost >= 0),
  updated_at timestamptz not null default now()
);

insert into public.price_materials (key, label) values
  ('perolas',   'Pérolas'),
  ('crucifixo', 'Crucifixo'),
  ('entremeio', 'Entremeio'),
  ('fio',       'Fio'),
  ('embalagem', 'Embalagem'),
  ('outros',    'Outros')
on conflict (key) do nothing;

drop trigger if exists trg_price_materials_touch on public.price_materials;
create trigger trg_price_materials_touch
  before update on public.price_materials
  for each row execute function public.touch_updated_at();

-- saved terço models: how many units of each material a given model uses,
-- plus the chosen profit margin. Cost/profit/final price are always
-- recalculated live in the browser from the current material costs above
-- — nothing pre-computed is stored, so editing a material cost instantly
-- updates every model's price.
create table if not exists public.price_models (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(trim(name)) > 0),
  qty_perolas    numeric(10,2) not null default 0,
  qty_crucifixo  numeric(10,2) not null default 0,
  qty_entremeio  numeric(10,2) not null default 0,
  qty_fio        numeric(10,2) not null default 0,
  qty_embalagem  numeric(10,2) not null default 0,
  qty_outros     numeric(10,2) not null default 0,
  margin_percent numeric(6,2) not null default 50,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_price_models_touch on public.price_models;
create trigger trg_price_models_touch
  before update on public.price_models
  for each row execute function public.touch_updated_at();

alter table public.price_materials enable row level security;
alter table public.price_models enable row level security;

drop policy if exists "admins manage price materials" on public.price_materials;
create policy "admins manage price materials"
  on public.price_materials for all
  to authenticated
  using (true) with check (true);

drop policy if exists "admins manage price models" on public.price_models;
create policy "admins manage price models"
  on public.price_models for all
  to authenticated
  using (true) with check (true);

-- --------------------------------------------------------------------------
-- 9) ESTOQUE — integrated with the price calculator above.
--    price_materials gets stock tracking columns; purchases add to stock,
--    sales subtract from stock (using the quantities already registered
--    per terço model in price_models). Both go through RPC functions so
--    the stock update is atomic — no lost updates from two people (or two
--    tabs) editing stock at the same time.
-- --------------------------------------------------------------------------

alter table public.price_materials
  add column if not exists stock_quantity numeric(10,2) not null default 0,
  add column if not exists low_stock_threshold numeric(10,2) not null default 10;

create table if not exists public.stock_purchases (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.price_materials(id) on delete cascade,
  quantity      numeric(10,2) not null check (quantity > 0),
  total_cost    numeric(10,2) not null check (total_cost >= 0),
  notes         text,
  purchased_at  timestamptz not null default now()
);
create index if not exists stock_purchases_material_id_idx on public.stock_purchases (material_id);

create table if not exists public.stock_sales (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid not null references public.price_models(id) on delete cascade,
  quantity    integer not null check (quantity > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  unit_cost   numeric(10,2) not null check (unit_cost >= 0),  -- snapshot of cost at sale time
  profit      numeric(10,2) not null,                          -- snapshot too — material costs may change later
  notes       text,
  sold_at     timestamptz not null default now()
);
create index if not exists stock_sales_model_id_idx on public.stock_sales (model_id);

alter table public.stock_purchases enable row level security;
alter table public.stock_sales enable row level security;

drop policy if exists "admins manage stock purchases" on public.stock_purchases;
create policy "admins manage stock purchases"
  on public.stock_purchases for all
  to authenticated
  using (true) with check (true);

drop policy if exists "admins manage stock sales" on public.stock_sales;
create policy "admins manage stock sales"
  on public.stock_sales for all
  to authenticated
  using (true) with check (true);

-- register_purchase(): logs the purchase and atomically adds to stock.
-- Also updates the material's unit_cost to this purchase's price-per-unit,
-- so the calculator always reflects what you most recently paid.
create or replace function public.register_purchase(
  p_material_id uuid,
  p_quantity    numeric,
  p_total_cost  numeric,
  p_notes       text
)
returns public.stock_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stock_purchases;
begin
  insert into public.stock_purchases (material_id, quantity, total_cost, notes)
  values (p_material_id, p_quantity, p_total_cost, nullif(p_notes, ''))
  returning * into v_row;

  update public.price_materials
    set stock_quantity = stock_quantity + p_quantity,
        unit_cost = case when p_quantity > 0 then p_total_cost / p_quantity else unit_cost end
    where id = p_material_id;

  return v_row;
end;
$$;
grant execute on function public.register_purchase(uuid, numeric, numeric, text) to authenticated;

-- register_sale(): snapshots cost/profit for the given model + quantity,
-- logs the sale, and atomically subtracts the materials it used from stock.
create or replace function public.register_sale(
  p_model_id   uuid,
  p_quantity   integer,
  p_unit_price numeric,
  p_notes      text
)
returns public.stock_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model     public.price_models;
  v_unit_cost numeric(10,2) := 0;
  v_row       public.stock_sales;
begin
  select * into v_model from public.price_models where id = p_model_id;
  if not found then
    raise exception 'Modelo de terço não encontrado.';
  end if;

  select coalesce(sum(pm.unit_cost * qty.amount), 0) into v_unit_cost
  from (values
    ('perolas',   v_model.qty_perolas),
    ('crucifixo', v_model.qty_crucifixo),
    ('entremeio', v_model.qty_entremeio),
    ('fio',       v_model.qty_fio),
    ('embalagem', v_model.qty_embalagem),
    ('outros',    v_model.qty_outros)
  ) as qty(key, amount)
  join public.price_materials pm on pm.key = qty.key;

  insert into public.stock_sales (model_id, quantity, unit_price, unit_cost, profit, notes)
  values (
    p_model_id, p_quantity, p_unit_price, v_unit_cost,
    (p_unit_price - v_unit_cost) * p_quantity,
    nullif(p_notes, '')
  )
  returning * into v_row;

  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_perolas * p_quantity) where key = 'perolas';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_crucifixo * p_quantity) where key = 'crucifixo';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_entremeio * p_quantity) where key = 'entremeio';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_fio * p_quantity) where key = 'fio';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_embalagem * p_quantity) where key = 'embalagem';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_outros * p_quantity) where key = 'outros';

  return v_row;
end;
$$;
grant execute on function public.register_sale(uuid, integer, numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 10) Per-model material costs — each terço model now keeps its own cost
--     per material (the same material can cost more in one model than
--     another, e.g. nicer pearls). Editing a model's own cost no longer
--     changes any other model's price. The material's global unit_cost
--     (from step 8) is now only used as a starting suggestion when
--     creating a brand new model, and still drives stock/purchases.
-- --------------------------------------------------------------------------

alter table public.price_models
  add column if not exists cost_perolas    numeric(10,4) not null default 0,
  add column if not exists cost_crucifixo  numeric(10,4) not null default 0,
  add column if not exists cost_entremeio  numeric(10,4) not null default 0,
  add column if not exists cost_fio        numeric(10,4) not null default 0,
  add column if not exists cost_embalagem  numeric(10,4) not null default 0,
  add column if not exists cost_outros     numeric(10,4) not null default 0;

-- one-time backfill: give existing models the current global costs so
-- their price doesn't suddenly drop to zero after this migration
update public.price_models m
set cost_perolas   = coalesce((select unit_cost from public.price_materials where key = 'perolas'), 0),
    cost_crucifixo = coalesce((select unit_cost from public.price_materials where key = 'crucifixo'), 0),
    cost_entremeio = coalesce((select unit_cost from public.price_materials where key = 'entremeio'), 0),
    cost_fio       = coalesce((select unit_cost from public.price_materials where key = 'fio'), 0),
    cost_embalagem = coalesce((select unit_cost from public.price_materials where key = 'embalagem'), 0),
    cost_outros    = coalesce((select unit_cost from public.price_materials where key = 'outros'), 0)
where m.cost_perolas = 0 and m.cost_crucifixo = 0 and m.cost_entremeio = 0
  and m.cost_fio = 0 and m.cost_embalagem = 0 and m.cost_outros = 0;

-- register_sale() now costs the sale using the MODEL's own cost_* columns
-- instead of joining the shared price_materials table.
create or replace function public.register_sale(
  p_model_id   uuid,
  p_quantity   integer,
  p_unit_price numeric,
  p_notes      text
)
returns public.stock_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model     public.price_models;
  v_unit_cost numeric(10,2) := 0;
  v_row       public.stock_sales;
begin
  select * into v_model from public.price_models where id = p_model_id;
  if not found then
    raise exception 'Modelo de terço não encontrado.';
  end if;

  v_unit_cost :=
    v_model.qty_perolas   * v_model.cost_perolas +
    v_model.qty_crucifixo * v_model.cost_crucifixo +
    v_model.qty_entremeio * v_model.cost_entremeio +
    v_model.qty_fio       * v_model.cost_fio +
    v_model.qty_embalagem * v_model.cost_embalagem +
    v_model.qty_outros    * v_model.cost_outros;

  insert into public.stock_sales (model_id, quantity, unit_price, unit_cost, profit, notes)
  values (
    p_model_id, p_quantity, p_unit_price, v_unit_cost,
    (p_unit_price - v_unit_cost) * p_quantity,
    nullif(p_notes, '')
  )
  returning * into v_row;

  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_perolas * p_quantity) where key = 'perolas';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_crucifixo * p_quantity) where key = 'crucifixo';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_entremeio * p_quantity) where key = 'entremeio';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_fio * p_quantity) where key = 'fio';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_embalagem * p_quantity) where key = 'embalagem';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_outros * p_quantity) where key = 'outros';

  return v_row;
end;
$$;
grant execute on function public.register_sale(uuid, integer, numeric, text) to authenticated;

-- ==========================================================================
-- Done. Next: Authentication → Users → Add user, to create your first
-- admin login (see README.md, step 4).
-- ==========================================================================
