// Draggable vertical splitters that write a CSS variable on :root and remember it.
import { html } from '../vendor/preact.js';

const KEY = 'ytos.sizes';
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function save(sizes) { try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch {} }
export function applySizes() {
  const s = load();
  for (const [k, v] of Object.entries(s)) document.documentElement.style.setProperty('--' + k, v + 'px');
}
export function resetSizes() { save({}); for (const k of ['sidebar', 'nbw', 'lcw', 'dside']) document.documentElement.style.removeProperty('--' + k); }

// varName: CSS var without --; dir: 1 when dragging right grows, -1 when dragging right shrinks.
export function Splitter({ varName, min = 160, max = 520, dir = 1, class: cls = '' }) {
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const root = document.documentElement;
    const start = e.clientX;
    const cur = parseFloat(getComputedStyle(root).getPropertyValue('--' + varName)) || 0;
    const base = cur || (e.currentTarget.previousElementSibling || e.currentTarget.parentElement).getBoundingClientRect().width;
    document.body.classList.add('resizing');
    const move = (ev) => { const w = Math.max(min, Math.min(max, base + (ev.clientX - start) * dir)); root.style.setProperty('--' + varName, w + 'px'); };
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); const w = parseFloat(root.style.getPropertyValue('--' + varName)); if (w) { const s = load(); s[varName] = Math.round(w); save(s); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const reset = () => { const s = load(); delete s[varName]; save(s); document.documentElement.style.removeProperty('--' + varName); };
  return html`<div class=${'splitter ' + cls} onPointerDown=${down} onDblClick=${reset} title="拖动调整宽度 · 双击恢复"></div>`;
}
