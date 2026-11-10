// 桌面版的窗口按钮（最小化 / 最大化 / 关闭）：网页自己画，跟着主题和界面风格走，不用系统那三个。
// 只有新版桌面版（preload 里有 sealonote.win）才出现；网页版、macOS（用系统的红绿灯）不画。
import { html, useState, useEffect } from '../vendor/preact.js';

export const hasWinCtl = () => typeof window !== 'undefined' && !!(window.sealonote && window.sealonote.win) && window.sealonote.platform !== 'darwin';

export function WinControls({ min = true, max = true, cls = '' }) {
  const [isMax, setMax] = useState(false);
  useEffect(() => {
    if (!hasWinCtl()) return;
    window.sealonote.win.isMax().then(setMax).catch(() => {});
    return window.sealonote.win.onMax(setMax);
  }, []);
  if (!hasWinCtl()) return null;
  const w = window.sealonote.win;
  return html`<div class=${'winctl ' + cls}>
    ${min && html`<button type="button" class="wc-b" title="最小化" aria-label="最小化" onClick=${() => w.minimize()}><svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 6.5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>`}
    ${max && html`<button type="button" class="wc-b" title=${isMax ? '还原' : '最大化'} aria-label=${isMax ? '还原' : '最大化'} onClick=${() => w.toggleMax().then(setMax)}>${isMax
      ? html`<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="2" y="3.6" width="6.4" height="6.4" rx="1.4"/><path d="M4 2h4.6A1.4 1.4 0 0 1 10 3.4V8"/></svg>`
      : html`<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="2" y="2" width="8" height="8" rx="1.8"/></svg>`}</button>`}
    <button type="button" class="wc-b wc-x" title="关闭" aria-label="关闭" onClick=${() => w.close()}><svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
  </div>`;
}

// 启动时打上标记：is-desktop（桌面版）/ has-winctl（自己画按钮）/ is-mac（左上角留出红绿灯的位置）
export function initDesktop() {
  const sn = window.sealonote; if (!sn) return;
  const root = document.documentElement;
  root.classList.add('is-desktop');
  if (sn.platform === 'darwin') root.classList.add('is-mac');
  if (hasWinCtl()) root.classList.add('has-winctl');
  else if (sn.setTitleBar && !sn.win) root.classList.add('has-wco'); // 0.2 版：系统画的按钮压在右上角
  // 窗口刚打开时的底色跟着深浅色走，不闪白
  if (sn.win && sn.win.setDark) {
    let last = null;
    const tell = () => { const d = root.dataset.theme === 'dark'; if (d !== last) { last = d; sn.win.setDark(d); } };
    new MutationObserver(tell).observe(root, { attributes: true, attributeFilter: ['data-theme'] }); setTimeout(tell, 300);
  }
}
