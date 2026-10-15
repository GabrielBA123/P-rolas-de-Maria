-- ==========================================================================
-- Pérolas de Maria — SQL COMPLETO (versão final, tudo em um arquivo)
-- ==========================================================================
-- Reúne: pedidos, estoque/calculadora, segurança (admin), cupons, o cupom
-- APARECIDA, o catálogo de produtos editável pelo painel, e o carrossel editável. Substitui o schema.sql antigo + seguranca.sql +
-- seguranca-parte2.sql + cupons.sql + cupom-imagem.sql.
--
-- Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--   • Banco NOVO: rode e depois crie seu login em Authentication → Users.
--     Em seguida torne-o admin com o comando que está no FIM deste arquivo.
--   • Banco que JÁ está funcionando (o seu): pode rodar por cima sem medo.
--     Não apaga pedidos nem dados; só garante que tudo está no estado final.
--     Se o Supabase mostrar o aviso amarelo "destructive operations", é por
--     causa dos "drop policy/trigger if exists" que recriam as regras.
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1) QUEM É ADMIN (schema "private": não é exposto pela API do Supabase)
--    As policies abaixo só liberam acesso a quem estiver nesta lista.
-- --------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.admin_users enable row level security;
revoke all on table private.admin_users from public, anon, authenticated;

drop policy if exists "ninguem acessa direto" on private.admin_users;
create policy "ninguem acessa direto"
  on private.admin_users for all to authenticated
  using (false) with check (false);

-- Só semeia a lista se ela estiver VAZIA (primeira vez). Em banco que já
-- tem admin, nada muda — contas criadas depois NÃO viram admin sozinhas.
do $$
begin
  if not exists (select 1 from private.admin_users) then
    insert into private.admin_users (user_id) select id from auth.users;
    if not exists (select 1 from private.admin_users) then
      raise notice 'Ainda não existe nenhum usuário. Crie o login em Authentication > Users e depois rode o comando do FIM deste arquivo para torná-lo admin.';
    end if;
  end if;
end $$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- --------------------------------------------------------------------------
-- 2) PEDIDOS
-- --------------------------------------------------------------------------
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     bigint generated always as identity,   -- #000001, #000002...
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

-- cupom usado e valor do desconto (bancos antigos ganham as colunas aqui)
alter table public.orders
  add column if not exists coupon_code text,
  add column if not exists discount numeric(10,2) not null default 0 check (discount >= 0);

create unique index if not exists orders_order_number_key on public.orders (order_number);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(10,2) not null check (unit_price >= 0),
  line_total   numeric(10,2) not null check (line_total >= 0),
  -- terços personalizados: { tipo, tipoLabel, cor, estilo, entremeio };
  -- itens com cupom: { cupom, preco_original }
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on public.order_items (order_id);

create table if not exists public.order_status_history (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  status     text not null,
  note       text,
  changed_at timestamptz not null default now()
);
create index if not exists order_status_history_order_id_idx on public.order_status_history (order_id);

-- --------------------------------------------------------------------------
-- 3) FUNÇÕES DE TRIGGER (search_path fixo; ninguém chama por fora)
-- --------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.log_order_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_status_history (order_id, status, note)
  values (new.id, new.status, 'Pedido criado');
  return new;
end;
$$;

create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, status)
    values (new.id, new.status);
  end if;
  return new;
end;
$$;

revoke all on function public.touch_updated_at()  from public, anon, authenticated;
revoke all on function public.log_order_created() from public, anon, authenticated;
revoke all on function public.log_status_change() from public, anon, authenticated;

drop trigger if exists trg_orders_touch_updated_at on public.orders;
create trigger trg_orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_orders_log_created on public.orders;
create trigger trg_orders_log_created
  after insert on public.orders
  for each row execute function public.log_order_created();

drop trigger if exists trg_orders_log_status_change on public.orders;
create trigger trg_orders_log_status_change
  after update on public.orders
  for each row execute function public.log_status_change();

-- --------------------------------------------------------------------------
-- 4) CALCULADORA DE PREÇO + ESTOQUE (só /admin)
-- --------------------------------------------------------------------------
create table if not exists public.price_materials (
  id                   uuid primary key default gen_random_uuid(),
  key                  text unique not null check (key in ('perolas','crucifixo','entremeio','fio','embalagem','outros')),
  label                text not null,
  unit_cost            numeric(10,4) not null default 0 check (unit_cost >= 0),
  stock_quantity       numeric(10,2) not null default 0,
  low_stock_threshold  numeric(10,2) not null default 10,
  updated_at           timestamptz not null default now()
);
alter table public.price_materials
  add column if not exists stock_quantity numeric(10,2) not null default 0,
  add column if not exists low_stock_threshold numeric(10,2) not null default 10;

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

create table if not exists public.price_models (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(trim(name)) > 0),
  qty_perolas    numeric(10,2) not null default 0,
  qty_crucifixo  numeric(10,2) not null default 0,
  qty_entremeio  numeric(10,2) not null default 0,
  qty_fio        numeric(10,2) not null default 0,
  qty_embalagem  numeric(10,2) not null default 0,
  qty_outros     numeric(10,2) not null default 0,
  cost_perolas   numeric(10,4) not null default 0,
  cost_crucifixo numeric(10,4) not null default 0,
  cost_entremeio numeric(10,4) not null default 0,
  cost_fio       numeric(10,4) not null default 0,
  cost_embalagem numeric(10,4) not null default 0,
  cost_outros    numeric(10,4) not null default 0,
  margin_percent numeric(6,2) not null default 50,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.price_models
  add column if not exists cost_perolas    numeric(10,4) not null default 0,
  add column if not exists cost_crucifixo  numeric(10,4) not null default 0,
  add column if not exists cost_entremeio  numeric(10,4) not null default 0,
  add column if not exists cost_fio        numeric(10,4) not null default 0,
  add column if not exists cost_embalagem  numeric(10,4) not null default 0,
  add column if not exists cost_outros     numeric(10,4) not null default 0;

