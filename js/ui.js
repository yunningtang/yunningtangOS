// Shared UI primitives: icons, cards, inputs, modal, tags.
import { html, useEffect, useRef, useState, createPortal } from '../vendor/preact.js';
import { tagColor, tagKey, TAG_COLORS, TAG_COLOR_NAMES, todayStr as _today, pad as _pad, WEEKDAY_SUN as _WD, fmtDate as _fmt } from './util.js';
import { update, renameTag, removeTag, countTag } from './store.js';
import { ctxMenu } from './ctx.js';
import { askPrompt, askConfirm } from './confirm.js';
import { go, toast } from './nav.js';

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="4"/>',
  checksq: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12l3 3 5-6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  indent: '<polyline points="3 8 7 12 3 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>',
  outdent: '<polyline points="7 8 3 12 7 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>',
  listol: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.3 0-2.6-.3-3.7-.8L4 20l1.2-4.3A8.3 8.3 0 0 1 4 11.5 8.5 8.5 0 0 1 21 11.5z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.5 3.8 3.8 0 0 0 6 19z"/>',
  cloudsun: '<path d="M12 4V2M5.6 5.6 4.2 4.2M3 12H1M19 5.6l1.4-1.4"/><path d="M8.5 12a4 4 0 1 1 7.1-2.8"/><path d="M18 20a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 7.6 14 3 3 0 0 0 9 20z"/>',
  fog: '<path d="M4 14h16M6 18h12M8 10h10M3 6h11"/>',
  drizzle: '<path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 6.5 3.8 3.8 0 0 0 6 13z"/><path d="M8 17v2M12 17v2M16 17v2"/>',
  rain: '<path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 6.5 3.8 3.8 0 0 0 6 13z"/><path d="M8 16l-1 4M12 16l-1 4M16 16l-1 4"/>',
  snow: '<path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 6.5 3.8 3.8 0 0 0 6 13z"/><path d="M8 16h.01M12 18h.01M16 16h.01M10 20h.01M14 20h.01"/>',
  storm: '<path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 6.5 3.8 3.8 0 0 0 6 13z"/><path d="M13 13l-2 4h3l-2 5"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8a2 2 0 1 1-2 2"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  play: '<path d="M5 3l14 9-14 9z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  moonstar: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  archive: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
  cursor: '<path d="M4 3l7.5 17 2.6-7.3L21.5 10z"/>',
  type: '<path d="M5 7V4h14v3M9 20h6M12 4v16"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
  eraser: '<path d="M20 20H8.5L3 14.5 12.5 5l7 7-6 6"/><path d="M6 11.5l6.5 6.5"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="8" rx="1.5"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h4v4H8zM14 13h3v3h-3zM12 10l2 3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
};

