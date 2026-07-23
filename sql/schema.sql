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
  v_order_id     uuid;
  v_order_number bigint;
  v_total        numeric(10,2);
  v_item         jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
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

-- ==========================================================================
-- Done. Next: Authentication → Users → Add user, to create your first
-- admin login (see README.md, step 4).
-- ==========================================================================
