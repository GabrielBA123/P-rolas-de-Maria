-- ==========================================================================
-- Pérolas de Maria — SQL COMPLETO (versão final, tudo em um arquivo)
-- ==========================================================================
-- Reúne: pedidos, estoque/calculadora, segurança (admin), cupons e o
-- cupom APARECIDA. Substitui o schema.sql antigo + seguranca.sql +
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
