// 文字颜色 / 荧光标记的颜色面板（像 Google Docs）：主题色（跟着深浅色变）+ 一大格常用色 + 自己调的颜色。
// 打开时记下选区，选完颜色先还原选区再上色——点面板、开系统取色器都不会把选中的字弄丢。
import { html, render, useState, useEffect, useLayoutEffect, useRef } from '../vendor/preact.js';
import { get, update } from './store.js';
import { TEXT_COLORS, TEXT_COLOR_NAMES, HL_COLORS, HL_NAMES } from './blocks.js';
import { Icon } from './ui.js';

export const GRID = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
];
const MAX_CUSTOM = 10;
const customColors = () => { const c = get().settings.customColors; return Array.isArray(c) ? c.filter((x) => /^#[0-9a-f]{6}$/i.test(x)) : []; };
function rememberColor(hex) { update((d) => { const c = customColors().filter((x) => x !== hex); d.settings.customColors = [hex, ...c].slice(0, MAX_CUSTOM); }); }
function forgetColor(hex) { update((d) => { d.settings.customColors = customColors().filter((x) => x !== hex); }); }

let host = null, setCurrent = null;
function Palette() {
  const [m, set] = useState(null); setCurrent = set;
  const ref = useRef(); const [, bump] = useState(0);
  useEffect(() => {
    if (!m) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) set(null); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); set(null); } };
    addEventListener('mousedown', down, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true); };
  }, [m]);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !m) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(m.x, innerWidth - w - 8)) + 'px';
    el.style.top = (m.y + h + 8 > innerHeight ? Math.max(8, m.y - h - 8) : m.y) + 'px'; el.style.visibility = 'visible';
  }, [m]);
  if (!m) return null;
  const text = m.kind === 'text'; const cur = String(m.cur || '').toLowerCase();
  const pick = (v) => {
    set(null);
    const s = getSelection(); if (m.range && s) { s.removeAllRanges(); s.addRange(m.range); }
    m.onPick(v);
  };
  // 按下时别抢走选区
  const sw = (v, color, title, extra = '') => html`<button type="button" key=${v} class=${'pal-sw ' + extra + (cur === String(v).toLowerCase() ? ' on' : '')} title=${title} style=${`--c:${color}`} onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(v)}>${text && extra.includes('pre') ? 'A' : ''}</button>`;
  const presets = text ? TEXT_COLORS.map((c) => sw(c, `var(--tc-${c})`, TEXT_COLOR_NAMES[c] + '（跟着深浅色变）', 'pre txt')) : HL_COLORS.map((c) => sw(c, `var(--hs-${c})`, HL_NAMES[c] + '（跟着深浅色变）', 'pre'));
  const customs = customColors();
  return html`<div class="pal popmenu" ref=${ref} style=${`left:${m.x}px;top:${m.y}px;visibility:hidden`} onContextMenu=${(e) => e.preventDefault()}>
    <button type="button" class="pal-reset" onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(text ? '' : null)}><${Icon} name=${text ? 'refresh' : 'x'} size=${13} />${text ? '默认颜色' : '去掉标记'}</button>
    <div class="pal-h">主题色</div>
    <div class="pal-row">${presets}</div>
    <div class="pal-h">更多颜色</div>
    <div class="pal-grid">${GRID.map((row) => row.map((c) => sw(c, c, c, c === '#ffffff' ? 'white' : '')))}</div>
    <div class="pal-h">自定义<small>右键可以删掉</small></div>
    <div class="pal-row">
      ${customs.map((c) => html`<span key=${c} onContextMenu=${(e) => { e.preventDefault(); forgetColor(c); bump((x) => x + 1); }}>${sw(c, c, c + '（右键删掉）')}</span>`)}
      <label class="pal-sw pal-add" title="调一个颜色" onMouseDown=${(e) => e.preventDefault()}><${Icon} name="plus" size=${13} /><input type="color" value=${/^#/.test(cur) ? cur : (text ? '#3b6fd6' : '#ffe066')} onChange=${(e) => { const v = e.target.value.toLowerCase(); rememberColor(v); pick(v); }} /></label>
    </div>
  </div>`;
}

// kind：'text' | 'hl'；cur：现在的颜色（预设名或 #hex）；onPick(v)：v 为 '' / null 表示默认 / 去掉
export function openPalette(e, { kind, cur, onPick }) {
  e.preventDefault(); e.stopPropagation();
  if (!host) { host = document.createElement('div'); host.id = 'pal-host'; document.body.appendChild(host); render(html`<${Palette} />`, host); }
  const s = getSelection(); const range = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
  setCurrent({ kind, cur, onPick, range, x: r ? r.left : e.clientX, y: r ? r.bottom + 6 : e.clientY });
}
