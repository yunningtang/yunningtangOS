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
  if (action && action.label) {
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { action.onClick && action.onClick(); el.remove(); };
    el.appendChild(b);
  }
  clearTimeout(toastTimer);
  // sticky：重要警告不自动消失，给一个「知道了」
  if (action && action.sticky) { const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = '知道了'; b.onclick = () => el.remove(); el.appendChild(b); return; }
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 2200);
}
