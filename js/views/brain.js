// 「大脑」页：同一批待办，按处理方式摆在一张抽象的脑图上。左边看全局，右边是选中那一区的待办
import { html, useState, useMemo } from '../../vendor/preact.js';
import { useStore, get } from '../store.js';
import { Icon, Card, Seg } from '../ui.js';
import { todayStr } from '../util.js';
import { TodoItem, TodoModal, QuickAdd } from './todos.js';
import { dropProps } from '../dnd.js';
import { REGIONS, THALAMUS, regionOf, brainOf, setBrain } from '../brain.js';

// 脑图上每一区的位置（百分比），整体是一个侧面的大脑：前额叶在左前，小脑在右下
const POS = {
  plan: { l: 5, t: 22, w: 33, h: 42 },
  move: { l: 40, t: 8, w: 30, h: 26 },
  talk: { l: 40, t: 37, w: 26, h: 28 },
  memory: { l: 68, t: 30, w: 27, h: 30 },
  alarm: { l: 26, t: 67, w: 22, h: 22 },
  habit: { l: 62, t: 64, w: 30, h: 26 },
};

export default function Brain() {
  const s = useStore();
  const today = todayStr();
  const [scope, setScope] = useState('today');
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('ytos.brain.sel') || 'plan'; } catch { return 'plan'; } });
  const [editing, setEditing] = useState(null);
  // 手机上脑图和列表是上下排的，点了脑区顺手滚到列表
  const pick = (id) => { setSel(id); try { localStorage.setItem('ytos.brain.sel', id); } catch {} if (innerWidth <= 900) setTimeout(() => document.querySelector('.br-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const words = s.settings.brainWords || {};
  const open = useMemo(() => s.todos.filter((t) => !t.done && (scope === 'all' || !t.due || t.due <= today)), [s.todos, scope, today]);
  const by = useMemo(() => { const m = { '': [] }; REGIONS.forEach((r) => { m[r.id] = []; }); open.forEach((t) => { const id = brainOf(t, words); (m[id] || m['']).push(t); }); return m; }, [open, words]);
  const inbox = useMemo(() => s.todos.filter((t) => !t.done && !brainOf(t, words)), [s.todos, words]);

  // 顶上一句话：哪块忙、哪块闲
  const tip = (() => {
    const counts = REGIONS.map((r) => [r, by[r.id].length]);
    const alarm = by.alarm.length; const total = counts.reduce((n, [, c]) => n + c, 0);
    if (alarm) return `杏仁核里有 ${alarm} 件拖着难受的事，挑一件拆小一点？`;
    if (!total) return inbox.length ? `都在丘脑里还没分，先分一分？` : '今天脑子很清爽。';
    const [busy, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const idle = counts.filter(([r, c]) => c > 0 && r.id !== busy.id && ['move', 'talk', 'habit'].includes(r.id)).sort((a, b) => a[1] - b[1])[0];
    if (n >= 4 && idle) return `${busy.name}有点满（${n} 件），先做点${idle[0].name}的事换换脑子？`;
    return `最忙的是${busy.name}（${n} 件）。`;
  })();
  const max = Math.max(1, ...REGIONS.map((r) => by[r.id].length));
  const cur = regionOf(sel); const list = by[sel] || [];

  return html`<div class="brain">
    <div class="br-head">
      <div><h1>大脑</h1><p>同一批待办，按处理方式摆在脑图上 · 一种好玩的看法，不是神经科学</p></div>
      <${Seg} options=${[{ v: 'today', label: '今天' }, { v: 'all', label: '全部' }]} value=${scope} onChange=${setScope} />
    </div>
    <div class="br-tip"><${Icon} name="sparkle" size=${14} />${tip}</div>
    <div class="br-grid">
      <${Card} class="br-map-card" pad=${false}>
        <div class="br-map">
          <svg class="br-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M8 52 C6 26 26 6 52 6 C78 6 96 22 96 46 C96 62 90 72 80 78 C78 90 66 96 54 92 C44 98 30 96 24 88 C12 82 8 68 8 52 Z" /></svg>
          ${REGIONS.map((r) => { const n = by[r.id].length; const p = POS[r.id]; const k = n ? 14 + Math.round((n / max) * 30) : 0; return html`<button type="button" key=${r.id}
            class=${'br-r ' + (sel === r.id ? 'on ' : '') + (n ? '' : 'empty ') + (r.id === 'alarm' && n ? 'alarm ' : '') + (n >= 5 ? 'busy' : '')}
            style=${`left:${p.l}%;top:${p.t}%;width:${p.w}%;height:${p.h}%;--c:${r.color};--bg:${r.bg};--k:${k}%`}
            onClick=${() => pick(r.id)} ...${dropProps('todo', (d) => { const t = get().todos.find((x) => x.id === d.id); if (t) setBrain(t, r.id); })}>
            <span class="br-n">${n || ''}</span><b>${r.name}</b><small>${r.role}</small>
          </button>`; })}
        </div>
        <div class="br-legend">把待办拖到脑区上就能换区 · 右键待办也能「换脑区」</div>
      <//>
      <${Card} class="br-list">
        <div class="card-h"><h3><i class="br-dot" style=${`background:${cur.color}`}></i>${cur.name} <span class="muted small">${cur.role} · ${list.length}</span></h3></div>
        ${list.length ? html`<div class="tlist">${list.map((t) => html`<${TodoItem} key=${t.id} t=${t} compact onEdit=${setEditing} />`)}</div>` : html`<p class="br-empty">这一区${scope === 'today' ? '今天' : ''}没有事。</p>`}
        <${QuickAdd} defaults=${{ due: today, brain: sel }} placeholder=${`给${cur.name}加一件事…`} />
      <//>
    </div>
    ${inbox.length > 0 && html`<${Card} class="br-inbox">
      <div class="card-h"><h3><i class="br-dot" style=${`background:${THALAMUS.color}`}></i>丘脑 · 还没分 <span class="muted small">${inbox.length}</span></h3></div>
      <div class="br-in-list">${inbox.map((t) => html`<div class="br-in" key=${t.id}>
        <span class="br-in-t">${t.title}</span>
        <span class="br-in-acts">${REGIONS.map((r) => html`<button type="button" key=${r.id} title=${`${r.name} · ${r.role}`} style=${`--c:${r.color};--bg:${r.bg}`} onClick=${() => setBrain(t, r.id)}>${r.name}</button>`)}</span>
      </div>`)}</div>
    <//>`}
    <${TodoModal} open=${!!editing} todo=${editing} onClose=${() => setEditing(null)} />
  </div>`;
}
