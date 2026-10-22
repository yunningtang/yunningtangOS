import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, toggleTodo, update } from '../store.js';
import { Icon, Card, Btn, Tag, Empty, Progress, useClock } from '../ui.js';
import { todayStr, greeting, WEEKDAY_SUN, monthKey, sortBy, timeToMin, kindColor, weekKey, weekStart, weekDays, addDays, parseDate, pad, BLOCK_KINDS } from '../util.js';
import { TodoModal, QuickAdd } from './todos.js';
import { goalPct } from './planner.js';
import { ancestors, noteTitle, isBlank, newNote } from './notes.js';
import { go } from '../nav.js';

const FOCUS_KINDS = ['focus', 'study', 'work', 'create'];
const GOAL_MIN = 4 * 60;

function MonthCal({ s, today }) {
  const [ym, setYm] = useState(today.slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDay = first.getDay(); // Sunday first like the reference
  const days = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  const cells = [];
  for (let i = startDay - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true, key: `p${i}` });
  for (let d = 1; d <= days; d++) cells.push({ d, key: `${ym}-${pad(d)}`, date: `${ym}-${pad(d)}` });
  while (cells.length % 7) cells.push({ d: cells.length - days - startDay + 1, out: true, key: `n${cells.length}` });
  const busy = useMemo(() => { const set = new Set(); s.todos.forEach((t) => t.due && !t.done && set.add(t.due)); s.blocks.forEach((b) => set.add(b.date)); return set; }, [s.todos, s.blocks]);
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  return html`<${Card} class="mcal">
    <div class="card-h"><h3>${y} 年 ${m} 月</h3><div class="card-act"><button class="ibtn" onClick=${() => shift(-1)}><${Icon} name="left" size=${14} /></button><button class="ibtn" onClick=${() => shift(1)}><${Icon} name="right" size=${14} /></button></div></div>
    <div class="mc-grid">${['日', '一', '二', '三', '四', '五', '六'].map((w) => html`<span class="mc-w">${w}</span>`)}
      ${cells.map((c) => html`<button class=${'mc-d ' + (c.out ? 'out' : '') + (c.date === today ? ' today' : '') + (c.date && busy.has(c.date) ? ' busy' : '')} key=${c.key} onClick=${() => c.date && go('plan/day?d=' + c.date)}>${c.d}</button>`)}
    </div>
  <//>`;
}

function Ring({ value, label, sub }) {
  const r = 34, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return html`<div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r=${r} class="ring-bg" /><circle cx="42" cy="42" r=${r} class="ring-fg" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - v)} /></svg><div class="ring-t"><b>${Math.round(v * 100)}%</b></div></div>`;
}

function Spark({ points, color = 'var(--blue)' }) {
  const w = 120, h = 36, max = Math.max(1, ...points), n = points.length;
  const pts = points.map((p, i) => [i * (w / (n - 1)), h - 4 - (p / max) * (h - 8)]);
  const d = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = d + ` L${w} ${h} L0 ${h} Z`;
  return html`<svg class="spark" viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none"><path d=${area} fill=${color} opacity=".12" /><path d=${d} fill="none" stroke=${color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" /></svg>`;
}

