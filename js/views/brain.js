// 「大脑」页：同一批待办，按处理方式摆在一张抽象的脑图上。左边看全局，右边是选中那一区的待办
import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, get } from '../store.js';
import { Icon, Card, Seg } from '../ui.js';
import { todayStr, addDays } from '../util.js';
import { TodoItem, TodoModal, QuickAdd } from './todos.js';
import { dropProps } from '../dnd.js';
import { REGIONS, THALAMUS, regionOf, brainOf, setBrain, dopamine, dopamineWord, MOODS, saveReview, pushOpenTo } from '../brain.js';

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
  const dop = useMemo(() => dopamine(s, today), [s.todos, words, today]);
  // 流转：哪一区多了事 → 那一块弹一下；哪一区刚做完一件 → 冒一个 +分
  const prev = useRef(null); const [fx, setFx] = useState({});
  useEffect(() => {
    const cur = {}; REGIONS.forEach((r) => { cur[r.id] = [by[r.id].length, dop.by[r.id] || 0]; });
    const p = prev.current; prev.current = cur; if (!p) return;
    const next = {}; REGIONS.forEach((r) => { if (cur[r.id][1] > p[r.id][1]) next[r.id] = 'done'; else if (cur[r.id][0] > p[r.id][0]) next[r.id] = 'in'; });
    if (!Object.keys(next).length) return;
    const k = Date.now(); setFx(Object.fromEntries(Object.entries(next).map(([id, v]) => [id, v + ':' + k])));
    const tm = setTimeout(() => setFx({}), 1100); return () => clearTimeout(tm);
  }, [by, dop]);
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
      <div class="br-head-r">
        <div class="br-dop" title=${'今天做完的事攒出来的：每件 10，杏仁核里的 25，换着脑区做再加分'}>
          <span class="br-dop-l">多巴胺</span><span class="br-dop-bar"><i style=${`width:${dop.value}%`}></i></span><b>${dop.value}</b><small>${dopamineWord(dop.value)}</small>
        </div>
        <${Seg} options=${[{ v: 'today', label: '今天' }, { v: 'all', label: '全部' }]} value=${scope} onChange=${setScope} />
      </div>
    </div>
    <div class="br-tip"><${Icon} name="sparkle" size=${14} />${tip}</div>
    <div class="br-grid">
      <${Card} class="br-map-card" pad=${false}>
        <div class="br-map">
          <svg class="br-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M8 52 C6 26 26 6 52 6 C78 6 96 22 96 46 C96 62 90 72 80 78 C78 90 66 96 54 92 C44 98 30 96 24 88 C12 82 8 68 8 52 Z" /></svg>
          ${REGIONS.map((r) => { const n = by[r.id].length; const p = POS[r.id]; const k = n ? 14 + Math.round((n / max) * 30) : 0; return html`<button type="button" key=${r.id}
            class=${'br-r ' + (sel === r.id ? 'on ' : '') + (n ? '' : 'empty ') + (r.id === 'alarm' && n ? 'alarm ' : '') + (n >= 5 ? 'busy ' : '') + (fx[r.id] ? 'fx-' + fx[r.id].split(':')[0] : '')}
            style=${`left:${p.l}%;top:${p.t}%;width:${p.w}%;height:${p.h}%;--c:${r.color};--bg:${r.bg};--k:${k}%`}
            onClick=${() => pick(r.id)} ...${dropProps('todo', (d) => { const t = get().todos.find((x) => x.id === d.id); if (t) setBrain(t, r.id); })}>
            <span class="br-n">${n || ''}</span><b>${r.name}</b><small>${r.role}</small>
            ${dop.by[r.id] ? html`<span class="br-done" title="今天做完的">✓ ${dop.by[r.id]}</span>` : ''}
            ${fx[r.id] && fx[r.id].startsWith('done') && html`<span class="br-plus" key=${fx[r.id]}>+${r.id === 'alarm' ? 25 : 10}</span>`}
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
    <${Review} s=${s} today=${today} dop=${dop} by=${by} words=${words} />
    <${TodoModal} open=${!!editing} todo=${editing} onClose=${() => setEditing(null)} />
  </div>`;
}

// 晚上复盘：18 点以后自动出现；白天可以点「现在复盘」提前打开
function Review({ s, today, dop, by, words }) {
  const saved = (s.settings.brainReview || {})[today];
  const [force, setForce] = useState(false); const [edit, setEdit] = useState(false);
  const [note, setNote] = useState(saved ? saved.note || '' : '');
  const [moved, setMoved] = useState(0);
  const evening = new Date().getHours() >= 18;
  const left = s.todos.filter((t) => !t.done && t.due && t.due <= today).length; // 跟 pushOpenTo 挪的是同一批
  if (saved && saved.done && !edit) {
    const m = MOODS.find((x) => x.v === saved.mood);
    return html`<div class="br-rv-done"><${Icon} name="check" size=${14} />今天复盘过了${m ? ' · ' + m.label : ''}${saved.note ? html` · <span>${saved.note}</span>` : ''}<button type="button" class="btn ghost sm" onClick=${() => setEdit(true)}>改一下</button></div>`;
  }
  if (!evening && !force && !edit) return html`<button type="button" class="br-rv-open" onClick=${() => setForce(true)}><${Icon} name="moon" size=${14} />现在复盘</button>`;
  // 一句话总结：今天主要用了哪块，杏仁核有没有动
  const top = REGIONS.map((r) => [r, dop.by[r.id] || 0]).sort((a, b) => b[1] - a[1])[0];
  const line = !dop.done ? '今天还没勾掉什么事，没关系，明天挑一件最小的开头。'
    : [`今天做完 ${dop.done} 件，`, top[1] ? `主要用的是${top[0].name}。` : '', dop.by.alarm ? '杏仁核里的事也动了，这个最难，值得记一笔。' : by.alarm.length ? '杏仁核里还剩 ' + by.alarm.length + ' 件，明天先拆它？' : ''].join('');
  const mood = saved && saved.mood;
  return html`<${Card} class="br-review">
    <div class="card-h"><h3><${Icon} name="moon" size=${15} />晚上复盘</h3>${!evening && html`<button type="button" class="ibtn" title="收起" onClick=${() => { setForce(false); setEdit(false); }}><${Icon} name="x" size=${14} /></button>`}</div>
    <p class="br-rv-line">${line}</p>
    <div class="br-rv-bars">${REGIONS.map((r) => { const d = dop.by[r.id] || 0; const l = by[r.id].length; return html`<div class="br-rv-b" key=${r.id} style=${`--c:${r.color};--bg:${r.bg}`} title=${`${r.name}：做完 ${d}，还剩 ${l}`}>
      <span class="br-rv-n">${r.name}</span><span class="br-rv-track"><i class="d" style=${`flex:${d}`}></i><i class="l" style=${`flex:${l}`}></i>${!d && !l ? html`<i class="z"></i>` : ''}</span><small>${d}/${d + l}</small></div>`; })}</div>
    <div class="br-rv-row"><span class="br-rv-k">今天感觉</span><div class="br-moods">${MOODS.map((m) => html`<button type="button" key=${m.v} class=${mood === m.v ? 'on' : ''} onClick=${() => saveReview(today, { mood: m.v })}>${m.label}</button>`)}</div></div>
    <div class="br-rv-row"><span class="br-rv-k">一句话</span><input class="flex1" type="text" value=${note} placeholder="今天最想记住的一件事…" onInput=${(e) => setNote(e.target.value)} onBlur=${() => saveReview(today, { note: note.trim() })} /></div>
    <div class="br-rv-acts">
      ${(left > 0 || moved) && html`<button type="button" class="btn ghost sm" disabled=${!!moved} onClick=${() => setMoved(pushOpenTo(s, today, addDays(today, 1)) || -1)}>${moved > 0 ? `已挪 ${moved} 件到明天` : moved < 0 ? '没有要挪的' : `没做完的 ${left} 件挪到明天`}</button>`}
      <button type="button" class="btn sm" onClick=${() => { saveReview(today, { note: note.trim(), done: true }); setEdit(false); }}>完成复盘</button>
    </div>
  <//>`;
}

// 总览上的「今天的大脑」小卡
export function BrainCard({ s }) {
  const today = todayStr(); const words = s.settings.brainWords || {};
  const dop = dopamine(s, today);
  const by = {}; REGIONS.forEach((r) => { by[r.id] = 0; });
  s.todos.forEach((t) => { if (!t.done && (!t.due || t.due <= today)) { const id = brainOf(t, words); if (id in by) by[id]++; } });
  return html`<${Card} class="brain-card">
    <div class="card-h"><h3>今天的大脑</h3><div class="card-act"><a class="ibtn" href="#/brain" title="打开大脑"><${Icon} name="brain" size=${15} /></a></div></div>
    <div class="bc-grid">${REGIONS.map((r) => html`<a key=${r.id} href="#/brain" class=${'bc-r ' + (by[r.id] ? '' : 'empty')} style=${`--c:${r.color};--bg:${r.bg}`} onClick=${() => { try { localStorage.setItem('ytos.brain.sel', r.id); } catch {} }}>
      <b>${r.name}</b><span>${by[r.id] || ''}${dop.by[r.id] ? html`<small>✓${dop.by[r.id]}</small>` : ''}</span></a>`)}</div>
    <div class="br-dop sm"><span class="br-dop-l">多巴胺</span><span class="br-dop-bar"><i style=${`width:${dop.value}%`}></i></span><b>${dop.value}</b></div>
  <//>`;
}
