/* ==========================================================================
   Mudra: Our Story (/about)
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
    if (fig.querySelector('img')) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.onload = () => fig.appendChild(img);
    img.src = `/assets/img/story/${fig.dataset.photo}.jpg`;
  });
}

/* ---------- 01: the mirror ------------------------------------------
   Line 2 sits there mirrored; a small pane of glass shows it the right way
   round. The pane follows the pointer, drifts when left alone, and the first
   20vh of scroll opens it over the whole line. All geometry is read in
   measure(); the frame loop only writes --mx and --my (and --p where CSS
   scroll timelines are missing). With reduced motion none of this runs and
   the page keeps the plain, finished text. */
function glass() {
  const fold = $('.st--hero'), box = $('.st-glass');
  if (!fold || !box || reduce) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const native = !!(window.CSS && CSS.supports('animation-timeline: scroll()'));
  const IDLE = 3000, PASS = 6000, LAG = .15;
  const set = (k, v) => fold.style.setProperty(k, v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let fx = 0, fy = 0, fw = 0, fh = 0, ox = 0, oy = 0, gw = 0, gh = 0, em = 0, vh = 1;
  let mx = 0, my = 0, tx = 0, ty = 0;            // mirror centre now and wanted, from the top left of line 2
  let px = 0, py = 0, moved = false, lastMove = 0;
  let sy = 0, scrolled = true;                    // scroll position, read once per frame
  let drifting = !fine, drift0 = -1, heldAt = 0, idleT = 0;
  let seen = true, raf = 0, ready = false;

  const measure = () => {
    const f = fold.getBoundingClientRect();
    fx = f.left + scrollX; fy = f.top + scrollY; fw = fold.offsetWidth; fh = fold.offsetHeight;
    ox = 0; oy = 0;
    for (let el = box; el && el !== fold; el = el.offsetParent) { ox += el.offsetLeft; oy += el.offsetTop; }
    gw = box.offsetWidth; gh = box.offsetHeight;
    em = parseFloat(getComputedStyle(box).fontSize);
    vh = innerHeight;
    set('--ox', ox); set('--oy', oy); set('--fw', fw); set('--fh', fh); set('--gw', gw); set('--gh', gh);
    if (!moved && !drifting) { tx = mx = em; ty = my = gh / 2; }      // resting place: left edge of line 2
    if (!ready) {
      ready = true;
      tx = mx = em; ty = my = gh / 2;
      set('--mx', mx); set('--my', my);
      fold.classList.add('is-mirror');
    }
    kick();
  };

  const startDrift = now => {
    // pick the pass up from wherever the mirror already is
    const u = clamp((mx - em) / Math.max(1, gw - 2 * em), 0, 1);
    drift0 = now - Math.acos(1 - 2 * u) / Math.PI * PASS;
    drifting = true;
  };

  function frame(now) {
    raf = 0;
    if (scrolled) { scrolled = false; sy = scrollY; }
    if (!native) set('--p', clamp(sy / (vh * .2), 0, 1).toFixed(4));
    if (sy > 0) {                                 // scroll owns the mirror now
      if (!heldAt) heldAt = now;
      if (!fine) drifting = false;                // touch: the drift ends with the first scroll
      return;
    }
    if (heldAt) { if (drift0 >= 0) drift0 += now - heldAt; lastMove += now - heldAt; heldAt = 0; }

    if (moved) {
      moved = false;
      tx = clamp(px - fx - ox, -ox, fw - ox);
      ty = clamp(py - fy - oy, -oy, fh - oy);
    } else if (fine && !drifting && now - lastMove >= IDLE) {
      startDrift(now);
    }
    if (drifting) {
      if (drift0 < 0) drift0 = now;
      const u = (1 - Math.cos(Math.PI * (now - drift0) / PASS)) / 2;
      tx = em + Math.max(0, gw - 2 * em) * u;
      ty = gh / 2;
    }
    mx += (tx - mx) * LAG; my += (ty - my) * LAG;
    const settled = Math.abs(tx - mx) < .05 && Math.abs(ty - my) < .05;
    if (settled) { mx = tx; my = ty; }
    set('--mx', mx.toFixed(2)); set('--my', my.toFixed(2));

    if (drifting || !settled) return kick();
    if (fine) {                                   // still: wake up when the idle time is over
      clearTimeout(idleT);
      idleT = setTimeout(kick, Math.max(0, IDLE - (now - lastMove)) + 20);
    }
  }
  function kick() {
    if (!raf && ready && seen && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const hold = () => {
    cancelAnimationFrame(raf); raf = 0; clearTimeout(idleT);
    if (!heldAt) heldAt = performance.now();
  };

  if (fine) {
    fold.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      px = e.pageX; py = e.pageY; moved = true; drifting = false; lastMove = performance.now();
      kick();
    }, { passive: true });
  }
  addEventListener('scroll', () => { scrolled = true; kick(); }, { passive: true });
  addEventListener('resize', measure, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? hold() : kick()));
  new IntersectionObserver(([en]) => { seen = en.isIntersecting; seen ? kick() : hold(); }).observe(fold);
  if (window.ResizeObserver) { const ro = new ResizeObserver(measure); ro.observe(fold); ro.observe(box); }
  lastMove = performance.now();
  measure();
  document.fonts && document.fonts.ready.then(measure);
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
  const HOLD = 1000;   // fresh clay on every visit and every reload
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

  if (reduce) seal(false);

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
  glass(); chapters(); clay(); lines(); mirror(); photos(); ticker();
}

init();
})();