drop trigger if exists trg_price_models_touch on public.price_models;
create trigger trg_price_models_touch
  before update on public.price_models
  for each row execute function public.touch_updated_at();

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
  unit_cost   numeric(10,2) not null check (unit_cost >= 0),
  profit      numeric(10,2) not null,
  notes       text,
  sold_at     timestamptz not null default now()
);
create index if not exists stock_sales_model_id_idx on public.stock_sales (model_id);

-- --------------------------------------------------------------------------
-- 5) CUPONS (preço promocional fixo por produto)
-- --------------------------------------------------------------------------
create table if not exists public.coupons (
  code        text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,30}$'),
  active      boolean not null default true,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.coupon_prices (
  coupon_code text not null references public.coupons(code) on delete cascade,
  product_id  text not null,              -- mesmo id do site (data-product-id)
  promo_price numeric(10,2) not null check (promo_price >= 0),
  primary key (coupon_code, product_id)
);

-- --------------------------------------------------------------------------
-- 6) FUNÇÕES DO SISTEMA
-- --------------------------------------------------------------------------

-- create_order(): a ÚNICA porta de entrada do checkout público. Valida
-- tudo, aplica o cupom e calcula total/desconto NO SERVIDOR. Retorna o
-- total e o desconto reais para o site usar na mensagem do WhatsApp.
drop function if exists public.create_order(text, text, text, text, jsonb);

create or replace function public.create_order(
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_address text,
  p_notes            text,
  p_items            jsonb,
  p_coupon           text default null
)
returns table(id uuid, order_number bigint, total numeric, discount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id     uuid;
  v_order_number bigint;
  v_subtotal     numeric(10,2) := 0;
  v_total        numeric(10,2) := 0;
  v_item         jsonb;
  v_norm         jsonb := '[]'::jsonb;
  v_qty          int;
  v_price        numeric;
  v_promo        numeric;
  v_final        numeric;
  v_code         text;
  v_applied      int := 0;
  v_recent_count int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;

  if jsonb_array_length(p_items) > 30 then
    raise exception 'Pedido com itens demais. Fale com a gente pelo WhatsApp.';
  end if;

  if char_length(coalesce(p_customer_name, ''))    > 120
     or char_length(coalesce(p_customer_phone, ''))   > 40
     or char_length(coalesce(p_customer_address, '')) > 300
     or char_length(coalesce(p_notes, ''))            > 500
     or char_length(coalesce(p_coupon, ''))           > 30 then
    raise exception 'Algum campo está longo demais.';
  end if;

  -- limite por telefone (anti-abuso do formulário público)
  select count(*) into v_recent_count
    from public.orders o
    where o.customer_phone = p_customer_phone
      and o.created_at > now() - interval '10 minutes';

  if v_recent_count >= 3 then
    raise exception 'Você já enviou pedidos recentemente. Aguarde alguns minutos antes de tentar novamente, ou fale com a gente pelo WhatsApp.';
  end if;

  -- cupom (se veio): precisa existir, estar ativo e não ter expirado
  v_code := upper(trim(coalesce(p_coupon, '')));
  if v_code <> '' then
    if not exists (
      select 1 from public.coupons c
      where c.code = v_code
        and c.active
        and (c.expires_at is null or c.expires_at > now())
    ) then
      raise exception 'Cupom inválido ou expirado.';
    end if;
  end if;

  -- valida cada item, aplica o preço do cupom e calcula tudo no servidor
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := (v_item->>'quantity')::int;
    v_price := (v_item->>'unit_price')::numeric;

    if v_qty is null or v_qty < 1 or v_qty > 50
       or v_price is null or v_price < 0 or v_price > 5000
       or coalesce(v_item->>'product_name', '') = ''
       or char_length(v_item->>'product_name') > 200
       or char_length(coalesce((v_item->'details')::text, '')) > 2000 then
      raise exception 'Item inválido no pedido.';
    end if;

    v_promo := null;
    if v_code <> '' then
      select cp.promo_price into v_promo
        from public.coupon_prices cp
        where cp.coupon_code = v_code
          and cp.product_id = (v_item->>'product_id');
    end if;

    -- o cupom nunca deixa o item mais caro do que o preço normal
    v_final := least(v_promo, v_price);
    if v_promo is not null and v_final < v_price then
      v_applied := v_applied + 1;
    end if;

    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_total    := v_total    + round(v_qty * v_final, 2);

    v_norm := v_norm || jsonb_build_object(
      'product_name', v_item->>'product_name',
      'quantity',     v_qty,
      'unit_price',   v_final,
      'line_total',   round(v_qty * v_final, 2),
      'details',      case
                        when v_promo is not null and v_final < v_price
                          then jsonb_build_object('cupom', v_code, 'preco_original', v_price)
                        else v_item->'details'
                      end
    );
  end loop;

  if v_code <> '' and v_applied = 0 then
    raise exception 'Este cupom não vale para os produtos do seu carrinho.';
  end if;

  insert into public.orders
    (customer_name, customer_phone, customer_address, notes, payment_method,
     subtotal, discount, total, coupon_code, status)
  values
    (p_customer_name, p_customer_phone, p_customer_address, nullif(p_notes, ''), 'pix',
     v_subtotal, v_subtotal - v_total, v_total,
     case when v_applied > 0 then v_code else null end,
     'aguardando_pagamento')
  returning orders.id, orders.order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(v_norm)
  loop
    insert into public.order_items (order_id, product_name, quantity, unit_price, line_total, details)
    values (
      v_order_id,
      v_item->>'product_name',
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric,
      case when jsonb_typeof(v_item->'details') = 'null' then null else v_item->'details' end
    );
  end loop;

  return query select v_order_id, v_order_number, v_total, (v_subtotal - v_total);
end;
$$;

-- register_purchase(): registra a compra e soma no estoque (SECURITY INVOKER:
-- roda com os poderes de quem chama, então só admin consegue, via RLS).
create or replace function public.register_purchase(
  p_material_id uuid,
  p_quantity    numeric,
  p_total_cost  numeric,
  p_notes       text
)
returns public.stock_purchases
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.stock_purchases;
begin
  if not (select private.is_admin()) then
    raise exception 'Acesso negado.';
  end if;

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

-- register_sale(): registra a venda de um modelo e baixa os materiais do estoque.
create or replace function public.register_sale(
  p_model_id   uuid,
  p_quantity   integer,
  p_unit_price numeric,
  p_notes      text
)
returns public.stock_sales
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_model     public.price_models;
  v_unit_cost numeric(10,2) := 0;
  v_row       public.stock_sales;
begin
  if not (select private.is_admin()) then
    raise exception 'Acesso negado.';
  end if;

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

  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_perolas   * p_quantity) where key = 'perolas';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_crucifixo * p_quantity) where key = 'crucifixo';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_entremeio * p_quantity) where key = 'entremeio';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_fio       * p_quantity) where key = 'fio';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_embalagem * p_quantity) where key = 'embalagem';
  update public.price_materials set stock_quantity = stock_quantity - (v_model.qty_outros    * p_quantity) where key = 'outros';

  return v_row;
