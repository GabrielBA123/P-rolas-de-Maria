# Pérolas de Maria — loja + painel administrativo

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
├── index.html                 → a loja (era um único arquivo, agora limpo)
├── css/
│   └── styles.css             → todo o visual da loja (extraído do HTML)
├── js/
│   ├── supabase-client.js     → onde você cola a URL + chave do Supabase
│   ├── main.js                → carrinho, galeria, personalizador, tema
│   └── checkout.js            → salva o pedido no banco + abre o WhatsApp
├── assets/
│   └── images/                → fotos dos produtos (antes elas viviam
│                                 "escondidas" dentro do HTML como texto
│                                 codificado — agora são arquivos de
│                                 verdade, o que deixa o site mais leve)
├── admin/
│   ├── index.html             → painel administrativo (/admin)
│   ├── update-password.html   → página de "criar nova senha"
│   ├── css/admin.css          → visual do painel
│   └── js/admin.js            → toda a lógica do painel
├── sql/
│   └── schema.sql             → script único para criar tudo no Supabase
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
4. Pronto — entre em `seusite.vercel.app/admin` com esse e-mail e senha.

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
nova pessoa. Não precisa mexer em nenhum código — qualquer usuário
criado no Supabase Auth consegue entrar em `/admin` automaticamente.

*(Hoje o sistema trata "logado" e "administrador" como a mesma coisa —
não existem níveis de permissão diferentes. Se um dia você quiser um
funcionário com acesso mais limitado, por exemplo, dá pra evoluir isso
depois com uma tabela de permissões — não implementei porque você não
pediu e isso deixaria o projeto mais complexo do que precisa ser hoje.)*

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
