/* ==========================================================================
   main.js — Pérolas de Maria
   Site behaviour that has NOTHING to do with saving orders:
   - bead divider generator
   - product gallery (thumbnail swap)
   - cart (add/remove/qty/render) — in-memory, resets on page reload
   - personalized terço configurator
   - cart drawer + checkout modal open/close
   - Pix key copy button
   - light/dark theme toggle

   Order submission (Supabase + WhatsApp handoff) lives in checkout.js,
   which is loaded after this file and reuses `cart`, `cartTotal()`,
   `formatBRL()` and `closeCheckoutModal()` defined below.
   ========================================================================== */

// ---------- bead divider generator ----------
document.querySelectorAll('.bead-divider').forEach(function(el){
  if(el.id==='beadDivider' || !el.children.length){
    var html = '';
    for(var i=0;i<23;i++){ html += '<span></span>'; }
    el.innerHTML = html;
  }
});

// ---------- cart state ----------
// Cada produto tem a sua própria página (produto-*.html). Antes o carrinho
// vivia só na memória da página e zerava ao abrir um produto. Agora ele é
// guardado no localStorage e recarregado em qualquer página do site. Expira
// em 3 dias. O servidor continua validando tudo no pedido.
var CART_STORAGE_KEY = 'pdm-cart-v1';
// Produtos que saíram do site: se alguém ainda tem um deles no carrinho guardado, é removido.
var RETIRED_PRODUCTS = ['pulseira-sao-bento-branco'];
var CART_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function loadCart(){
  try{
    var raw = localStorage.getItem(CART_STORAGE_KEY);
    if(!raw) return [];
    var data = JSON.parse(raw);
    if(!data || !Array.isArray(data.items) || (Date.now() - data.savedAt) > CART_MAX_AGE_MS) return [];

    // só aceita itens com o formato esperado (protege contra dado velho/corrompido)
    var items = data.items.filter(function(i){
      return i && typeof i.id === 'string' && RETIRED_PRODUCTS.indexOf(i.id) === -1 && typeof i.name === 'string' && i.name.indexOf('<') === -1
        && typeof i.img === 'string' && /^(\/?assets\/|https:\/\/)[^"'<>\s]+$/.test(i.img)
        && typeof i.price === 'number' && isFinite(i.price) && i.price >= 0
        && typeof i.qty === 'number' && i.qty >= 1 && i.qty <= 50 && Math.floor(i.qty) === i.qty;
    });

    // se a página atual tem o produto, usa o nome/preço atuais (evita preço velho no carrinho)
    items.forEach(function(i){
      var el = document.querySelector('[data-product-id="' + i.id + '"][data-product-price]');
      if(el){
        var price = parseFloat(el.dataset.productPrice);
        if(isFinite(price)) i.price = price;
        if(el.dataset.productName) i.name = el.dataset.productName;
      }
    });
    return items;
  }catch(e){ return []; }
}

function saveCart(){
  try{
    if(cart.length === 0){ localStorage.removeItem(CART_STORAGE_KEY); }
    else{ localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), items: cart })); }
  }catch(e){ /* localStorage indisponível (ex.: aba anônima) — segue só em memória */ }
}

var cart = loadCart();