end;
$$;

-- permissões das funções: create_order é pública (é o checkout; "authenticated"
-- fica liberado porque, logada no /admin, o checkout do site roda como logada);
-- register_* só para logados (e a checagem de admin acontece dentro/por RLS).
revoke all on function public.create_order(text, text, text, text, jsonb, text)  from public;
revoke all on function public.register_purchase(uuid, numeric, numeric, text)    from public, anon;
revoke all on function public.register_sale(uuid, integer, numeric, text)        from public, anon;

grant execute on function public.create_order(text, text, text, text, jsonb, text)  to anon, authenticated;
grant execute on function public.register_purchase(uuid, numeric, numeric, text)    to authenticated;
grant execute on function public.register_sale(uuid, integer, numeric, text)        to authenticated;

-- --------------------------------------------------------------------------
-- 7) SEGURANÇA DAS TABELAS (RLS: só admin lê/escreve; público só via create_order)
-- --------------------------------------------------------------------------
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_status_history enable row level security;
alter table public.price_materials      enable row level security;
alter table public.price_models         enable row level security;
alter table public.stock_purchases      enable row level security;
alter table public.stock_sales          enable row level security;
alter table public.coupons              enable row level security;
alter table public.coupon_prices        enable row level security;

drop policy if exists "admins can read orders" on public.orders;
create policy "admins can read orders"
  on public.orders for select to authenticated
  using ((select private.is_admin()));

drop policy if exists "admins can update orders" on public.orders;
create policy "admins can update orders"
  on public.orders for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admins can delete orders" on public.orders;
create policy "admins can delete orders"
  on public.orders for delete to authenticated
  using ((select private.is_admin()));

drop policy if exists "admins can read order items" on public.order_items;
create policy "admins can read order items"
  on public.order_items for select to authenticated
  using ((select private.is_admin()));

drop policy if exists "admins can read order history" on public.order_status_history;
create policy "admins can read order history"
  on public.order_status_history for select to authenticated
  using ((select private.is_admin()));

drop policy if exists "admins manage price materials" on public.price_materials;
create policy "admins manage price materials"
  on public.price_materials for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage price models" on public.price_models;
create policy "admins manage price models"
  on public.price_models for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage stock purchases" on public.stock_purchases;
create policy "admins manage stock purchases"
  on public.stock_purchases for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage stock sales" on public.stock_sales;
create policy "admins manage stock sales"
  on public.stock_sales for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons"
  on public.coupons for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage coupon prices" on public.coupon_prices;
create policy "admins manage coupon prices"
  on public.coupon_prices for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- segundo cadeado: o público (anon) não precisa de acesso direto a NENHUMA tabela
revoke all on table
  public.orders,
  public.order_items,
  public.order_status_history,
  public.price_materials,
  public.price_models,
  public.stock_purchases,
  public.stock_sales,
  public.coupons,
  public.coupon_prices
from anon;

-- funções novas que você criar no futuro não nascem executáveis pelo público
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 8) REALTIME — aviso "Novo pedido" no painel sem recarregar a página
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
-- 9) CUPOM "APARECIDA" — rodar de novo atualiza os preços abaixo
-- --------------------------------------------------------------------------
insert into public.coupons (code, active) values ('APARECIDA', true)
on conflict (code) do nothing;

insert into public.coupon_prices (coupon_code, product_id, promo_price) values
  ('APARECIDA', 'terco-aparecida',          32.90),  -- Terço Nossa Senhora Aparecida (de 39,90)
  ('APARECIDA', 'terco-corrente-aparecida',  9.90),  -- Terço de Corrente (de 19,90)
  ('APARECIDA', 'santinha-aparecida',        6.00),  -- Santinha (de 7,90)
  ('APARECIDA', 'chaveiro-aparecida',        6.00),  -- Chaveiro (de 7,90)
  ('APARECIDA', 'imagem-aparecida',         14.90)   -- Imagem de N.S. Aparecida 15 cm (de 19,90)
on conflict (coupon_code, product_id) do update set promo_price = excluded.promo_price;

commit;

-- ##########################################################################
-- PARTE 2 — CATÁLOGO NO PAINEL: produtos, opções, fotos, cupons e preço decidido
-- no servidor. (Também existe separado em sql/catalogo.sql, para quem já tem o
-- banco da parte 1 funcionando.)
-- ##########################################################################

begin;

