/* ==========================================================================
   product-render.js — Pérolas de Maria
   Monta o HTML dos produtos a partir dos dados do Supabase (tabelas
   products / product_variants / product_images).

   Usado em DOIS lugares, para o resultado ser sempre idêntico:
     • no navegador (home: card em destaque e grade de produtos)
     • no servidor (api/produto.js: página de cada produto, já pronta para o
       Google e para a prévia de link do WhatsApp/Instagram)
   Tudo que vem do banco passa por esc() antes de virar HTML.
   ========================================================================== */
(function(root, factory){
  if(typeof module === 'object' && module.exports){ module.exports = factory(); }
  else { root.PDMRender = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){

  var FALLBACK_IMG = 'assets/images/logo.jpg';

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function brl(v){ return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }
  function imgUrl(u){
    if(!u) return '/' + FALLBACK_IMG;
    return /^(https?:)?\/\//.test(u) ? u : '/' + String(u).replace(/^\/+/, '');
  }
  function bySort(a, b){ return (a.sort_order || 0) - (b.sort_order || 0); }

  // linhas "- item" viram tópicos; **texto** vira negrito; linha em branco separa parágrafos
  function inline(s){ return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
  function descriptionHtml(text){
    if(!text) return '';
    return String(text).replace(/\r/g, '').split(/\n\s*\n/).map(function(block){
      var lines = block.split('\n').filter(function(l){ return l.trim() !== ''; });
      if(!lines.length) return '';
      var isList = lines.every(function(l){ return /^\s*[-•]\s+/.test(l); });
      if(isList){
        return '<ul>' + lines.map(function(l){ return '<li>' + inline(l.replace(/^\s*[-•]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      }
      return '<p>' + lines.map(function(l){ return inline(l.trim()); }).join('<br>') + '</p>';
    }).join('');
  }

  // organiza o que veio do banco: opções e fotos ordenadas
  function normalize(p){
    var variants = (p.product_variants || p.variants || []).slice().sort(bySort);
    var images = (p.product_images || p.images || []).slice().sort(bySort);
    var out = {}; for(var k in p){ out[k] = p[k]; }
    out.variants = variants; out.images = images;
    return out;
  }

  // fotos na ordem da galeria: gerais primeiro, depois as de cada opção
  function galleryImages(p){
    var list = p.images.filter(function(i){ return !i.variant_id; });
    p.variants.forEach(function(v){
      p.images.filter(function(i){ return i.variant_id === v.id; }).forEach(function(i){ list.push(i); });
    });
    return list;
  }
  function variantCover(p, v){
    var im = p.images.filter(function(i){ return i.variant_id === v.id; })[0];
    return im ? im.url : null;
  }
  function defaultVariant(p){
    return p.variants.filter(function(v){ return !v.sold_out; })[0] || p.variants[0] || null;
  }
  function isSoldOut(p){
    return !!p.sold_out || (p.variants.length > 0 && p.variants.every(function(v){ return v.sold_out; }));
  }
  function minPrice(p){
    var prices = [Number(p.price)];
    p.variants.forEach(function(v){ if(v.price != null) prices.push(Number(v.price)); });
    return Math.min.apply(null, prices);
  }
  function hasPriceRange(p){
    return p.variants.some(function(v){ return v.price != null && Number(v.price) !== Number(p.price); });
  }
  function firstImage(p){
    var g = galleryImages(p);
    return g.length ? g[0].url : null;
  }

  var ARTICLES = { 'cor': 'a cor', 'modelo': 'o modelo', 'entremeio': 'o entremeio', 'tamanho': 'o tamanho', 'opção': 'a opção', 'opcao': 'a opção' };
  function optionButtonText(p){
    var parts = [];
    if(p.variants.length) parts.push(String(p.option_title || 'Cor').toLowerCase());
    if(p.has_entremeio) parts.push('entremeio');
    if(!parts.length) return null;
    if(parts.length === 1) return 'Escolher ' + (ARTICLES[parts[0]] || parts[0]);
    return 'Escolher ' + parts.join(' e ');
  }

  /* ------------------------------------------------------------------
     Card grande (página do produto e destaque da home)
     ------------------------------------------------------------------ */
  function productCardHtml(raw){
    var p = normalize(raw);
    var soldOut = isSoldOut(p);
    var gallery = galleryImages(p);
    var selVar = defaultVariant(p);

    var mainUrl = (p.images.filter(function(i){ return !i.variant_id; })[0] || {}).url;
    if(!mainUrl && selVar) mainUrl = variantCover(p, selVar);
    if(!mainUrl && gallery.length) mainUrl = gallery[0].url;

    var thumbs = gallery.map(function(im, i){
      var vk = '';
      if(im.variant_id){
        var v = p.variants.filter(function(x){ return x.id === im.variant_id; })[0];
        if(v) vk = ' data-variant="' + esc(v.key) + '"';
      }
      var u = imgUrl(im.url);
      return '<img' + (im.url === mainUrl ? ' class="active"' : '') + vk + ' data-full="' + esc(u) + '" src="' + esc(u) +
        '" alt="' + esc(p.name) + ' — foto ' + (i + 1) + '" loading="lazy">';
    }).join('');

    var badge = soldOut
      ? '<span class="soldout-badge">Esgotado</span>'
      : (p.is_new ? '<span class="novidade-badge">✦ Novidade</span>' : '');

    // preço mostrado = o da opção selecionada (se tiver preço próprio)
    var shownPrice = (selVar && selVar.price != null) ? selVar.price : p.price;

    var variantHtml = '';
    if(p.variants.length){
      var hasSwatch = p.variants.some(function(v){ return !!v.swatch_url; });
      var buttons = p.variants.map(function(v){
        var sel = selVar && v.id === selVar.id;
        var cover = variantCover(p, v);
        var price = v.price != null ? v.price : p.price;
        return '<button type="button" class="variant-btn' + (sel ? ' selected' : '') + '" role="radio" aria-checked="' + (sel ? 'true' : 'false') + '"' +
          ' data-variant="' + esc(v.key) + '" data-label="' + esc(v.label) + '" data-product-id="' + esc(v.cart_id) + '"' +
          ' data-product-name="' + esc(p.name + ' ' + v.label) + '" data-product-price="' + esc(Number(price).toFixed(2)) + '"' +
          ' data-product-slug="' + esc(p.slug) + '"' +
          (cover ? ' data-cover="' + esc(imgUrl(cover)) + '"' : '') +
          (v.swatch_url ? ' data-swatch="' + esc(imgUrl(v.swatch_url)) + '"' : '') +
          (v.sold_out ? ' disabled' : '') + '>' +
          '<span class="variant-dot" style="background:' + esc(v.color || '#D9D2C3') + '"></span>' + esc(v.label) +
          (v.sold_out ? ' <small class="variant-soldout">(esgotado)</small>' : '') + '</button>';
      }).join('\n          ');

      var preview = '';
      if(hasSwatch){
        var sw = selVar && selVar.swatch_url ? imgUrl(selVar.swatch_url) : '';
        preview = '\n        <div class="variant-preview"' + (sw ? '' : ' style="display:none;"') + '>' +
          '<img class="variant-preview-img" src="' + esc(sw) + '" alt="' + esc(selVar ? selVar.label : '') + '" width="96" height="96">' +
          '<div class="variant-preview-text"><span>Pérola da cor</span><strong class="variant-preview-name">' + esc(selVar ? selVar.label : '') + '</strong></div></div>';
      }
      var showNote = gallery.length > 0 && selVar && !variantCover(p, selVar);
      var noteText = 'Ainda não temos a foto desta opção' + (hasSwatch ? ' — veja a imagem acima.' : '.');

      variantHtml = '\n      <div class="variant-picker" role="radiogroup" aria-label="' + esc(p.option_title) + '">' +
        '\n        <span class="variant-title">' + esc(p.option_title) + ': <strong class="variant-current">' + esc(selVar ? selVar.label : '') + '</strong></span>' +
        '\n        <div class="variant-options">\n          ' + buttons + '\n        </div>' + preview +
        '\n        <p class="variant-note" style="display:' + (showNote ? 'block' : 'none') + ';">' + esc(noteText) + '</p>' +
        '\n      </div>';
    }

    var entremeioHtml = '';
    if(p.has_entremeio){
      var wa = 'https://wa.me/5532999976067?text=' + encodeURIComponent('Olá! Quero um entremeio especial no meu ' + String(p.name).toLowerCase() + '.');
      entremeioHtml = '\n      <div class="field entremeio-field">' +
        '\n        <label for="entremeioSelect">Qual santo(a) você deseja no entremeio?</label>' +
        '\n        <select id="entremeioSelect" data-entremeios>' +
        '\n          <option value="" disabled selected>Selecione uma opção</option>' +
        '\n          <option value="outro">Quero um entremeio especial (falar no WhatsApp)</option>' +
        '\n        </select>' +
        '\n        <p class="custom-sub entremeio-hint" style="display:none;">Combine o seu entremeio especial pelo ' +
        '<a href="' + esc(wa) + '" target="_blank" rel="noopener" style="color:var(--gold);font-weight:600;">WhatsApp</a>.</p>' +
        '\n        <p class="custom-sub">As fotos são exemplos — o entremeio é o santo(a) que você escolher acima.</p>' +
        '\n      </div>';
    }

    return '<div class="product-card' + (p.is_new && !soldOut ? ' novidade-card' : '') + '"' +
      ' data-product-id="' + esc(p.slug) + '" data-product-slug="' + esc(p.slug) + '" data-product-name="' + esc(p.name) + '"' +
      ' data-product-price="' + esc(Number(p.price).toFixed(2)) + '"' + (soldOut ? ' data-sold-out="true"' : '') + '>' +
      '\n    <div class="gallery">' +
      '\n      <div class="gallery-main">' + badge +
      '\n        <img class="main-img" src="' + esc(imgUrl(mainUrl)) + '" alt="' + esc(p.name) + '">' +
      '\n      </div>' +
      '\n      <div class="gallery-thumbs">' + thumbs + '</div>' +
      '\n    </div>' +
      '\n    <div class="product-info">' +
      (p.eyebrow ? '\n      <span class="eyebrow">' + esc(p.eyebrow) + '</span>' : '') +
      '\n      <h3>' + esc(p.name) + '</h3>' +
      '\n      <div class="stars">★★★★★</div>' +
      '\n      <div class="product-desc">' + descriptionHtml(p.description) + '</div>' +
      variantHtml + entremeioHtml +
      '\n      <div class="price-row">' +
      '\n        <span class="price">' + brl(shownPrice) + '</span>' +
      '\n        <span class="price-note">à vista no Pix</span>' +
      '\n      </div>' +
      '\n      <div class="qty-row">' +
      '\n        <div class="qty-stepper">' +
      '\n          <button class="qty-minus">–</button>' +
      '\n          <span class="qty-display">1</span>' +
      '\n          <button class="qty-plus">+</button>' +
      '\n        </div>' +
      '\n        <button class="add-cart-btn"' + (soldOut ? ' disabled' : '') + '>' + (soldOut ? 'Esgotado' : 'Adicionar ao carrinho') + '</button>' +
      '\n      </div>' +
      '\n      <div class="ship-note">' +
      '\n        <span>✦</span>' +
      '\n        <span>Peça artesanal — pequenas variações entre peças fazem parte da produção manual. Envio combinado após confirmação do pagamento.</span>' +
      '\n      </div>' +
      '\n    </div>' +
      '\n  </div>';
  }

  /* ------------------------------------------------------------------
     Card pequeno (grade "Mais modelos" da home)
     ------------------------------------------------------------------ */
  var CART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

  function catalogCardHtml(raw){
    var p = normalize(raw);
    var soldOut = isSoldOut(p);
    var href = '/produto/' + encodeURIComponent(p.slug);
    var img = imgUrl(firstImage(p));
    var tagline = p.tagline || String(p.description || '').split(/\n\s*\n/)[0].replace(/\*\*/g, '').slice(0, 110);
    var btnText = optionButtonText(p);

    var badge = soldOut ? '<span class="soldout-badge catalog-badge">Esgotado</span>'
      : (p.is_new ? '<span class="novidade-badge catalog-badge">✦ Novidade</span>' : '');

    var colors = '';
    if(p.variants.length > 1){
      var word = p.variants.length + ' ' + (String(p.option_title).toLowerCase() === 'cor' ? 'cores'
        : String(p.option_title).toLowerCase() === 'modelo' ? 'modelos' : 'opções');
      colors = '<div class="catalog-colors">' + p.variants.slice(0, 8).map(function(v){
        return '<span class="variant-dot" style="background:' + esc(v.color || '#D9D2C3') + '"></span>';
      }).join('') + '<span>' + esc(word) + '</span></div>';
    }

    var priceTxt = (hasPriceRange(p) ? 'a partir de ' : '') + brl(minPrice(p));

    var actions;
    if(btnText){
      actions = '<a href="' + esc(href) + '" class="catalog-view-btn">' + esc(soldOut ? 'Ver mais' : btnText) + '</a>';
    } else {
      actions = '<a href="' + esc(href) + '" class="catalog-view-btn">Ver mais</a>' +
        (soldOut ? '' : '<button type="button" class="catalog-cart-btn" aria-label="Adicionar ao carrinho">' + CART_SVG + '</button>');
    }

    return '<div class="catalog-card" data-product-id="' + esc(p.slug) + '" data-product-slug="' + esc(p.slug) + '"' +
      ' data-product-name="' + esc(p.name) + '" data-product-price="' + esc(Number(p.price).toFixed(2)) + '"' +
      ' data-product-img="' + esc(img) + '">' +
      '\n      <a href="' + esc(href) + '" class="catalog-card-link">' +
      '\n        ' + badge +
      '\n        <div class="catalog-img"><img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy"></div>' +
      '\n        <div class="catalog-info">' +
      '\n          <h4>' + esc(p.name) + '</h4>' +
      '\n          <p class="catalog-desc">' + esc(tagline) + '</p>' +
      (colors ? '\n          ' + colors : '') +
      '\n          <span class="catalog-price">' + esc(priceTxt) + '</span>' +
      '\n        </div>' +
      '\n      </a>' +
      '\n      <div class="catalog-actions">' + actions + '</div>' +
      '\n    </div>';
  }

  /* ------------------------------------------------------------------
     Dados estruturados (Google) de um produto
     ------------------------------------------------------------------ */
  function productJsonLd(raw, siteUrl){
    var p = normalize(raw);
    var base = String(siteUrl || '').replace(/\/+$/, '');
    function abs(u){ var x = imgUrl(u); return /^https?:/.test(x) ? x : base + x; }
    var images = galleryImages(p).map(function(i){ return abs(i.url); });
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      image: images.length ? images : [abs(null)],
      description: String(p.tagline || p.description || p.name).replace(/\*\*/g, '').replace(/\n+/g, ' ').slice(0, 300),
      brand: { '@type': 'Brand', name: 'Pérolas de Maria' },
      offers: {
        '@type': 'Offer', priceCurrency: 'BRL', price: Number(minPrice(p)).toFixed(2),
        availability: isSoldOut(p) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        url: base + '/produto/' + p.slug
      }
    };
    // evita "</script>" dentro do JSON
    return JSON.stringify(ld).replace(/</g, '\\u003c');
  }

  return {
    esc: esc, brl: brl, imgUrl: imgUrl, descriptionHtml: descriptionHtml, normalize: normalize,
    galleryImages: galleryImages, firstImage: firstImage, isSoldOut: isSoldOut, minPrice: minPrice,
    productCardHtml: productCardHtml, catalogCardHtml: catalogCardHtml, productJsonLd: productJsonLd
  };
});
