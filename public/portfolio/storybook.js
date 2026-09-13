(() => {
  const board = document.querySelector('.memory-board');
  if (!board) return;
  const slides = [...board.querySelectorAll('.story-slide')];
  const dots = [...board.querySelectorAll('[data-slide]')];
  const toggle = board.querySelector('.slideshow-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let paused = reducedMotion.matches;
  let timer;

  function show(index) {
    current = index;
    slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === current);
      slide.setAttribute('aria-hidden', String(i !== current));
      dots[i].setAttribute('aria-pressed', String(i === current));
    });
  }

  function schedule() {
    clearInterval(timer);
    toggle.textContent = paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
    if (!paused && !document.hidden) timer = setInterval(() => show((current + 1) % slides.length), 3000);
  }

  dots.forEach((dot, i) => dot.addEventListener('click', () => {
    paused = true;
    show(i);
    schedule();
  }));
  toggle.addEventListener('click', () => { paused = !paused; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; schedule(); });
  board.querySelector('.slideshow-controls').hidden = false;
  schedule();
})();

