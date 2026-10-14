/* ==========================================================================
   catalogo.js — Pérolas de Maria (só na home)
   Monta o produto em destaque e a grade "Mais modelos" a partir do banco
   (tabelas products / product_variants / product_images, cadastradas em
   /admin → Produtos). Guarda uma cópia no navegador: na próxima visita a
   vitrine aparece na hora e é atualizada em seguida; e se o servidor estiver
   fora do ar, os últimos produtos vistos continuam na tela.
   ========================================================================== */
(function(){
  var featuredEl = document.getElementById('featuredProducts');
  var gridEl = document.getElementById('catalogGrid');
  if(!gridEl || typeof PDMRender === 'undefined') return;

  var CACHE_KEY = 'pdm-catalog-v1';

  function render(products){
    var featured = products.filter(function(p){ return p.featured; });
    var others = products.filter(function(p){ return !p.featured; });

    if(featuredEl){
      featuredEl.innerHTML = featured.map(PDMRender.productCardHtml).join('');
      fillEntremeios(featuredEl);
      featuredEl.querySelectorAll('.product-card[data-product-id]').forEach(initProductCard);
    }
    gridEl.innerHTML = others.map(PDMRender.catalogCardHtml).join('') ||
      '<p class="catalog-empty">Em breve novos produtos por aqui. 🌹</p>';
  }

  function readCache(){
    try{
      var d = JSON.parse(localStorage.getItem(CACHE_KEY));
      if(d && Array.isArray(d.products)) return d.products;
    }catch(e){}
    return null;
  }
  function writeCache(products){
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), products: products })); }catch(e){}
  }

  var cached = readCache();
  if(cached) render(cached);

  (async function load(){
    try{
      if(typeof sb === 'undefined' || !sb) throw new Error('sem conexão com o servidor');
      var res = await sb.from('products')
        .select('*, product_variants(*), product_images(*)')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if(res.error) throw res.error;
      var fresh = res.data || [];
      if(JSON.stringify(fresh) !== JSON.stringify(cached)){ render(fresh); writeCache(fresh); }
      syncCartWithCatalog();
    }catch(e){
      console.error('Erro ao carregar os produtos:', e);
      if(!cached){
        gridEl.innerHTML = '<p class="catalog-empty">Não foi possível carregar os produtos agora. Atualize a página em instantes ' +
          'ou fale com a gente pelo <a href="https://wa.me/5532999976067" target="_blank" rel="noopener" style="color:var(--gold);font-weight:600;">WhatsApp</a>.</p>';
      }
    }
  })();
})();
