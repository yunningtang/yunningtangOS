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
    // 一帧只排一次版；要是一帧排版超过 24ms（长笔记里整列文字都要重新折行），后面就只拖一条引导线，松手再真正改宽度
    const bar = e.currentTarget; let want = base, applied = base, raf = 0, slow = false, guide = null;
    const apply = () => {
      raf = 0; if (want === applied) return;
      if (slow) { if (!guide) { guide = document.createElement('div'); guide.className = 'splitter-guide'; document.body.appendChild(guide); const r = bar.getBoundingClientRect(); guide.style.top = r.top + 'px'; guide.style.height = r.height + 'px'; guide.dataset.x0 = r.left; } guide.style.transform = `translateX(${parseFloat(guide.dataset.x0) + (want - applied) * dir}px)`; return; }
      const t0 = performance.now(); root.style.setProperty('--' + varName, want + 'px'); applied = want;
      void document.body.offsetWidth; if (performance.now() - t0 > 24) slow = true;
    };
    const move = (ev) => { want = Math.max(min, Math.min(max, base + (ev.clientX - start) * dir)); if (!raf) raf = requestAnimationFrame(apply); };
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cancelAnimationFrame(raf); raf = 0; if (guide) { guide.remove(); guide = null; } root.style.setProperty('--' + varName, want + 'px'); document.body.classList.remove('resizing'); const w = parseFloat(root.style.getPropertyValue('--' + varName)); if (w) { const s = load(); s[varName] = Math.round(w); save(s); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const reset = () => { const s = load(); delete s[varName]; save(s); document.documentElement.style.removeProperty('--' + varName); };
  return html`<div class=${'splitter ' + cls} onPointerDown=${down} onDblClick=${reset} title="拖动调整宽度 · 双击恢复"></div>`;
}
