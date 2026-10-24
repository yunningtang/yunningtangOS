// Global context menu. Call ctxMenu(event, items) from any onContextMenu handler.
// items: [{ label, icon?, danger?, onClick }, 'sep', { label: '...', sub: [...] }]
import { html, render, useEffect, useState, useRef, useLayoutEffect } from '../vendor/preact.js';
import { Icon } from './ui.js';

let host, current = null, setCurrent = null;

function Menu() {
  const [m, set] = useState(null);
  setCurrent = set;
  useEffect(() => {
    if (!m) return;
    const close = () => set(null);
    const key = (e) => e.key === 'Escape' && close();
    const down = (e) => { if (!e.target.closest('.ctx')) close(); };
    document.addEventListener('mousedown', down); window.addEventListener('keydown', key, true); window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [m]);
  const ref = useRef();
  // Position after render so the real height (not an estimate) keeps the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !m) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(m.x, innerWidth - w - 8));
    const top = m.y + h + 8 > innerHeight ? Math.max(8, m.y - h) : m.y;
    el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.visibility = 'visible';
  }, [m]);
  if (!m) return null;
  return html`<div class="ctx popmenu" ref=${ref} style=${`left:${m.x}px;top:${m.y}px;visibility:hidden`} onContextMenu=${(e) => e.preventDefault()}>
    ${m.title && html`<div class="pm-sec">${m.title}</div>`}
    ${m.items.map((it, i) => it === 'sep' ? html`<div class="ctx-sep" key=${i}></div>` : html`<div key=${i} class=${'pm ' + (it.danger ? 'danger' : '') + (it.disabled ? ' disabled' : '')} onClick=${() => { if (it.disabled) return; if (it.sub) { set({ ...m, title: it.label, items: [{ label: '返回', icon: 'left', onClick: () => set(m) }, 'sep', ...it.sub.filter(Boolean)] }); return; } set(null); it.onClick && it.onClick(); }}>${it.color ? html`<span class="ic"><i class="ctx-dot" style=${`background:${it.color}`}></i></span>` : it.icon ? html`<${Icon} name=${it.icon} size=${14} />` : html`<span class="ic"></span>`}<b>${it.label}</b>${it.sub ? html`<small>›</small>` : it.color && it.icon === 'check' ? html`<small>✓</small>` : it.hint && !it.color ? html`<small>${it.hint}</small>` : html`<span></span>`}</div>`)}
  </div>`;
}

export function ctxMenu(e, items, title) {
  if (!items || !items.length) return;
  e.preventDefault(); e.stopPropagation();
  if (!host) { host = document.createElement('div'); host.id = 'ctx-host'; document.body.appendChild(host); render(html`<${Menu} />`, host); }
  setCurrent({ x: e.clientX, y: e.clientY, items: items.filter(Boolean), title });
}
export function closeCtx() { setCurrent && setCurrent(null); }
