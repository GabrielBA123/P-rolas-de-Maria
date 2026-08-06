/* ==========================================================================
   carousel.js — promo carousel at the top of the storefront
   The track is a horizontally-scrolling flex container with scroll-snap,
   so touch swipe works for free (native browser scrolling). This script
   only adds: autoplay, dots, arrow buttons, and pausing on interaction.
   ========================================================================== */

(function(){
  const track = document.getElementById('carouselTrack');
  if(!track) return; // section not on this page

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
    dot.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function goTo(i){
    index = (i + slides.length) % slides.length;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
    dots.forEach((d, di) => d.classList.toggle('active', di === index));
  }

  prevBtn.addEventListener('click', () => { goTo(index - 1); restartAutoplay(); });
  nextBtn.addEventListener('click', () => { goTo(index + 1); restartAutoplay(); });

  // keep the dots in sync if the visitor swipes manually
  let scrollDebounce;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      const slideWidth = track.clientWidth;
      const current = Math.round(track.scrollLeft / slideWidth);
      index = Math.max(0, Math.min(slides.length - 1, current));
      dots.forEach((d, di) => d.classList.toggle('active', di === index));
    }, 100);
  });

  function startAutoplay(){
    autoplayTimer = setInterval(() => goTo(index + 1), AUTOPLAY_MS);
  }
  function stopAutoplay(){
    clearInterval(autoplayTimer);
  }
  function restartAutoplay(){
    stopAutoplay();
    startAutoplay();
  }

  // pause on hover (desktop) and on touch (mobile) — never fight the visitor
  const section = document.getElementById('promoCarousel');
  section.addEventListener('mouseenter', stopAutoplay);
  section.addEventListener('mouseleave', startAutoplay);
  track.addEventListener('touchstart', stopAutoplay, { passive: true });
  track.addEventListener('touchend', () => setTimeout(startAutoplay, AUTOPLAY_MS));

  startAutoplay();
})();
