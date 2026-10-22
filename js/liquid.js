// Liquid selection: one soft pill per container that glides to the hovered item
// and settles back on the active one. Containers opt in with data-liquid="<item selector>".
const DEFAULT_ITEMS = 'a,button';
const hovered = new WeakSet();

// The pill is rendered by the component itself (<span class="liq">) so the virtual DOM stays in sync.
function pill(c) { return c.querySelector(':scope > .liq'); }
function itemsOf(c) { return c.dataset.liquid || DEFAULT_ITEMS; }
function activeOf(c) { return c.querySelector(':is(.active,.on,[aria-current]):is(' + itemsOf(c) + ')'); }

function moveTo(c, el, instant = false) {
  const p = pill(c);
  if (!p) return;
  if (!el) { p.style.opacity = '0'; return; }
  const cr = c.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (instant) { p.style.transition = 'none'; requestAnimationFrame(() => { p.style.transition = ''; }); }
  p.style.opacity = '1';
  p.style.transform = `translate(${r.left - cr.left + c.scrollLeft}px, ${r.top - cr.top + c.scrollTop}px)`;
  p.style.width = r.width + 'px';
  p.style.height = r.height + 'px';
}

function settle(c, instant) { if (!hovered.has(c)) moveTo(c, activeOf(c), instant); }
function settleAll(instant) { document.querySelectorAll('[data-liquid]').forEach((c) => settle(c, instant)); }

let raf = 0;
const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => settleAll(false)); };

export function initLiquid() {
  document.addEventListener('pointerover', (e) => {
    const c = e.target.closest && e.target.closest('[data-liquid]');
    if (!c) return;
    const it = e.target.closest(itemsOf(c));
    if (!it || !c.contains(it) || it.classList.contains('liq')) return;
    hovered.add(c); moveTo(c, it);
  });
  document.addEventListener('pointerout', (e) => {
    const c = e.target.closest && e.target.closest('[data-liquid]');
    if (!c) return;
    if (e.relatedTarget && c.contains(e.relatedTarget)) return;
    hovered.delete(c); settle(c);
  });
  const mo = new MutationObserver((muts) => {
    // Typing inside contenteditable mutates the DOM constantly; the pills do not care about that.
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (t && t.closest && t.closest('[contenteditable], .b-text, input, textarea')) continue;
      schedule(); return;
    }
  });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', () => setTimeout(() => settleAll(false), 30));
  document.addEventListener('scroll', (e) => {
    const t = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!t) return; // page scroll does not move pills relative to their containers
    const c = t.closest('[data-liquid]'); if (c) cancelAnimationFrame(raf), (raf = requestAnimationFrame(() => settle(c, true)));
  }, true);
  setTimeout(() => settleAll(true), 50);
}
