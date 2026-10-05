-- ==========================================================================
-- Pérolas de Maria — Correções de segurança (avisos do Database Linter)
-- Rodar UMA vez em: Supabase → SQL Editor → New query → colar tudo → Run
-- É seguro rodar de novo se precisar (tudo usa "or replace"/"if not exists").
-- ==========================================================================

begin;

-- 0) Trava de segurança: se não existir nenhum usuário admin criado em
--    Authentication → Users, o script para aqui (evita ficar sem acesso).
do $$
begin
  if not exists (select 1 from auth.users) then
    raise exception 'Nenhum usuário em Authentication > Users. Crie o login de admin antes de rodar este script.';
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 1) Quem é admin de verdade
--    Antes: qualquer usuário "logado" (authenticated) tinha acesso total
--    (policies com "using (true)"). Se alguém conseguisse criar uma conta
--    no seu projeto, enxergaria todos os pedidos. Agora só quem está na
--    lista abaixo é admin. A lista fica num schema "private", que NÃO é
--    exposto pela API do Supabase (ninguém consegue ler ou chamar de fora).
-- --------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
revoke all on table private.admin_users from public, anon, authenticated;

-- todos os usuários que existem HOJE viram admin (no seu caso, só você)
insert into private.admin_users (user_id)
select id from auth.users
on conflict do nothing;

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
-- 2) Funções de trigger: search_path fixo e ninguém chama por fora
--    (triggers continuam funcionando normalmente — o Postgres só confere
--    a permissão de EXECUTE na hora de criar o trigger, não ao disparar).
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

revoke all on function public.touch_updated_at()   from public, anon, authenticated;
revoke all on function public.log_order_created()  from public, anon, authenticated;
revoke all on function public.log_status_change()  from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3) create_order() — a função do checkout (precisa ficar pública, é assim
--    que o cliente registra o pedido). Mantive igual, e reforcei:
--      - limites de tamanho nos campos e de itens/quantidade por pedido
--      - o total e o line_total agora são calculados AQUI (quantidade x
--        preço), não mais aceitos como vieram do navegador
--      - search_path fixo
--    Os 2 avisos que restam para esta função são esperados (é pública
--    por design). "authenticated" continua liberado porque, se você estiver
--    logada no /admin no mesmo navegador, o checkout do site também passa
--    a rodar como "authenticated".
-- --------------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_address text,
  p_notes            text,
  p_items            jsonb
)
returns table(id uuid, order_number bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id     uuid;
  v_order_number bigint;
  v_total        numeric(10,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric;
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
     or char_length(coalesce(p_notes, ''))            > 500 then
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

  -- valida cada item e calcula o total no servidor
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

    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

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
      round((v_item->>'quantity')::int * (v_item->>'unit_price')::numeric, 2),
      v_item->'details'
    );
  end loop;

  return query select v_order_id, v_order_number;
end;
$$;

revoke all on function public.create_order(text, text, text, text, jsonb) from public;
grant execute on function public.create_order(text, text, text, text, jsonb) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 4) register_purchase() e register_sale() — estoque/vendas do painel.
--    PROBLEMA CORRIGIDO: estavam executáveis por qualquer pessoa com a chave
--    pública do site (anon) e, como são SECURITY DEFINER, ignoravam o RLS —
--    ou seja, qualquer um poderia registrar compra/venda e mexer no seu
--    estoque. Agora: anon bloqueado + checagem de admin dentro da função.
-- --------------------------------------------------------------------------
create or replace function public.register_purchase(
  p_material_id uuid,
  p_quantity    numeric,
  p_total_cost  numeric,
  p_notes       text
)
returns public.stock_purchases
language plpgsql
security definer
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

create or replace function public.register_sale(
  p_model_id   uuid,
  p_quantity   integer,
  p_unit_price numeric,
  p_notes      text
)
returns public.stock_sales
language plpgsql
security definer
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

revoke all on function public.register_purchase(uuid, numeric, numeric, text) from public, anon;
revoke all on function public.register_sale(uuid, integer, numeric, text)     from public, anon;
grant execute on function public.register_purchase(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.register_sale(uuid, integer, numeric, text)     to authenticated;

-- --------------------------------------------------------------------------
-- 5) Policies: trocar "using (true)" por "só admin"
-- --------------------------------------------------------------------------
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
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admins manage price models" on public.price_models;
create policy "admins manage price models"
  on public.price_models for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admins manage stock purchases" on public.stock_purchases;
create policy "admins manage stock purchases"
  on public.stock_purchases for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admins manage stock sales" on public.stock_sales;
create policy "admins manage stock sales"
  on public.stock_sales for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- --------------------------------------------------------------------------
-- 6) Defesa extra: o público (anon) não precisa de acesso direto a NENHUMA
--    tabela — o site só usa a função create_order(). Tirar o grant
--    é um segundo cadeado além do RLS.
-- --------------------------------------------------------------------------
revoke all on table
  public.orders,
  public.order_items,
  public.order_status_history,
  public.price_materials,
  public.price_models,
  public.stock_purchases,
  public.stock_sales
from anon;

-- --------------------------------------------------------------------------
-- 7) Funções novas que você criar no futuro NÃO nascem executáveis pelo
--    público (precisam de um "grant execute" explícito, como já fazemos).
-- --------------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

commit;

-- ==========================================================================
-- Para adicionar OUTRO admin no futuro (depois de criar o usuário em
-- Authentication → Users), rode:
--   insert into private.admin_users (user_id)
--   select id from auth.users where email = 'email-do-novo-admin@exemplo.com';
-- ==========================================================================
