-- ==========================================================================
-- Pérolas de Maria — Sistema de cupons de desconto
-- Rodar UMA vez em: Supabase → SQL Editor → New query → colar tudo → Run
-- Pode rodar de novo sem problema (serve também pra atualizar os preços
-- do cupom: é só mudar os valores lá embaixo e rodar outra vez).
-- Requer que o seguranca.sql já tenha sido rodado (usa private.is_admin()).
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1) Pedidos passam a guardar qual cupom foi usado e quanto de desconto deu
-- --------------------------------------------------------------------------
alter table public.orders
  add column if not exists coupon_code text,
  add column if not exists discount numeric(10,2) not null default 0 check (discount >= 0);

-- --------------------------------------------------------------------------
-- 2) Cupons e os preços promocionais de cada produto
--    O desconto é por PREÇO FIXO por produto (ex.: terço de corrente de
--    19,90 por 9,90), e só vale para os produtos listados em coupon_prices.
-- --------------------------------------------------------------------------
create table if not exists public.coupons (
  code        text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,30}$'),
  active      boolean not null default true,
  expires_at  timestamptz,                -- vazio = não expira
  created_at  timestamptz not null default now()
);

create table if not exists public.coupon_prices (
  coupon_code text not null references public.coupons(code) on delete cascade,
  product_id  text not null,              -- o mesmo id usado no site (data-product-id)
  promo_price numeric(10,2) not null check (promo_price >= 0),
  primary key (coupon_code, product_id)
);

alter table public.coupons       enable row level security;
alter table public.coupon_prices enable row level security;

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons"
  on public.coupons for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admins manage coupon prices" on public.coupon_prices;
create policy "admins manage coupon prices"
  on public.coupon_prices for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on table public.coupons, public.coupon_prices from anon;

-- --------------------------------------------------------------------------
-- 3) O cupom APARECIDA
-- --------------------------------------------------------------------------
insert into public.coupons (code, active) values ('APARECIDA', true)
on conflict (code) do nothing;

insert into public.coupon_prices (coupon_code, product_id, promo_price) values
  ('APARECIDA', 'terco-aparecida',          32.90),  -- Terço Nossa Senhora Aparecida (de 39,90)
  ('APARECIDA', 'terco-corrente-aparecida',  9.90),  -- Terço de Corrente (de 19,90)
  ('APARECIDA', 'santinha-aparecida',        6.00),  -- Santinha (de 7,90)
  ('APARECIDA', 'chaveiro-aparecida',        6.00)   -- Chaveiro (de 7,90)
on conflict (coupon_code, product_id) do update set promo_price = excluded.promo_price;

-- --------------------------------------------------------------------------
-- 4) create_order() agora aceita um cupom — e o desconto é calculado AQUI,
--    no servidor, a partir da tabela acima. O navegador só manda o código;
--    ele não consegue inventar um preço de cupom.
--    Retorna também o total e o desconto reais, que o site usa na mensagem
--    do WhatsApp.
-- --------------------------------------------------------------------------
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

revoke all on function public.create_order(text, text, text, text, jsonb, text) from public;
grant execute on function public.create_order(text, text, text, text, jsonb, text) to anon, authenticated;

commit;

-- ==========================================================================
-- Para criar OUTRO cupom no futuro (exemplo):
--   insert into public.coupons (code) values ('NATAL');
--   insert into public.coupon_prices (coupon_code, product_id, promo_price)
--   values ('NATAL', 'terco-infantil-rosa', 19.90);
-- Para desligar um cupom:  update public.coupons set active = false where code = 'APARECIDA';
-- Para dar prazo:          update public.coupons set expires_at = '2026-12-31 23:59-03' where code = 'APARECIDA';
-- (O site também precisa conhecer o cupom pra mostrar o preço antes de
--  finalizar — veja COUPONS em js/main.js.)
-- ==========================================================================