export function Icon({ name, size = 16, class: cls = '', ...rest }) {
  const d = ICONS[name] || ICONS.dots;
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: d }} ...${rest}></svg>`;
}

export function Card({ title, sub, action, class: cls = '', children, pad = true, ...rest }) {
  return html`<section class=${'card ' + (pad ? 'pad ' : '') + cls} ...${rest}>
    ${(title || action) && html`<header class="card-h">
      <div><h3>${title}</h3>${sub && html`<span class="card-sub">${sub}</span>`}</div>
      ${action && html`<div class="card-act">${action}</div>`}
    </header>`}
    ${children}
  </section>`;
}

export function Btn({ children, kind = '', icon, small, ...rest }) {
  return html`<button class=${'btn ' + kind + (small ? ' sm' : '')} type="button" ...${rest}>${icon && html`<${Icon} name=${icon} size=${small ? 13 : 15} />`}${children}</button>`;
}

// 折叠 / 展开：grid-template-rows 0fr → 1fr，高度跟着内容平滑变化（不用量高度）。第一次展开才渲染里面的东西
export function Collapse({ open, children, class: cls = '' }) {
  const [mounted, setMounted] = useState(!!open);
  useEffect(() => { if (open) setMounted(true); }, [open]);
  return html`<div class=${'clp ' + (open ? 'open ' : '') + cls} aria-hidden=${open ? 'false' : 'true'}><div class="clp-in">${(open || mounted) && children}</div></div>`;
}
export function IconBtn({ icon, title, size = 15, ...rest }) {
  return html`<button class="ibtn" type="button" title=${title} aria-label=${title} ...${rest}><${Icon} name=${icon} size=${size} /></button>`;
}

function flat(c) { return Array.isArray(c) ? c.map(flat).join('') : (c == null || typeof c === 'object') ? '' : String(c); }

// 系统取色器：返回 #rrggbb，取消返回 null
export function pickColor(initial) {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(initial || '') ? initial : '#4f7cf5';
    inp.style.cssText = 'position:fixed;left:-20px;top:-20px;width:1px;height:1px;opacity:0;pointer-events:none';
    let done = false; const fin = (v) => { if (done) return; done = true; resolve(v); setTimeout(() => inp.remove(), 0); };
    inp.addEventListener('change', () => fin(inp.value)); inp.addEventListener('cancel', () => fin(null));
    document.body.appendChild(inp); inp.click(); setTimeout(() => fin(null), 120000);
  });
}
// 「换颜色」子菜单：预设色打勾 + 自定义…（系统取色器）
export function colorSub(current, palette, names, onPick) {
  const cur = (current || '').toLowerCase(); const inPal = palette.some((c) => c.toLowerCase() === cur);
  return [
    ...palette.map((c, i) => ({ label: names[i] || String(i + 1), icon: c.toLowerCase() === cur ? 'check' : '', color: c, onClick: () => onPick(c) })),
    'sep',
    { label: inPal || !cur ? '自定义…' : '自定义（当前）', icon: inPal || !cur ? 'edit' : '', color: inPal || !cur ? undefined : cur, onClick: async () => { const v = await pickColor(inPal ? cur : (cur.startsWith('#') ? cur : '')); if (v) onPick(v); } },
  ];
}
// 右键任何标签：换颜色 / 重命名（所有地方一起改）/ 从所有条目移除 / 去筛选
export function tagMenu(e, name) {
  const key = tagKey(name); if (!key) return;
  const cnt = countTag(name);
  ctxMenu(e, [
    { label: '在笔记里筛选', icon: 'note', onClick: () => go('notes?tag=' + encodeURIComponent(name)) },
    { label: '在待办里筛选', icon: 'checksq', onClick: () => go('todos?tag=' + encodeURIComponent(name)) },
    'sep',
    { label: '换颜色', icon: 'tag', sub: colorSub(tagColor(name)[0], TAG_COLORS.map((c) => c[0]), TAG_COLOR_NAMES, (c) => update((d) => { const i = TAG_COLORS.findIndex((x) => x[0].toLowerCase() === c.toLowerCase()); d.settings.tagColors = { ...(d.settings.tagColors || {}), [key]: i >= 0 ? i : [c, c] }; })) },
    { label: '重命名…', icon: 'edit', hint: cnt ? `${cnt} 处` : '', onClick: async () => { const v = await askPrompt('新名字', name, { title: `重命名标签 #${name}`, placeholder: '所有用到的地方一起改' }); if (v && v.trim() && v.trim() !== name) { const n = renameTag(name, v.trim()); toast(`已改名，${n} 处更新`); } } },
    'sep',
    { label: '从所有条目移除', icon: 'trash', danger: true, hint: cnt ? `${cnt} 处` : '', disabled: !cnt, onClick: async () => { if (await askConfirm(`${cnt} 个条目上的 #${name} 会被去掉，条目本身保留。`, { title: `移除标签 #${name}？`, ok: '移除' })) { removeTag(name); toast('已移除'); } } },
  ], '#' + name);
}
export function Tag({ children, color, plain, class: cls = '', ...rest }) {
  const name = flat(children).replace(/^#/, '').trim();
  const style = color ? `--tc:${color}` : plain ? '' : (([l, d]) => `--tc:${l};--tcd:${d}`)(tagColor(name));
  const ctx = rest.onContextMenu || (plain || color ? undefined : (e) => tagMenu(e, name));
  return html`<span class=${'tag ' + cls + (color ? ' tc' : plain ? '' : ' th')} style=${style} ...${rest} onContextMenu=${ctx}>${children}</span>`;
}

export function Empty({ icon = 'sparkle', text, children }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${20} /><p>${text}</p>${children}</div>`;
}

export function Field({ label, children, hint, class: cls = '' }) {
  return html`<label class=${'field ' + cls}><span class="flabel">${label}</span>${children}${hint && html`<span class="fhint">${hint}</span>`}</label>`;
}

export function Modal({ open, onClose, title, children, wide, foot }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', h);
      document.body.classList.remove('modal-open');
    };
  }, [open]);
  if (!open) return null;
  // 挂到 body 上：玻璃卡片的 backdrop-filter 会把 fixed 定位关在卡片里，弹窗就只能盖住那张卡
  return createPortal(html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true">
      <header class="modal-h"><h3>${title}</h3><${IconBtn} icon="x" title="关闭" onClick=${onClose} /></header>
      <div class="modal-b">${children}</div>
      ${foot && html`<footer class="modal-f">${foot}</footer>`}
    </div>
  </div>`, document.body);
}

