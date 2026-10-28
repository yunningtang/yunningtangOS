// Navigation + toast helpers kept separate so views can import them without pulling in app.js.
export function go(path) {
  location.hash = '#/' + path;
}

let toastTimer;
export function toast(msg, action) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  // 复制成功：前面一个对勾，2.5 秒自己消失
  const copiedMsg = !action && /^已复制/.test(msg); el.classList.toggle('ok', copiedMsg);
  if (copiedMsg) el.insertAdjacentHTML('afterbegin', '<svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>');
  if (action && action.label) {
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { action.onClick && action.onClick(); el.remove(); };
    el.appendChild(b);
  }
  clearTimeout(toastTimer);
  // sticky：重要警告不自动消失，给一个「知道了」
  if (action && action.sticky) { const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = '知道了'; b.onclick = () => el.remove(); el.appendChild(b); return; }
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : copiedMsg ? 2500 : 2200);
}
