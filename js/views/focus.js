import { html, useState, useEffect, useMemo } from '../../vendor/preact.js';
import { useStore } from '../store.js';


import { Icon, Card, Btn, Seg, Empty, Tag, Select } from '../ui.js';
import { todayStr, sortBy, timeToMin, kindColor, addDays, pad } from '../util.js';
import * as pomo from '../pomo.js';
import { go } from '../nav.js';

export function usePomo() {
  const [st, set] = useState(pomo.get());
  useEffect(() => pomo.subscribe((s) => set({ ...s })), []);
  return st;
}

export default function Focus({ route }) {
  const s = useStore();
  const st = usePomo();
  const rem = pomo.remaining();
  const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60;
  const pct = st.phase === 'idle' ? 0 : 1 - rem / total;
  const today = todayStr();
  const todos = sortBy(s.todos.filter((t) => !t.done && (t.due === today || !t.due)), 'priority');
  const sessions = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today && b.kind === 'focus'), 'start'), [s.blocks]);
  const mins = sessions.reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0);
  const streak = useMemo(() => { let n = 0; const d = new Date(); for (;;) { const k = todayStr(d); if (s.blocks.some((b) => b.date === k && b.kind === 'focus')) { n++; d.setDate(d.getDate() - 1); } else break; if (n > 365) break; } return n; }, [s.blocks]);
  useEffect(() => { document.title = st.phase === 'idle' ? '专注 · yunningtang OS' : `${pomo.fmt(rem)} · ${st.phase === 'break' ? '休息' : st.label || '专注'}`; return () => { document.title = 'yunningtang OS'; }; }, [rem, st.phase]);
  const dayFrom = 6, dayTo = 24;
  const posOf = (t) => Math.max(0, Math.min(100, ((timeToMin(t) - dayFrom * 60) / ((dayTo - dayFrom) * 60)) * 100));

  return html`<div class="dash3 focus-grid">
    <div class="widget span-1"><${PomoCard} full initialTodo=${route.query && route.query.todo} /></div>
    <div class="widget span-1">
      <${Card} title="今天的专注" sub=${sessions.length ? `${sessions.length} 段 · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '还没有记录'} action=${html`<a class="btn ghost sm" href="#/plan/day">时间线 →</a>`}>
        <div class="day-strip">
          ${[6, 9, 12, 15, 18, 21, 24].map((h) => html`<span class="ds-h" key=${h} style=${`left:${posOf(String(h).padStart(2, '0') + ':00')}%`}>${h}</span>`)}
          ${sessions.map((b) => html`<i key=${b.id} class="ds-b" style=${`left:${posOf(b.start)}%;width:${Math.max(1.2, posOf(b.end) - posOf(b.start))}%`} title=${`${b.title} ${b.start}–${b.end}`}></i>`)}
          ${st.phase === 'work' && html`<i class="ds-b live" style=${`left:${posOf(new Date(st.startedAt).toTimeString().slice(0, 5))}%;width:${Math.max(1.2, ((st.workLen - rem / 60) / ((dayTo - dayFrom) * 60)) * 100)}%`}></i>`}
        </div>
        ${sessions.length > 0 && html`<div class="sess-list">${[...sessions].reverse().slice(0, 6).map((b) => html`<div class="sess" key=${b.id}><i></i><span class="sess-t">${b.start}–${b.end}</span><span class="sess-n">${b.title || '专注'}</span><span class="sess-m">${timeToMin(b.end) - timeToMin(b.start)} 分</span></div>`)}</div>`}
      <//>
    </div>
    <div class="widget span-1">
      <${Card} title="快速开始" sub="点一下就进入这一项的专注">
        ${todos.length === 0 ? html`<${Empty} icon="checksq" text="今天没有待办。" />` : html`<div class="tlist">${todos.slice(0, 7).map((t) => html`<button class="tl-i" key=${t.id} onClick=${() => pomo.start({ label: t.title, todoId: t.id })}><${Icon} name="play" size=${12} class="muted" /><span class="flex1">${t.title}</span>${t.time && html`<small>${t.time}</small>`}</button>`)}</div>`}
      <//>
    </div>
    <div class="widget span-3"><${FocusStats} blocks=${s.blocks} /></div>
  </div>`;
}

/* ---------- the timer card, shared by the dashboard and the focus page ---------- */
export function PomoCard({ full = false, initialTodo = '' }) {
  const s = useStore();
  const pst = usePomo();
  const today = todayStr();
  const [label, setLabel] = useState(pst.label || '');
  const [todoId, setTodoId] = useState(pst.todoId || '');
  const [customLen, setCustomLen] = useState(false);
  useEffect(() => { if (initialTodo) { const t = s.todos.find((x) => x.id === initialTodo); if (t) { setTodoId(t.id); setLabel(t.title); } } }, [initialTodo]);
  const todos = sortBy(s.todos.filter((t) => !t.done && (t.due === today || !t.due)), 'priority');
  const rem = pomo.remaining(); const total = (pst.phase === 'break' ? pst.breakLen : pst.workLen) * 60; const pct = pst.phase === 'idle' ? 0 : 1 - rem / total; const R = 118, C = 2 * Math.PI * R;
  const begin = () => { pomo.start({ label: label.trim(), todoId }); if (!full) setLabel(''); };
  const presets = [[25, 5], [45, 10], [50, 10], [90, 15]];
  return html`<${Card} class=${'focus-w ' + pst.phase + (pst.paused ? ' paused' : '') + (full ? ' full' : '')} pad=${false}>
    <div class="fw-hero">
      <div class="fw-top"><span class="fh-k">${pst.phase === 'idle' ? '专注' : pst.phase === 'break' ? '休息一下' : pst.paused ? '已暂停' : '专注中'}</span>${full ? html`<span class="muted small">${pst.phase === 'idle' ? `${pst.workLen} 分钟 · 休息 ${pst.breakLen} 分钟` : ''}</span>` : html`<a class="ibtn" href="#/focus" title="打开专注页"><${Icon} name="right" size=${15} /></a>`}</div>
      <${Dial} rem=${rem} phase=${pst.phase} full=${full} />
      <div class="pomo-t"><div class="pomo-time">${pomo.fmt(rem)}</div><div class="pomo-sub">${pst.phase === 'idle' ? `${pst.workLen} 分钟` : pst.phase === 'break' ? '休息' : (pst.label || '专注')}</div><${Span} rem=${rem} /></div>
      ${pst.phase === 'idle' ? html`
        <form class="fw-start" onSubmit=${(e) => { e.preventDefault(); begin(); }}>
          <input type="text" value=${label} placeholder="这一轮要做什么？" onInput=${(e) => setLabel(e.target.value)} />
          <button type="submit" class="fw-go" title="开始专注"><${Icon} name="play" size=${14} /> 开始</button>
        </form>
        <div class="chips fw-chips">${presets.map(([w, b]) => html`<button key=${w} type="button" class=${'chip ' + (pst.workLen === w && !customLen ? 'on' : '')} onClick=${() => { setCustomLen(false); pomo.setLens(w, b); }}>${w}<i>分</i></button>`)}${full && (customLen ? html`<input class="chip-in" type="number" min="5" max="180" value=${pst.workLen} autofocus onInput=${(e) => { const w = Math.max(5, Math.min(180, +e.target.value || 25)); pomo.setLens(w, Math.max(3, Math.round(w / 5))); }} />` : html`<button type="button" class=${'chip ' + (presets.every(([w]) => w !== pst.workLen) ? 'on' : '')} onClick=${() => setCustomLen(true)}>自定义</button>`)}</div>
        ${full && todos.length > 0 && html`<div class="fw-todo"><${Select} class="pf-todo" value=${todoId} placeholder="关联待办…" clearable options=${todos.map((t) => ({ v: t.id, label: t.title }))} onChange=${(v) => { setTodoId(v); const t = s.todos.find((x) => x.id === v); if (t) setLabel(t.title); }} /></div>`}`
      : html`<div class="fw-ctl">
          <button class="pf-btn main" onClick=${() => (pst.paused ? pomo.resume() : pomo.pause())}><${Icon} name=${pst.paused ? 'play' : 'pause'} size=${13} /> ${pst.paused ? '继续' : '暂停'}</button>
          ${pst.phase === 'work' ? html`<button class="pf-btn" onClick=${() => pomo.stop(true)}><${Icon} name="check" size=${13} /> 完成</button>` : html`<button class="pf-btn" onClick=${() => pomo.skip()}><${Icon} name="right" size=${13} /> 跳过</button>`}
          <button class="pf-btn danger" title="放弃" onClick=${() => pomo.stop(false)}><${Icon} name="x" size=${13} /></button>
        </div>`}
    </div>
  <//>`;
}