export function Progress({ value = 0, color }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return html`<div class="prog" title=${v + '%'}><i style=${`width:${v}%;${color ? 'background:' + color : ''}`}></i></div>`;
}

export function Stars({ value = 0, onChange, size = 13 }) {
  return html`<span class="stars">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class=${n <= value ? 'on' : ''} onClick=${onChange ? () => onChange(n === value ? 0 : n) : undefined} tabindex=${onChange ? 0 : -1}><${Icon} name="star" size=${size} /></button>`)}</span>`;
}

export function TagInput({ value = [], onChange, placeholder = '标签，回车添加' }) {
  const [txt, setTxt] = useState('');
  const commit = () => {
    const t = txt.trim().replace(/^#/, '');
    if (t && !value.includes(t)) onChange([...value, t]);
    setTxt('');
  };
  return html`<div class="taginput">
    ${value.map((t) => html`<${Tag}>${t}<button type="button" onClick=${() => onChange(value.filter((x) => x !== t))}>×</button><//>`)}
    <input value=${txt} placeholder=${placeholder} onInput=${(e) => setTxt(e.target.value)} onKeyDown=${(e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      if (e.key === 'Backspace' && !txt && value.length) onChange(value.slice(0, -1));
    }} onBlur=${commit} />
  </div>`;
}

export function Seg({ options, value, onChange }) {
  return html`<div class="seg" data-liquid="button"><span class="liq"></span>${options.map((o) => html`<button type="button" class=${o.v === value ? 'on' : ''} onClick=${() => onChange(o.v)}>${o.label}</button>`)}</div>`;
}

export function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AutoTextarea({ value, onInput, ...rest }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);
  return html`<textarea ref=${ref} value=${value} onInput=${onInput} ...${rest}></textarea>`;
}

export function confirmDel() { return true; } // deletions are undoable now; irreversible ones use askConfirm

/* ---------- Date & time pickers (styled like the app, no native controls) ---------- */

function usePopover(open, setOpen, anchorRef) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const h = 330, w = 272;
      const top = r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
      const left = Math.min(r.left, innerWidth - w - 8);
      setPos({ top, left });
    };
    place();
    const close = (e) => { if (anchorRef.current && anchorRef.current.contains(e.target)) return; if (e.target.closest && e.target.closest('.pop')) return; setOpen(false); };
    const key = (e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('mousedown', close); window.addEventListener('keydown', key, true); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  return pos;
}

export function DateInput({ value, onChange, placeholder = '选择日期', clearable = true, short = false, class: cls = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const pos = usePopover(open, setOpen, ref);
  const [ym, setYm] = useState(() => (value || _today()).slice(0, 7));
  useEffect(() => { if (open) setYm((value || _today()).slice(0, 7)); }, [open]);
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate(), start = new Date(y, m - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < start; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${_pad(d)}`);
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); setYm(`${d.getFullYear()}-${_pad(d.getMonth() + 1)}`); };
  const label = value ? (short ? `${+value.slice(5, 7)}/${+value.slice(8, 10)} ${_WD[new Date(value.replace(/-/g, '/')).getDay()]}` : `${_fmt(value, true)} ${_WD[new Date(value.replace(/-/g, '/')).getDay()]}`) : placeholder;
  const t = _today();
  return html`<div class=${'pick ' + cls}>
    <button type="button" ref=${ref} class=${'pick-btn ' + (value ? '' : 'is-empty')} onClick=${() => setOpen(!open)}><${Icon} name="calendar" size=${13} /><span>${label}</span></button>
    ${open && pos && createPortal(html`<div class="pop cal" style=${`top:${pos.top}px;left:${pos.left}px`}>
      <div class="pop-h"><button type="button" class="ibtn" onClick=${() => shift(-1)}><${Icon} name="left" size=${14} /></button><b>${y} 年 ${m} 月</b><button type="button" class="ibtn" onClick=${() => shift(1)}><${Icon} name="right" size=${14} /></button></div>
      <div class="cal-grid">${['日', '一', '二', '三', '四', '五', '六'].map((w) => html`<span class="cal-w">${w}</span>`)}
        ${cells.map((d, i) => d ? html`<button type="button" key=${d} class=${'cal-d ' + (d === value ? 'sel' : '') + (d === t ? ' today' : '')} onClick=${() => { onChange(d); setOpen(false); }}>${Number(d.slice(8))}</button>` : html`<span key=${'e' + i}></span>`)}
      </div>
      <div class="pop-f"><button type="button" class="btn ghost sm" onClick=${() => { onChange(t); setOpen(false); }}>今天</button><button type="button" class="btn ghost sm" onClick=${() => { onChange(t.slice(0, 8) + _pad(new Date().getDate() + 1 > days ? 1 : new Date().getDate() + 1)); setOpen(false); }}>明天</button><span class="flex1"></span>${clearable && value && html`<button type="button" class="btn ghost sm" onClick=${() => { onChange(''); setOpen(false); }}>清除</button>`}</div>
    </div>`, document.body)}
  </div>`;
}