export default function Dashboard() {
  const s = useStore();
  const now = useClock();
  const today = todayStr();
  const [editing, setEditing] = useState(null);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const todosAll = useMemo(() => sortBy(s.todos.filter((t) => t.due === today || (!t.done && t.due && t.due < today) || (t.done && t.completedAt === today)), 'priority', 'time'), [s.todos]);
  const todos = todosAll.filter((t) => !t.done).slice(0, 10);
  const doneTodos = todosAll.filter((t) => t.done);
  const [showDone, setShowDone] = useState(false);
  const blocks = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today), 'start'), [s.blocks]);
  const goals = s.goals[monthKey()] || [];
  const wk = s.weeks[weekKey()];
  const week = weekDays(weekStart());
  const recentNotes = sortBy(s.notes.filter((n) => !isBlank(n)), '-updated').slice(0, 5);
  const recentLinks = s.links.slice(0, 3);
  const quote = s.vision.statements.length ? s.vision.statements[now.getDate() % s.vision.statements.length] : null;

  const focusToday = blocks.filter((b) => FOCUS_KINDS.includes(b.kind)).reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0);
  const focusByDay = week.map((d) => s.blocks.filter((b) => b.date === d && FOCUS_KINDS.includes(b.kind)).reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0));
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const doneSeries = last7.map((d) => s.todos.filter((t) => t.done && t.completedAt === d).length);
  const focusSeries = last7.map((d) => s.blocks.filter((b) => b.date === d && FOCUS_KINDS.includes(b.kind)).reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0) / 60);
  const noteSeries = last7.map((d) => s.notes.filter((n) => (n.updated || '').slice(0, 10) === d).length);
  const doneWeek = s.todos.filter((t) => t.done && t.completedAt && week.includes(t.completedAt)).length;
  const fmtH = (min) => `${Math.floor(min / 60)}h ${pad(min % 60)}m`;

  // compact timeline geometry
  const from = 7, to = 23, hourH = 30;
  const y = (min) => ((min - from * 60) / 60) * hourH;

  const DEFAULT = { main: ['profile', 'timeline', 'todos', 'pages', 'goals', 'focusweek'], side: ['calendar', 'focus', 'notes', 'links', 'week'], hidden: [] };
  const layout = useMemo(() => { const l = s.settings.dash || DEFAULT; const known = new Set([...DEFAULT.main, ...DEFAULT.side]); const used = new Set([...l.main, ...l.side, ...(l.hidden || [])]); const extra = [...known].filter((id) => !used.has(id)); return { main: l.main.filter((id) => known.has(id)).concat(extra.filter((id) => DEFAULT.main.includes(id))), side: l.side.filter((id) => known.has(id)).concat(extra.filter((id) => DEFAULT.side.includes(id))), hidden: (l.hidden || []).filter((id) => known.has(id)) }; }, [s.settings.dash]);
  const setLayout = (next) => update((d) => { d.settings.dash = next; });
  const [drag, setDrag] = useState(null); // { id }
  const [over, setOver] = useState(null); // { id, after } | { col }
  const [custom, setCustom] = useState(false);
  const [wmenu, setWmenu] = useState(null);
  const colOf = (id) => (layout.main.includes(id) ? 'main' : 'side');
  const moveTo = (id, col, index) => {
    const next = { main: layout.main.filter((x) => x !== id), side: layout.side.filter((x) => x !== id), hidden: layout.hidden.filter((x) => x !== id) };
    const list = next[col]; const at = index == null ? list.length : Math.max(0, Math.min(list.length, index));
    list.splice(at, 0, id); setLayout(next);
  };
  const hide = (id) => setLayout({ main: layout.main.filter((x) => x !== id), side: layout.side.filter((x) => x !== id), hidden: [...layout.hidden, id] });
  const shift = (id, dir) => { const col = colOf(id); const list = layout[col]; const i = list.indexOf(id); const j = i + dir; if (j < 0 || j >= list.length) return; const n = [...list]; n.splice(i, 1); n.splice(j, 0, id); setLayout({ ...layout, [col]: n }); };
  const onDrop = (e, targetId, col) => {
    e.preventDefault(); if (!drag) return;
    if (targetId && targetId !== drag.id) { const list = layout[col].filter((x) => x !== drag.id); let idx = list.indexOf(targetId); if (over && over.after) idx++; moveTo(drag.id, col, idx); }
    else if (!targetId) moveTo(drag.id, col, null);
    setDrag(null); setOver(null);
  };
  useEffect(() => { if (!wmenu) return; const h = (e) => { if (!e.target.closest('.w-menu, .w-dots')) setWmenu(null); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [wmenu]);

  const W = {
    profile: { title: '个人', span: 2, el: html`<${Card} class="profile">
        <div class="avatar big">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || 'R')[0]}</div>
        <div class="flex1"><div class="p-name">${greeting(now)}，${s.profile.name}</div><div class="p-sub">${s.profile.motto} · ${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_SUN[now.getDay()]} · ${weekKey()}</div></div>
        <button class=${'btn ghost sm ' + (custom ? 'on' : '')} onClick=${() => setCustom(!custom)}><${Icon} name="grid" size=${14} /> ${custom ? '完成' : '自定义'}</button>
      <//>` },
    timeline: { title: '今天', span: 1, el: html`<${Card} class="tl-card">
        <div class="card-h"><h3>今天 <span class="muted small">${blocks.length ? blocks.length + ' 个时间块' : ''}</span></h3><div class="card-act"><a class="ibtn" href="#/plan/day" title="编辑"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="mini-tl" style=${`height:${(to - from) * hourH}px`}>
          ${Array.from({ length: to - from }, (_, i) => html`<div class="mt-h" style=${`top:${i * hourH}px`}><span>${pad(from + i)}:00</span></div>`)}
          ${blocks.map((b) => { const a = Math.max(timeToMin(b.start), from * 60), e = Math.min(timeToMin(b.end), to * 60); if (e <= a) return null; const cur = a <= nowMin && e > nowMin; return html`<div class=${'mt-b ' + (cur ? 'cur' : '') + (e <= nowMin ? ' past' : '')} style=${`top:${y(a)}px;height:${Math.max(y(e) - y(a) - 2, 18)}px;--bc:${kindColor(b.kind)}`} onClick=${() => go('plan/day')}><b>${b.title}</b><small>${b.start} – ${b.end}</small></div>`; })}
          ${nowMin >= from * 60 && nowMin <= to * 60 && html`<div class="mt-now" style=${`top:${y(nowMin)}px`}></div>`}
        </div>
      <//>` },
    todos: { title: '待办', span: 1, el: html`<${Card} class="todo-card">
        <div class="card-h"><h3>待办 ${todos.length > 0 && html`<span class="muted small">${todos.length}</span>`}</h3><div class="card-act"><a class="ibtn" href="#/todos" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        ${todos.length === 0 ? html`<${Empty} icon="checksq" text=${doneTodos.length ? '今天的都做完了。' : '今天没有待办。'} />` : html`<div class="tlist">${todos.map((t) => html`<label class="tl-i" key=${t.id}><input type="checkbox" checked=${false} onChange=${() => toggleTodo(t.id)} /><span class="flex1" onClick=${(e) => { e.preventDefault(); setEditing(t); }}>${t.title}</span>${t.time && html`<small>${t.time}</small>`}</label>`)}</div>`}
        <${QuickAdd} defaults=${{ due: today }} placeholder="添加待办…" />
        ${doneTodos.length > 0 && html`<button class="done-tg" onClick=${() => setShowDone(!showDone)}><${Icon} name=${showDone ? 'down' : 'right'} size=${12} /> 已完成 ${doneTodos.length}</button>
          ${showDone && html`<div class="tlist">${doneTodos.map((t) => html`<label class="tl-i done" key=${t.id}><input type="checkbox" checked=${true} onChange=${() => toggleTodo(t.id)} /><span class="flex1" onClick=${(e) => { e.preventDefault(); setEditing(t); }}>${t.title}</span>${t.time && html`<small>${t.time}</small>`}</label>`)}</div>`}`}
      <//>` },
    pages: { title: '最近页面', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>最近页面</h3><div class="card-act"><a class="ibtn" href="#/notes" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        <div class="thumbs">
          ${recentNotes.map((n) => html`<a class="thumb" href=${'#/notes/' + n.id} key=${n.id}><div class="th-prev" style=${n.cover ? (/^https?:/.test(n.cover) ? `background-image:url(${n.cover})` : `background:${n.cover}`) : ''}>${!n.cover && html`<div class="th-lines"><i></i><i></i><i></i><i></i></div>`}</div><b>${noteTitle(n)}</b><small>${ancestors(s.notes, n).map(noteTitle).join(' / ') || n.updated.slice(0, 10)}</small></a>`)}
          <button class="thumb new" onClick=${() => { const n = newNote(); go('notes/' + n.id); }}><div class="th-prev"><${Icon} name="plus" size=${18} /></div><b>新建</b></button>
        </div>
      <//>` },
    goals: { title: '本月目标', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>本月目标</h3><div class="card-act"><a class="ibtn" href="#/plan/month" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        ${goals.length === 0 ? html`<${Empty} icon="target" text="这个月还没定目标。" />` : html`<div class="glist">${goals.map((g) => { const p = goalPct(g); return html`<a class="g-row" href="#/plan/month" key=${g.id}><${Icon} name="target" size=${14} class="muted" /><span class="g-t">${g.title}</span><span class="g-bar"><${Progress} value=${p} /></span><span class="g-p">${p}%</span><${Tag} color=${p >= 100 ? 'var(--green)' : p >= 50 ? 'var(--blue)' : 'var(--amber)'}>${p >= 100 ? '完成' : p >= 50 ? '进行中' : '刚开始'}<//></a>`; })}</div>`}
      <//>` },
    focusweek: { title: '本周焦点', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>本周焦点</h3><div class="card-act"><a class="ibtn" href="#/plan/week" title="周计划"><${Icon} name="right" size=${15} /></a></div></div>
        ${wk && wk.focus ? html`<pre class="focus-pre">${wk.focus}</pre>` : html`<p class="small muted">还没写本周焦点。去周计划里写下这周最重要的三件事。</p>`}
        ${quote && html`<div class="quote-line"><${Icon} name="sparkle" size=${13} /> ${quote.text}</div>`}
      <//>` },
    calendar: { title: '月历', span: 1, el: html`<${MonthCal} s=${s} today=${today} />` },
    focus: { title: '专注', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>专注</h3><div class="card-act"><a class="ibtn" href="#/plan/day" title="时间线"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="focus-row"><div><div class="small muted">今日目标</div><div class="focus-big">${fmtH(focusToday)} <span class="muted">/ ${GOAL_MIN / 60}h</span></div></div><${Ring} value=${focusToday / GOAL_MIN} /></div>
        <div class="bars">${focusByDay.map((m, i) => html`<div class="bar" key=${i}><i style=${`height:${Math.max(4, Math.min(100, (m / GOAL_MIN) * 100))}%`} class=${week[i] === today ? 'on' : ''}></i><span>${['一', '二', '三', '四', '五', '六', '日'][i]}</span></div>`)}</div>
      <//>` },
    notes: { title: '笔记', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>笔记</h3><div class="card-act"><a class="ibtn" href="#/notes" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentNotes.slice(0, 4).map((n) => html`<a class="dl-i" href=${'#/notes/' + n.id} key=${n.id}><i style=${`background:${['var(--violet)', 'var(--amber)', 'var(--blue)', 'var(--green)'][n.id.charCodeAt(0) % 4]}`}></i><div><b>${noteTitle(n)}</b><small>${n.updated.slice(5, 16).replace('T', ' · ')}</small></div></a>`)}</div>
        <a class="small link" href="#/notes">查看全部</a>
      <//>` },
    links: { title: '收藏', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>收藏</h3><div class="card-act"><a class="ibtn" href="#/links" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentLinks.map((l) => html`<a class="dl-i" href=${l.url} target="_blank" rel="noopener" key=${l.id}><span class="fav"><img src=${`https://www.google.com/s2/favicons?domain=${l.host}&sz=32`} alt="" /></span><div><b>${l.title}</b><small>${l.host}</small></div></a>`)}</div>
        <a class="small link" href="#/links">查看全部</a>
      <//>` },
    week: { title: '本周', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>本周</h3></div>
        <div class="stat-row"><div><small>完成待办</small><b>${doneWeek}</b></div><${Spark} points=${doneSeries} /></div>
        <div class="stat-row"><div><small>专注时间</small><b>${fmtH(focusByDay.reduce((a, b) => a + b, 0))}</b></div><${Spark} points=${focusSeries} color="var(--violet)" /></div>
        <div class="stat-row"><div><small>更新页面</small><b>${s.notes.filter((n) => week.includes((n.updated || '').slice(0, 10))).length}</b></div><${Spark} points=${noteSeries} color="var(--teal)" /></div>
      <//>` },
  };

  const Widget = (id, col) => {
    const w = W[id]; if (!w) return null;
    const ov = over && over.id === id;
    return html`<div class=${'widget span-' + w.span + (drag && drag.id === id ? ' dragging' : '') + (ov ? (over.after ? ' drop-after' : ' drop-before') : '') + (custom ? ' custom' : '')} key=${id} data-id=${id}
      draggable=${custom} onDragStart=${(e) => { setDrag({ id }); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd=${() => { setDrag(null); setOver(null); }}
      onDragOver=${(e) => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id, after: e.clientY > r.top + r.height / 2 }); }}
      onDrop=${(e) => onDrop(e, id, col)}>
      ${w.el}
      ${custom && html`<div class="w-tools"><span class="w-grip" title="拖动排序"><${Icon} name="dots" size=${14} /></span><button class="w-dots" onClick=${() => setWmenu(wmenu === id ? null : id)}><${Icon} name="down" size=${13} /></button>
        ${wmenu === id && html`<div class="popmenu w-menu">
          <div class="pm" onClick=${() => { shift(id, -1); setWmenu(null); }}><b>上移</b></div>
          <div class="pm" onClick=${() => { shift(id, 1); setWmenu(null); }}><b>下移</b></div>
          <div class="pm" onClick=${() => { moveTo(id, col === 'main' ? 'side' : 'main', null); setWmenu(null); }}><b>${col === 'main' ? '移到右栏' : '移到左栏'}</b></div>
          <div class="pm danger" onClick=${() => { hide(id); setWmenu(null); }}><b>隐藏</b></div>
        </div>`}
      </div>`}
    </div>`;
  };

  return html`<div class=${'dash2 ' + (custom ? 'customizing' : '')}>
    ${custom && html`<div class="custom-bar">
      <span><${Icon} name="grid" size=${14} /> 拖动卡片排序，点卡片右上角的箭头可以隐藏或换栏。</span>
      ${layout.hidden.length > 0 && html`<span class="muted">已隐藏：</span>${layout.hidden.map((id) => html`<button class="btn sm" key=${id} onClick=${() => moveTo(id, ['calendar', 'focus', 'notes', 'links', 'week'].includes(id) ? 'side' : 'main', null)}>+ ${W[id] ? W[id].title : id}</button>`)}`}
      <span class="flex1"></span>
      <button class="btn ghost sm" onClick=${() => setLayout(DEFAULT)}>恢复默认</button>
      <button class="btn primary sm" onClick=${() => setCustom(false)}>完成</button>
    </div>`}
    <div class="d-main" onDragOver=${(e) => drag && e.preventDefault()} onDrop=${(e) => { if (e.target.closest('.widget')) return; onDrop(e, null, 'main'); }}>${layout.main.map((id) => Widget(id, 'main'))}</div>
    <div class="d-side" onDragOver=${(e) => drag && e.preventDefault()} onDrop=${(e) => { if (e.target.closest('.widget')) return; onDrop(e, null, 'side'); }}>${layout.side.map((id) => Widget(id, 'side'))}</div>
    <${TodoModal} open=${!!editing} todo=${editing && editing.id ? editing : null} defaults=${{ due: today }} onClose=${() => setEditing(null)} />
  </div>`;
}