/* ---------- clock-face dial: the session is a sector on a 60-minute face, a hand marks "now" ---------- */
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function useTick(ms) { const [, f] = useState(0); useEffect(() => { const t = setInterval(() => f((x) => x + 1), ms); return () => clearInterval(t); }, [ms]); }
function Span({ rem }) { useTick(15000); const now = new Date(); return html`<div class="pomo-span">${hhmm(now)} → ${hhmm(new Date(now.getTime() + rem * 1000))}</div>`; }
function Dial({ rem, phase, full }) {
  useTick(1000);
  const now = Date.now(); const C = 140, R = 112;
  const a0 = ((now / 60000) % 60) * 6; const span = Math.min(360, (rem / 60) * 6); const a1 = a0 + span;
  const pt = (a, r) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
  const [sx, sy] = pt(a0, R), [ex, ey] = pt(a1, R);
  const sector = span >= 360 ? `M${C - R},${C} a${R},${R} 0 1,0 ${R * 2},0 a${R},${R} 0 1,0 ${-R * 2},0` : `M${C},${C} L${sx},${sy} A${R},${R} 0 ${span > 180 ? 1 : 0},1 ${ex},${ey} Z`;
  const [hx, hy] = pt(a0, R * 0.8);
  return html`<div class=${'dial ' + phase}><svg viewBox="0 0 280 280">
    <circle cx=${C} cy=${C} r=${R + 14} class="dl-face" />
    <path d=${sector} class="dl-sector" />
    ${Array.from({ length: 60 }, (_, i) => { const big = i % 5 === 0; const [x1, y1] = pt(i * 6, R + 3), [x2, y2] = pt(i * 6, R + (big ? 11 : 7)); return html`<line key=${i} x1=${x1} y1=${y1} x2=${x2} y2=${y2} class=${'dl-tick ' + (big ? 'big' : '')} />`; })}
    <line x1=${C} y1=${C} x2=${hx} y2=${hy} class="dl-hand" />
    <circle cx=${C} cy=${C} r="7" class="dl-hub" />
  </svg></div>`;
}