// escapa texto vindo do banco/painel antes de colocar em HTML
function escHtml(t){
  return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatBRL(v){
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// ---------- products / gallery / add-to-cart ----------
// Os cards de produto vêm do banco (página /produto/<endereço> e destaque da
// home). Cada card carrega nome/preço/opções em atributos data-*; esta função
// liga o comportamento (galeria, opções, entremeio, quantidade, carrinho) e
// pode ser chamada para cards inseridos depois do carregamento da página.
function initProductCard(card){
  if(card.dataset.pdmInit) return;
  card.dataset.pdmInit = '1';
  var qty = 1;
  var qtyDisplay = card.querySelector('.qty-display');
  var mainImg = card.querySelector('.main-img');
  var defaultImg = mainImg.getAttribute('src'); // cart thumbnail always uses the cover photo, even if the visitor is browsing other gallery views

  // Variações opcionais (ex.: cor do terço infantil). Cada botão `.variant-btn`
  // carrega o próprio id/nome/preço/foto de capa; ao adicionar ao carrinho,
  // cada cor vira uma linha separada. Produtos sem `.variant-btn` não mudam.
  var variantBtns = Array.prototype.slice.call(card.querySelectorAll('.variant-btn'));
  var currentVariant = variantBtns.length
    ? (variantBtns.filter(function(b){ return b.classList.contains('selected'); })[0] || variantBtns[0])
    : null;
  var thumbs = card.querySelectorAll('.gallery-thumbs img');

  function selectVariant(btn, showCover){
    currentVariant = btn;
    variantBtns.forEach(function(b){
      var on = (b === btn);
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var cur = card.querySelector('.variant-current');
    if(cur) cur.textContent = btn.dataset.label || '';
    var priceEl = card.querySelector('.price');            // preço próprio da opção (se houver)
    if(priceEl && btn.dataset.productPrice){ priceEl.textContent = formatBRL(parseFloat(btn.dataset.productPrice)); }
    // foto da pérola/material da cor escolhida (opcional, `.variant-preview-img`)
    var pv = card.querySelector('.variant-preview-img');
    if(pv){
      var box = pv.parentNode;
      if(btn.dataset.swatch){
        pv.src = btn.dataset.swatch;
        pv.alt = 'Pérola ' + (btn.dataset.label || '');
        var pn = card.querySelector('.variant-preview-name');
        if(pn) pn.textContent = btn.dataset.label || '';
        if(box) box.style.display = '';
      } else if(box){ box.style.display = 'none'; }
    }
    var note = card.querySelector('.variant-note');   // aviso quando a cor ainda não tem foto
    if(note) note.style.display = btn.dataset.cover ? 'none' : 'block';
    if(showCover && btn.dataset.cover){
      mainImg.src = btn.dataset.cover;
      thumbs.forEach(function(t){ t.classList.toggle('active', t.dataset.full === btn.dataset.cover); });
    }
  }
  variantBtns.forEach(function(b){
    b.addEventListener('click', function(){ selectVariant(b, true); });
  });

  thumbs.forEach(function(t){
    t.addEventListener('click', function(){
      mainImg.src = t.dataset.full;
      thumbs.forEach(function(x){x.classList.remove('active');});
      t.classList.add('active');
      // clicar numa foto de outra cor troca a cor selecionada
      if(t.dataset.variant){
        var vb = variantBtns.filter(function(b){ return b.dataset.variant === t.dataset.variant; })[0];
        if(vb && vb !== currentVariant) selectVariant(vb, false);
      }
    });
  });

  card.querySelector('.qty-minus').addEventListener('click', function(){
    qty = Math.max(1, qty - 1);
    qtyDisplay.textContent = qty;
  });
  card.querySelector('.qty-plus').addEventListener('click', function(){
    qty = qty + 1;
    qtyDisplay.textContent = qty;
  });

  // Entremeio (santo) opcional por produto: `select[data-entremeios]` dentro do card.
  var entSelect = card.querySelector('select[data-entremeios]');
  var entHint = card.querySelector('.entremeio-hint');
  if(entSelect && entHint){
    entSelect.addEventListener('change', function(){
      entHint.style.display = (entSelect.value === 'outro') ? 'block' : 'none';
    });
  }

  card.querySelector('.add-cart-btn').addEventListener('click', function(){
    if(this.disabled) return;
    var src = currentVariant || card;                 // cor escolhida (se o produto tiver cores)
    var slug = src.dataset.productSlug || card.dataset.productSlug || card.dataset.productId;
    var id = src.dataset.productId;
    var name = src.dataset.productName;
    var price = parseFloat(src.dataset.productPrice);
    var img = currentVariant ? (currentVariant.dataset.cover || defaultImg) : defaultImg;
    var details = null;

    if(entSelect){
      if(!entSelect.value){
        showToast('Escolha o entremeio antes de adicionar');
        entSelect.focus();
        return;
      }
      var ent = (entSelect.value === 'outro') ? 'entremeio especial (a combinar no WhatsApp)' : entSelect.value;
      // cada combinação cor + entremeio é uma linha própria no carrinho e no pedido
      id = id + '--' + slugify(ent);
      details = {
        tipoLabel: card.dataset.productName,
        cor: currentVariant ? (currentVariant.dataset.label || null) : null,
        entremeio: ent
      };
      name = name + ' — entremeio: ' + ent;
    }

    var existing = cart.find(function(i){ return i.id === id; });
    if(existing){ existing.qty += qty; }
    else {
      var item = { id: id, slug: slug, name: name, price: price, img: img, qty: qty };
      if(details) item.customDetails = details;   // vai para o pedido (checkout.js)
      cart.push(item);
    }

    renderCart();
    showToast('Adicionado ao carrinho');

    var btn = card.querySelector('.add-cart-btn');
    btn.classList.add('added');
    btn.textContent = 'Adicionado ✦';
    setTimeout(function(){ btn.classList.remove('added'); btn.textContent = 'Adicionar ao carrinho'; }, 1400);

    qty = 1;
    qtyDisplay.textContent = qty;
  });
}
document.querySelectorAll('.product-card[data-product-id]').forEach(initProductCard);

function removeFromCart(id){
  cart = cart.filter(function(i){return i.id !== id;});
  renderCart();
}

// ---------- personalized terço configurator ----------
// Guarded: only runs on pages that actually have the #personalizados
// section (the homepage). Without this check, the calls at the bottom
// of this block would throw on pages that don't include it (like the
// standalone product pages) and silently break everything after them.
if(document.getElementById('personalizados')){
var PRICE_TABLE = {
  '6mm': { base: 19.90, comNome: 22.90 },
  '8mm': { base: 24.90, comNome: 26.90 }
};
var PRICE_PEROLAS = 29.90;

var customState = {
  tipo: 'normal',      // 'normal' | 'perolas'
  tamanho: '6mm',       // '6mm' | '8mm' — only matters when tipo === 'normal'
  cor: 'Branco Fosco',
  estilo: 'Florzinha',
  santo: '',
  nomePersonalizado: false,
  nomeTexto: '',
  price: PRICE_TABLE['6mm'].base,
  qty: 1
};

function recalcPrice(){
  if(customState.tipo === 'perolas'){
    customState.price = PRICE_PEROLAS;
    return;
  }
  var tier = PRICE_TABLE[customState.tamanho];
  customState.price = customState.nomePersonalizado ? tier.comNome : tier.base;
}

function updateTipoVisibility(){
  var isPerolas = customState.tipo === 'perolas';
  document.getElementById('tamanhoCard').style.display = isPerolas ? 'none' : 'block';
  document.getElementById('nomeCard').style.display = isPerolas ? 'none' : 'block';
  document.getElementById('corSub').style.display = isPerolas ? 'none' : 'block';
  document.getElementById('corHint').style.display = isPerolas ? 'block' : 'none';
  updateCorGroupVisibility();
}

function updateCorGroupVisibility(){
  var isPerolas = customState.tipo === 'perolas';
  var show6mm = !isPerolas && customState.tamanho === '6mm';
  var show8mm = !isPerolas && customState.tamanho === '8mm';
  document.getElementById('corChoice6mm').style.display = show6mm ? 'flex' : 'none';
  document.getElementById('corChoice8mm').style.display = show8mm ? 'flex' : 'none';
  document.getElementById('corMouseHint').style.display = show8mm ? 'block' : 'none';
}

document.querySelectorAll('#tipoChoice .choice-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#tipoChoice .choice-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    customState.tipo = btn.dataset.tipo;
    updateTipoVisibility();
    recalcPrice();
    updateCustomSummary();
  });
});

// Counts how many color swatches exist for a given Ave Maria size, so the
// "disponíveis em N cores" hint always matches reality — adding or
// removing a swatch in the HTML (like a new bead color) never requires
// touching this number by hand again.
function countColorOptions(tamanho){
  var groupId = tamanho === '6mm' ? 'corChoice6mm' : 'corChoice8mm';
  return document.querySelectorAll('#' + groupId + ' .swatch').length;
}

document.querySelectorAll('#tamanhoChoice .choice-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#tamanhoChoice .choice-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    customState.tamanho = btn.dataset.tamanho;
    // reset to that size's first color so we never keep a color that
    // doesn't exist in the newly chosen size
    if(customState.tamanho === '6mm'){
      customState.cor = 'Branco Fosco';
      document.querySelectorAll('#corChoice6mm .swatch').forEach(function(s,i){ s.classList.toggle('selected', i===0); });
    } else {
      customState.cor = 'Preto';
      document.querySelectorAll('#corChoice8mm .swatch').forEach(function(s,i){ s.classList.toggle('selected', i===0); });
    }
    document.getElementById('corSub').textContent =
      'Contas de ' + customState.tamanho + ' disponíveis em ' + countColorOptions(customState.tamanho) + ' cores';
    updateCorGroupVisibility();
    updateNomePriceLabel();
    recalcPrice();
    updateCustomSummary();
  });
});

