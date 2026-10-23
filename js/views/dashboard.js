import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, toggleTodo, update, removeUndo } from '../store.js';
import { usePomo } from './focus.js';
import * as pomo from '../pomo.js';
import { Icon, Card, Btn, Tag, Empty, Progress, useClock } from '../ui.js';
import { uid, todayStr, greeting, WEEKDAY_SUN, monthKey, sortBy, timeToMin, kindColor, weekKey, weekStart, weekDays, addDays, parseDate, pad, BLOCK_KINDS } from '../util.js';
import { TodoModal, QuickAdd, todoMenu } from './todos.js';
import { ctxMenu } from '../ctx.js';
import { dragProps, dropProps } from '../dnd.js';
import { Splitter } from '../resize.js';
import { upsert, remove } from '../store.js';
import { goalPct } from './planner.js';
import { ancestors, noteTitle, isBlank, newNote, nbOf } from './notes.js';
import { go } from '../nav.js';
import { AvatarPicker } from './settings.js';

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
  const pst = usePomo();
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

  const DEFAULT = { main: ['profile', 'timeline', 'todos', 'pages', 'goals', 'focusweek'], side: ['calendar', 'focus', 'notes', 'links', 'week'], hidden: [], sizes: {} };
  const layout = useMemo(() => { const l = s.settings.dash || DEFAULT; const known = new Set([...DEFAULT.main, ...DEFAULT.side]); const used = new Set([...l.main, ...l.side, ...(l.hidden || [])]); const extra = [...known].filter((id) => !used.has(id)); return { main: l.main.filter((id) => known.has(id)).concat(extra.filter((id) => DEFAULT.main.includes(id))), side: l.side.filter((id) => known.has(id)).concat(extra.filter((id) => DEFAULT.side.includes(id))), hidden: (l.hidden || []).filter((id) => known.has(id)), sizes: l.sizes || {} }; }, [s.settings.dash]);
  const setLayout = (next) => update((d) => { d.settings.dash = next; });
  const [drag, setDrag] = useState(null); // { id }
  const [over, setOver] = useState(null); // { id, after } | { col }
  const [custom, setCustom] = useState(false);
  const [fwLabel, setFwLabel] = useState('');
  const [wmenu, setWmenu] = useState(null);
  const colOf = (id) => (layout.main.includes(id) ? 'main' : 'side');
  const moveTo = (id, col, index) => {
    const next = { ...layout, main: layout.main.filter((x) => x !== id), side: layout.side.filter((x) => x !== id), hidden: layout.hidden.filter((x) => x !== id) };
    const list = next[col]; const at = index == null ? list.length : Math.max(0, Math.min(list.length, index));
    list.splice(at, 0, id); setLayout(next);
  };
  const hide = (id) => setLayout({ ...layout, main: layout.main.filter((x) => x !== id), side: layout.side.filter((x) => x !== id), hidden: [...layout.hidden, id] });
  const setSize = (id, patch) => setLayout({ ...layout, sizes: { ...layout.sizes, [id]: { ...(layout.sizes[id] || {}), ...patch } } });
  const sizeOf = (id) => layout.sizes[id] || {};
  // Pointer-driven resize: right edge toggles span (main column), bottom edge sets min height.
  const startResize = (e, id, mode, col) => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget.closest('.widget'); const r = el.getBoundingClientRect(); const x0 = e.clientX, y0 = e.clientY, h0 = r.height;
    document.body.classList.add('resizing');
    const move = (ev) => {
      if (mode === 'h') { el.style.setProperty('--wh', Math.max(120, h0 + ev.clientY - y0) + 'px'); }
      else if (col === 'main') { const want = r.width + (ev.clientX - x0) > (el.parentElement.getBoundingClientRect().width * 0.72) ? 2 : 1; el.dataset.spanPreview = want; }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing');
      if (mode === 'h') { const h = parseFloat(el.style.getPropertyValue('--wh')); el.style.removeProperty('--wh'); if (Math.abs(ev.clientY - y0) > 4) setSize(id, { h: Math.round(h) }); }
      else if (col === 'main') { const want = el.dataset.spanPreview; delete el.dataset.spanPreview; if (want) setSize(id, { span: +want }); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
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
        <${AvatarPicker} size=${60} class="big" />
        <div class="flex1"><div class="p-name">${greeting(now)}，${s.profile.name}</div><div class="p-sub">${s.profile.motto} · ${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_SUN[now.getDay()]} · ${weekKey()}</div></div>
        <button class=${'btn ghost sm ' + (custom ? 'on' : '')} onClick=${() => setCustom(!custom)}><${Icon} name="grid" size=${14} /> ${custom ? '完成' : '自定义'}</button>
      <//>` },
    timeline: { title: '今天', span: 1, el: html`<${Card} class="tl-card">
        <div class="card-h"><h3>今天 <span class="muted small">${blocks.length ? blocks.length + ' 个时间块' : ''}</span></h3><div class="card-act"><a class="ibtn" href="#/plan/day" title="编辑"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="mini-tl-wrap" ref=${(el) => { if (el && !el.dataset.scrolled) { el.dataset.scrolled = 1; const target = nowMin >= from * 60 && nowMin <= to * 60 ? y(nowMin) : (blocks.length ? y(timeToMin(blocks[0].start)) : 0); el.scrollTop = Math.max(0, target - 140); } }}>
        <div class="mini-tl" style=${`height:${Math.max((to - from) * hourH, ...laid.map((it) => it.top + it.h + 6))}px`}>
          ${Array.from({ length: to - from }, (_, i) => html`<div class="mt-h" style=${`top:${i * hourH}px`}><span>${pad(from + i)}:00</span></div>`)}
          ${laid.map(({ b, a, e, lane, lanes, top, h }) => { const real = timeToMin(b.end); const cur = a <= nowMin && real > nowMin; const w = 100 / lanes; return html`<div class=${'mt-b ' + (cur ? 'cur' : '') + (real <= nowMin ? ' past' : '') + (h < 36 ? ' one' : '')} key=${b.id} style=${`top:${top}px;height:${h}px;left:calc(6px + ${lane * w}%);width:calc(${w}% - ${lanes > 1 ? 8 : 6}px);--bc:${kindColor(b.kind)}`} ...${dragProps('block', { kind: 'block', id: b.id })} onClick=${() => go('plan/day')} onContextMenu=${(ev) => ctxMenu(ev, [{ label: '在时间线中编辑', icon: 'edit', onClick: () => go('plan/day') }, { label: '复制到明天', icon: 'calendar', onClick: () => upsert('blocks', { ...b, id: uid(), date: addDays(today, 1) }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('blocks', b.id, b.title || b.place || b.url) }], b.title)} title=${`${b.title} ${b.start} – ${b.end}`}><b>${b.title || b.place || '（无标题）'}</b><small>${b.start} – ${b.end}</small></div>`; })}
          ${nowMin >= from * 60 && nowMin <= to * 60 && html`<div class="mt-now" style=${`top:${y(nowMin)}px`}><span>${pad(now.getHours())}:${pad(now.getMinutes())}</span></div>`}
        </div>
        </div>
      <//>` },
    todos: { title: '待办', span: 1, el: html`<${Card} class="todo-card" ...${dropProps('todo', (d) => upsert('todos', { id: d.id, due: today }))}>
        <div class="card-h"><h3>待办 ${todos.length > 0 && html`<span class="muted small">${todos.length}</span>`}</h3><div class="card-act"><a class="ibtn" href="#/todos" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        ${todos.length === 0 ? html`<${Empty} icon="checksq" text=${doneTodos.length ? '今天的都做完了。' : '今天没有待办。'} />` : html`<div class="tlist">${todos.map((t) => html`<label class="tl-i" key=${t.id} ...${dragProps('todo', { id: t.id })} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, setEditing), t.title)}><input type="checkbox" checked=${false} onChange=${() => toggleTodo(t.id)} /><span class="flex1" onClick=${(e) => { e.preventDefault(); setEditing(t); }}>${t.title}</span>${t.time && html`<small>${t.time}</small>`}</label>`)}</div>`}
        <${QuickAdd} defaults=${{ due: today }} placeholder="添加待办…" />
        ${doneTodos.length > 0 && html`<button class="done-tg" onClick=${() => setShowDone(!showDone)}><${Icon} name=${showDone ? 'down' : 'right'} size=${12} /> 已完成 ${doneTodos.length}</button>
          ${showDone && html`<div class="tlist">${doneTodos.map((t) => html`<label class="tl-i done" key=${t.id} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, setEditing), t.title)}><input type="checkbox" checked=${true} onChange=${() => toggleTodo(t.id)} /><span class="flex1" onClick=${(e) => { e.preventDefault(); setEditing(t); }}>${t.title}</span>${t.time && html`<small>${t.time}</small>`}</label>`)}</div>`}`}
      <//>` },
    pages: { title: '最近页面', span: 2, el: html`<${Card}>
        <div class="card-h"><h3>最近页面</h3><div class="card-act"><button class="ibtn" title="新页面" onClick=${() => { const n = newNote(); go('notes/' + n.id); }}><${Icon} name="plus" size=${15} /></button><a class="ibtn" href="#/notes" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        <div class="thumbs">
          ${recentNotes.map((n) => html`<a class="thumb" href=${'#/notes/' + n.id} key=${n.id}><div class="th-prev" style=${n.cover ? (/^https?:/.test(n.cover) ? `background-image:url(${n.cover})` : `background:${n.cover}`) : ''}>${!n.cover && html`<div class="th-lines"><i></i><i></i><i></i><i></i></div>`}</div><b>${noteTitle(n)}</b><small>${ancestors(s.notes, n).map(noteTitle).join(' / ') || n.updated.slice(0, 10)}</small></a>`)}
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
    focus: { title: '专注', span: 1, el: (() => {
      const rem = pomo.remaining(); const total = (pst.phase === 'break' ? pst.breakLen : pst.workLen) * 60; const pct = pst.phase === 'idle' ? 0 : 1 - rem / total; const R = 118, C = 2 * Math.PI * R;
      return html`<${Card} class=${'focus-w ' + pst.phase + (pst.paused ? ' paused' : '')} pad=${false}>
        <div class="fw-hero">
          <div class="fw-top"><span class="fh-k">${pst.phase === 'idle' ? '专注' : pst.phase === 'break' ? '休息一下' : pst.paused ? '已暂停' : '专注中'}</span><a class="ibtn" href="#/focus" title="打开专注页"><${Icon} name="right" size=${15} /></a></div>
          <div class="pomo-ring"><svg viewBox="0 0 280 280"><defs><linearGradient id="pgw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pg1)" /><stop offset="1" stop-color="var(--pg2)" /></linearGradient></defs>
            <circle cx="140" cy="140" r=${R} class="pr-bg" /><circle cx="140" cy="140" r=${R} class="pr-fg" stroke="url(#pgw)" stroke-dasharray=${C} stroke-dashoffset=${C * (1 - pct)} />
            ${pst.phase !== 'idle' && html`<circle class="pr-dot" cx=${140 + R * Math.cos((pct * 360 - 90) * Math.PI / 180)} cy=${140 + R * Math.sin((pct * 360 - 90) * Math.PI / 180)} r="6" />`}</svg>
            <div class="pomo-t"><div class="pomo-time">${pomo.fmt(rem)}</div><div class="pomo-sub">${pst.phase === 'idle' ? `${pst.workLen} 分钟` : pst.phase === 'break' ? '休息' : (pst.label || '专注')}</div></div>
          </div>
          ${pst.phase === 'idle' ? html`
            <form class="fw-start" onSubmit=${(e) => { e.preventDefault(); pomo.start({ label: fwLabel.trim() }); setFwLabel(''); }}>
              <input type="text" value=${fwLabel} placeholder="这一轮要做什么？" onInput=${(e) => setFwLabel(e.target.value)} />
              <button type="submit" class="fw-go" title="开始专注"><${Icon} name="play" size=${14} /> 开始</button>
            </form>
            <div class="chips fw-chips">${[25, 45, 50, 90].map((w) => html`<button key=${w} type="button" class=${'chip ' + (pst.workLen === w ? 'on' : '')} onClick=${() => pomo.setLens(w, Math.max(5, Math.round(w / 5)))}>${w}<i>分</i></button>`)}</div>`
          : html`<div class="fw-ctl">
              <button class="pf-btn main" onClick=${() => (pst.paused ? pomo.resume() : pomo.pause())}><${Icon} name=${pst.paused ? 'play' : 'pause'} size=${13} /> ${pst.paused ? '继续' : '暂停'}</button>
              ${pst.phase === 'work' ? html`<button class="pf-btn" onClick=${() => pomo.stop(true)}><${Icon} name="check" size=${13} /> 完成</button>` : html`<button class="pf-btn" onClick=${() => pomo.skip()}><${Icon} name="right" size=${13} /> 跳过</button>`}
              <button class="pf-btn danger" title="放弃" onClick=${() => pomo.stop(false)}><${Icon} name="x" size=${13} /></button>
            </div>`}
        </div>
        <div class="fw-foot">
          <div class="fw-today"><small>今天</small><b>${fmtH(focusToday)}</b><span class="muted">/ ${GOAL_MIN / 60}h</span></div>
          <div class="bars">${focusByDay.map((m, i) => html`<div class="bar" key=${i}><i style=${`height:${Math.max(4, Math.min(100, (m / GOAL_MIN) * 100))}%`} class=${week[i] === today ? 'on' : ''}></i><span>${['一', '二', '三', '四', '五', '六', '日'][i]}</span></div>`)}</div>
        </div>
      <//>`; })() },
    notes: { title: '笔记', span: 1, el: html`<${Card}>
        <div class="card-h"><h3>笔记</h3><div class="card-act"><a class="ibtn" href="#/notes" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentNotes.slice(0, 4).map((n) => html`<a class="dl-i" href=${'#/notes/' + n.id} key=${n.id}><i style=${`background:${(nbOf(s, n.nb) || {}).color || 'var(--text-4)'}`} title=${(nbOf(s, n.nb) || {}).name || ''}></i><div><b>${noteTitle(n)}</b><small>${n.updated.slice(5, 16).replace('T', ' · ')}</small></div></a>`)}</div>
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
    const sz = sizeOf(id); const span = col === 'main' ? (sz.span || w.span) : 1;
    return html`<div class=${'widget span-' + span + (drag && drag.id === id ? ' dragging' : '') + (ov ? (over.after ? ' drop-after' : ' drop-before') : '') + (custom ? ' custom' : '')} key=${id} data-id=${id} style=${sz.h ? `--wh:${sz.h}px` : ''}
      draggable=${custom} onDragStart=${(e) => { setDrag({ id }); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd=${() => { setDrag(null); setOver(null); }}
      onDragOver=${(e) => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id, after: e.clientY > r.top + r.height / 2 }); }}
      onDrop=${(e) => onDrop(e, id, col)}
      onContextMenu=${(e) => { if (e.target.closest('.tl-i, .mt-b, .dl-i, .thumb, .g-row, input, textarea, [contenteditable]')) return; ctxMenu(e, [{ label: custom ? '完成自定义' : '自定义主页', icon: 'grid', onClick: () => setCustom(!custom) }, 'sep', { label: '上移', icon: 'up', onClick: () => shift(id, -1) }, { label: '下移', icon: 'down', onClick: () => shift(id, 1) }, { label: col === 'main' ? '移到右栏' : '移到左栏', icon: 'right', onClick: () => moveTo(id, col === 'main' ? 'side' : 'main', null) }, col === 'main' && { label: span === 2 ? '改为半行' : '占满整行', icon: 'grid', onClick: () => setSize(id, { span: span === 2 ? 1 : 2 }) }, 'sep', { label: '隐藏此卡片', icon: 'eye', danger: true, onClick: () => hide(id) }], w.title); }}>
      ${w.el}
      <span class="w-rz w-rz-b" title="拖动调整高度" onPointerDown=${(e) => startResize(e, id, 'h', col)}></span>
      ${col === 'main' && html`<span class="w-rz w-rz-r" title="拖动切换半行 / 整行" onPointerDown=${(e) => startResize(e, id, 'w', col)}></span>`}
      ${custom && html`<div class="w-tools"><span class="w-grip" title="拖动排序"><${Icon} name="dots" size=${14} /></span><button class="w-dots" onClick=${() => setWmenu(wmenu === id ? null : id)}><${Icon} name="down" size=${13} /></button>
        ${wmenu === id && html`<div class="popmenu w-menu">
          <div class="pm" onClick=${() => { shift(id, -1); setWmenu(null); }}><b>上移</b></div>
          <div class="pm" onClick=${() => { shift(id, 1); setWmenu(null); }}><b>下移</b></div>
          <div class="pm" onClick=${() => { moveTo(id, col === 'main' ? 'side' : 'main', null); setWmenu(null); }}><b>${col === 'main' ? '移到右栏' : '移到左栏'}</b></div>
          ${col === 'main' && html`<div class="pm" onClick=${() => { setSize(id, { span: span === 2 ? 1 : 2 }); setWmenu(null); }}><b>${span === 2 ? '改为半行' : '占满整行'}</b></div>`}
          ${sz.h && html`<div class="pm" onClick=${() => { setSize(id, { h: null }); setWmenu(null); }}><b>恢复高度</b></div>`}
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
    <${Splitter} varName="dside" min=${240} max=${460} dir=${-1} class="sp-dash" />
    <div class="d-side" onDragOver=${(e) => drag && e.preventDefault()} onDrop=${(e) => { if (e.target.closest('.widget')) return; onDrop(e, null, 'side'); }}>${layout.side.map((id) => Widget(id, 'side'))}</div>
    <${TodoModal} open=${!!editing} todo=${editing && editing.id ? editing : null} defaults=${{ due: today }} onClose=${() => setEditing(null)} />
  </div>`;
}
