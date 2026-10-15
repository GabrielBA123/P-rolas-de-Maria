# Pérolas de Maria — loja + painel administrativo

> **Novidade:** produtos, opções (cores/modelos), fotos e cupons agora são
> cadastrados no **painel (/admin → Produtos e Cupons)**, sem mexer em código.
> Veja a seção "Produtos e cupons pelo painel" mais abaixo.

Este projeto é 100% o mesmo site que você já tinha (mesmas cores, fontes,
animações e layout) — só que agora organizado em arquivos separados, com
pedidos salvos automaticamente no banco de dados e um painel administrativo
para acompanhar tudo.

**Nenhum arquivo é um "build"** — é HTML/CSS/JS puro, sem Node, sem
compilador. Isso significa: fácil de entender, fácil de hospedar, e
qualquer edição futura no visual do site é só editar `css/styles.css`
normalmente, como antes.

---

## 1. Estrutura do projeto

```
perolas-app/
├── index.html                 → a loja (home; produtos vêm do banco)
├── produto-template.html      → modelo da página de cada produto
├── api/
│   ├── produto.js             → monta /produto/<endereço> no servidor (Vercel)
│   ├── sitemap.js             → /sitemap.xml gerado dos produtos ativos
│   └── _supabase.js           → leitura pública do Supabase (mesma chave do site)
├── css/styles.css             → todo o visual da loja
├── js/
│   ├── supabase-client.js     → onde você cola a URL + chave do Supabase
│   ├── product-render.js      → monta cards e páginas de produto (site + servidor)
│   ├── catalogo.js            → vitrine da home (lê os produtos do banco)
│   ├── carousel.js            → movimento do carrossel (arrastar, bolinhas, automático)
│   ├── carrossel.js           → monta os slides do carrossel a partir do banco
│   ├── main.js                → carrinho, galeria, cupom, personalizador, tema
│   └── checkout.js            → salva o pedido no banco + abre o WhatsApp
├── assets/images/             → fotos antigas dos produtos
├── admin/
│   ├── index.html             → painel administrativo (/admin)
│   ├── css/admin.css          → visual do painel
│   └── js/
│       ├── admin.js           → pedidos (+ botões de WhatsApp)
│       ├── produtos.js        → aba Produtos
│       ├── cupons.js          → aba Cupons
│       ├── vendas.js          → aba Vendas (números, gráfico, planilha)
│       ├── carrossel.js       → aba Carrossel
│       └── calculadora.js     → calculadora de preço e estoque
├── sql/
│   ├── schema.sql             → tudo para criar o banco do zero (= schema-completo.sql)
│   ├── catalogo.sql           → só a parte do catálogo (para banco que já existe)
│   ├── extras.sql             → carrossel editável
│   └── historico/             → migrações antigas (já aplicadas, não rode de novo)
├── vercel.json                → endereços, redirecionamentos antigos e segurança
└── README.md                  → este arquivo
```

Por que esses arquivos e não outros? Cada um tem uma responsabilidade só:
`main.js` nunca fala com o banco de dados (só cuida da loja em si);
`checkout.js` só cuida de salvar o pedido; `admin.js` só existe dentro de
`/admin`, então ele nunca é baixado por um cliente comum da loja.

---

## 2. Criar o projeto no Supabase (gratuito)

1. Acesse **supabase.com** → **Start your project** → crie uma conta
   (dá para usar login do GitHub ou e-mail).
2. Clique em **New project**. Escolha um nome (ex: `perolas-de-maria`),
   uma senha para o banco (guarde essa senha em local seguro, é diferente
   da senha de admin do site) e a região mais próxima (ex: `South
   America (São Paulo)`). Clique em **Create new project** e aguarde
   uns 2 minutos.
3. No menu lateral, vá em **SQL Editor** → **New query**.
4. Abra o arquivo `sql/schema.sql` deste projeto, copie **todo** o
   conteúdo, cole no editor e clique em **Run**. Isso cria as tabelas de
   pedidos, as regras de segurança e as automações de histórico — tudo
   de uma vez.