-- --------------------------------------------------------------------------
-- 1) TABELAS
-- --------------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name          text not null check (char_length(trim(name)) between 1 and 120),
  tagline       text check (char_length(tagline) <= 200),        -- frase curta do card
  description   text check (char_length(description) <= 4000),   -- texto da página
  eyebrow       text check (char_length(eyebrow) <= 80),         -- etiqueta acima do nome
  option_title  text not null default 'Cor'
                  check (char_length(trim(option_title)) between 1 and 30),  -- "Cor", "Modelo"...
  price         numeric(10,2) not null check (price >= 0 and price <= 5000),
  has_entremeio boolean not null default false,                  -- pede o santo(a) do entremeio
  is_new        boolean not null default false,                  -- selo "Novidade"
  featured      boolean not null default false,                  -- card grande na home
  sold_out      boolean not null default false,                  -- esgotado
  active        boolean not null default true,                   -- aparece no site
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label       text not null check (char_length(trim(label)) between 1 and 80),
  color       text check (color ~ '^#[0-9A-Fa-f]{6}$'),          -- bolinha de cor
  price       numeric(10,2) check (price >= 0 and price <= 5000), -- vazio = preço do produto
  cart_id     text not null unique
                check (cart_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(cart_id) <= 80),
  swatch_url  text check (char_length(swatch_url) <= 600),       -- foto da pérola/amostra
  sold_out    boolean not null default false,
  sort_order  integer not null default 0,
  unique (product_id, key)
);

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  variant_id  uuid references public.product_variants(id) on delete cascade, -- vazio = foto geral
  url         text not null check (char_length(url) <= 600),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists product_variants_product_idx on public.product_variants (product_id);
create index if not exists product_images_product_idx   on public.product_images (product_id);
create index if not exists product_images_variant_idx   on public.product_images (variant_id);
create index if not exists products_sort_idx            on public.products (sort_order);

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- o "código no carrinho" de uma opção nunca pode ser igual ao slug de um produto
create or replace function private.check_catalog_ids()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'product_variants' then
    if exists (select 1 from public.products p where p.slug = new.cart_id) then
      raise exception 'O código "%" já é o endereço de um produto. Escolha outro nome para a opção.', new.cart_id;
    end if;
  else
    if exists (select 1 from public.product_variants v where v.cart_id = new.slug) then
      raise exception 'O endereço "%" já é usado por uma opção de outro produto.', new.slug;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.check_catalog_ids() from public, anon, authenticated;

drop trigger if exists trg_variants_ids on public.product_variants;
create trigger trg_variants_ids before insert or update of cart_id on public.product_variants
  for each row execute function private.check_catalog_ids();
drop trigger if exists trg_products_ids on public.products;
create trigger trg_products_ids before insert or update of slug on public.products
  for each row execute function private.check_catalog_ids();

-- --------------------------------------------------------------------------
-- 2) SEGURANÇA (RLS): o público só LÊ o que está ativo; só admin escreve
-- --------------------------------------------------------------------------
alter table public.products         enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images   enable row level security;

drop policy if exists "public reads active products" on public.products;
create policy "public reads active products"
  on public.products for select to anon, authenticated
  using (active);

drop policy if exists "public reads variants of active products" on public.product_variants;
create policy "public reads variants of active products"
  on public.product_variants for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.active));

drop policy if exists "public reads images of active products" on public.product_images;
create policy "public reads images of active products"
  on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.active));

drop policy if exists "admins manage products" on public.products;
create policy "admins manage products"
  on public.products for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage variants" on public.product_variants;
create policy "admins manage variants"
  on public.product_variants for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admins manage images" on public.product_images;
create policy "admins manage images"
  on public.product_images for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.products, public.product_variants, public.product_images from anon;
grant select on public.products, public.product_variants, public.product_images to anon;

-- --------------------------------------------------------------------------
-- 3) FOTOS: bucket público para leitura; só o admin envia/apaga
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "admins read product photos"   on storage.objects;
drop policy if exists "admins upload product photos" on storage.objects;
drop policy if exists "admins update product photos" on storage.objects;
drop policy if exists "admins delete product photos" on storage.objects;

create policy "admins read product photos" on storage.objects for select to authenticated
  using (bucket_id = 'produtos' and (select private.is_admin()));
create policy "admins upload product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and (select private.is_admin()));
create policy "admins update product photos" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and (select private.is_admin()))
  with check (bucket_id = 'produtos' and (select private.is_admin()));
create policy "admins delete product photos" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and (select private.is_admin()));

-- --------------------------------------------------------------------------
-- 4) PRODUTOS QUE JÁ ESTÃO NO SITE (só na 1ª vez)
-- --------------------------------------------------------------------------
do $seed$
declare pid uuid;
begin
  if exists (select 1 from public.products) then return; end if;   -- só semeia na primeira vez (não sobrescreve edições do painel)

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$terco-aparecida$pdm$, $pdm$Terço Nossa Senhora Aparecida$pdm$, null, $pdm$Contas de pérola em azul royal, entremeio de Nossa Senhora Aparecida esmaltado em azul e dourado, e crucifixo em resina branca com detalhes em dourado.

- Contas de pérola azul royal, 12 posições
- Entremeio esmaltado de Nossa Senhora Aparecida
- Crucifixo branco com acabamento dourado
- Amarração artesanal reforçada$pdm$, $pdm$Edição devocional$pdm$, $pdm$Cor$pdm$,
          39.90, false, false, true, 10)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-aparecida-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-aparecida-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-aparecida-3.jpg$pdm$, 30);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-aparecida-4.jpg$pdm$, 40);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$terco-infantil$pdm$, $pdm$Terço Infantil$pdm$, $pdm$Com anjinho da guarda e crucifixo emborrachados, leve e resistente.$pdm$, $pdm$Terço pensado especialmente para os pequenos, disponível em rosa ou azul: contas leves e arredondadas e dois pingentes fofos emborrachados — o anjinho da guarda e o crucifixo — que tornam a oração mais lúdica e gostosa de aprender desde cedo.