/* ---------- statistics: heatmap + day/week/month/year chart ---------- */
const dur = (b) => Math.max(0, timeToMin(b.end) - timeToMin(b.start));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function FocusStats({ blocks }) {
  const [unit, setUnit] = useState('day');
  const [cursor, setCursor] = useState(() => todayStr());
  const focus = useMemo(() => blocks.filter((b) => b.kind === 'focus'), [blocks]);
  const perDay = useMemo(() => { const m = new Map(); focus.forEach((b) => m.set(b.date, (m.get(b.date) || 0) + dur(b))); return m; }, [focus]);
  const today = todayStr();
  const streak = useMemo(() => { let n = 0; let d = today; if (!perDay.get(d)) d = addDays(d, -1); while (perDay.get(d) && n < 1000) { n++; d = addDays(d, -1); } return n; }, [perDay]);
  // heatmap: last 30 weeks, Sunday first
  const weeks = 30;
  const grid = useMemo(() => {
    const t = new Date(today + 'T00:00:00'); const sunday = addDays(today, -t.getDay()); const first = addDays(sunday, -(weeks - 1) * 7);
    const cols = []; const months = [];
    for (let w = 0; w < weeks; w++) { const col = []; for (let d = 0; d < 7; d++) { const date = addDays(first, w * 7 + d); const m = perDay.get(date) || 0; col.push({ date, m, future: date > today, lvl: !m ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4 }); } cols.push(col); const dd = new Date(col[0].date + 'T00:00:00'); const prev = w ? new Date(cols[w - 1][0].date + 'T00:00:00') : null; if (!prev || prev.getMonth() !== dd.getMonth() || (w === 0)) { if (!(w === 0 && dd.getDate() > 21)) months.push({ w, label: (dd.getMonth() + 1) + '月' }); } }
    return { cols, months };
  }, [perDay]);
  // period data
  const cur = new Date(cursor + 'T00:00:00');
  const period = useMemo(() => {
    const sum = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) n += perDay.get(d) || 0; return n; };
    if (unit === 'day') {
      const buckets = Array(24).fill(0); focus.filter((b) => b.date === cursor).forEach((b) => { const a = timeToMin(b.start), e = timeToMin(b.end); for (let h = 0; h < 24; h++) buckets[h] += Math.max(0, Math.min(e, (h + 1) * 60) - Math.max(a, h * 60)); });
      return { title: (cursor === today ? '今天 ' : cursor === addDays(today, -1) ? '昨天 ' : '') + (cur.getMonth() + 1) + '月' + cur.getDate() + '日', total: buckets.reduce((a, b) => a + b, 0), bars: buckets, labels: [[0, '00:00'], [6, '06:00'], [12, '12:00'], [18, '18:00']], unitMax: 60 };
    }
    if (unit === 'week') {
      const mon = addDays(cursor, -((cur.getDay() + 6) % 7)); const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
      return { title: `${mon.slice(5).replace('-', '/')} – ${days[6].slice(5).replace('-', '/')}`, total: sum(mon, days[6]), bars: days.map((d) => perDay.get(d) || 0), labels: days.map((d, i) => [i, '一二三四五六日'[i]]), unitMax: 0 };
    }
    if (unit === 'month') {
      const y = cur.getFullYear(), m = cur.getMonth(); const n = new Date(y, m + 1, 0).getDate(); const days = Array.from({ length: n }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
      return { title: `${y}年${m + 1}月`, total: sum(days[0], days[n - 1]), bars: days.map((d) => perDay.get(d) || 0), labels: [0, 9, 19, n - 1].map((i) => [i, String(i + 1)]), unitMax: 0 };
    }
    const y = cur.getFullYear(); const bars = Array(12).fill(0); for (const [d, m] of perDay) if (d.startsWith(y + '-')) bars[+d.slice(5, 7) - 1] += m;
    return { title: `${y}年`, total: bars.reduce((a, b) => a + b, 0), bars, labels: [0, 3, 6, 9].map((i) => [i, (i + 1) + '月']), unitMax: 0 };
  }, [unit, cursor, perDay, focus]);
  const step = (dir) => { if (unit === 'day') setCursor(addDays(cursor, dir)); else if (unit === 'week') setCursor(addDays(cursor, 7 * dir)); else if (unit === 'month') { const d = new Date(cur.getFullYear(), cur.getMonth() + dir, 1); setCursor(todayStr(d)); } else setCursor(todayStr(new Date(cur.getFullYear() + dir, 0, 1))); };
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60 ? m % 60 + ' 分' : ''}`.trim() : `${m} 分钟`);
  const max = Math.max(period.unitMax || 0, ...period.bars, 1); const yMax = period.unitMax ? period.unitMax : Math.ceil(max / 60) * 60;
  const W = 600, H = 150, padL = 4, padR = 34, padT = 10, padB = 24; const bw = (W - padL - padR) / period.bars.length;
  const yOf = (v) => padT + (H - padT - padB) * (1 - v / yMax);
  return html`<${Card} class="fstats">
    <div class="fs-left">
    <div class="fs-nums"><div><b>${focus.length}</b><small>次</small></div><div><b>${perDay.size}</b><small>天</small></div><div><b class=${streak ? '' : 'muted'}>${streak} 天</b><small>连续专注</small></div></div>
    <div class="heat">
      <div class="heat-months">${grid.months.map((m) => html`<span key=${m.w} style=${`left:calc(${m.w} * (100% / ${weeks}))`}>${m.label}</span>`)}</div>
      <div class="heat-body"><div class="heat-wd">${WD.map((d) => html`<span key=${d}>${d}</span>`)}</div>
        <div class="heat-grid" style=${`grid-template-columns:repeat(${weeks},1fr)`}>${grid.cols.map((col, w) => html`<div class="heat-col" key=${w}>${col.map((c) => html`<i key=${c.date} class=${'l' + c.lvl + (c.future ? ' fut' : '') + (c.date === cursor && unit === 'day' ? ' sel' : '')} title=${`${c.date} · ${c.m} 分钟`} onClick=${() => { if (!c.future) { setUnit('day'); setCursor(c.date); } }}></i>`)}</div>`)}</div>
      </div>
    </div>
    </div>
    <div class="fs-right">
    <div class="fs-seg"><${Seg} options=${[{ v: 'day', label: '天' }, { v: 'week', label: '周' }, { v: 'month', label: '月' }, { v: 'year', label: '年' }]} value=${unit} onChange=${setUnit} /></div>
    <div class="fs-head">
      <button class="fs-nav" onClick=${() => step(-1)}><${Icon} name="left" size=${16} /></button>
      <div class="fs-title"><small>${period.title}${cursor !== today && html` <button class="fs-today" onClick=${() => setCursor(today)}>回到今天</button>`}</small><b>${fmtMin(period.total)}</b></div>
      <button class="fs-nav" disabled=${cursor >= today} onClick=${() => step(1)}><${Icon} name="right" size=${16} /></button>
    </div>
    <svg class="fs-chart" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none">
      ${[0, .25, .5, .75, 1].map((f) => html`<line key=${f} x1=${padL} x2=${W - padR} y1=${yOf(yMax * f)} y2=${yOf(yMax * f)} class="gl" />`)}
      ${period.labels.map(([i, l]) => html`<line key=${'v' + i} x1=${padL + i * bw} x2=${padL + i * bw} y1=${padT} y2=${H - padB} class="gl v" />`)}
      ${period.bars.map((v, i) => v > 0 && html`<rect key=${i} x=${padL + i * bw + bw * 0.15} width=${bw * 0.7} y=${yOf(v)} height=${Math.max(2, yOf(0) - yOf(v))} rx=${Math.min(3, bw * 0.3)} class="bar" />`)}
      <text x=${W - padR + 6} y=${yOf(yMax) + 4} class="ax">${yMax >= 60 ? (yMax / 60) + 'h' : yMax + 'm'}</text>
      <text x=${W - padR + 6} y=${yOf(0) + 4} class="ax">0</text>
      ${period.labels.map(([i, l]) => html`<text key=${'t' + i} x=${padL + i * bw + (unit === 'day' ? 0 : bw / 2)} y=${H - 6} class=${'ax ' + (unit === 'day' ? '' : 'mid')}>${l}</text>`)}
    </svg>
    </div>
  <//>`;
}

export function MiniPomo() {
  const st = usePomo();
  if (st.phase === 'idle') return null;
  const rem = pomo.remaining();
  return html`<a class=${'mini-pomo ' + st.phase + (st.paused ? ' paused' : '')} href="#/focus" title="打开专注">
    <span class="mp-time">${pomo.fmt(rem)}</span>
    <span class="mp-label nl">${st.phase === 'break' ? '休息中' : st.label || '专注中'}</span>
    <button class="ibtn nl" onClick=${(e) => { e.preventDefault(); st.paused ? pomo.resume() : pomo.pause(); }} title=${st.paused ? '继续' : '暂停'}><${Icon} name=${st.paused ? 'play' : 'pause'} size=${13} /></button>
  </a>`;
}