function updateNomePriceLabel(){
  var tier = PRICE_TABLE[customState.tamanho];
  var delta = tier.comNome - tier.base;
  document.getElementById('nomePriceLabel').textContent =
    'Quero o nome em miçangas de letras (+' + formatBRL(delta) + ')';
}

document.querySelectorAll('#corChoice6mm .swatch, #corChoice8mm .swatch').forEach(function(btn){
  btn.addEventListener('click', function(){
    var group = btn.closest('.swatches');
    group.querySelectorAll('.swatch').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    customState.cor = btn.dataset.cor;
    updateCustomSummary();
  });
});

document.querySelectorAll('#paiNossoChoice .choice-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#paiNossoChoice .choice-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    customState.estilo = btn.dataset.estilo;
    updateCustomSummary();
  });
});

// ---------- nome personalizado (miçangas de letras) ----------
var nomeToggle = document.getElementById('nomeToggle');
var nomeFieldWrap = document.getElementById('nomeFieldWrap');
var nomeInput = document.getElementById('nomeInput');
if(nomeToggle){
  nomeToggle.addEventListener('change', function(){
    customState.nomePersonalizado = nomeToggle.checked;
    nomeFieldWrap.style.display = nomeToggle.checked ? 'block' : 'none';
    recalcPrice();
    updateCustomSummary();
  });
}
if(nomeInput){
  nomeInput.addEventListener('input', function(){
    customState.nomeTexto = nomeInput.value.trim();
    updateCustomSummary();
  });
}

