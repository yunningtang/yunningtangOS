import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, toggleTodo, update, removeUndo } from '../store.js';
import { usePomo, PomoCard } from './focus.js';
import * as pomo from '../pomo.js';
import { Icon, Card, Btn, Tag, Empty, Progress, useClock } from '../ui.js';
import { uid, todayStr, greeting, WEEKDAY_SUN, monthKey, sortBy, timeToMin, kindColor, weekKey, weekStart, weekDays, addDays, parseDate, pad, BLOCK_KINDS, fmtShort } from '../util.js';
import { TodoModal, QuickAdd, todoMenu, TodoItem } from './todos.js';
import { ctxMenu } from '../ctx.js';
import { dragProps, dropProps } from '../dnd.js';
import { Splitter } from '../resize.js';
import { upsert, remove } from '../store.js';
import { goalPct } from './planner.js';
import { ancestors, noteTitle, isBlank, newNote, nbOf } from './notes.js';
import { go } from '../nav.js';
import { AvatarPicker } from './settings.js';
import { NowWidget } from './now.js';

const FOCUS_KINDS = ['focus', 'study', 'work', 'create'];

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
  const pst = usePomo();
  const today = todayStr();
  const [editing, setEditing] = useState(null);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // 只放今天的：今天到期的 + 逾期没做完的；没排日期的不进来，只在底部给个数
  const todosAll = useMemo(() => sortBy(s.todos.filter((t) => (!t.done && t.due === today) || (t.done && t.completedAt === today)), 'priority', 'due', 'time'), [s.todos]);
  const undated = useMemo(() => s.todos.filter((t) => !t.done && !t.due).length, [s.todos]);
  // 逾期的单独折叠一段，不混进今天的列表
  const lateTodos = useMemo(() => sortBy(s.todos.filter((t) => !t.done && t.due && t.due < today), 'due', 'priority'), [s.todos]);
  const [showLate, setShowLate] = useState(false);
  const todos = todosAll.filter((t) => !t.done).slice(0, 10);
  const doneTodos = todosAll.filter((t) => t.done);
  const [showDone, setShowDone] = useState(false);
  const blocks = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today && !b.pomo), 'start'), [s.blocks]);
  const goals = s.goals[monthKey()] || [];
  const wk = s.weeks[weekKey()];
  const week = weekDays(weekStart());
  const recentNotes = sortBy(s.notes.filter((n) => !isBlank(n)), '-updated').slice(0, 5);
  const recentLinks = s.links.slice(0, 3);
  const quote = s.vision.statements.length ? s.vision.statements[now.getDate() % s.vision.statements.length] : null;

  const sess = s.sessions || [];
  const focusToday = sess.filter((b) => b.date === today).reduce((n, b) => n + (b.mins || 0), 0);
  const focusByDay = week.map((d) => sess.filter((b) => b.date === d).reduce((n, b) => n + (b.mins || 0), 0));
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const doneSeries = last7.map((d) => s.todos.filter((t) => t.done && t.completedAt === d).length);
  const focusSeries = last7.map((d) => sess.filter((b) => b.date === d).reduce((n, b) => n + (b.mins || 0), 0) / 60);
  const noteSeries = last7.map((d) => s.notes.filter((n) => (n.updated || '').slice(0, 10) === d).length);
  const doneWeek = s.todos.filter((t) => t.done && t.completedAt && week.includes(t.completedAt)).length;
  const fmtH = (min) => `${Math.floor(min / 60)}h ${pad(min % 60)}m`;

  // compact timeline geometry: range follows the day's blocks (never narrower than 07–23), overlaps go side by side
  const hourH = 40, minH = 24;
  const from = blocks.length ? Math.max(0, Math.min(7, ...blocks.map((b) => Math.floor(timeToMin(b.start) / 60)))) : 7;
  const to = blocks.length ? Math.min(24, Math.max(23, ...blocks.map((b) => Math.ceil(Math.max(timeToMin(b.end), timeToMin(b.start) + 1) / 60)))) : 23;
  const y = (min) => ((min - from * 60) / 60) * hourH;
  const laid = useMemo(() => {
    // lanes only for blocks that really overlap in time; blocks that would merely paint over each other
    // (short ones, given the minimum height) are pushed down instead, so nothing sits on top of anything
    const items = blocks.map((b) => { const a = timeToMin(b.start); return { b, a, e: Math.max(timeToMin(b.end), a + 1) }; });
    let cluster = [], clusterEnd = -1; const out = [];
    const flush = () => { if (!cluster.length) return; const lanes = []; cluster.forEach((it) => { let l = lanes.findIndex((end) => end <= it.a); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = it.e; it.lane = l; }); cluster.forEach((it) => { it.lanes = lanes.length; out.push(it); }); cluster = []; clusterEnd = -1; };
    items.forEach((it) => { if (cluster.length && it.a >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e); });
    flush();
    let bottomAll = -1; const bottoms = [];
    out.forEach((it) => {
      const floor = it.lanes === 1 ? Math.max(bottomAll, ...bottoms) : Math.max(bottomAll, bottoms[it.lane] || -1);
      it.top = Math.max(y(it.a), floor + 2); it.h = Math.max(y(it.e) - y(it.a) - 2, minH);
      const bottom = it.top + it.h;
      if (it.lanes === 1) { bottomAll = bottom; bottoms.length = 0; } else bottoms[it.lane] = bottom;
    });
    return out;
  }, [blocks]);

  // 一行三张卡等高。高度不会变的（此刻 / 月历 / 专注）放一行，内容会长的（今天 / 待办 / 笔记）放一行，
  // 这样一张卡变长不会把不相干的卡拉得空一截。
  const SPAN = { profile: 3, now: 1, calendar: 1, focus: 1, timeline: 1, todos: 1, notes: 1, pages: 2, links: 1, goals: 2, week: 1, focusweek: 3 };
  const ORDER = ['profile', 'now', 'calendar', 'focus', 'timeline', 'todos', 'notes', 'pages', 'links', 'goals', 'week', 'focusweek'];
  const OLD_ORDER = ['profile', 'now', 'timeline', 'todos', 'focus', 'calendar', 'notes', 'pages', 'links', 'goals', 'week', 'focusweek'];
  const DEFAULT = { v: 3, order: ORDER, hidden: [], sizes: {} };
  const layout = useMemo(() => {
    const saved = s.settings.dash;
    // 旧默认布局（没自己改过顺序的）直接换成新的分组；自己排过的保留
    const isOldDefault = saved && saved.v === 2 && Array.isArray(saved.order) && saved.order.join() === OLD_ORDER.join() && !(saved.hidden || []).length;
    const l = saved && saved.v >= 2 && !isOldDefault ? saved : DEFAULT; const known = new Set(ORDER);
    const base = l.order || [...(l.main || []), ...(l.side || [])]; // older two-column layouts fold into one list
    const hidden = (l.hidden || []).filter((id) => known.has(id));
    const used = new Set([...base, ...hidden]);
    let order = base.filter((id) => known.has(id)).concat(ORDER.filter((id) => !used.has(id) && id !== 'now'));
    if (!used.has('now')) order.splice(Math.min(1, order.length), 0, 'now'); // new widget lands right under the profile card
    return { order, hidden, sizes: l.sizes || {} };
  }, [s.settings.dash]);
  const setLayout = (next) => update((d) => { d.settings.dash = { ...next, v: 3 }; });
  const [drag, setDrag] = useState(null); // { id }
  const [over, setOver] = useState(null); // { id, after } | { col }
  const [custom, setCustom] = useState(false);
  const [wmenu, setWmenu] = useState(null);
  const moveTo = (id, index) => {
    const list = layout.order.filter((x) => x !== id); const at = index == null ? list.length : Math.max(0, Math.min(list.length, index));
    list.splice(at, 0, id); setLayout({ ...layout, order: list, hidden: layout.hidden.filter((x) => x !== id) });
  };
  const hide = (id) => setLayout({ ...layout, order: layout.order.filter((x) => x !== id), hidden: [...layout.hidden, id] });
  const setSize = (id, patch) => setLayout({ ...layout, sizes: { ...layout.sizes, [id]: { ...(layout.sizes[id] || {}), ...patch } } });
  const sizeOf = (id) => layout.sizes[id] || {};
  const spanOf = (id) => Math.max(1, Math.min(3, sizeOf(id).span || SPAN[id] || 1));
  // Pointer-driven resize: right edge picks the width in thirds, bottom edge sets a minimum height.
  const startResize = (e, id, mode) => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget.closest('.widget'); const r = el.getBoundingClientRect(); const x0 = e.clientX, y0 = e.clientY, h0 = r.height;
    const colW = el.parentElement.getBoundingClientRect().width / 3;
    document.body.classList.add('resizing');
    const move = (ev) => {
      if (mode === 'h') { el.style.setProperty('--wh', Math.max(120, h0 + ev.clientY - y0) + 'px'); }
      else { const want = Math.max(1, Math.min(3, Math.round((r.width + (ev.clientX - x0)) / colW))); el.dataset.spanPreview = want; }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing');
      if (mode === 'h') { const h = parseFloat(el.style.getPropertyValue('--wh')); el.style.removeProperty('--wh'); if (Math.abs(ev.clientY - y0) > 4) setSize(id, { h: Math.round(h) }); }
      else { const want = el.dataset.spanPreview; delete el.dataset.spanPreview; if (want) setSize(id, { span: +want }); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const shift = (id, dir) => { const list = layout.order; const i = list.indexOf(id); const j = i + dir; if (j < 0 || j >= list.length) return; const n = [...list]; n.splice(i, 1); n.splice(j, 0, id); setLayout({ ...layout, order: n }); };
  const onDrop = (e, targetId) => {
    e.preventDefault(); if (!drag) return;
    if (targetId && targetId !== drag.id) { const list = layout.order.filter((x) => x !== drag.id); let idx = list.indexOf(targetId); if (over && over.after) idx++; moveTo(drag.id, idx); }
    else if (!targetId) moveTo(drag.id, null);
    setDrag(null); setOver(null);
  };
  useEffect(() => { if (!wmenu) return; const h = (e) => { if (!e.target.closest('.w-menu, .w-dots')) setWmenu(null); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [wmenu]);

  const W = {
    profile: { title: '个人', span: 2, el: html`<${Card} class="profile">
        <${AvatarPicker} size=${60} class="big" />
        <div class="flex1"><div class="p-name">${greeting(now)}，${s.profile.name}</div><div class="p-sub">${s.profile.motto} · ${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_SUN[now.getDay()]} · ${weekKey()}</div></div>
        <button class=${'btn ghost sm ' + (custom ? 'on' : '')} onClick=${() => setCustom(!custom)}><${Icon} name="grid" size=${14} /> ${custom ? '完成' : '自定义'}</button>
      <//>` },
    now: { title: '此刻', span: 1, el: html`<${NowWidget} />` },
    timeline: { title: '今天', span: 1, el: html`<${Card} class="tl-card">
        <div class="card-h"><h3>今天 <span class="muted small">${blocks.length ? blocks.length + ' 个时间块' : ''}</span></h3><div class="card-act"><a class="ibtn" href="#/plan/day" title="编辑"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="mini-tl-wrap" ref=${(el) => { if (el && !el.dataset.scrolled) { el.dataset.scrolled = 1; const target = nowMin >= from * 60 && nowMin <= to * 60 ? y(nowMin) : (blocks.length ? y(timeToMin(blocks[0].start)) : 0); el.scrollTop = Math.max(0, target - el.clientHeight * 0.4); } }}>
        <div class="mini-tl" style=${`height:${Math.max((to - from) * hourH, ...laid.map((it) => it.top + it.h + 6))}px`}>
          ${Array.from({ length: to - from }, (_, i) => html`<div class="mt-h" style=${`top:${i * hourH}px`}><span>${pad(from + i)}:00</span></div>`)}
          ${laid.map(({ b, a, e, lane, lanes, top, h }) => { const real = timeToMin(b.end); const cur = a <= nowMin && real > nowMin; const w = 100 / lanes; return html`<div class=${'mt-b ' + (cur ? 'cur' : '') + (real <= nowMin ? ' past' : '') + (h < 36 ? ' one' : '')} key=${b.id} style=${`top:${top}px;height:${h}px;left:calc(6px + ${lane * w}%);width:calc(${w}% - ${lanes > 1 ? 8 : 6}px);--bc:${kindColor(b.kind)}`} ...${dragProps('block', { kind: 'block', id: b.id })} onClick=${() => go('plan/day')} onContextMenu=${(ev) => ctxMenu(ev, [{ label: '在时间线中编辑', icon: 'edit', onClick: () => go('plan/day') }, { label: '复制到明天', icon: 'calendar', onClick: () => upsert('blocks', { ...b, id: uid(), date: addDays(today, 1) }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('blocks', b.id, b.title || b.place || b.url) }], b.title)} title=${`${b.title} ${b.start} – ${b.end}`}><b>${b.title || b.place || '（无标题）'}</b><small>${b.start} – ${b.end}</small></div>`; })}
          ${nowMin >= from * 60 && nowMin <= to * 60 && html`<div class="mt-now" style=${`top:${y(nowMin)}px`}><span>${pad(now.getHours())}:${pad(now.getMinutes())}</span></div>`}
        </div>
        </div>
      <//>` },
    todos: { title: '待办', span: 1, el: html`<${Card} class="todo-card" ...${dropProps('todo', (d) => upsert('todos', { id: d.id, due: today }))}>
        <div class="card-h"><h3>待办 ${todos.length > 0 && html`<span class="muted small">${todos.length}</span>`}</h3><div class="card-act"><a class="ibtn" href="#/todos" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        ${todos.length === 0 ? html`<${Empty} icon="checksq" text=${doneTodos.length ? '今天的都做完了。' : '今天没有待办。'} />` : html`<div class="tlist">${todos.map((t) => html`<${TodoItem} key=${t.id} t=${t} compact onEdit=${setEditing} />`)}</div>`}
        <${QuickAdd} defaults=${{ due: today }} placeholder="添加今天的待办…" />
        ${lateTodos.length > 0 && html`<button class="done-tg late" onClick=${() => setShowLate(!showLate)}><${Icon} name=${showLate ? 'down' : 'right'} size=${12} /> 逾期 ${lateTodos.length}</button>
          ${showLate && html`<div class="tlist">${lateTodos.map((t) => html`<${TodoItem} key=${t.id} t=${t} compact onEdit=${setEditing} />`)}</div>`}`}
        ${undated > 0 && html`<a class="more undated" href="#/todos" title="没排日期的待办不在这里，去待办页看">未排期 ${undated} 项<${Icon} name="right" size=${12} /></a>`}
        ${doneTodos.length > 0 && html`<button class="done-tg" onClick=${() => setShowDone(!showDone)}><${Icon} name=${showDone ? 'down' : 'right'} size=${12} /> 已完成 ${doneTodos.length}</button>
          ${showDone && html`<div class="tlist">${doneTodos.map((t) => html`<${TodoItem} key=${t.id} t=${t} compact onEdit=${setEditing} />`)}</div>`}`}
      <//>` },
    pages: { title: '最近页面', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>最近页面</h3><div class="card-act"><button class="ibtn" title="新页面" onClick=${() => { const n = newNote(); go('notes/' + n.id); }}><${Icon} name="plus" size=${15} /></button><a class="ibtn" href="#/notes" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        <div class="thumbs">
          ${recentNotes.map((n) => html`<a class="thumb" href=${'#/notes/' + n.id} key=${n.id}><div class="th-prev" style=${n.cover ? (/^https?:/.test(n.cover) ? `background-image:url(${n.cover})` : `background:${n.cover}`) : ''}>${!n.cover && html`<div class="th-lines"><i></i><i></i><i></i><i></i></div>`}</div><b>${noteTitle(n)}</b><small>${ancestors(s.notes, n).map(noteTitle).join(' / ') || fmtShort(n.updated.slice(0, 10))}</small></a>`)}
          ${recentNotes.length === 0 && html`<button class="thumb new" onClick=${() => { const n = newNote(); go('notes/' + n.id); }}><div class="th-prev"><${Icon} name="plus" size=${18} /></div><b>新建</b></button>`}
        </div>
      <//>` },
    goals: { title: '本月目标', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>本月目标</h3><div class="card-act"><a class="ibtn" href="#/plan/month" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        ${goals.length === 0 ? html`<${Empty} icon="target" text="这个月还没定目标。" />` : html`<div class="glist">${goals.map((g) => { const p = goalPct(g); return html`<a class="g-row" href="#/plan/month" key=${g.id}><${Icon} name="target" size=${14} class="muted" /><span class="g-t">${g.title}</span><span class="g-bar"><${Progress} value=${p} /></span><span class="g-p">${p}%</span><${Tag} color=${p >= 100 ? 'var(--green)' : p >= 50 ? 'var(--blue)' : 'var(--amber)'}>${p >= 100 ? '完成' : p >= 50 ? '进行中' : '刚开始'}<//></a>`; })}</div>`}
      <//>` },
    focusweek: { title: '本周焦点', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>本周焦点</h3><div class="card-act"><a class="ibtn" href="#/plan/week" title="周计划"><${Icon} name="right" size=${15} /></a></div></div>
        ${wk && wk.focus && wk.focus.trim() ? html`<ol class="focus-ol">${wk.focus.split('\n').map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim()).filter(Boolean).map((l, i) => html`<li key=${i}><span class="n">${i + 1}</span>${l}</li>`)}</ol>` : html`<p class="small muted">还没写本周焦点。去周计划里写下这周最重要的三件事。</p>`}
        ${quote && html`<div class="quote-line"><${Icon} name="sparkle" size=${13} /> ${quote.text}</div>`}
      <//>` },
    calendar: { title: '月历', span: 1, el: html`<${MonthCal} s=${s} today=${today} />` },
    focus: { title: '专注', span: 1, el: html`<${PomoCard} />` },
    notes: { title: '笔记', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>笔记</h3><div class="card-act"><a class="ibtn" href="#/notes" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentNotes.slice(0, 4).map((n) => html`<a class="dl-i" href=${'#/notes/' + n.id} key=${n.id}><i style=${`background:${(nbOf(s, n.nb) || {}).color || 'var(--text-4)'}`} title=${(nbOf(s, n.nb) || {}).name || ''}></i><div><b>${noteTitle(n)}</b><small>${fmtShort(n.updated.slice(0, 10))} ${n.updated.slice(11, 16)}</small></div></a>`)}</div>
        <a class="more" href="#/notes">查看全部<${Icon} name="right" size=${12} /></a>
      <//>` },
    links: { title: '收藏', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>收藏</h3><div class="card-act"><a class="ibtn" href="#/links" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentLinks.map((l) => html`<a class="dl-i" href=${l.url} target="_blank" rel="noopener" key=${l.id}><span class="fav"><img src=${`https://www.google.com/s2/favicons?domain=${l.host}&sz=32`} alt="" /></span><div><b>${l.title}</b><small>${l.host}</small></div></a>`)}</div>
        <a class="more" href="#/links">查看全部<${Icon} name="right" size=${12} /></a>
      <//>` },
    week: { title: '本周', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>本周</h3></div>
        <div class="wk-stats">
        <div class="stat-row"><div><small>完成待办</small><b>${doneWeek}</b></div><${Spark} points=${doneSeries} /></div>
        <div class="stat-row"><div><small>专注时间</small><b>${fmtH(focusByDay.reduce((a, b) => a + b, 0))}</b></div><${Spark} points=${focusSeries} color="var(--violet)" /></div>
        <div class="stat-row"><div><small>更新页面</small><b>${s.notes.filter((n) => week.includes((n.updated || '').slice(0, 10))).length}</b></div><${Spark} points=${noteSeries} color="var(--teal)" /></div>
        </div>
      <//>` },
  };

  const Widget = (id) => {
    const w = W[id]; if (!w) return null;
    const ov = over && over.id === id;
    const sz = sizeOf(id); const span = spanOf(id);
    const widthItems = [[1, '⅓ 宽'], [2, '⅔ 宽'], [3, '整行']].map(([n, l]) => ({ label: l, icon: span === n ? 'check' : 'grid', onClick: () => setSize(id, { span: n }) }));
    return html`<div class=${'widget span-' + span + (drag && drag.id === id ? ' dragging' : '') + (ov ? (over.after ? ' drop-after' : ' drop-before') : '') + (custom ? ' custom' : '')} key=${id} data-id=${id} style=${sz.h ? `--wh:${sz.h}px` : ''}
      draggable=${custom} onDragStart=${(e) => { setDrag({ id }); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd=${() => { setDrag(null); setOver(null); }}
      onDragOver=${(e) => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id, after: e.clientX > r.left + r.width / 2 || e.clientY > r.top + r.height * 0.75 }); }}
      onDrop=${(e) => onDrop(e, id)}
      onContextMenu=${(e) => { if (e.target.closest('.tl-i, .mt-b, .dl-i, .thumb, .g-row, input, textarea, [contenteditable]')) return; ctxMenu(e, [{ label: custom ? '完成自定义' : '自定义主页', icon: 'grid', onClick: () => setCustom(!custom) }, 'sep', { label: '前移', icon: 'left', onClick: () => shift(id, -1) }, { label: '后移', icon: 'right', onClick: () => shift(id, 1) }, 'sep', ...widthItems, sz.h && { label: '恢复高度', icon: 'refresh', onClick: () => setSize(id, { h: null }) }, 'sep', { label: '隐藏此卡片', icon: 'eye', danger: true, onClick: () => hide(id) }], w.title); }}>
      ${w.el}
      <span class="w-rz w-rz-b" title="拖动调整高度" onPointerDown=${(e) => startResize(e, id, 'h')}></span>
      <span class="w-rz w-rz-r" title="拖动调整宽度" onPointerDown=${(e) => startResize(e, id, 'w')}></span>
      ${custom && html`<div class="w-tools"><span class="w-grip" title="拖动排序"><${Icon} name="dots" size=${14} /></span><button class="w-dots" onClick=${() => setWmenu(wmenu === id ? null : id)}><${Icon} name="down" size=${13} /></button>
        ${wmenu === id && html`<div class="popmenu w-menu">
          <div class="pm" onClick=${() => { shift(id, -1); setWmenu(null); }}><b>前移</b></div>
          <div class="pm" onClick=${() => { shift(id, 1); setWmenu(null); }}><b>后移</b></div>
          ${widthItems.map((it) => html`<div class=${'pm ' + (it.icon === 'check' ? 'on' : '')} onClick=${() => { it.onClick(); setWmenu(null); }}><b>${it.label}</b></div>`)}
          ${sz.h && html`<div class="pm" onClick=${() => { setSize(id, { h: null }); setWmenu(null); }}><b>恢复高度</b></div>`}
          <div class="pm danger" onClick=${() => { hide(id); setWmenu(null); }}><b>隐藏</b></div>
        </div>`}
      </div>`}
    </div>`;
  };

  return html`<div class=${'dash3 ' + (custom ? 'customizing' : '')} onDragOver=${(e) => drag && e.preventDefault()} onDrop=${(e) => { if (e.target.closest('.widget')) return; onDrop(e, null); }}>
    ${custom && html`<div class="custom-bar">
      <span><${Icon} name="grid" size=${14} /> 拖动卡片排序；拖卡片右边缘改宽度（⅓ / ⅔ / 整行），下边缘改高度。</span>
      ${layout.hidden.length > 0 && html`<span class="muted">已隐藏：</span>${layout.hidden.map((id) => html`<button class="btn sm" key=${id} onClick=${() => moveTo(id, null)}>+ ${W[id] ? W[id].title : id}</button>`)}`}
      <span class="flex1"></span>
      <button class="btn ghost sm" onClick=${() => setLayout(DEFAULT)}>恢复默认</button>
      <button class="btn primary sm" onClick=${() => setCustom(false)}>完成</button>
    </div>`}
    ${layout.order.map((id) => Widget(id))}
    <${TodoModal} open=${!!editing} todo=${editing && editing.id ? editing : null} defaults=${{ due: today }} onClose=${() => setEditing(null)} />
  </div>`;
}