5. Vá em **Project Settings** (ícone de engrenagem) → **API**. Você vai
   precisar de dois valores dessa página:
   - **Project URL**
   - **anon public** key (a chave pública — não é a `service_role`,
     essa nunca deve ser usada aqui)

---

## 3. Conectar o site ao Supabase

Abra o arquivo `js/supabase-client.js` e troque as duas linhas:

```js
const SUPABASE_URL = 'COLE_AQUI_A_URL_DO_SEU_PROJETO_SUPABASE';
const SUPABASE_ANON_KEY = 'COLE_AQUI_A_ANON_KEY_DO_SEU_PROJETO_SUPABASE';
```

pelos valores que você copiou no passo anterior. Só isso — os dois
arquivos que precisam do Supabase (`checkout.js` na loja e `admin.js` no
painel) já compartilham esse mesmo arquivo.

> A chave "anon" pode ficar visível no código sem problema — ela foi
> feita para isso. Quem realmente protege os dados dos seus pedidos são
> as regras de segurança criadas pelo `schema.sql` (só um admin logado
> consegue ler os pedidos; o site público só consegue *criar* um pedido
> novo, nunca ler os de outras pessoas).

---

## 4. Publicar na Vercel

1. Suba a pasta `perolas-app` para um repositório no GitHub (pode ser
   privado).
2. Em **vercel.com**, clique em **Add New → Project** e importe esse
   repositório.
3. Na tela de configuração, o **Framework Preset** deve ficar como
   **Other** (é um site estático, não precisa de build). Não precisa
   mexer em mais nada — clique em **Deploy**.
4. Pronto: `seusite.vercel.app` mostra a loja, e
   `seusite.vercel.app/admin` mostra o painel.

Sempre que você quiser atualizar o site (trocar uma foto, mudar um
preço), edite os arquivos e suba de novo para o GitHub — a Vercel
republica sozinha.

---

## 5. Criar seu usuário administrador

O painel usa o próprio sistema de login do Supabase — não existe
cadastro público, só você cria os logins manualmente:

1. No Supabase, vá em **Authentication → Users**.
2. Clique em **Add user → Create new user**.
3. Preencha seu e-mail e uma senha. Marque **Auto Confirm User** (assim
   você não precisa confirmar por e-mail) e clique em **Create user**.
4. **Torne esse usuário administrador:** no **SQL Editor** (query nova),
   rode o comando abaixo trocando pelo seu e-mail:

   ```sql
   insert into private.admin_users (user_id)
   select id from auth.users where email = 'seu-email@exemplo.com'
   on conflict do nothing;
   ```

   *(Se você rodou o `schema.sql` DEPOIS de criar o usuário, o primeiro
   usuário já vira admin sozinho e este passo não é necessário.)*
5. Pronto — entre em `seusite.vercel.app/admin` com esse e-mail e senha.
6. No Supabase, em **Authentication → Sign In / Providers**, desligue
   **Allow new users to sign up** — assim ninguém além de você cria conta.

---

## 6. Alterar sua senha

Duas formas:

- **Pelo próprio painel:** na tela de login, clique em **"Esqueci minha
  senha"** (digite o e-mail antes). Você recebe um e-mail com um link
  que abre a página `update-password.html`, onde escolhe a nova senha.
- **Pelo Supabase:** em **Authentication → Users**, clique nos "..." ao
  lado do seu usuário → **Reset password** (ou edite diretamente lá).

---

## 7. Adicionar outro administrador no futuro

Repita o passo 5 (**Authentication → Users → Add user**) com o e-mail da
nova pessoa e depois rode, no SQL Editor, o comando do passo 4 acima com o
e-mail dela. Não precisa mexer em nenhum código. Ter conta no Supabase
**não** basta: só quem está na lista `private.admin_users` enxerga os
pedidos.