// ---------- hover / tap preview (8mm colors + name-bead photo) ----------
var hoverPreview = document.getElementById('hoverPreview');
var hoverPreviewImg = document.getElementById('hoverPreviewImg');

function showPreview(el){
  var src = el.dataset.preview;
  if(!src) return;
  hoverPreviewImg.src = src;
  var rect = el.getBoundingClientRect();
  var left = Math.min(rect.left, window.innerWidth - 196);
  var top = rect.bottom + 10;
  if(top + 190 > window.innerHeight){ top = rect.top - 200; }
  hoverPreview.style.left = Math.max(8, left) + 'px';
  hoverPreview.style.top = Math.max(8, top) + 'px';
  hoverPreview.classList.add('show');
}
function hidePreview(){
  hoverPreview.classList.remove('show');
}

document.querySelectorAll('[data-preview]').forEach(function(el){
  el.addEventListener('mouseenter', function(){ showPreview(el); });
  el.addEventListener('mouseleave', hidePreview);
  el.addEventListener('click', function(e){
    // on touch devices there's no real hover — a tap opens/closes the preview
    if(hoverPreview.classList.contains('show')){ hidePreview(); }
    else { showPreview(el); e.stopPropagation(); }
  });
});
document.addEventListener('click', function(e){
  if(!e.target.closest('[data-preview]')) hidePreview();
});

var santoSelect = document.getElementById('santoSelect');
var santoOutroHint = document.getElementById('santoOutroHint');
if(santoSelect){
  santoSelect.addEventListener('change', function(){
    var val = santoSelect.value;
    if(val === 'outro'){
      customState.santo = 'entremeio especial (a combinar no WhatsApp)';
      santoOutroHint.style.display = 'block';
    } else {
      customState.santo = val;
      santoOutroHint.style.display = 'none';
    }
    updateCustomSummary();
  });
}

function changeCustomQty(delta){
  customState.qty = Math.max(1, customState.qty + delta);
  document.getElementById('customQtyDisplay').textContent = customState.qty;
  updateCustomSummary();
}

function updateCustomSummary(){
  var santoText = customState.santo ? customState.santo : 'a combinar';
  var isPerolas = customState.tipo === 'perolas';

  var rows = '<div class="cfg-row"><strong>Tipo:</strong><span>' +
    (isPerolas ? 'Só de pérolas de Pai Nosso' : 'Terço simples') + '</span></div>';

  if(isPerolas){
    rows += '<div class="cfg-row"><strong>Contas:</strong><span>só pérolas (Pai Nosso)</span></div>';
  } else {
    rows += '<div class="cfg-row"><strong>Tamanho:</strong><span>' + customState.tamanho + '</span></div>';
    rows += '<div class="cfg-row"><strong>Cor da Ave Maria:</strong><span>' + customState.cor + '</span></div>';
    rows += '<div class="cfg-row"><strong>Nome personalizado:</strong><span>' +
      (customState.nomePersonalizado ? (customState.nomeTexto || 'sim (nome a combinar)') : 'não') + '</span></div>';
  }

  rows += '<div class="cfg-row"><strong>Pai Nosso:</strong><span>' + customState.estilo + '</span></div>';
  rows += '<div class="cfg-row"><strong>Entremeio:</strong><span>' + santoText + '</span></div>';
  rows += '<div class="cfg-row"><strong>Quantidade:</strong><span>' + customState.qty + '</span></div>';
  rows += '<div class="total"><span>Total</span><span>' + formatBRL(customState.price * customState.qty) + '</span></div>';

  document.getElementById('customSummary').innerHTML = rows;
}

