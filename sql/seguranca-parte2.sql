-- ==========================================================================
-- Pérolas de Maria — Parte 2 da correção de segurança
-- Rodar em: Supabase → SQL Editor → New query → colar → Run
-- Troca register_purchase() e register_sale() para SECURITY INVOKER: elas
-- passam a rodar com os poderes de quem chama (e o RLS já limita isso a
-- admin), em vez de ignorar o RLS. Isso zera os 2 avisos restantes delas.
-- ==========================================================================

begin;

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

revoke all on function public.register_purchase(uuid, numeric, numeric, text) from public, anon;
revoke all on function public.register_sale(uuid, integer, numeric, text)     from public, anon;
grant execute on function public.register_purchase(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.register_sale(uuid, integer, numeric, text)     to authenticated;

commit;