*(Todo administrador tem acesso total — não existem níveis de permissão diferentes. Se um dia você quiser um funcionário com acesso mais limitado, dá pra evoluir isso depois.)*

---

## Produtos e cupons pelo painel

**Produtos** (`/admin` → aba **Produtos**)
- **＋ Novo produto:** nome, preço, frase curta (card da home), descrição, fotos
  e opções. Linhas da descrição começando com `- ` viram tópicos; `**texto**`
  vira negrito.
- **Opções** (cor, modelo...): cada uma pode ter preço próprio, bolinha de cor,
  ficar esgotada e ter uma foto de amostra (ex.: da pérola). Cada opção vira
  uma linha própria no carrinho e no pedido.
- **Fotos:** envie do celular — são reduzidas sozinhas. Ligue uma foto a uma
  opção para ela aparecer quando a cliente escolher aquela opção.
- **Visível / Esgotado:** os botões na lista escondem o produto ou impedem a
  compra, sem apagar nada. **▲ ▼** muda a ordem da vitrine.
- Marcar **"A cliente escolhe o santo(a) do entremeio"** mostra a lista de
  entremeios e exige a escolha (a lista fica em `js/main.js`, `ENTREMEIOS`).
- O endereço do produto (`/produto/nome`) não muda depois de criado: é o que
  mantém cupons e links funcionando.
- Mudanças aparecem no site em até **1 minuto**.

**Cupons** (aba **Cupons**): código, ativo/desativado, validade (até o fim do
dia) e o **preço especial de cada produto**. Um cupom novo funciona na hora.
Em produto com opções, o cupom vale para todas as opções.

**Vendas** (aba **Vendas**): escolha o período (este mês, mês passado, 7/30/90
dias, este ano, tudo) e veja faturamento, pedidos, ticket médio, itens
vendidos, descontos de cupom e quanto ainda está **a receber**; gráfico de
faturamento por dia (ou por mês nos períodos longos); produtos e entremeios
mais vendidos; uso de cada cupom. Por padrão só conta pedidos **pagos**
(pago, em preparação, enviado, entregue) — desmarque "Só pedidos pagos" para
incluir os aguardando pagamento. Pedidos cancelados nunca entram. O botão
**Baixar planilha (CSV)** exporta os pedidos do período (abre direto no Excel
e no Google Planilhas). As datas seguem o horário de Brasília.

