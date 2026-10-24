import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact.js';
import { useStore, update, upsert, toggleTodo, removeUndo } from '../store.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt } from '../confirm.js';
import { uid } from '../util.js';


import { Icon, Card, Btn, Seg, Empty, Tag, Select } from '../ui.js';
import { todayStr, sortBy, timeToMin, kindColor, addDays, pad, PRIORITY } from '../util.js';
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
  const all = s.sessions || [];
  const sessions = useMemo(() => sortBy(all.filter((b) => b.date === today), 'start'), [all]);
  const mins = sessions.reduce((n, b) => n + (b.mins || 0), 0);
  useEffect(() => { document.title = st.phase === 'idle' ? '专注 · yunningtang OS' : `${pomo.fmt(rem)} · ${st.phase === 'break' ? '休息' : st.label || '专注'}`; return () => { document.title = 'yunningtang OS'; }; }, [rem, st.phase]);
  const focusedOn = useMemo(() => { const m = new Map(); sessions.forEach((b) => { if (b.todo) m.set(b.todo, (m.get(b.todo) || 0) + (b.mins || 0)); }); return m; }, [sessions]);
  const sessMenu = (e, b) => ctxMenu(e, [
    { label: b.note ? '编辑备注' : '添加备注', icon: 'edit', onClick: async () => { const v = await askPrompt('这一段做了什么、感觉如何？', b.note || '', { title: '备注' }); if (v != null) upsert('sessions', { id: b.id, note: v.trim(), updated: new Date().toISOString() }); } },
    { label: '改名', icon: 'tag', onClick: async () => { const v = await askPrompt('名称', b.title || '', { title: '这一段专注' }); if (v != null && v.trim()) upsert('sessions', { id: b.id, title: v.trim(), updated: new Date().toISOString() }); } },
    'sep',
    { label: '删除这一段', icon: 'trash', danger: true, onClick: () => removeUndo('sessions', b.id, b.title || '专注') },
  ], `${b.start}–${b.end}`);
  const lenMenu = (e, t) => ctxMenu(e, [...LENS.map((n) => ({ label: `${n} 分钟`, icon: (t.focusLen || 25) === n ? 'check' : 'clock', onClick: () => upsert('todos', { id: t.id, focusLen: n }) })), 'sep', { label: '自定义…', icon: 'edit', onClick: async () => { const v = parseInt(await askPrompt('分钟数', String(t.focusLen || 25), { title: '专注时长' }), 10); if (v >= 5 && v <= 180) upsert('todos', { id: t.id, focusLen: v }); } }], t.title);
  const dayFrom = 6, dayTo = 24;
  const posOf = (t) => Math.max(0, Math.min(100, ((timeToMin(t) - dayFrom * 60) / ((dayTo - dayFrom) * 60)) * 100));

  return html`<div class="dash3 focus-grid">
    <div class="widget span-1"><${PomoCard} full initialTodo=${route.query && route.query.todo} /></div>
    <div class="widget span-1">
      <${Card} title="今天的专注" sub=${sessions.length ? `${sessions.length} 段 · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '还没有记录'} action=${html`<a class="more" href="#/plan/day">时间线<${Icon} name="right" size=${12} /></a>`}>
        <${GoalRow} mins=${mins} goal=${s.settings.focusGoal || 120} />
        <div class="day-strip">
          ${[6, 9, 12, 15, 18, 21, 24].map((h) => html`<span class="ds-h" key=${h} style=${`left:${posOf(String(h).padStart(2, '0') + ':00')}%`}>${h}</span>`)}
          ${sessions.map((b) => html`<i key=${b.id} class="ds-b" style=${`left:${posOf(b.start)}%;width:${Math.max(1.2, posOf(b.end) - posOf(b.start))}%`} title=${`${b.title} ${b.start}–${b.end}`}></i>`)}
          ${st.phase === 'work' && html`<i class="ds-b live" style=${`left:${posOf(new Date(st.startedAt).toTimeString().slice(0, 5))}%;width:${Math.max(1.2, ((st.workLen - rem / 60) / ((dayTo - dayFrom) * 60)) * 100)}%`}></i>`}
        </div>
        ${sessions.length > 0 && html`<div class="sec-h" style="margin-top:14px">已完成 <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">右键可备注或删除</span></div><div class="sess-list">${[...sessions].reverse().slice(0, 8).map((b) => html`<div class="sess" key=${b.id} onContextMenu=${(e) => sessMenu(e, b)}><i></i><span class="sess-t">${b.start}–${b.end}</span><span class="sess-n">${b.title || '专注'}${b.note && html`<small class="sess-note">${b.note}</small>`}</span><span class="sess-m">${b.mins} 分</span><span class="sess-acts"><button class="ibtn" title="备注" onClick=${(e) => sessMenu(e, b)}><${Icon} name="dots" size=${13} /></button></span></div>`)}</div>`}
      <//>
    </div>
    <div class="widget span-1">
      <${Card} title="今天的待办" sub="点 ▶ 用右边的时长开始专注" action=${html`<a class="more" href="#/todos">全部待办<${Icon} name="right" size=${12} /></a>`}>
        ${todos.length === 0 ? html`<${Empty} icon="checksq" text="今天没有待办。"><${Btn} small onClick=${() => go('todos')}>去添加<//><//>` : html`<div class="tlist">${todos.slice(0, 8).map((t) => { const spent = focusedOn.get(t.id) || 0; const live = st.phase === 'work' && st.todoId === t.id; return html`<div class=${'fp-i p' + t.priority + ' ' + (live ? 'live' : '')} key=${t.id} style=${`--pc:${(PRIORITY[t.priority] || PRIORITY[2]).color}`} onContextMenu=${(e) => lenMenu(e, t)}>
          <button class="cb" title="标为完成" onClick=${() => toggleTodo(t.id)}><${Icon} name="check" size=${12} /></button>
          <span class="fp-t">${t.title}${spent > 0 && html`<small class="fp-spent">已专注 ${spent} 分</small>`}</span>
          ${t.time && html`<small class="muted">${t.time}</small>`}
          <button class="fp-len" title="专注时长（点击修改）" onClick=${(e) => lenMenu(e, t)}>${t.focusLen || 25}<i>分</i></button>
          <button class="fp-go" title="开始这一项" disabled=${st.phase !== 'idle'} onClick=${() => { const w = t.focusLen || 25; pomo.start({ label: t.title, todoId: t.id, workLen: w, breakLen: Math.max(3, Math.round(w / 5)) }); }}><${Icon} name="play" size=${12} /></button>
        </div>`; })}</div>`}
      <//>
    </div>
    <div class="widget span-3"><${FocusStats} sessions=${all} /></div>
  </div>`;
}

/* ---------- daily goal ---------- */
const LENS = [15, 25, 45, 50, 90];
function GoalRow({ mins, goal }) {
  const edit = async () => { const v = await askPrompt('每天想专注多久？按小时填，比如 2 或 2.5', String(goal / 60), { title: '今日目标' }); const h = parseFloat(v); if (v != null && h > 0 && h <= 16) update((d) => { d.settings.focusGoal = Math.round(h * 60); }); };
  const pct = Math.min(100, Math.round((mins / goal) * 100));
  return html`<div class="goal-row">
    <button class="goal-lbl" title="点击修改目标" onClick=${edit}><small>目标</small><b>${goal % 60 ? (goal / 60).toFixed(1) : goal / 60}h</b><${Icon} name="edit" size=${11} /></button>
    <div class="prog flex1"><i style=${`width:${pct}%`}></i></div>
    <span class=${'goal-pct ' + (pct >= 100 ? 'done' : '')}>${pct}%</span>
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
  const endAt = (w) => hhmm(new Date(Date.now() + w * 60000));
  return html`<${Card} class=${'focus-w ' + pst.phase + (pst.paused ? ' paused' : '') + (full ? ' full' : '')} pad=${false}>
    <div class="fw-hero">
      <div class="fw-top"><span class="fh-k">${pst.phase === 'idle' ? '专注' : pst.phase === 'break' ? '休息一下' : pst.paused ? '已暂停' : '专注中'}</span>${full ? html`${pst.phase === 'idle' && html`<button class="fw-lens" title="点击修改休息时长" onClick=${(e) => ctxMenu(e, [...[3, 5, 10, 15, 20].map((n) => ({ label: `休息 ${n} 分钟`, icon: pst.breakLen === n ? 'check' : 'clock', onClick: () => pomo.setLens(pst.workLen, n) })), 'sep', { label: '自定义…', icon: 'edit', onClick: async () => { const v = parseInt(await askPrompt('休息几分钟？', String(pst.breakLen), { title: '休息时长' }), 10); if (v >= 1 && v <= 60) pomo.setLens(pst.workLen, v); } }], '休息时长')}>${pst.workLen} 分钟 · 休息 ${pst.breakLen} 分钟 <${Icon} name="down" size=${10} /></button>`}` : html`<a class="ibtn" href="#/focus" title="打开专注页"><${Icon} name="right" size=${15} /></a>`}</div>
      <${Dial} rem=${rem} phase=${pst.phase} full=${full} />
      <div class="pomo-t"><div class="pomo-time">${pomo.fmt(rem)}</div><div class="pomo-sub">${pst.phase === 'idle' ? html`${pst.workLen} 分钟` : pst.phase === 'break' ? '休息' : (pst.label || '专注')}<${Span} rem=${rem} /></div></div>
      ${pst.phase === 'idle' ? html`
        <form class="fw-start" onSubmit=${(e) => { e.preventDefault(); begin(); }}>
          <input type="text" value=${label} placeholder="这一轮要做什么？" onInput=${(e) => setLabel(e.target.value)} />
          <button type="submit" class="fw-go" title="开始专注"><${Icon} name="play" size=${14} /> 开始</button>
        </form>
        <div class="chips fw-chips">${presets.map(([w, b]) => html`<button key=${w} type="button" class=${'chip ' + (pst.workLen === w && !customLen ? 'on' : '')} title=${`${w} 分钟 · 到 ${endAt(w)}`} onClick=${() => { setCustomLen(false); pomo.setLens(w, b); }}>${w}<i>分</i></button>`)}${full && (customLen ? html`<input class="chip-in" type="number" min="5" max="180" value=${pst.workLen} autofocus onBlur=${() => { if (presets.some(([w]) => w === pst.workLen)) setCustomLen(false); }} onInput=${(e) => { const w = Math.max(5, Math.min(180, +e.target.value || 25)); pomo.setLens(w, Math.max(3, Math.round(w / 5))); }} />` : html`<button type="button" class=${'chip ' + (presets.every(([w]) => w !== pst.workLen) ? 'on' : '')} title="输入任意分钟数" onClick=${() => setCustomLen(true)}>${presets.every(([w]) => w !== pst.workLen) ? `${pst.workLen}分` : '自定义'}</button>`)}</div>`
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
function Span({ rem }) { useTick(15000); const now = new Date(); return html`<span class="pomo-span"><i>·</i>${hhmm(now)} → ${hhmm(new Date(now.getTime() + rem * 1000))}</span>`; }
function Dial({ rem, phase, full }) {
  useTick(1000);
  const secDelay = useRef(-((Date.now() / 1000) % 60)); // fixed at mount so the sweep is not restarted on every render
  const [drag, setDrag] = useState(null); // minutes while dragging the sector (idle only)
  const [tilt, setTilt] = useState(null); // [rx, ry] from the pointer, for the 3D lean
  const ref = useRef();
  const C = 140, R = 104, PIE_R = R / 2;
  const nowA = ((Date.now() / 60000) % 60) * 6;
  const mins = drag != null ? drag : rem / 60;
  const span = Math.min(360, mins * 6);
  const circ = 2 * Math.PI * PIE_R;
  const idle = phase === 'idle';
  const angleAt = (e) => { const r = ref.current.getBoundingClientRect(); const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2); return ((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360; };
  const minsAt = (e) => { let d = (angleAt(e) - nowA + 360) % 360; let m = Math.round(d / 6 / 5) * 5; if (m === 0) m = 60; return Math.max(5, Math.min(60, m)); };
  const down = (e) => { if (!idle || e.button) return; e.preventDefault(); ref.current.setPointerCapture(e.pointerId); setDrag(minsAt(e)); };
  const move = (e) => {
    if (drag != null) { setDrag(minsAt(e)); return; }
    const r = ref.current.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; setTilt([-y * 14, x * 14]);
  };
  const up = (e) => { if (drag == null) return; const m = drag; setDrag(null); pomo.setLens(m, Math.max(3, Math.round(m / 5))); };
  const leave = () => setTilt(null);
  const wheel = (e) => { if (!idle) return; e.preventDefault(); const cur = pomo.get().workLen; const m = Math.max(5, Math.min(180, cur + (e.deltaY < 0 ? 5 : -5))); pomo.setLens(m, Math.max(3, Math.round(m / 5))); };
  const style = tilt ? `transform:perspective(600px) rotateX(${tilt[0]}deg) rotateY(${tilt[1]}deg)` : '';
  const pt = (a, r) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
  const uid = full ? 'f' : 'w';
  return html`<div class=${'dial3 ' + phase + (drag != null ? ' turning' : '') + (idle ? ' idle' : '')} ref=${ref} style=${style} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onPointerLeave=${leave} onWheel=${wheel} title=${idle ? '拖动表盘或滚轮设置时长' : ''}>
    <svg viewBox="0 0 280 280">
      <defs>
        <radialGradient id=${'rim' + uid} cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="var(--d-rim1)" /><stop offset="1" stop-color="var(--d-rim2)" /></radialGradient>
        <radialGradient id=${'face' + uid} cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="var(--d-face1)" /><stop offset="1" stop-color="var(--d-face2)" /></radialGradient>
        <linearGradient id=${'pie' + uid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pg1)" /><stop offset="1" stop-color="var(--pg2)" /></linearGradient>
        <linearGradient id=${'gloss' + uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></linearGradient>
        <linearGradient id=${'hand' + uid} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--pg1)" /><stop offset="1" stop-color="var(--pg2)" /></linearGradient>
        <filter id=${'soft' + uid} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" /></filter>
      </defs>
      <circle cx=${C} cy=${C} r=${R + 22} class="d3-shadow" />
      <circle cx=${C} cy=${C} r=${R + 18} fill=${'url(#rim' + uid + ')'} class="d3-rim" />
      <circle cx=${C} cy=${C} r=${R + 8} class="d3-groove" />
      <circle cx=${C} cy=${C} r=${R + 4} fill=${'url(#face' + uid + ')'} class="d3-face" />
      <g class="d3-pie" style=${`transform:rotate(${nowA}deg);transform-origin:${C}px ${C}px`}>
        <circle cx=${C} cy=${C} r=${PIE_R} fill="none" stroke=${'url(#pie' + uid + ')'} stroke-width=${R} stroke-dasharray=${`${circ * span / 360} ${circ}`} class="d3-pie-c" style=${`transform:rotate(-90deg);transform-origin:${C}px ${C}px`} />
      </g>
      ${Array.from({ length: 60 }, (_, i) => { const big = i % 5 === 0; const [x1, y1] = pt(i * 6, R - 2), [x2, y2] = pt(i * 6, R - (big ? 12 : 7)); return html`<line key=${i} x1=${x1} y1=${y1} x2=${x2} y2=${y2} class=${'d3-tick ' + (big ? 'big' : '')} />`; })}
      ${[15, 30, 45, 60].map((n) => { const [x, y] = pt(n * 6, R - 24); return html`<text key=${n} x=${x} y=${y + 4} class="d3-num">${n}</text>`; })}
      <ellipse cx=${C} cy=${C - R * 0.45} rx=${R * 0.78} ry=${R * 0.42} fill=${'url(#gloss' + uid + ')'} class="d3-gloss" />
      <g class="d3-hour" style=${`transform:rotate(${((new Date().getHours() % 12) + new Date().getMinutes() / 60) * 30}deg);transform-origin:${C}px ${C}px`}><path d=${`M${C - 5},${C + 12} L${C - 3.5},${C - R * 0.52} L${C + 3.5},${C - R * 0.52} L${C + 5},${C + 12} Z`} class="d3-hour-p" /></g>
      <g class="d3-hand" style=${`transform:rotate(${nowA}deg);transform-origin:${C}px ${C}px`}>
        <path d=${`M${C - 5},${C + 16} L${C - 3},${C - R + 16} L${C + 3},${C - R + 16} L${C + 5},${C + 16} Z`} class="d3-hand-sh" filter=${'url(#soft' + uid + ')'} />
        <path d=${`M${C - 5},${C + 16} L${C - 3},${C - R + 16} L${C + 3},${C - R + 16} L${C + 5},${C + 16} Z`} class="d3-hand-p" />
        <path d=${`M${C - 1.2},${C} L${C - 1.2},${C - R + 22} L${C + 1.2},${C - R + 22} L${C + 1.2},${C} Z`} class="d3-hand-core" />
      </g>
      <g class=${'d3-sec ' + (phase !== 'idle' && pomo.get().paused ? 'paused' : '')} style=${`transform-origin:${C}px ${C}px;animation-delay:${secDelay.current.toFixed(2)}s`}><line x1=${C} y1=${C + 18} x2=${C} y2=${C - R + 10} class="d3-sec-l" /><circle cx=${C} cy=${C + 18} r="3" class="d3-sec-t" /></g>
      <circle cx=${C} cy=${C} r="10" class="d3-hub" /><circle cx=${C} cy=${C} r="4" class="d3-hub-in" />
    </svg>
    ${drag != null && html`<div class="d3-bubble">${drag} 分钟</div>`}
  </div>`;
}

/* ---------- statistics: heatmap + day/week/month/year chart ---------- */
const dur = (b) => b.mins || Math.max(0, timeToMin(b.end) - timeToMin(b.start));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function FocusStats({ sessions }) {
  const [unit, setUnit] = useState('day');
  const [cursor, setCursor] = useState(() => todayStr());
  const focus = sessions;
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
  const menu = (e) => ctxMenu(e, [
    { label: st.paused ? '继续' : '暂停', icon: st.paused ? 'play' : 'pause', onClick: () => (st.paused ? pomo.resume() : pomo.pause()) },
    st.phase === 'work' ? { label: '提前完成并记录', icon: 'check', onClick: () => pomo.stop(true) } : { label: '跳过休息', icon: 'right', onClick: () => pomo.skip() },
    { label: '打开专注页', icon: 'clock', onClick: () => go('focus') },
    'sep',
    { label: '取消这一轮', icon: 'x', danger: true, onClick: () => pomo.stop(false) },
  ], st.label || '专注');
  return html`<a class=${'mini-pomo ' + st.phase + (st.paused ? ' paused' : '')} href="#/focus" title="打开专注 · 右键可取消" onContextMenu=${menu}>
    <span class="mp-time">${pomo.fmt(rem)}</span>
    <span class="mp-label nl">${st.phase === 'break' ? '休息中' : st.label || '专注中'}</span>
    <button class="ibtn nl" onClick=${(e) => { e.preventDefault(); st.paused ? pomo.resume() : pomo.pause(); }} title=${st.paused ? '继续' : '暂停'}><${Icon} name=${st.paused ? 'play' : 'pause'} size=${13} /></button>
  </a>`;
}
