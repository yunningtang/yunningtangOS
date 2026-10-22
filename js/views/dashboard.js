import { html, useState, useMemo } from '../../vendor/preact.js';
import { useStore } from '../store.js';
import { Icon, Card, Btn, Tag, Empty, Progress, useClock } from '../ui.js';
import { todayStr, greeting, WEEKDAY_SUN, monthKey, sortBy, timeToMin, kindColor, weekKey, weekStart, weekDays, fmtShort, PRIORITY } from '../util.js';
import { TodoItem, TodoModal, QuickAdd } from './todos.js';
import { goalPct } from './planner.js';

export default function Dashboard() {
  const s = useStore();
  const now = useClock();
  const today = todayStr();
  const [editing, setEditing] = useState(null);
  const pad = (n) => String(n).padStart(2, '0');

  const todos = useMemo(() => sortBy(s.todos.filter((t) => !t.done && (t.due === today || (t.due && t.due < today))), 'due', 'priority', 'time'), [s.todos]);
  const blocks = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today), 'start'), [s.blocks]);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const current = blocks.find((b) => timeToMin(b.start) <= nowMin && timeToMin(b.end) > nowMin);
  const next = blocks.find((b) => timeToMin(b.start) > nowMin);
  const goals = s.goals[monthKey()] || [];
  const reading = s.books.filter((b) => b.status === 'reading');
  const wk = s.weeks[weekKey()];
  const week = weekDays(weekStart());
  const statements = s.vision.statements;
  const quote = statements.length ? statements[now.getDate() % statements.length] : null;
  const recentNotes = sortBy(s.notes, '-updated').slice(0, 4);
  const recentLinks = s.links.slice(0, 4);
  const doneToday = s.todos.filter((t) => t.done && t.completedAt === today).length;

  const stats = [
    { to: '#/todos', icon: 'checksq', n: s.todos.filter((t) => !t.done).length, l: '未完成待办', c: 'var(--teal)' },
    { to: '#/plan/month', icon: 'target', n: goals.length ? Math.round(goals.reduce((a, g) => a + goalPct(g), 0) / goals.length) + '%' : '—', l: '本月目标进度', c: 'var(--violet)' },
    { to: '#/reading', icon: 'book', n: reading.length, l: '在读', c: 'var(--amber)' },
    { to: '#/notes', icon: 'note', n: s.notes.length, l: '笔记', c: 'var(--blue)' },
  ];

  return html`<div>
    <div class="hero">
      <${Card} class="greet">
        <div class="kicker">${WEEKDAY_SUN[now.getDay()]} · ${weekKey()}</div>
        <h1>${greeting(now)}，${s.profile.name}</h1>
        <p>${s.profile.motto}</p>
        <div class="today">
          ${current ? html`<${Tag} color=${kindColor(current.kind)}><${Icon} name="play" size=${10} /> 正在：${current.title} · 至 ${current.end}<//>` : next ? html`<${Tag}><${Icon} name="clock" size=${10} /> 下一项 ${next.start} ${next.title}<//>` : html`<${Tag}><${Icon} name="clock" size=${10} /> 今天还没有时间块<//>`}
          ${doneToday > 0 && html`<${Tag} color="var(--green)">今天已完成 ${doneToday} 项<//>`}
        </div>
      <//>
      <${Card} class="clock">
        <span class="k">现在是</span>
        <div class="t">${pad(now.getHours())}:${pad(now.getMinutes())}<span class="muted" style="font-size:.5em">:${pad(now.getSeconds())}</span></div>
        <div class="d">${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_SUN[now.getDay()]}</div>
      <//>
    </div>

    <div class="stats">${stats.map((x) => html`<a class="card stat" href=${x.to} style=${`--sc:${x.c}`}><span class="si"><${Icon} name=${x.icon} size=${16} /></span><span><b>${x.n}</b><small>${x.l}</small></span></a>`)}</div>

    <div class="dash">
      <div class="col">
        <${Card} title="今天" sub=${todos.length ? `${todos.length} 项待办` : '今天没有排期的待办'} action=${html`<a class="btn ghost sm" href="#/todos">全部 →</a>`}>
          <${QuickAdd} defaults=${{ due: today }} placeholder="今天要做什么？ 例如：跑步 18:00 !2" />
          ${todos.length === 0 ? html`<${Empty} icon="sparkle" text="空白的一天是礼物。去计划里安排一下，或者就这样放松。" />` : todos.map((t) => html`<${TodoItem} key=${t.id} t=${t} onEdit=${setEditing} />`)}
        <//>
        <${Card} title="今日时间线" sub=${blocks.length ? `${blocks.length} 个时间块` : ''} action=${html`<a class="btn ghost sm" href="#/plan/day">编辑 →</a>`}>
          ${blocks.length === 0 ? html`<${Empty} icon="clock" text="还没有给今天画时间线。" />` : html`<div class="day-sum">${blocks.map((b) => {
            const past = timeToMin(b.end) <= nowMin, cur = current && current.id === b.id;
            return html`<div class="r" style=${past ? 'opacity:.45' : cur ? 'font-weight:600' : ''}><i style=${`background:${kindColor(b.kind)}`}></i><span class="mono muted" style="width:92px">${b.start}–${b.end}</span><span class="flex1">${b.title}</span>${cur && html`<${Tag} color=${kindColor(b.kind)}>进行中<//>`}</div>`;
          })}</div>`}
        <//>
        <${Card} title="本周" sub=${wk && wk.focus ? '本周焦点' : '还没写本周焦点'} action=${html`<a class="btn ghost sm" href="#/plan/week">周计划 →</a>`}>
          ${wk && wk.focus && html`<pre class="serif" style="white-space:pre-wrap;font-size:.95rem;line-height:1.7;margin-bottom:12px">${wk.focus}</pre>`}
          <div class="row" style="gap:6px">${week.map((d, i) => {
            const items = (wk?.items?.[d] || []), tds = s.todos.filter((t) => t.due === d);
            const n = items.length + tds.length, done = items.filter((x) => x.done).length + tds.filter((t) => t.done).length;
            return html`<a href="#/plan/week" style="flex:1;text-decoration:none" class=${'small ' + (d === today ? '' : 'muted')}><div style=${`text-align:center;padding:8px 0;border-radius:10px;${d === today ? 'background:rgba(var(--ac),.1)' : ''}`}><b style="display:block">${['一', '二', '三', '四', '五', '六', '日'][i]}</b><span class="mono">${n ? `${done}/${n}` : '·'}</span></div></a>`;
          })}</div>
        <//>
      </div>
      <div class="col">
        ${quote && html`<${Card}><div class="quote"><${Icon} name="quote" size=${16} /><div>${quote.text}</div></div><a class="small muted" href="#/vision" style="display:block;margin-top:10px;text-decoration:none">愿景 →</a><//>`}
        <${Card} title="本月目标" sub=${monthKey()} action=${html`<a class="btn ghost sm" href="#/plan/month">全部 →</a>`}>
          ${goals.length === 0 ? html`<${Empty} icon="target" text="这个月还没定目标。" /> ` : html`<div class="stack gap8">${goals.slice(0, 5).map((g) => html`<div><div class="row" style="justify-content:space-between;font-size:.8rem;margin-bottom:4px"><span>${g.title}</span><span class="mono muted">${goalPct(g)}%</span></div><${Progress} value=${goalPct(g)} /></div>`)}</div>`}
        <//>
        <${Card} title="在读" action=${html`<a class="btn ghost sm" href="#/reading">书架 →</a>`}>
          ${reading.length === 0 ? html`<${Empty} icon="book" text="没有在读的书。" />` : html`<div class="stack gap8">${reading.slice(0, 3).map((b) => html`<div class="row"><div class="bk" style="padding:0;cursor:default"><div class="cv" style=${`--cc:${b.color || 'var(--teal)'};width:38px;height:54px;font-size:.5rem`}>${b.cover ? html`<img src=${b.cover} alt="" />` : b.title.slice(0, 6)}</div></div><div class="flex1"><div style="font-size:.82rem;font-weight:500">${b.title}</div><div class="small muted">${b.author}</div><div class="row" style="margin-top:4px;gap:6px"><div class="flex1"><${Progress} value=${b.total ? (b.progress / b.total) * 100 : b.progress} /></div><span class="small mono muted">${b.total ? `${b.progress}/${b.total}` : b.progress + '%'}</span></div></div></div>`)}</div>`}
        <//>
        <${Card} title="最近笔记" action=${html`<a class="btn ghost sm" href="#/notes">全部 →</a>`}>
          ${recentNotes.length === 0 ? html`<${Empty} icon="note" text="知识库还是空的。" />` : html`<div class="stack gap8">${recentNotes.map((n) => html`<a class="note-item" href=${'#/notes/' + n.id} style="padding:6px 8px"><b>${n.title || '无标题'}</b><p>${(n.body || '').replace(/[#*>\-\[\]`]/g, '').slice(0, 60)}</p></a>`)}</div>`}
        <//>
        <${Card} title="最近收藏" action=${html`<a class="btn ghost sm" href="#/links">全部 →</a>`}>
          ${recentLinks.length === 0 ? html`<${Empty} icon="link" text="还没有收藏链接。" />` : html`<div class="links">${recentLinks.map((l) => html`<a class="lk" href=${l.url} target="_blank" rel="noopener" style="padding:6px 8px"><div class="li"><b>${l.title || l.url}</b><span class="host">${l.host || ''}</span></div></a>`)}</div>`}
        <//>
      </div>
    </div>
    <${TodoModal} open=${!!editing} todo=${editing} onClose=${() => setEditing(null)} />
  </div>`;
}
