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
document.querySelectorAll('.catalog-card[data-product-id]').forEach(function(card){
  var btn = card.querySelector('.catalog-cart-btn');
  if(!btn) return;
  btn.addEventListener('click', function(e){
    e.preventDefault();
    var id = card.dataset.productId;
    var name = card.dataset.productName;
    var price = parseFloat(card.dataset.productPrice);
    var img = card.dataset.productImg;

    var existing = cart.find(function(i){ return i.id === id; });
    if(existing){ existing.qty += 1; }
    else { cart.push({ id: id, name: name, price: price, img: img, qty: 1 }); }

    renderCart();
    showToast('Adicionado ao carrinho');

    btn.classList.add('added');
    setTimeout(function(){ btn.classList.remove('added'); }, 1400);
  });
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
