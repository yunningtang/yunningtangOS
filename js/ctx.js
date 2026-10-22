// Global context menu. Call ctxMenu(event, items) from any onContextMenu handler.
// items: [{ label, icon?, danger?, onClick }, 'sep', { label: '...', sub: [...] }]
import { html, render, useEffect, useState } from '../vendor/preact.js';
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
  if (!m) return null;
  const w = 200, h = 12 + m.items.length * 32;
  const left = Math.min(m.x, innerWidth - w - 8), top = Math.min(m.y, innerHeight - h - 8);
  return html`<div class="ctx popmenu" style=${`left:${left}px;top:${top}px`} onContextMenu=${(e) => e.preventDefault()}>
    ${m.title && html`<div class="pm-sec">${m.title}</div>`}
    ${m.items.map((it, i) => it === 'sep' ? html`<div class="ctx-sep" key=${i}></div>` : html`<div key=${i} class=${'pm ' + (it.danger ? 'danger' : '') + (it.disabled ? ' disabled' : '')} onClick=${() => { if (it.disabled) return; set(null); it.onClick && it.onClick(); }}>${it.icon && html`<${Icon} name=${it.icon} size=${13} />`}<b>${it.label}</b>${it.hint && html`<small>${it.hint}</small>`}</div>`)}
  </div>`;
}

export function ctxMenu(e, items, title) {
  if (!items || !items.length) return;
  e.preventDefault(); e.stopPropagation();
  if (!host) { host = document.createElement('div'); host.id = 'ctx-host'; document.body.appendChild(host); render(html`<${Menu} />`, host); }
  setCurrent({ x: e.clientX, y: e.clientY, items: items.filter(Boolean), title });
}
export function closeCtx() { setCurrent && setCurrent(null); }