- Duas cores à escolha: rosa ou azul
- Contas leves e resistentes, no tamanho ideal para as mãozinhas
- Medalha do anjinho da guarda emborrachada
- Crucifixo emborrachado a tiracolo$pdm$, $pdm$Novo ramo · terço infantil$pdm$, $pdm$Cor$pdm$,
          22.90, false, true, false, 20)
  returning id into pid;
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$rosa$pdm$, $pdm$Rosa$pdm$, $pdm$#F58BB9$pdm$, null, $pdm$terco-infantil-rosa$pdm$, null, 10);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$azul$pdm$, $pdm$Azul$pdm$, $pdm$#2147C9$pdm$, null, $pdm$terco-infantil-azul$pdm$, null, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$rosa$pdm$), $pdm$assets/images/terco-infantil-rosa-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$rosa$pdm$), $pdm$assets/images/terco-infantil-rosa-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$rosa$pdm$), $pdm$assets/images/terco-infantil-rosa-3.jpg$pdm$, 30);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$azul$pdm$), $pdm$assets/images/terco-infantil-azul-1.jpg$pdm$, 40);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$azul$pdm$), $pdm$assets/images/terco-infantil-azul-2.jpg$pdm$, 50);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$santinha-aparecida$pdm$, $pdm$Santinha de Nossa Senhora Aparecida$pdm$, $pdm$Metal dourado com strass e base adesiva — fixa onde quiser.$pdm$, $pdm$Pequena imagem de Nossa Senhora Aparecida em metal dourado, com manto azul em resina e strass aplicado no resplendor e nas bordas. Vem com base adesiva na parte de baixo: é só descolar a proteção e fixar onde quiser — painel do carro, cabeceira, mesa de trabalho ou cantinho de oração.

- Metal dourado com manto azul em resina
- Strass no resplendor e nas bordas do manto
- Base com adesivo — fixa onde você quiser
- Acompanha caixinha transparente$pdm$, $pdm$Novo ramo · imagem devocional$pdm$, $pdm$Cor$pdm$,
          7.90, false, true, false, 30)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/santinha-aparecida-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/santinha-aparecida-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/santinha-aparecida-3.jpg$pdm$, 30);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$imagem-aparecida$pdm$, $pdm$Imagem de Nossa Senhora Aparecida$pdm$, $pdm$15 cm, resistente, com acabamento branco perolado.$pdm$, $pdm$Imagem de Nossa Senhora Aparecida com 15 cm de altura, de acabamento branco perolado e riqueza de detalhes em relevo: o manto bordado, a coroa, o terço entre as mãos e o anjinho aos pés da Padroeira. Uma peça resistente, feita para durar — perfeita para o altar, o oratório, a cabeceira ou para presentear com fé.

- 15 cm de altura
- Peça resistente
- Acabamento branco perolado
- Detalhes em relevo: manto, coroa, terço e anjinho$pdm$, $pdm$Novo ramo · imagem devocional$pdm$, $pdm$Cor$pdm$,
          19.90, false, true, false, 40)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/imagem-aparecida-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/imagem-aparecida-2.jpg$pdm$, 20);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$pulseira-sao-bento$pdm$, $pdm$Terço-Pulseira de São Bento$pdm$, $pdm$Hematita importada, medalha e crucifixo de São Bento.$pdm$, $pdm$Fé e proteção direto no pulso: pulseira dupla volta em contas de hematita importada, medalha de São Bento (frente e verso) e crucifixo de São Bento. Fecho em inox tipo mosquetão, 22cm de comprimento.

- Contas de hematita importada
- Medalha de São Bento nos dois lados
- Crucifixo de São Bento
- Fecho em inox, 22cm$pdm$, $pdm$Novo ramo · terço de pulso$pdm$, $pdm$Cor$pdm$,
          14.90, false, true, false, 50)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/pulseira-sao-bento-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/pulseira-sao-bento-2.jpg$pdm$, 20);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$terco-pulso$pdm$, $pdm$Terço de Pulso$pdm$, $pdm$Com medalha de São Bento ou de Nossa Senhora Aparecida e crucifixo.$pdm$, $pdm$Terço de pulso artesanal para levar a sua fé sempre junto de você: contas arredondadas, medalha central do santo de devoção, fecho de lagosta e um crucifixo na ponta. Escolha o seu modelo:

- **Marrom de São Bento** — contas marrom-escuro com a medalha de São Bento
- **Preto de São Bento** — contas pretas com a medalha de São Bento
- **Branco de Nossa Senhora Aparecida** — contas brancas perolizadas com a medalha da Padroeira$pdm$, $pdm$Novo ramo · terço de pulso$pdm$, $pdm$Modelo$pdm$,
          13.90, false, true, false, 60)
  returning id into pid;
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$marrom$pdm$, $pdm$Marrom de São Bento$pdm$, $pdm$#6B1F1A$pdm$, null, $pdm$terco-pulso-marrom$pdm$, null, 10);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$preto$pdm$, $pdm$Preto de São Bento$pdm$, $pdm$#151515$pdm$, null, $pdm$terco-pulso-preto$pdm$, null, 20);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$branco$pdm$, $pdm$Branco de Nossa Senhora Aparecida$pdm$, $pdm$#F4F1EA$pdm$, null, $pdm$terco-pulso-branco$pdm$, null, 30);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-pulso-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-pulso-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$marrom$pdm$), $pdm$assets/images/terco-pulso-marrom.jpg$pdm$, 30);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$preto$pdm$), $pdm$assets/images/terco-pulso-preto.jpg$pdm$, 40);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$branco$pdm$), $pdm$assets/images/terco-pulso-branco.jpg$pdm$, 50);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$terco-corrente-aparecida$pdm$, $pdm$Terço de Corrente Nossa Senhora Aparecida$pdm$, $pdm$Contas de madeira com aroma de rosas 🌹 e corrente prateada.$pdm$, $pdm$Terço montado em corrente prateada com contas de madeira em vermelho vibrante, entremeio de Nossa Senhora Aparecida em relevo e crucifixo prateado com INRI. As contas são perfumadas com aroma de rosas 🌹 — um detalhe que acompanha a oração e permanece na peça. Acompanha estojinho redondo transparente com a imagem da Padroeira.

- Contas de madeira vermelha perfumadas com aroma de rosas 🌹
- Corrente e acabamentos prateados
- Entremeio de Nossa Senhora Aparecida em relevo
- Crucifixo prateado com detalhe INRI
- Acompanha estojinho redondo transparente$pdm$, $pdm$Novo ramo · terço de corrente$pdm$, $pdm$Cor$pdm$,
          19.90, false, true, false, 70)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-corrente-aparecida-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-corrente-aparecida-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-corrente-aparecida-3.jpg$pdm$, 30);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-corrente-aparecida-4.jpg$pdm$, 40);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$terco-emborrachado$pdm$, $pdm$Terço Emborrachado$pdm$, $pdm$Escolha a cor e o santo(a) do entremeio.$pdm$, $pdm$Terço artesanal com contas emborrachadas de acabamento fosco, separadores de pérola texturizada, cordão branco trançado, crucifixo dourado e uma medalha dourada com o santo(a) da sua devoção. Escolha a cor e o entremeio:

- 5 cores: vermelho, verde militar, cinza, lilás e marrom
- Entremeio com o santo(a) que você escolher
- Separadores de pérola texturizada
- Crucifixo dourado$pdm$, $pdm$Novo ramo · terço emborrachado$pdm$, $pdm$Cor$pdm$,
          24.90, true, true, false, 80)
  returning id into pid;
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$vermelho$pdm$, $pdm$Vermelho$pdm$, $pdm$#C91C34$pdm$, null, $pdm$terco-emb-vermelho$pdm$, $pdm$assets/images/terco-emb-perola-vermelho.jpg$pdm$, 10);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$verde-militar$pdm$, $pdm$Verde militar$pdm$, $pdm$#7B925F$pdm$, null, $pdm$terco-emb-verde-militar$pdm$, $pdm$assets/images/terco-emb-perola-verde-militar.jpg$pdm$, 20);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$cinza$pdm$, $pdm$Cinza$pdm$, $pdm$#666769$pdm$, null, $pdm$terco-emb-cinza$pdm$, $pdm$assets/images/terco-emb-perola-cinza.jpg$pdm$, 30);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$lilas$pdm$, $pdm$Lilás$pdm$, $pdm$#9D7DCB$pdm$, null, $pdm$terco-emb-lilas$pdm$, $pdm$assets/images/terco-emb-perola-lilas.jpg$pdm$, 40);
  insert into public.product_variants (product_id, key, label, color, price, cart_id, swatch_url, sort_order)
  values (pid, $pdm$marrom$pdm$, $pdm$Marrom$pdm$, $pdm$#864C35$pdm$, null, $pdm$terco-emb-marrom$pdm$, $pdm$assets/images/terco-emb-perola-marrom.jpg$pdm$, 50);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$vermelho$pdm$), $pdm$assets/images/terco-emb-vermelho-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$vermelho$pdm$), $pdm$assets/images/terco-emb-vermelho-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$verde-militar$pdm$), $pdm$assets/images/terco-emb-verde-1.jpg$pdm$, 30);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, (select id from public.product_variants where product_id = pid and key = $pdm$verde-militar$pdm$), $pdm$assets/images/terco-emb-verde-2.jpg$pdm$, 40);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$terco-madeira$pdm$, $pdm$Terço de Madeira$pdm$, $pdm$Contas de madeira, cordão preto e o santo(a) do entremeio à sua escolha.$pdm$, $pdm$Terço artesanal de contas de madeira em tom marrom-escuro, com cordão preto trançado, crucifixo dourado e uma medalha dourada com o santo(a) da sua devoção. A única escolha é o entremeio:

- Contas de madeira em tom marrom-escuro
- Cordão preto trançado
- Entremeio com o santo(a) que você escolher
- Crucifixo dourado$pdm$, $pdm$Novo ramo · terço de madeira$pdm$, $pdm$Cor$pdm$,
          22.90, true, true, false, 90)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-madeira-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-madeira-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/terco-madeira-3.jpg$pdm$, 30);

  insert into public.products (slug, name, tagline, description, eyebrow, option_title, price, has_entremeio, is_new, featured, sort_order)
  values ($pdm$chaveiro-aparecida$pdm$, $pdm$Chaveiro Nossa Senhora Aparecida$pdm$, $pdm$Strass e detalhes dourados, acabamento delicado.$pdm$, $pdm$Chaveiro de Nossa Senhora Aparecida com acabamento em strass e detalhes dourados, argola tipo mosquetão. Vem em diversos formatos (coração, oval, retangular e mais) — o modelo é enviado sortido entre os desenhos da coleção.$pdm$, $pdm$Novo ramo · chaveiro da fé$pdm$, $pdm$Cor$pdm$,
          7.90, false, true, false, 100)
  returning id into pid;
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/chaveiro-aparecida-1.jpg$pdm$, 10);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/chaveiro-aparecida-2.jpg$pdm$, 20);
  insert into public.product_images (product_id, variant_id, url, sort_order) values (pid, null, $pdm$assets/images/chaveiro-aparecida-3.jpg$pdm$, 30);
end
$seed$;

