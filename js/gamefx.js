// 游戏风主题（搁浅 / 方舟）的完成特效：勾掉一件事时，那一行闪一下，屏幕上方滑过一条「任务完成」横幅。
// 别的主题什么都不做；系统设置了「减少动态效果」也不做。
const GAME = new Set(['strand', 'ark']);
let lastDown = null, bannerTimer = 0;
const on = () => GAME.has(document.documentElement.dataset.skin) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROW = '.todo,.fp-i,.bcard,.bwn,.nt-row,.nxt,.dw,.bwl,.st-row,.ag-i';

function banner(title) {
  let el = document.getElementById('gfx-banner');
  if (!el) { el = document.createElement('div'); el.id = 'gfx-banner'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
  const skin = document.documentElement.dataset.skin;
  el.className = 'gfx-' + skin;
  el.innerHTML = '';
  const k = document.createElement('b'); k.textContent = skin === 'ark' ? '任务完成' : '已完成';
  const t = document.createElement('span'); t.textContent = String(title || '').slice(0, 28);
  el.append(k, t);
  void el.offsetWidth; el.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

export function initGameFx() {
  addEventListener('pointerdown', (e) => { lastDown = e.target; }, true);
  addEventListener('todo:done', (e) => {
    if (!on()) return;
    const row = lastDown && lastDown.closest && lastDown.closest(ROW);
    // 完成的那行通常会马上挪走或重画，所以闪光画在一个单独的浮层上
    if (row) {
      const r = row.getBoundingClientRect(); const f = document.createElement('div'); f.className = 'gfx-flash';
      Object.assign(f.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      document.body.appendChild(f); setTimeout(() => f.remove(), 900);
    }
    banner(e.detail && e.detail.title);
  });
}