// Custom dropdown with the same look as the date / time pickers.
export function Select({ value, options = [], onChange, placeholder = '—', class: cls = '', clearable = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const pos = usePopover(open, setOpen, ref);
  const opts = options.map((o) => (typeof o === 'string' ? { v: o, label: o } : o));
  const cur = opts.find((o) => o.v === value);
  return html`<div class=${'pick ' + cls}>
    <button type="button" ref=${ref} class=${'pick-btn ' + (cur ? '' : 'is-empty')} onClick=${() => setOpen(!open)}><span class="flex1">${cur ? cur.label : placeholder}</span><${Icon} name="down" size=${12} class="caret" /></button>
    ${open && pos && createPortal(html`<div class="pop sel" style=${`top:${pos.top}px;left:${pos.left}px`}>
      <div class="time-list">${clearable && html`<button type="button" class=${'time-i ' + (!value ? 'sel' : '')} onClick=${() => { onChange(''); setOpen(false); }}>${placeholder}</button>`}${opts.map((o) => html`<button type="button" key=${o.v} class=${'time-i ' + (o.v === value ? 'sel' : '')} onClick=${() => { onChange(o.v); setOpen(false); }}>${o.label}</button>`)}</div>
    </div>`, document.body)}
  </div>`;
}

export function TimeInput({ value, onChange, placeholder = '时间', clearable = true, class: cls = '' }) {
  // 不滚动：先点小时（24 格），再点分钟（00 / 15 / 30 / 45）；也可以直接输入 9:30
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const pos = usePopover(open, setOpen, ref);
  const [h, m] = value ? value.split(':').map(Number) : [null, null];
  const [hh, setHh] = useState(h);
  useEffect(() => { if (open) setHh(h); }, [open]);
  const commit = (v) => { const mt = v.trim().match(/^(\d{1,2})[:：.]?(\d{2})?$/); if (!mt) return; const H = Math.min(23, +mt[1]), M = Math.min(59, +(mt[2] || 0)); onChange(`${_pad(H)}:${_pad(M)}`); setOpen(false); };
  const pickH = (H) => { setHh(H); if (m != null) { onChange(`${_pad(H)}:${_pad(m)}`); } else { onChange(`${_pad(H)}:00`); } };
  const pickM = (M) => { const H = hh != null ? hh : (h != null ? h : 9); onChange(`${_pad(H)}:${_pad(M)}`); setOpen(false); };
  return html`<div class=${'pick ' + cls}>
    <button type="button" ref=${ref} class=${'pick-btn ' + (value ? '' : 'is-empty')} onClick=${() => setOpen(!open)}><${Icon} name="clock" size=${13} /><span>${value || placeholder}</span></button>
    ${open && pos && createPortal(html`<div class="pop time" style=${`top:${pos.top}px;left:${pos.left}px`}>
      <input type="text" class="time-in" placeholder="输入如 9:30 回车" autofocus onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value); } }} />
      <div class="time-grid">${Array.from({ length: 24 }, (_, H) => html`<button type="button" key=${H} class=${'time-h ' + ((hh != null ? hh : h) === H ? 'sel' : '')} onClick=${() => pickH(H)}>${_pad(H)}</button>`)}</div>
      <div class="time-mins">${[0, 15, 30, 45].map((M) => html`<button type="button" key=${M} class=${'time-m ' + (m === M && (hh == null || hh === h) ? 'sel' : '')} onClick=${() => pickM(M)}>:${_pad(M)}</button>`)}</div>
      ${clearable && value && html`<div class="pop-f"><button type="button" class="btn ghost sm" onClick=${() => { onChange(''); setOpen(false); }}>清除</button></div>`}
    </div>`, document.body)}
  </div>`;
}
