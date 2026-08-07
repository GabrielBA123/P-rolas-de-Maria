/* ==========================================================================
   carousel.js — promo carousel at the top of the storefront
   The track moves via a CSS transform (translateX), fully controlled by
   this script — no native scrolling/scroll-snap involved, which is what
   caused the previous version to glitch when clicking the arrows.
   Touch/mouse drag is implemented by hand below so swiping still works.
   ========================================================================== */

(function(){
  const track = document.getElementById('carouselTrack');
  if(!track) return; // section not on this page

  const viewport = track.parentElement;
  const slides = Array.from(track.children);
  const dotsWrap = document.getElementById('carouselDots');
  const prevBtn = document.getElementById('carouselPrev');
  const nextBtn = document.getElementById('carouselNext');

  let index = 0;
  let autoplayTimer = null;
  const AUTOPLAY_MS = 7500;

  // build the dot indicators
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', 'Ir para o slide ' + (i + 1));
    dot.addEventListener('click', () => { goTo(i); restartAutoplay(); });
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function render(){
    track.style.transform = 'translateX(' + (-index * 100) + '%)';
    dots.forEach((d, di) => d.classList.toggle('active', di === index));
  }

  function goTo(i){
    index = (i + slides.length) % slides.length;
    render();
  }

  prevBtn.addEventListener('click', () => { goTo(index - 1); restartAutoplay(); });
  nextBtn.addEventListener('click', () => { goTo(index + 1); restartAutoplay(); });

  function startAutoplay(){
    stopAutoplay();
    autoplayTimer = setInterval(() => goTo(index + 1), AUTOPLAY_MS);
  }
  function stopAutoplay(){
    clearInterval(autoplayTimer);
  }
  function restartAutoplay(){
    startAutoplay();
  }

  // pause on hover (desktop) — never fight the visitor while they're looking
  const section = document.getElementById('promoCarousel');
  section.addEventListener('mouseenter', stopAutoplay);
  section.addEventListener('mouseleave', startAutoplay);

  /* ------------------------------------------------------------------------
     Manual drag/swipe (mouse + touch), since we no longer use native scroll.
     A small drag distance is treated as a swipe (changes slide); a very
     small movement (or none) lets the click through so the slide's own
     link still works normally.
     ------------------------------------------------------------------------ */
  let dragging = false;
  let dragMoved = false;
  let startX = 0;

  function dragStart(clientX){
    dragging = true;
    dragMoved = false;
    startX = clientX;
    stopAutoplay();
    track.style.transition = 'none';
  }
  function dragMove(clientX){
    if(!dragging) return;
    const delta = clientX - startX;
    if(Math.abs(delta) > 6) dragMoved = true;
    const percent = (delta / viewport.clientWidth) * 100;
    track.style.transform = 'translateX(' + (-index * 100 + percent) + '%)';
  }
  function dragEnd(clientX){
    if(!dragging) return;
    dragging = false;
    track.style.transition = '';
    const delta = clientX - startX;
    const threshold = viewport.clientWidth * 0.15;
    if(delta > threshold) goTo(index - 1);
    else if(delta < -threshold) goTo(index + 1);
    else render(); // snap back to the current slide
    startAutoplay();
  }

  viewport.addEventListener('pointerdown', e => {
    // ignore right-click / non-primary buttons
    if(e.button !== undefined && e.button !== 0) return;
    dragStart(e.clientX);
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', e => dragMove(e.clientX));
  viewport.addEventListener('pointerup', e => dragEnd(e.clientX));
  viewport.addEventListener('pointercancel', () => { dragging = false; track.style.transition = ''; render(); startAutoplay(); });

  // if the pointer moved enough to count as a drag, swallow the click so
  // the slide's <a href> doesn't navigate accidentally mid-swipe
  slides.forEach(slide => {
    slide.addEventListener('click', e => {
      if(dragMoved) e.preventDefault();
    });
  });

  render();
  startAutoplay();
})();
