import { html, useState, useMemo } from '../../vendor/preact.js';
import { useStore, toggleTodo } from '../store.js';
import { Icon, Card, Btn, Tag, Empty, Progress, useClock } from '../ui.js';
import { todayStr, greeting, WEEKDAY_SUN, monthKey, sortBy, timeToMin, kindColor, weekKey, weekStart, weekDays, addDays, parseDate, pad, BLOCK_KINDS } from '../util.js';
import { TodoModal, QuickAdd } from './todos.js';
import { goalPct } from './planner.js';
import { ancestors, noteTitle } from './notes.js';
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

  const todos = useMemo(() => sortBy(s.todos.filter((t) => t.due === today || (!t.done && t.due && t.due < today)), 'done', 'priority', 'time').slice(0, 8), [s.todos]);
  const blocks = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today), 'start'), [s.blocks]);
  const goals = s.goals[monthKey()] || [];
  const wk = s.weeks[weekKey()];
  const week = weekDays(weekStart());
  const recentNotes = sortBy(s.notes, '-updated').slice(0, 5);
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

  return html`<div class="dash2">
    <div class="d-main">
      <${Card} class="profile">
        <div class="avatar big">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || 'R')[0]}</div>
        <div class="flex1"><div class="p-name">${greeting(now)}，${s.profile.name}</div><div class="p-sub">${s.profile.motto} · ${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_SUN[now.getDay()]} · ${weekKey()}</div></div>
        <a class="ibtn" href="#/settings" title="设置"><${Icon} name="settings" size=${16} /></a>
      <//>
      <div class="d-row">
        <${Card} class="tl-card">
          <div class="card-h"><h3>今天 <span class="muted small">${blocks.length ? blocks.length + ' 个时间块' : ''}</span></h3><div class="card-act"><a class="ibtn" href="#/plan/day" title="编辑"><${Icon} name="plus" size=${15} /></a></div></div>
          <div class="mini-tl" style=${`height:${(to - from) * hourH}px`}>
            ${Array.from({ length: to - from }, (_, i) => html`<div class="mt-h" style=${`top:${i * hourH}px`}><span>${pad(from + i)}:00</span></div>`)}
            ${blocks.map((b) => { const a = Math.max(timeToMin(b.start), from * 60), e = Math.min(timeToMin(b.end), to * 60); if (e <= a) return null; const cur = a <= nowMin && e > nowMin; return html`<div class=${'mt-b ' + (cur ? 'cur' : '') + (e <= nowMin ? ' past' : '')} style=${`top:${y(a)}px;height:${Math.max(y(e) - y(a) - 2, 18)}px;--bc:${kindColor(b.kind)}`} onClick=${() => go('plan/day')}><b>${b.title}</b><small>${b.start} – ${b.end}</small></div>`; })}
            ${nowMin >= from * 60 && nowMin <= to * 60 && html`<div class="mt-now" style=${`top:${y(nowMin)}px`}></div>`}
          </div>
        <//>
        <${Card} class="todo-card">
          <div class="card-h"><h3>待办</h3><div class="card-act"><button class="ibtn" onClick=${() => { setEditing({ id: null }); }} title="新建"><${Icon} name="plus" size=${15} /></button></div></div>
          ${todos.length === 0 ? html`<${Empty} icon="checksq" text="今天没有待办。" />` : html`<div class="tlist">${todos.map((t) => html`<label class=${'tl-i ' + (t.done ? 'done' : '')} key=${t.id}><input type="checkbox" checked=${t.done} onChange=${() => toggleTodo(t.id)} /><span class="flex1" onClick=${(e) => { e.preventDefault(); setEditing(t); }}>${t.title}</span>${t.time && html`<small>${t.time}</small>`}</label>`)}</div>`}
          <${QuickAdd} defaults=${{ due: today }} placeholder="添加待办…" />
        <//>
      </div>
      <${Card}>
        <div class="card-h"><h3>最近页面</h3><div class="card-act"><a class="ibtn" href="#/notes" title="全部"><${Icon} name="right" size=${15} /></a></div></div>
        <div class="thumbs">
          ${recentNotes.map((n) => html`<a class="thumb" href=${'#/notes/' + n.id} key=${n.id}><div class="th-prev" style=${n.cover ? (/^https?:/.test(n.cover) ? `background-image:url(${n.cover})` : `background:${n.cover}`) : ''}>${!n.cover && html`<div class="th-lines"><i></i><i></i><i></i><i></i></div>`}</div><b>${noteTitle(n)}</b><small>${ancestors(s.notes, n).map(noteTitle).join(' / ') || n.updated.slice(0, 10)}</small></a>`)}
          <button class="thumb new" onClick=${() => go('notes/t:' + encodeURIComponent('新页面 ' + today))}><div class="th-prev"><${Icon} name="plus" size=${18} /></div><b>新建</b></button>
        </div>
      <//>
      <${Card}>
        <div class="card-h"><h3>本月目标</h3><div class="card-act"><a class="ibtn" href="#/plan/month" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        ${goals.length === 0 ? html`<${Empty} icon="target" text="这个月还没定目标。" />` : html`<div class="glist">${goals.map((g) => { const p = goalPct(g); return html`<a class="g-row" href="#/plan/month" key=${g.id}><${Icon} name="target" size=${14} class="muted" /><span class="g-t">${g.title}</span><span class="g-bar"><${Progress} value=${p} /></span><span class="g-p">${p}%</span><${Tag} color=${p >= 100 ? 'var(--green)' : p >= 50 ? 'var(--blue)' : 'var(--amber)'}>${p >= 100 ? '完成' : p >= 50 ? '进行中' : '刚开始'}<//></a>`; })}</div>`}
      <//>
      <${Card}>
        <div class="card-h"><h3>本周焦点</h3><div class="card-act"><a class="ibtn" href="#/plan/week" title="周计划"><${Icon} name="right" size=${15} /></a></div></div>
        ${wk && wk.focus ? html`<pre class="focus-pre">${wk.focus}</pre>` : html`<p class="small muted">还没写本周焦点。去周计划里写下这周最重要的三件事。</p>`}
        ${quote && html`<div class="quote-line"><${Icon} name="sparkle" size=${13} /> ${quote.text}</div>`}
      <//>
    </div>
    <div class="d-side">
      <${MonthCal} s=${s} today=${today} />
      <${Card}>
        <div class="card-h"><h3>专注</h3><div class="card-act"><a class="ibtn" href="#/plan/day" title="时间线"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="focus-row"><div><div class="small muted">今日目标</div><div class="focus-big">${fmtH(focusToday)} <span class="muted">/ ${GOAL_MIN / 60}h</span></div></div><${Ring} value=${focusToday / GOAL_MIN} /></div>
        <div class="bars">${focusByDay.map((m, i) => html`<div class="bar" key=${i}><i style=${`height:${Math.max(4, Math.min(100, (m / GOAL_MIN) * 100))}%`} class=${week[i] === today ? 'on' : ''}></i><span>${['一', '二', '三', '四', '五', '六', '日'][i]}</span></div>`)}</div>
      <//>
      <${Card}>
        <div class="card-h"><h3>笔记</h3><div class="card-act"><a class="ibtn" href="#/notes" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentNotes.slice(0, 4).map((n) => html`<a class="dl-i" href=${'#/notes/' + n.id} key=${n.id}><i style=${`background:${['var(--violet)', 'var(--amber)', 'var(--blue)', 'var(--green)'][n.id.charCodeAt(0) % 4]}`}></i><div><b>${noteTitle(n)}</b><small>${n.updated.slice(5, 16).replace('T', ' · ')}</small></div></a>`)}</div>
        <a class="small link" href="#/notes">查看全部</a>
      <//>
      <${Card}>
        <div class="card-h"><h3>收藏</h3><div class="card-act"><a class="ibtn" href="#/links" title="全部"><${Icon} name="plus" size=${15} /></a></div></div>
        <div class="dot-list">${recentLinks.map((l) => html`<a class="dl-i" href=${l.url} target="_blank" rel="noopener" key=${l.id}><span class="fav"><img src=${`https://www.google.com/s2/favicons?domain=${l.host}&sz=32`} alt="" /></span><div><b>${l.title}</b><small>${l.host}</small></div></a>`)}</div>
        <a class="small link" href="#/links">查看全部</a>
      <//>
      <${Card}>
        <div class="card-h"><h3>本周</h3></div>
        <div class="stat-row"><div><small>完成待办</small><b>${doneWeek}</b></div><${Spark} points=${doneSeries} /></div>
        <div class="stat-row"><div><small>专注时间</small><b>${fmtH(focusByDay.reduce((a, b) => a + b, 0))}</b></div><${Spark} points=${focusSeries} color="var(--violet)" /></div>
        <div class="stat-row"><div><small>更新页面</small><b>${s.notes.filter((n) => week.includes((n.updated || '').slice(0, 10))).length}</b></div><${Spark} points=${noteSeries} color="var(--teal)" /></div>
      <//>
    </div>
    <${TodoModal} open=${!!editing} todo=${editing && editing.id ? editing : null} defaults=${{ due: today }} onClose=${() => setEditing(null)} />
  </div>`;
}
