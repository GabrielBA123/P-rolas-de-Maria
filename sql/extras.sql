-- ==========================================================================
-- Pérolas de Maria — EXTRAS: carrossel editável
-- ==========================================================================
-- Rodar UMA vez em: Supabase → SQL Editor → New query → colar tudo → Run.
-- Pode rodar de novo sem problema. Não mexe em pedidos nem produtos.
--
--   1) Carrossel do topo da home editável pelo painel (/admin → Carrossel).
--      Os 3 slides atuais são cadastrados na primeira vez.
-- ==========================================================================

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
