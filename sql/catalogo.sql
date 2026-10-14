-- ==========================================================================
-- Pérolas de Maria — CATÁLOGO NO PAINEL (produtos, opções, fotos e cupons)
-- ==========================================================================
-- Rodar UMA vez em: Supabase → SQL Editor → New query → colar tudo → Run.
-- Pode rodar de novo sem problema (não sobrescreve o que você editar no painel).
--
-- O que este script faz:
--   1) Cria as tabelas de produtos, opções (cores/modelos) e fotos.
--   2) Cria o armazenamento de fotos (bucket "produtos") — só o admin envia.
--   3) Cadastra os 10 produtos que já estão no site (na 1ª vez).
--   4) Passa o PREÇO a ser decidido pelo servidor: o pedido usa o preço que está
--      no banco, e não mais o que o navegador manda.
--   5) Cria a função get_coupon() para o site mostrar o preço do cupom
--      (os cupons passam a ser 100% geridos pelo painel).
-- É compatível com o site atual: pode rodar ANTES de subir a versão nova.
-- ==========================================================================

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
