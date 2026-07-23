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

// ---------- cart state (in-memory — lives only for this page visit) ----------
var cart = [];

function formatBRL(v){
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// ---------- products / gallery / add-to-cart ----------
// Works for any number of `.product-card[data-product-id]` blocks in the
// page — each card carries its own name/price in data attributes, so
// adding a new terço is just adding another card in index.html, no JS
// changes needed.
document.querySelectorAll('.product-card[data-product-id]').forEach(function(card){
  var qty = 1;
  var qtyDisplay = card.querySelector('.qty-display');
  var mainImg = card.querySelector('.main-img');
  var defaultImg = mainImg.getAttribute('src'); // cart thumbnail always uses the cover photo, even if the visitor is browsing other gallery views

  card.querySelectorAll('.gallery-thumbs img').forEach(function(t){
    t.addEventListener('click', function(){
      mainImg.src = t.dataset.full;
      card.querySelectorAll('.gallery-thumbs img').forEach(function(x){x.classList.remove('active');});
      t.classList.add('active');
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

  card.querySelector('.add-cart-btn').addEventListener('click', function(){
    var id = card.dataset.productId;
    var name = card.dataset.productName;
    var price = parseFloat(card.dataset.productPrice);

    var existing = cart.find(function(i){ return i.id === id; });
    if(existing){ existing.qty += qty; }
    else { cart.push({ id: id, name: name, price: price, img: defaultImg, qty: qty }); }

    renderCart();
    showToast('Adicionado ao carrinho');

    var btn = card.querySelector('.add-cart-btn');
    btn.classList.add('added');
    btn.textContent = 'Adicionado ✦';
    setTimeout(function(){ btn.classList.remove('added'); btn.textContent = 'Adicionar ao carrinho'; }, 1400);

    qty = 1;
    qtyDisplay.textContent = qty;
  });
});

function removeFromCart(id){
  cart = cart.filter(function(i){return i.id !== id;});
  renderCart();
}

// ---------- personalized terço configurator ----------
var customState = {
  tipo: 'normal',
  price: 19.90,
  tipoLabel: 'Terço simples',
  cor: 'Royal',
  estilo: 'Florzinha',
  santo: '',
  qty: 1
};

document.querySelectorAll('#tipoChoice .choice-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#tipoChoice .choice-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    customState.tipo = btn.dataset.tipo;
    customState.price = parseFloat(btn.dataset.price);
    customState.tipoLabel = btn.querySelector('.choice-title').textContent;
    var corHint = document.getElementById('corHint');
    var corChoice = document.getElementById('corChoice');
    if(customState.tipo === 'perolas'){
      corChoice.style.opacity = '.35';
      corChoice.style.pointerEvents = 'none';
      corHint.style.display = 'block';
    } else {
      corChoice.style.opacity = '1';
      corChoice.style.pointerEvents = 'auto';
      corHint.style.display = 'none';
    }
    updateCustomSummary();
  });
});

document.querySelectorAll('#corChoice .swatch').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#corChoice .swatch').forEach(function(b){b.classList.remove('selected');});
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
  var corLine = customState.tipo === 'perolas'
    ? '<div class="cfg-row"><strong>Contas:</strong><span>só pérolas (Pai Nosso)</span></div>'
    : '<div class="cfg-row"><strong>Cor da Ave Maria:</strong><span>' + customState.cor + '</span></div>';
  var html =
    '<div class="cfg-row"><strong>Tipo:</strong><span>' + customState.tipoLabel + '</span></div>' +
    corLine +
    '<div class="cfg-row"><strong>Pai Nosso:</strong><span>' + customState.estilo + '</span></div>' +
    '<div class="cfg-row"><strong>Entremeio:</strong><span>' + santoText + '</span></div>' +
    '<div class="cfg-row"><strong>Quantidade:</strong><span>' + customState.qty + '</span></div>' +
    '<div class="total"><span>Total</span><span>' + formatBRL(customState.price * customState.qty) + '</span></div>';
  document.getElementById('customSummary').innerHTML = html;
}

function addCustomToCart(){
  var santoText = customState.santo ? customState.santo : 'a combinar';
  var corText = customState.tipo === 'perolas' ? 'só pérolas (Pai Nosso)' : customState.cor;
  var name = customState.tipoLabel + ' — ' + corText + ', Pai Nosso ' + customState.estilo + ', entremeio: ' + santoText;
  var id = 'custom-' + customState.tipo + '-' + customState.cor + '-' + customState.estilo + '-' + santoText + '-' + Date.now();
  cart.push({
    id: id,
    name: name,
    price: customState.price,
    img: 'assets/images/catalogo-personalizado.jpg',
    qty: customState.qty,
    // extra detail kept for the order sent to Supabase (see checkout.js)
    customDetails: {
      tipo: customState.tipo,
      tipoLabel: customState.tipoLabel,
      cor: customState.tipo === 'perolas' ? null : customState.cor,
      estilo: customState.estilo,
      entremeio: customState.santo || null
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

updateCustomSummary();

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

function renderCart(){
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
      '<img src="' + i.img + '" alt="' + i.name + '">' +
      '<div>' +
        '<h5>' + i.name + '</h5>' +
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
  renderModalSummary();
  closeDrawer();
  checkoutOverlay.classList.add('show');
}
function closeCheckoutModal(){ checkoutOverlay.classList.remove('show'); }
document.getElementById('closeCheckout').addEventListener('click', closeCheckoutModal);

function renderModalSummary(){
  var rows = cart.map(function(i){
    return '<div class="row"><span>' + i.qty + '× ' + i.name + '</span><span>' + formatBRL(i.price*i.qty) + '</span></div>';
  }).join('');
  document.getElementById('modalSummary').innerHTML = rows +
    '<div class="total"><span>Total</span><span>' + formatBRL(cartTotal()) + '</span></div>';
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

renderCart();

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
