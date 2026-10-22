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
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { action.onClick(); el.remove(); };
    el.appendChild(b);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 2200);
}
