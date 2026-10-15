/* ==========================================================================
   carrossel.js — Pérolas de Maria (só na home)
   Monta os slides do carrossel do topo a partir do banco (tabela
   carousel_slides, editada em /admin → Carrossel). Guarda uma cópia no
   navegador: na próxima visita aparece na hora, e se o servidor estiver fora
   do ar os últimos slides vistos continuam na tela. Se nunca conseguiu
   carregar, ficam os slides que já vêm escritos no index.html.
   ========================================================================== */
(function(){
  var track = document.getElementById('carouselTrack');
  var section = document.getElementById('promoCarousel');
  if(!track || !section || typeof PDMRender === 'undefined') return;

  var CACHE_KEY = 'pdm-carousel-v1';
  var esc = PDMRender.esc;

  // só endereços do próprio site, âncoras ou https (nunca "javascript:")
  function safeLink(l){ return /^(\/|#|https:\/\/)/.test(String(l || '')) ? l : '#produtos'; }

  function slideHtml(s){
    var external = /^https:\/\//.test(s.link) && s.link.indexOf('perolas-de-maria') === -1;
    return '<a class="carousel-slide" href="' + esc(safeLink(s.link)) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' +
      '<img src="' + esc(PDMRender.imgUrl(s.image_url)) + '" alt="' + esc(s.title) + '">' +
      '<div class="carousel-overlay">' +
        (s.eyebrow ? '<span class="carousel-eyebrow">' + esc(s.eyebrow) + '</span>' : '') +
        '<h3>' + esc(s.title) + '</h3>' +
        (s.text ? '<p>' + esc(s.text) + '</p>' : '') +
        (s.cta_text ? '<span class="carousel-cta">' + esc(s.cta_text) + '</span>' : '') +
      '</div></a>';
  }

  function render(slides){
    if(!slides.length){ section.style.display = 'none'; return; }   // nenhum slide ativo: esconde o carrossel
    section.style.display = '';
    track.innerHTML = slides.map(slideHtml).join('');
    if(window.PDMCarousel) window.PDMCarousel.rebuild();
  }

  function readCache(){
    try{ var d = JSON.parse(localStorage.getItem(CACHE_KEY)); if(d && Array.isArray(d.slides)) return d.slides; }catch(e){}
    return null;
  }
  function writeCache(slides){
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), slides: slides })); }catch(e){}
  }

  var cached = readCache();
  if(cached) render(cached);

  (async function load(){
    try{
      if(typeof sb === 'undefined' || !sb) throw new Error('sem conexão com o servidor');
      var res = await sb.from('carousel_slides').select('*').eq('active', true).order('sort_order', { ascending: true });
      if(res.error) throw res.error;
      var fresh = res.data || [];
      if(JSON.stringify(fresh) !== JSON.stringify(cached)){ render(fresh); writeCache(fresh); }
    }catch(e){
      console.error('Erro ao carregar o carrossel:', e);   // mantém o que já está na tela
    }
  })();
})();