function addCustomToCart(){
  if(customState.nomePersonalizado && !customState.nomeTexto){
    showToast('Digite o nome para as miçangas antes de adicionar');
    nomeInput.focus();
    return;
  }

  var santoText = customState.santo ? customState.santo : 'a combinar';
  var isPerolas = customState.tipo === 'perolas';
  var tipoLabel = isPerolas ? 'Só de pérolas de Pai Nosso' : 'Terço simples';

  var nameParts = [tipoLabel];
  if(isPerolas){
    nameParts.push('só pérolas (Pai Nosso)');
  } else {
    nameParts.push(customState.tamanho, customState.cor);
    if(customState.nomePersonalizado){ nameParts.push('nome "' + customState.nomeTexto + '"'); }
  }
  nameParts.push('Pai Nosso ' + customState.estilo, 'entremeio: ' + santoText);
  var name = nameParts.join(' — ');

  var id = 'custom-' + customState.tipo + '-' + customState.tamanho + '-' + customState.cor + '-' +
    customState.estilo + '-' + (customState.nomePersonalizado ? customState.nomeTexto : 'semnome') + '-' + santoText + '-' + Date.now();

  cart.push({
    id: id,
    name: name,
    price: customState.price,
    img: 'assets/images/catalogo-personalizado.jpg',
    qty: customState.qty,
    // extra detail kept for the order sent to Supabase (see checkout.js)
    customDetails: {
      tipo: customState.tipo,
      tipoLabel: tipoLabel,
      tamanho: isPerolas ? null : customState.tamanho,
      cor: isPerolas ? null : customState.cor,
      estilo: customState.estilo,
      entremeio: customState.santo || null,
      nomePersonalizado: (!isPerolas && customState.nomePersonalizado) ? customState.nomeTexto : null
    }
  });
  renderCart();
  showToast('Terço personalizado adicionado ao carrinho');
  var btn = document.getElementById('addCustomCartBtn');
  btn.classList.add('added');
  btn.textContent = 'Adicionado ✦';
  setTimeout(function(){ btn.classList.remove('added'); btn.textContent='Adicionar ao carrinho'; }, 1400);
  customState.qty = 1;
  document.getElementById('customQtyDisplay').textContent = 1;
  updateCustomSummary();
}

updateTipoVisibility();
updateNomePriceLabel();
updateCustomSummary();
} // end of #personalizados guard

function changeCartQty(id, delta){
  var item = cart.find(function(i){return i.id === id;});
  if(!item) return;
  item.qty += delta;
  if(item.qty <= 0){ removeFromCart(id); return; }
  renderCart();
}

function cartTotal(){
  return cart.reduce(function(sum,i){ return sum + i.price * i.qty; }, 0);
}

// ---------- cupons de desconto (aplicados na finalização do pedido) ----------
// Os cupons são criados e desligados no painel (/admin → Cupons). O site pergunta
// ao servidor (função get_coupon) quais produtos o cupom digitado cobre e por
// quanto. Isto serve só para MOSTRAR o desconto antes de finalizar: o preço de
// verdade é sempre calculado no servidor, na hora do pedido.
var appliedCoupon = null;       // código aplicado (ex.: 'APARECIDA') ou null
var appliedCouponData = null;   // { code, prices: { '<endereço do produto>': preço promocional } }

function roundMoney(v){ return Math.round(v * 100) / 100; }

// ---------- lista de entremeios (santos) ----------
// FONTE ÚNICA: todo <select data-entremeios> do site (terços personalizados e
// terços emborrachados) é preenchido a partir desta lista. Para adicionar um
// santo(a), basta incluir o nome aqui — ele aparece em todos os lugares.
var ENTREMEIOS = [
  'Carlo Acutis', 'Divino Espírito Santo', 'Jesus', 'Jesus Misericordioso',
  'Menino Jesus de Praga', 'Nossa Senhora Aparecida', 'Nossa Senhora da Conceição',
  'Nossa Senhora das Graças', 'Nossa Senhora de Fátima', 'Nossa Senhora de Guadalupe',
  'Nossa Senhora Desatadora de Nós', 'Nossa Senhora do Rosário', 'Padre Pio',
  'Pai das Misericórdias', 'Sagrada Família', 'Sagrado Coração de Jesus',
  'Sagrado Coração de Maria', 'Santa Dulce', 'Santa Luzia', 'Santa Rita',
  'Santa Terezinha', 'Santo Antônio', 'São Bento', 'São Francisco', 'São José',
  'São Miguel Arcanjo'
];
function fillEntremeios(root){
  (root || document).querySelectorAll('select[data-entremeios]').forEach(function(sel){
    if(sel.dataset.filled) return;
    sel.dataset.filled = '1';
    var outro = sel.querySelector('option[value="outro"]'); // "entremeio especial" fica sempre por último
    ENTREMEIOS.forEach(function(nome){
      var o = document.createElement('option');
      o.value = nome; o.textContent = nome;
      sel.insertBefore(o, outro);
    });
  });
}
fillEntremeios(document);