-- --------------------------------------------------------------------------
-- 5) get_coupon(): o site pergunta ao servidor o preço do cupom digitado.
--    Só devolve se o cupom existir, estiver ativo e não tiver expirado.
--    (Aparece no Security Advisor como aviso "esperado": é pública de propósito,
--    igual ao create_order.)
-- --------------------------------------------------------------------------
create or replace function public.get_coupon(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_prices jsonb;
begin
  if v_code = '' or char_length(v_code) > 30 then return null; end if;

  if not exists (
    select 1 from public.coupons c
    where c.code = v_code and c.active and (c.expires_at is null or c.expires_at > now())
  ) then
    return null;
  end if;

  select coalesce(jsonb_object_agg(cp.product_id, cp.promo_price), '{}'::jsonb)
    into v_prices
    from public.coupon_prices cp
    where cp.coupon_code = v_code;

  return jsonb_build_object('code', v_code, 'prices', v_prices);
end;
$$;
revoke all on function public.get_coupon(text) from public;
grant execute on function public.get_coupon(text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 6) create_order(): AGORA O SERVIDOR DECIDE O PREÇO
--    - produtos do catálogo: preço (e preço da opção) vêm da tabela, não do navegador
--    - produto/opção esgotado, oculto ou inexistente: o pedido é recusado com aviso claro
--    - produtos com entremeio: o entremeio é obrigatório
--    - terços personalizados: preço calculado aqui pelas mesmas regras do site
--      (6mm R$ 19,90 / com nome R$ 22,90 · 8mm R$ 24,90 / com nome R$ 26,90 · só pérolas R$ 29,90)
--    - cupom: preço promocional por produto (tabela coupon_prices), como antes
--    Compatível com o site antigo: o código do carrinho ("santinha-aparecida",
--    "terco-infantil-azul", "terco-emb-verde-militar--sao-bento") é resolvido aqui.
-- --------------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_address text,
  p_notes            text,
  p_items            jsonb,
  p_coupon           text default null
)
returns table(id uuid, order_number bigint, total numeric, discount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id     uuid;
  v_order_number bigint;
  v_subtotal     numeric(10,2) := 0;
  v_total        numeric(10,2) := 0;
  v_item         jsonb;
  v_norm         jsonb := '[]'::jsonb;
  v_qty          int;
  v_price        numeric;
  v_promo        numeric;
  v_final        numeric;
  v_code         text;
  v_applied      int := 0;
  v_recent_count int;
  v_cart_id      text;
  v_base         text;
  v_product      public.products%rowtype;
  v_variant      public.product_variants%rowtype;
  v_has_product  boolean;
  v_has_variant  boolean;
  v_name         text;
  v_ent          text;
  v_details      jsonb;
  v_tipo         text;
  v_nome         text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;

  if jsonb_array_length(p_items) > 30 then
    raise exception 'Pedido com itens demais. Fale com a gente pelo WhatsApp.';
  end if;

  if char_length(coalesce(p_customer_name, ''))    > 120
     or char_length(coalesce(p_customer_phone, ''))   > 40
     or char_length(coalesce(p_customer_address, '')) > 300
     or char_length(coalesce(p_notes, ''))            > 500
     or char_length(coalesce(p_coupon, ''))           > 30 then
    raise exception 'Algum campo está longo demais.';
  end if;

  -- limite por telefone (anti-abuso do formulário público)
  select count(*) into v_recent_count
    from public.orders o
    where o.customer_phone = p_customer_phone
      and o.created_at > now() - interval '10 minutes';

  if v_recent_count >= 3 then
    raise exception 'Você já enviou pedidos recentemente. Aguarde alguns minutos antes de tentar novamente, ou fale com a gente pelo WhatsApp.';
  end if;

  -- cupom (se veio): precisa existir, estar ativo e não ter expirado
  v_code := upper(trim(coalesce(p_coupon, '')));
  if v_code <> '' then
    if not exists (
      select 1 from public.coupons c
      where c.code = v_code
        and c.active
        and (c.expires_at is null or c.expires_at > now())
    ) then
      raise exception 'Cupom inválido ou expirado.';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 50 then
      raise exception 'Item inválido no pedido.';
    end if;

    v_cart_id := coalesce(v_item->>'product_id', '');
    if v_cart_id = '' or char_length(v_cart_id) > 200 then
      raise exception 'Item inválido no pedido.';
    end if;
    v_base := split_part(v_cart_id, '--', 1);     -- "<produto ou opção>[--<entremeio>]"

    v_promo := null; v_details := null; v_ent := null;
    v_has_variant := false;

    -- 1) produto do catálogo (pelo endereço) ou 2) opção de um produto (pelo código)
    select * into v_product from public.products p where p.slug = v_base and p.active;
    v_has_product := found;
    if not v_has_product then
      select * into v_variant from public.product_variants pv where pv.cart_id = v_base;
      v_has_variant := found;
      if v_has_variant then
        select * into v_product from public.products p where p.id = v_variant.product_id and p.active;
        v_has_product := found;
      end if;
    end if;

    if v_has_product then
      if not v_has_variant and exists (select 1 from public.product_variants pv where pv.product_id = v_product.id) then
        raise exception 'Escolha uma opção de "%" antes de finalizar.', v_product.name;
      end if;

      if v_product.sold_out or (v_has_variant and v_variant.sold_out) then
        raise exception 'O produto "%" está esgotado. Remova-o do carrinho para continuar.',
          trim(v_product.name || case when v_has_variant then ' ' || v_variant.label else '' end);
      end if;

      v_price := case when v_has_variant and v_variant.price is not null then v_variant.price else v_product.price end;

      if v_product.has_entremeio then
        v_ent := nullif(trim(coalesce(v_item->'details'->>'entremeio', '')), '');
        if v_ent is null then
          raise exception 'Escolha o entremeio de "%" antes de finalizar.', v_product.name;
        end if;
        if char_length(v_ent) > 120 then
          raise exception 'Entremeio inválido.';
        end if;
        v_details := jsonb_build_object(
          'tipoLabel', v_product.name,
          'cor', case when v_has_variant then v_variant.label else null end,
          'entremeio', v_ent
        );
      end if;

      v_name := v_product.name
        || case when v_has_variant then ' ' || v_variant.label else '' end
        || case when v_ent is not null then ' — entremeio: ' || v_ent else '' end;

      if v_code <> '' then
        select cp.promo_price into v_promo
          from public.coupon_prices cp
          where cp.coupon_code = v_code and cp.product_id = v_product.slug;
      end if;

    elsif v_base like 'custom-%' then
      -- terço personalizado (montado no configurador do site): preço pelas regras fixas
      v_tipo := v_item->'details'->>'tipo';
      v_price := null;
      if v_tipo = 'perolas' then
        v_price := 29.90;
      elsif v_tipo = 'normal' then
        v_nome := nullif(trim(coalesce(v_item->'details'->>'nomePersonalizado', '')), '');
        v_price := case v_item->'details'->>'tamanho'
          when '6mm' then case when v_nome is null then 19.90 else 22.90 end
          when '8mm' then case when v_nome is null then 24.90 else 26.90 end
          else null end;
      end if;
      if v_price is null then
        raise exception 'Item personalizado inválido.';
      end if;
      v_name := coalesce(nullif(trim(v_item->>'product_name'), ''), 'Terço personalizado');
      v_details := v_item->'details';
      if char_length(v_name) > 200 or char_length(coalesce(v_details::text, '')) > 2000 then
        raise exception 'Item inválido no pedido.';
      end if;

    else
      raise exception 'Um dos produtos do carrinho não está mais disponível. Atualize a página e monte o carrinho de novo.';
    end if;

    -- o cupom nunca deixa o item mais caro do que o preço normal
    v_final := least(v_promo, v_price);
    if v_promo is not null and v_final < v_price then
      v_applied := v_applied + 1;
      v_details := case
        when jsonb_typeof(v_details) = 'object'
          then v_details || jsonb_build_object('cupom', v_code, 'preco_original', v_price)
        else jsonb_build_object('cupom', v_code, 'preco_original', v_price)
      end;
    end if;

    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_total    := v_total    + round(v_qty * v_final, 2);

    v_norm := v_norm || jsonb_build_object(
      'product_name', v_name,
      'quantity',     v_qty,
      'unit_price',   v_final,
      'line_total',   round(v_qty * v_final, 2),
      'details',      v_details
    );
  end loop;

  if v_code <> '' and v_applied = 0 then
    raise exception 'Este cupom não vale para os produtos do seu carrinho.';
  end if;

  insert into public.orders
    (customer_name, customer_phone, customer_address, notes, payment_method,
     subtotal, discount, total, coupon_code, status)
  values
    (p_customer_name, p_customer_phone, p_customer_address, nullif(p_notes, ''), 'pix',
     v_subtotal, v_subtotal - v_total, v_total,
     case when v_applied > 0 then v_code else null end,
     'aguardando_pagamento')
  returning orders.id, orders.order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(v_norm)
  loop
    insert into public.order_items (order_id, product_name, quantity, unit_price, line_total, details)
    values (
      v_order_id,
      v_item->>'product_name',
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric,
      case when jsonb_typeof(v_item->'details') = 'null' then null else v_item->'details' end
    );
  end loop;

  return query select v_order_id, v_order_number, v_total, (v_subtotal - v_total);
