/* ==========================================================================
   Mudra Clothing Company: Our Story (/about)
   Small scroll-driven touches. The page reads fine without any of this:
   .js-st on <html> is what arms the "before" states in story.css.
   ========================================================================== */

(() => {
const M = window.Mudra;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const story = $('#story');
if (!story) return;

document.documentElement.classList.add('js-st');

/* add .in once, when an element is properly on screen */
function once(els, opts, fn) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      fn && fn(en.target);
      io.unobserve(en.target);
    });
  }, opts);
  els.forEach(el => el && io.observe(el));
}

/* ---------- ticker: same live lines as the home page ----------------- */
async function ticker() {
  const track = $('#ticker');
  if (!track || !M.loadDrop) return;
  await M.loadDrop();
  const row = M.tickerItems().map(t => `<span>${M.esc(t)}</span><span>✳</span>`).join('');
  track.innerHTML = row + row;
}

/* ---------- photos: use a file only if it exists --------------------- */
function photos() {
  $$('.st-photo[data-photo]').forEach(fig => {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.onload = () => fig.appendChild(img);
    img.src = `/assets/img/story/${fig.dataset.photo}.jpg`;
  });
}

/* ---------- chapter counter + progress line -------------------------- */
function chapters() {
  const count = $('#stCount'), bar = $('#stBar');
  const secs = $$('.st[data-ch]');
  const total = String(secs.length).padStart(2, '0');
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      count.textContent = `${String(el.closest('[data-ch]').dataset.ch).padStart(2, '0')} / ${total}`;
      count.dataset.tone = el.dataset.tone;
    });
  }, { rootMargin: '-50% 0px -50% 0px' });
  // posters carry their own tone, so the counter stays readable on lime and on black
  $$('.st[data-ch], .st-poster[data-tone]').forEach(el => io.observe(el));

  let ticking = false;
  const sync = () => {
    ticking = false;
    const r = story.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    if (bar) bar.style.transform = `scaleX(${p})`;
    count.classList.toggle('on', r.top < innerHeight * .4 && r.bottom > innerHeight * .6);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(sync); } }, { passive: true });
  sync();
}

/* ---------- 04: press and hold to stamp the seal --------------------- */
function clay() {
  const btn = $('#stClay'), label = $('#stClayLabel');
  if (!btn) return;
  const HOLD = 1000, KEY = 'mudra.sealed';
  let raf = 0, t0 = 0, done = false;

  const seal = (animate) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    btn.classList.remove('holding');
    btn.classList.add('sealed');
    if (animate && !reduce) btn.classList.add('stamping');
    btn.setAttribute('aria-pressed', 'true');
    btn.style.removeProperty('--hold');
    label.textContent = 'Sealed.';
    try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  };
  const tick = now => {
    const p = Math.min(1, (now - t0) / HOLD);
    btn.style.setProperty('--hold', p);
    if (p >= 1) return seal(true);
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (done || btn.classList.contains('holding')) return;
    btn.classList.add('holding');
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (done) return;
    cancelAnimationFrame(raf);
    btn.classList.remove('holding');
    btn.style.setProperty('--hold', 0);
  };

  let stored = false;
  try { stored = sessionStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
  if (stored || reduce) seal(false);

  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); start(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, stop));
  btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') stop(); });
  btn.addEventListener('blur', stop);

  // scrolled past without pressing: it stamps itself
  new IntersectionObserver(([en]) => {
    if (!en.isIntersecting && en.boundingClientRect.bottom < 0) seal(true);
  }).observe(btn);
}

/* ---------- 03: tap a line to show its footnote on touch screens ----- */
function lines() {
  $$('.st-line').forEach(line => {
    if (!$('.st-tag', line)) return;
    line.addEventListener('click', e => {
      if (e.target.closest('.st-tag')) return;           // the link itself navigates
      $$('.st-line.tapped').forEach(l => l !== line && l.classList.remove('tapped'));
      line.classList.toggle('tapped');
    });
  });
}

/* ---------- 09: light across the reflection -------------------------- */
function mirror() {
  const m = $('#stMirror');
  if (!m || reduce || !matchMedia('(hover:hover)').matches) return;
  m.addEventListener('pointermove', e => {
    const r = m.getBoundingClientRect();
    m.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    m.classList.add('lit');
  });
  m.addEventListener('pointerleave', () => m.classList.remove('lit'));
}

function init() {
  const mid = { rootMargin: '0px 0px -18% 0px', threshold: .2 };
  once([$('.st-hero')], { threshold: 0 });
  once([$('#stNotif')], { threshold: .9 });
  once($$('.st-line'), { rootMargin: '0px 0px -12% 0px', threshold: .6 });
  once([$('.st-chat'), $('.st-word')], mid);
  once($$('.st-place'), { rootMargin: '0px 0px -25% 0px', threshold: 1 });
  once([$('#stSameP')], { rootMargin: '0px 0px -35% 0px', threshold: 1 }, () => $('#stWalk').classList.add('same'));
  // touch screens have no hover: the belief cards stamp themselves as they arrive
  if (!matchMedia('(hover:hover)').matches) {
    once($$('.st-card'), { rootMargin: '0px 0px -30% 0px', threshold: .6 }, el => el.classList.add('stamped'));
  }
  chapters(); clay(); lines(); mirror(); photos(); ticker();
}

init();
})();