function slugify(t){
  return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// endereço (slug) do produto de um item do carrinho — é a chave dos preços do cupom
function couponKey(item){ return item.slug || String(item.id).split('--')[0]; }

// preço unitário do item considerando o cupom aplicado (nunca maior que o normal)
function couponUnitPrice(item){
  if(!appliedCouponData) return item.price;
  var promo = appliedCouponData.prices[couponKey(item)];
  return (typeof promo === 'number' && promo < item.price) ? promo : item.price;
}

function cartTotalWithCoupon(){
  return roundMoney(cart.reduce(function(sum,i){ return sum + couponUnitPrice(i) * i.qty; }, 0));
}

function cartDiscount(){
  return roundMoney(cartTotal() - cartTotalWithCoupon());
}

// o cupom só vale se ao menos um item do carrinho participa dele
function couponAppliesToCart(){
  if(!appliedCouponData) return false;
  return cart.some(function(i){ return couponUnitPrice(i) < i.price; });
}

function setCouponMsg(text, kind){
  var el = document.getElementById('couponMsg');
  if(!el) return;
  if(!text){ el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = text;
  el.className = 'coupon-msg ' + kind;
  el.style.display = 'block';
}

async function applyCoupon(){
  if(appliedCoupon){ removeCoupon(); return; } // o botão vira "Remover" depois de aplicado

  var input = document.getElementById('couponInput');
  var btn = document.getElementById('couponApplyBtn');
  var code = input.value.trim().toUpperCase();
  if(!code){ setCouponMsg('Digite o código do cupom.', 'error'); return; }

  btn.disabled = true;
  var data = null;
  try{
    if(typeof sb === 'undefined' || !sb) throw new Error('sem conexão com o servidor');
    await syncCartWithCatalog();                       // preços e endereços atuais dos itens
    var res = await sb.rpc('get_coupon', { p_code: code });
    if(res.error) throw res.error;
    data = res.data;
  } catch(e){
    btn.disabled = false;
    setCouponMsg('Não foi possível validar o cupom agora. Tente de novo em instantes.', 'error');
    return;
  }
  btn.disabled = false;

  if(!data || !data.prices){ setCouponMsg('Cupom inválido ou expirado.', 'error'); return; }
  appliedCouponData = data;
  if(!couponAppliesToCart()){
    appliedCouponData = null;
    setCouponMsg('Este cupom não vale para os produtos do seu carrinho.', 'error');
    return;
  }

  appliedCoupon = data.code;
  input.value = data.code;
  input.disabled = true;
  btn.textContent = 'Remover';
  renderModalSummary();
  setCouponMsg('Cupom ' + data.code + ' aplicado! Você economiza ' + formatBRL(cartDiscount()) + '.', 'ok');
}

function removeCoupon(){
  appliedCoupon = null;
  appliedCouponData = null;
  var input = document.getElementById('couponInput');
  if(input){ input.disabled = false; input.value = ''; }
  var btn = document.getElementById('couponApplyBtn');
  if(btn) btn.textContent = 'Aplicar';
  setCouponMsg('', '');
  renderModalSummary();
}

// chamado ao abrir o checkout: se o carrinho mudou e o cupom não vale mais, remove
function refreshCouponUI(){
  if(!appliedCoupon) return;
  if(!couponAppliesToCart()){
    removeCoupon();
    setCouponMsg('O cupom foi removido porque nenhum item do carrinho participa dele.', 'error');
  } else {
    setCouponMsg('Cupom ' + appliedCoupon + ' aplicado! Você economiza ' + formatBRL(cartDiscount()) + '.', 'ok');
  }
}

// ---------- carrinho x catálogo ----------
// Confere os itens do carrinho com o catálogo atual: atualiza preços que mudaram no
// painel e tira o que saiu do ar ou esgotou. É só para a tela mostrar o valor certo —
// o servidor sempre confere de novo quando o pedido é enviado.
async function syncCartWithCatalog(){
  if(typeof sb === 'undefined' || !sb || typeof sb.from !== 'function' || cart.length === 0) return;
  try{
    var res = await sb.from('products')
      .select('slug,price,sold_out,product_variants(cart_id,price,sold_out)')
      .eq('active', true);
    if(!res || res.error || !res.data) return;

    var map = {};
    res.data.forEach(function(p){
      map[p.slug] = { slug: p.slug, price: Number(p.price), sold_out: !!p.sold_out };
      (p.product_variants || []).forEach(function(v){
        map[v.cart_id] = { slug: p.slug, price: v.price != null ? Number(v.price) : Number(p.price), sold_out: !!p.sold_out || !!v.sold_out };
      });
    });

    var changed = false, removed = 0;
    cart = cart.filter(function(i){
      if(String(i.id).indexOf('custom-') === 0) return true;     // terços personalizados: preços do configurador
      var e = map[String(i.id).split('--')[0]];
      if(!e || e.sold_out){ removed++; return false; }
      if(e.price !== i.price){ i.price = e.price; changed = true; }
      if(i.slug !== e.slug){ i.slug = e.slug; changed = true; }
      return true;
    });
    if(changed || removed){
      renderCart();
      if(document.getElementById('modalSummary')) renderModalSummary();
      if(removed) showToast('Alguns itens saíram do carrinho porque não estão mais disponíveis.');
    }
  } catch(e){ /* sem conexão: segue com o que está na tela */ }
}
syncCartWithCatalog();

function renderCart(){
  saveCart();
  var count = cart.reduce(function(s,i){return s+i.qty;},0);
  document.getElementById('cartCount').textContent = count;

  var body = document.getElementById('cartBody');
  var foot = document.getElementById('cartFoot');

  if(cart.length === 0){
    body.innerHTML = '<div class="cart-empty"><div class="halo"></div><p>Seu carrinho está vazio.<br>Que tal escolher um terço?</p></div>';
    foot.style.display = 'none';
    return;
  }

  foot.style.display = 'block';
  document.getElementById('checkoutBtn').disabled = false;

  body.innerHTML = cart.map(function(i){
    return '<div class="cart-item">' +
      '<img src="' + escHtml(i.img) + '" alt="' + escHtml(i.name) + '">' +
      '<div>' +
        '<h5>' + escHtml(i.name) + '</h5>' +
        '<div class="cart-item-price">' + formatBRL(i.price) + '</div>' +
        '<div class="mini-stepper">' +
          '<button onclick="changeCartQty(\'' + i.id + '\',-1)">–</button>' +
          '<span>' + i.qty + '</span>' +
          '<button onclick="changeCartQty(\'' + i.id + '\',1)">+</button>' +
        '</div>' +
      '</div>' +
      '<button class="remove-btn" onclick="removeFromCart(\'' + i.id + '\')">remover</button>' +
    '</div>';
  }).join('');

  document.getElementById('cartSubtotal').textContent = formatBRL(cartTotal());
}

// ---------- drawer open/close ----------
var overlay = document.getElementById('overlay');
var drawer = document.getElementById('cartDrawer');
function openDrawer(){ overlay.classList.add('show'); drawer.classList.add('show'); }
function closeDrawer(){ overlay.classList.remove('show'); drawer.classList.remove('show'); }
document.getElementById('openCart').addEventListener('click', openDrawer);
document.getElementById('closeCart').addEventListener('click', closeDrawer);
overlay.addEventListener('click', function(){ closeDrawer(); closeCheckoutModal(); });

// ---------- checkout modal ----------
var checkoutOverlay = document.getElementById('checkoutOverlay');
function openCheckout(){
  if(cart.length === 0) return;
  refreshCouponUI();
  renderModalSummary();
  syncCartWithCatalog();
  closeDrawer();
  showCheckoutForm();
  checkoutOverlay.classList.add('show');
}
function closeCheckoutModal(){
  checkoutOverlay.classList.remove('show');
  // Reset to the form view after the close transition finishes, so a
  // customer opening checkout again next time doesn't see last order's
  // success screen for a split second.
  setTimeout(showCheckoutForm, 300);
}
document.getElementById('closeCheckout').addEventListener('click', closeCheckoutModal);

function showCheckoutForm(){
  document.getElementById('checkoutFormView').style.display = '';
  document.getElementById('checkoutSuccessView').style.display = 'none';
}
function showCheckoutSuccess(orderNumber, whatsappUrl){
  document.getElementById('checkoutFormView').style.display = 'none';
  var successView = document.getElementById('checkoutSuccessView');
  successView.style.display = 'block';
  document.getElementById('successOrderNumber').textContent = orderNumber;

  var successBtn = document.getElementById('successWhatsBtn');
  successBtn.onclick = function(){ window.open(whatsappUrl, '_blank'); };
  document.getElementById('successCloseBtn').onclick = closeCheckoutModal;
}

function renderModalSummary(){
  var rows = cart.map(function(i){
    var unit = couponUnitPrice(i);
    var line = unit < i.price
      ? '<span class="old">' + formatBRL(i.price*i.qty) + '</span>' + formatBRL(unit*i.qty)
      : formatBRL(i.price*i.qty);
    return '<div class="row"><span>' + i.qty + '× ' + escHtml(i.name) + '</span><span>' + line + '</span></div>';
  }).join('');

  var discount = cartDiscount();
  var couponRow = (appliedCoupon && discount > 0)
    ? '<div class="row coupon-line"><span>Cupom ' + appliedCoupon + '</span><span>– ' + formatBRL(discount) + '</span></div>'
    : '';

  document.getElementById('modalSummary').innerHTML = rows + couponRow +
    '<div class="total"><span>Total</span><span>' + formatBRL(cartTotalWithCoupon()) + '</span></div>';
}

function copyPix(){
  var key = '32999976067';
  navigator.clipboard.writeText(key).then(function(){
    var btn = document.getElementById('copyPixBtn');
    btn.textContent = 'Copiado ✓';
    btn.classList.add('copied');
    setTimeout(function(){ btn.textContent='Copiar'; btn.classList.remove('copied'); }, 1800);
  });
}

// ---------- toast ----------
function showToast(text){
  var t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2000);
}

// ---------- example gallery lightbox (click a card, see all 3 photos) ----------
// Guarded the same way as the personalizador block above.
if(document.getElementById('lightboxOverlay')){
var lightboxOverlay = document.getElementById('lightboxOverlay');
var lightboxMainImg = document.getElementById('lightboxMainImg');
var lightboxThumbs = document.getElementById('lightboxThumbs');
var lightboxTitle = document.getElementById('lightboxTitle');

document.querySelectorAll('.example-card').forEach(function(card){
  card.addEventListener('click', function(){
    var images = card.dataset.images.split(',');
    var name = card.dataset.name;

    lightboxTitle.textContent = name;
    lightboxMainImg.src = images[0];
    lightboxMainImg.alt = name;

    lightboxThumbs.innerHTML = images.map(function(src, i){
      return '<img src="' + src + '" alt="' + name + ' — foto ' + (i+1) + '" class="' + (i===0 ? 'active' : '') + '">';
    }).join('');

    lightboxThumbs.querySelectorAll('img').forEach(function(thumb){
      thumb.addEventListener('click', function(){
        lightboxMainImg.src = thumb.getAttribute('src');
        lightboxThumbs.querySelectorAll('img').forEach(function(t){ t.classList.remove('active'); });
        thumb.classList.add('active');
      });
    });

    lightboxOverlay.classList.add('show');
  });
});

function closeLightbox(){
  lightboxOverlay.classList.remove('show');
}
document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
lightboxOverlay.addEventListener('click', function(e){
  if(e.target === lightboxOverlay) closeLightbox();
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') closeLightbox();
});
} // end of lightbox guard

// ---------- mobile nav toggle ----------
(function(){
  var toggle = document.getElementById('menuToggle');
  var nav = document.getElementById('mainNav');
  if(!toggle || !nav) return;

  function closeNav(){
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }
  function openNav(){
    nav.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', function(){
    if(nav.classList.contains('open')) closeNav(); else openNav();
  });
  // Close after picking a link (same-page anchors) so the menu doesn't
  // stay open covering the section the visitor just navigated to.
  nav.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', closeNav);
  });
  // Close when tapping outside the open menu.
  document.addEventListener('click', function(e){
    if(!nav.classList.contains('open')) return;
    if(nav.contains(e.target) || toggle.contains(e.target)) return;
    closeNav();
  });
})();