**Carrossel** (aba **Carrossel**): edite os slides do topo da home — título,
frase, etiqueta, texto do link, para onde leva (lista de produtos, página de um
produto, personalizados ou um https://), ordem e visível/oculto. A imagem você
escolhe entre as fotos que o site já tem; enviar foto nova é opcional. Sem
nenhum slide visível, o carrossel some da home. Se você citar preço no texto do
slide, atualize quando o preço mudar.

**Pedidos:** no detalhe do pedido, **"Falar com a cliente"** abre o WhatsApp
com mensagem pronta (cobrar Pix, pagamento recebido, em preparação, enviado
com rastreio, entregue).

**Como funciona por trás:** o **preço é sempre decidido pelo servidor** no
momento do pedido (tabela `products`), nunca pelo navegador — então mudar o
preço no painel vale de verdade. Terços personalizados têm preço fixo por
regra no SQL (6mm R$ 19,90 / com nome R$ 22,90 · 8mm R$ 24,90 / com nome
R$ 26,90 · só pérolas R$ 29,90); se mudar no `js/main.js`, mude também em
`create_order()` no SQL.

### Google Search Console

1. Acesse **search.google.com/search-console** e entre com sua conta Google.
2. **Adicionar propriedade** → escolha **Prefixo do URL** e digite
   `https://perolas-de-maria.vercel.app/`.
3. Em verificação, escolha **Tag HTML** e copie a linha
   `<meta name="google-site-verification" content="...">`.
4. Cole essa linha no `index.html`, logo abaixo do comentário
   "Google Search Console" (no começo do arquivo), suba para o GitHub, espere a
   Vercel publicar e clique em **Verificar**.
5. No menu **Sitemaps**, envie `sitemap.xml`. Ele já lista a home e todos os
   produtos ativos sozinho (as mudanças do painel entram nele).
6. Depois de alguns dias, em **Desempenho** você vê por quais buscas o site
   aparece. Para um produto novo aparecer mais rápido, use **Inspeção de URL**
   → **Solicitar indexação**.

**Cuidados**
- O site depende do Supabase estar acordado (plano gratuito pausa após ~7 dias
  parado). O ping automático em `.github/workflows` evita isso.
- O carrossel do topo da home (`index.html`) continua manual; se ele cita preço,
  atualize o texto quando mudar o preço no painel.
- O painel de Vendas e a planilha usam os pedidos carregados no painel (o
  Supabase entrega até 1.000 pedidos por vez; passando disso, avise para
  ajustarmos).
- Instalar do zero: rode `sql/schema.sql`. Já tem banco funcionando: rode
  só `sql/catalogo.sql` e `sql/extras.sql` (cadastra os produtos atuais na 1ª vez e não
  sobrescreve o que você editar depois).

---

## O que o painel faz

- **Dashboard**: total de pedidos, quantos em cada status, faturado
  hoje, faturado no mês, total vendido.
- **Busca** por nome, telefone ou número do pedido.
- **Filtros** por status.
- Clique em qualquer pedido para ver todos os detalhes (produtos,
  endereço, observações) e mudar o status com um clique — cada mudança
  fica registrada automaticamente no histórico.
- **Notificação em tempo real**: com o painel aberto, assim que um
  pedido novo chega, aparece "🔔 Novo pedido recebido" sem precisar
  recarregar a página.
- Números de pedido sequenciais (`#000001`, `#000002`...) gerados pelo
  próprio banco de dados — nunca se repetem.

## O que este projeto **não** faz (por enquanto)

Para manter o escopo simples, como você pediu, o painel cuida só de
**pedidos** — os produtos e preços continuam sendo editados direto no
código (`index.html` / `js/main.js`), como já era antes. Se no futuro
você quiser um painel para cadastrar produtos novos sem mexer em
código, dá pra construir isso como uma etapa separada.

## SEO e favicon

Não mexi no seu favicon (o projeto não tinha nenhum configurado
antes, e continua assim) nem em nada que afete indexação no Google.
A única adição foi uma tag `<meta name="description">` no `index.html`
— isso só ajuda o SEO, nunca atrapalha; se preferir removê-la, ela está
logo no `<head>`.

## Solução de problemas comuns

**"Não foi possível registrar o pedido" / erro de internet ao finalizar
pedido:** na quase totalidade dos casos isso não é sua internet — é o
Supabase ainda não estar conectado. Confira:
1. Você colou a URL e a anon key reais no `js/supabase-client.js`
   (passo 3)? Enquanto estiver com o texto `COLE_AQUI_...`, o pedido
   nunca vai salvar, em nenhum navegador.
2. Você rodou o `sql/schema.sql` inteiro no SQL Editor do Supabase
   (passo 2)? Sem isso as tabelas não existem.
Depois de conectar de verdade, essa tela mostra o motivo exato do erro
em vez de uma mensagem genérica.

**Digitar `/admin` no navegador abre uma página estranha, mas abrir o
arquivo direto funciona:** isso acontece quando o site ainda não foi
publicado na Vercel — testar abrindo os arquivos direto pelo
computador (ex: dois cliques no `admin/index.html`) é ótimo para ver o
visual, mas o navegador não sabe transformar `/admin` em
`/admin/index.html` sozinho nesse modo local. Depois de publicar na
Vercel (passo 4), `seusite.vercel.app/admin` passa a funcionar
normalmente — o arquivo `vercel.json` incluído neste projeto garante
isso.