end;
$$;

revoke all on function public.create_order(text, text, text, text, jsonb, text) from public;
grant execute on function public.create_order(text, text, text, text, jsonb, text) to anon, authenticated;

commit;

-- ##########################################################################
-- PARTE 3 — EXTRAS: carrossel editável (também existe separado em sql/extras.sql)
-- ##########################################################################

begin;

-- --------------------------------------------------------------------------
-- 1) CARROSSEL
-- --------------------------------------------------------------------------
create table if not exists public.carousel_slides (
  id          uuid primary key default gen_random_uuid(),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  image_url   text not null check (char_length(image_url) <= 600),
  eyebrow     text check (char_length(eyebrow) <= 40),            -- etiqueta pequena ("Novidade")
  title       text not null check (char_length(trim(title)) between 1 and 80),
  text        text check (char_length(text) <= 160),
  cta_text    text check (char_length(cta_text) <= 30),            -- texto do link ("Ver terço →")
  link        text not null default '#produtos'
                check (char_length(link) <= 300 and link ~ '^(/|#|https://)'),   -- nunca javascript:
  created_at  timestamptz not null default now()
);
create index if not exists carousel_slides_sort_idx on public.carousel_slides (sort_order);

alter table public.carousel_slides enable row level security;

drop policy if exists "public reads active slides" on public.carousel_slides;
create policy "public reads active slides"
  on public.carousel_slides for select to anon, authenticated
  using (active);

drop policy if exists "admins manage slides" on public.carousel_slides;
create policy "admins manage slides"
  on public.carousel_slides for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.carousel_slides from anon;
grant select on public.carousel_slides to anon;

-- os 3 slides que já estão no site (só na primeira vez)
do $seed$
begin
  if exists (select 1 from public.carousel_slides) then return; end if;
  insert into public.carousel_slides (sort_order, image_url, eyebrow, title, text, cta_text, link) values
    (10, 'assets/images/carousel-chaveiros-aparecida.jpg', '✦ Novidade', 'Chaveiro Nossa Senhora Aparecida',
         'Strass e detalhes dourados, acabamento delicado — R$ 7,90', 'Ver chaveiro →', '/produto/chaveiro-aparecida'),
    (20, 'assets/images/carousel-tercos-diversos.jpg', 'Nossa coleção', 'Terços artesanais',
         'Feitos à mão, um a um, com fé em cada conta', 'Ver terços →', '#produtos'),
    (30, 'assets/images/terco-aparecida-1.jpg', 'Mais pedido', 'Terço Nossa Senhora Aparecida',
         'Contas de pérola azul royal, feito à mão — R$ 39,90', 'Ver terço →', '#produtos');
end
$seed$;

-- --------------------------------------------------------------------------
-- 2) LIMPEZA: o aviso de pedido por Telegram (de uma versão anterior deste script)
--    foi removido. Estas linhas só garantem que, se ele chegou a ser criado no seu
--    banco, sai por completo. Se nunca foi criado, não fazem nada.
-- --------------------------------------------------------------------------
drop trigger  if exists trg_orders_notify on public.orders;
drop function if exists private.notify_new_order();
drop function if exists private.send_telegram(text);
drop table    if exists private.notify_settings;

commit;

-- ==========================================================================
-- COMANDOS ÚTEIS (rode quando precisar, em uma query separada)
--
-- Tornar alguém admin (depois de criar o usuário em Authentication → Users):
--   insert into private.admin_users (user_id)
--   select id from auth.users where email = 'seu-email@exemplo.com'
--   on conflict do nothing;
--
-- Desligar o cupom APARECIDA:
--   update public.coupons set active = false where code = 'APARECIDA';
-- Dar prazo ao cupom:
--   update public.coupons set expires_at = '2026-12-31 23:59-03' where code = 'APARECIDA';
-- Criar outro cupom:
--   insert into public.coupons (code) values ('NATAL');
--   insert into public.coupon_prices (coupon_code, product_id, promo_price)
--   values ('NATAL', 'terco-infantil-rosa', 19.90);
-- (O site também precisa conhecer o cupom para mostrar o preço antes de
--  finalizar — veja COUPONS em js/main.js.)
-- ==========================================================================
