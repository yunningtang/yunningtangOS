// Global context menu. Call ctxMenu(event, items) from any onContextMenu handler.
// items: [{ label, icon?, danger?, onClick }, 'sep', { label: '...', sub: [...] }, { head: '小标题' }]
import { html, render, useEffect, useState, useRef, useLayoutEffect } from '../vendor/preact.js';
import { Icon } from './ui.js';

let host, current = null, setCurrent = null;

function Menu() {
  const [m, set] = useState(null);
  setCurrent = set;
  useEffect(() => {
    if (!m) return;
    const close = () => set(null);
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } }; // 只关菜单，不让下面的对话框 / 弹窗也跟着关
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
    ${m.grid && html`<div class="ctx-grid">${m.items.filter((it) => it !== 'sep' && it.color).map((it, i) => html`<button key=${i} type="button" class=${'ctx-sw ' + (m.grid === 'text' ? 'txt ' : '') + (it.icon === 'check' ? 'on' : '')} title=${it.label} style=${`--c:${it.color}`} onClick=${() => { set(null); it.onClick && it.onClick(); }}>${m.grid === 'text' ? 'A' : ''}</button>`)}</div>`}
    ${(m.grid ? m.items.filter((it) => it === 'sep' || !it.color) : m.items).map((it, i) => it === 'sep' ? html`<div class="ctx-sep" key=${i}></div>` : it.head ? html`<div class="pm-sec sub" key=${i}>${it.head}</div>` : it.swatches ? html`<div class="ctx-grid ctx-row" key=${i}>${it.swatches.map((w, j) => html`<button key=${j} type="button" class=${'ctx-sw ' + (w.none ? 'none ' : '') + (w.on ? 'on' : '')} title=${w.label} style=${`--c:${w.color || 'transparent'}`} onClick=${() => { set(null); w.onClick && w.onClick(); }}></button>`)}</div>` : html`<div key=${i} class=${'pm ' + (it.danger ? 'danger' : '') + (it.disabled ? ' disabled' : '')} onClick=${() => { if (it.disabled) return; if (it.sub) { set({ ...m, title: it.label, items: [{ label: '返回', icon: 'left', onClick: () => set(m) }, 'sep', ...it.sub.filter(Boolean)] }); return; } set(null); it.onClick && it.onClick(); }}>${it.color ? html`<span class="ic"><i class="ctx-dot" style=${`background:${it.color}`}></i></span>` : it.icon ? html`<${Icon} name=${it.icon} size=${14} />` : html`<span class="ic"></span>`}<b>${it.label}</b>${it.sub ? html`<small>›</small>` : it.color && it.icon === 'check' ? html`<small>✓</small>` : it.hint && !it.color ? html`<small>${it.hint}</small>` : html`<span></span>`}</div>`)}
  </div>`;
}

// opts.grid：有颜色的项排成一格一格的色块（'text' 时每格是一个彩色的 A），其余照常列在下面
// 也可以在列表中间放一项 { swatches: [{ color, label, on, none, onClick }] }：就地一排色块
export function ctxMenu(e, items, title, opts) {
  if (!items || !items.length) return;
  e.preventDefault(); e.stopPropagation();
  if (!host) { host = document.createElement('div'); host.id = 'ctx-host'; document.body.appendChild(host); render(html`<${Menu} />`, host); }
  setCurrent({ x: e.clientX, y: e.clientY, items: items.filter(Boolean), title, grid: opts && opts.grid });
}
export function closeCtx() { setCurrent && setCurrent(null); }