renderCart();

// ---------- catalog cards ("Mais modelos") — quick add-to-cart ----------
// Adds straight to the cart without opening the product page. Works for
// any number of `.catalog-card[data-product-id]` cards, same pattern as
// the full product-card handler above.
document.addEventListener('click', function(e){
  var btn = e.target.closest ? e.target.closest('.catalog-cart-btn') : null;
  if(!btn) return;
  var card = btn.closest('.catalog-card[data-product-id]');
  if(!card) return;
  e.preventDefault();
  var id = card.dataset.productId;
  var name = card.dataset.productName;
  var price = parseFloat(card.dataset.productPrice);
  var img = card.dataset.productImg;
  var slug = card.dataset.productSlug || id;

  var existing = cart.find(function(i){ return i.id === id; });
  if(existing){ existing.qty += 1; }
  else { cart.push({ id: id, slug: slug, name: name, price: price, img: img, qty: 1 }); }

  renderCart();
  showToast('Adicionado ao carrinho');

  btn.classList.add('added');
  setTimeout(function(){ btn.classList.remove('added'); }, 1400);
});

// ---------- theme toggle (light / dark) ----------
(function(){
  var root = document.documentElement;
  var saved = null;
  try{ saved = localStorage.getItem('pdm-theme'); }catch(e){}
  if(saved === 'dark'){ root.setAttribute('data-theme','dark'); }

  document.getElementById('themeToggle').addEventListener('click', function(){
    var isDark = root.getAttribute('data-theme') === 'dark';
    if(isDark){ root.removeAttribute('data-theme'); }
    else{ root.setAttribute('data-theme','dark'); }
    try{ localStorage.setItem('pdm-theme', isDark ? 'light' : 'dark'); }catch(e){}
  });
})();
