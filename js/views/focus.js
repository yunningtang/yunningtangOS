import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact.js';
import { useStore, update, upsert, toggleTodo, removeUndo, get } from '../store.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt } from '../confirm.js';
import { uid, lsGet, lsSet } from '../util.js';


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

  const running = st.phase === 'work';
  const [peek, setPeek] = useState(false); useEffect(() => { if (!running) setPeek(false); }, [running]);
  const [hist, setHist] = useState(() => lsGet('ytos.focus.hist', '') === '1');
  const quiet = running && !peek;
  const pick = (t) => { if (st.phase !== 'idle') return; pomo.setLabel(t.title, t.id); pomo.setGoal(t.next || ''); };
  const go1 = (t) => { const w = t.focusLen || st.workLen || 25; pomo.start({ label: t.title, todoId: t.id, goal: t.next || '', workLen: w, breakLen: Math.max(3, Math.round(w / 5)) }); };
  const rowMenu = (e, t) => ctxMenu(e, [{ label: '现在开始', icon: 'play', disabled: st.phase !== 'idle', onClick: () => go1(t) }, { label: '先做 2 分钟', icon: 'clock', disabled: st.phase !== 'idle', onClick: () => pomo.start({ label: t.title, todoId: t.id, goal: t.next || '', once: 2 }) }, { label: '专注时长', icon: 'clock', sub: LENS.map((n) => ({ label: `${n} 分钟`, icon: (t.focusLen || 25) === n ? 'check' : '', onClick: () => upsert('todos', { id: t.id, focusLen: n }) })) }, 'sep', { label: '标为完成', icon: 'check', onClick: () => toggleTodo(t.id) }, { label: '打开待办', icon: 'external', onClick: () => go('todos?open=' + t.id) }], t.title);
  return html`<div class=${'focus-page2 ' + (quiet ? 'quiet' : '')}>
    ${quiet && html`<div class="fq-bar"><span>专注中 · 其他内容先收起来了</span><button type="button" onClick=${() => setPeek(true)}>看一眼其他内容</button></div>`}
    ${running && peek && html`<div class="fq-bar"><span>正在专注</span><button type="button" onClick=${() => setPeek(false)}>回到专注视图</button></div>`}
    <div class="fp-main">
      <div class="fp-timer"><${PomoCard} full initialTodo=${route.query && route.query.todo} /></div>
      ${!quiet && html`<div class="fp-queue">
        <div class="fq-h"><b>接下来</b><small>${todos.length || ''}</small><a class="more" href="#/todos" title="全部待办"><${Icon} name="right" size=${13} /></a></div>
        ${todos.length === 0 ? html`<div class="fq-empty">今天没有待办。<a href="#/todos">去添加</a></div>` : html`<div class="fq-list">${todos.slice(0, 9).map((t) => { const spent = focusedOn.get(t.id) || 0; const on = st.todoId === t.id; return html`<div key=${t.id} role="button" tabindex="0" class=${'fq-row ' + (on ? 'on' : '')} style=${`--pc:${(PRIORITY.find((p) => p.v === t.priority) || PRIORITY[2]).color}`} onClick=${() => pick(t)} onKeyDown=${(e) => { if (e.key === 'Enter') pick(t); }} onContextMenu=${(e) => rowMenu(e, t)}>
          <i class=${'fq-p p' + (t.priority ?? 2)} title=${(PRIORITY.find((p) => p.v === t.priority) || PRIORITY[2]).name}></i>
          <span class="fq-t"><b>${t.title}</b><small>${t.next ? `下一步：${t.next}` : [t.time, spent ? `已专注 ${spent} 分` : '', `${t.focusLen || 25} 分钟`].filter(Boolean).join(' · ')}</small></span>
          <button type="button" class="fq-go" title=${`开始 · ${t.focusLen || 25} 分钟`} disabled=${st.phase !== 'idle'} onClick=${(e) => { e.stopPropagation(); go1(t); }}><${Icon} name="play" size=${12} /></button>
        </div>`; })}</div>`}
        <form class="fq-add" onSubmit=${(e) => { e.preventDefault(); const v = e.target.elements.q.value.trim(); if (!v) return; const t = { id: uid(), title: v, done: false, priority: 2, due: today, time: '', tags: [], area: '', note: '', created: today, steps: [] }; upsert('todos', t); e.target.reset(); pick(t); }}><${Icon} name="plus" size=${13} /><input name="q" placeholder="加一件今天要做的事" autocomplete="off" /></form>
      </div>`}
    </div>
    ${!quiet && html`<div class="fp-today">
      <div class="fq-h"><b>今天</b><small>${sessions.length ? `${sessions.length} 段 · ${Math.floor(mins / 60) ? Math.floor(mins / 60) + ' 小时 ' : ''}${mins % 60} 分钟` : '还没有专注记录，开始第一轮吧'}</small>${s.settings.focusGoal ? html`<${GoalRow} mins=${mins} goal=${s.settings.focusGoal} />` : html`<button type="button" class="fq-goal" onClick=${async () => { const v = await askPrompt('每天想专注多久？按小时填，比如 2；留空就不设目标', '', { title: '今日目标（可选）' }); const h = parseFloat(v); if (h > 0 && h <= 16) update((d) => { d.settings.focusGoal = Math.round(h * 60); }); }}>设个目标（可选）</button>`}</div>
      ${sessions.length > 0 && html`<div class="day-strip">
          ${[6, 9, 12, 15, 18, 21, 24].map((h) => html`<span class="ds-h" key=${h} style=${`left:${posOf(String(h).padStart(2, '0') + ':00')}%`}>${h}</span>`)}
          ${sessions.map((b) => html`<i key=${b.id} class="ds-b" style=${`left:${posOf(b.start)}%;width:${Math.max(1.2, posOf(b.end) - posOf(b.start))}%`} title=${`${b.title} ${b.start}–${b.end}`}></i>`)}
        </div>
        <div class="ft-list">${[...sessions].reverse().map((b) => html`<div key=${b.id} class="ft-row" onContextMenu=${(e) => sessMenu(e, b)}><span class="ft-time">${b.start}–${b.end}</span><span class="ft-b"><b>${b.title || '专注'}</b>${(b.note || b.next || b.goal) && html`<small>${[b.note && '做到：' + b.note, b.next && '下一步：' + b.next, !b.note && b.goal && '目标：' + b.goal].filter(Boolean).join(' · ')}</small>`}</span><span class="ft-m">${b.mins} 分</span></div>`)}</div>`}
    </div>
    <div class="fp-hist">
      <button type="button" class="fq-fold" onClick=${() => { const v = !hist; setHist(v); lsSet('ytos.focus.hist', v ? '1' : ''); }}><${Icon} name=${hist ? 'down' : 'right'} size=${12} /> 历史与趋势</button>
      ${hist && html`<${FocusStats} sessions=${all} />`}
    </div>`}
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
  const [customLen, setCustomLen] = useState(false);
  const [note, setNote] = useState(''); const [next, setNext] = useState('');
  useEffect(() => { if (initialTodo) { const t = s.todos.find((x) => x.id === initialTodo); if (t) { pomo.setLabel(t.title, t.id); pomo.setGoal(t.next || ''); } } }, [initialTodo]);
  useEffect(() => { setNote(''); setNext(''); }, [pst.review && pst.review.sid]);
  const task = pst.todoId ? s.todos.find((t) => t.id === pst.todoId) : null;
  const rem = pomo.remaining();
  const begin = (once) => pomo.start({ label: (pst.label || '').trim(), todoId: pst.todoId, goal: (pst.goal || '').trim(), ...(once ? { once } : {}) });
  const presets = full ? [[5, 2], [15, 3], [25, 5], [45, 10]] : [[15, 3], [25, 5], [45, 10]];
  const custom = !presets.some(([w]) => w === pst.workLen);
  const endAt = (w) => hhmm(new Date(Date.now() + w * 60000));
  const breakMenu = (e) => ctxMenu(e, [...[3, 5, 10, 15, 20].map((n) => ({ label: `休息 ${n} 分钟`, icon: pst.breakLen === n ? 'check' : 'clock', onClick: () => pomo.setLens(pst.workLen, n) })), 'sep', { label: '自定义…', icon: 'edit', onClick: async () => { const v = parseInt(await askPrompt('休息几分钟？', String(pst.breakLen), { title: '休息时长' }), 10); if (v >= 1 && v <= 60) pomo.setLens(pst.workLen, v); } }], '休息时长');
  const tint = s.settings.pomoColor || 'blue';
  const rv = pst.review;
  const sub = pst.phase === 'idle' ? html`${pst.workLen} 分钟<${Span} rem=${rem} />${full ? html`<button type="button" class="tt-break" title="休息时长" onClick=${breakMenu}>· 休息 ${pst.breakLen} 分</button>` : ''}`
    : pst.phase === 'break' ? html`休息一下<${Span} rem=${rem} />` : html`${pst.paused ? '已暂停' : '专注中'}<${Span} rem=${rem} />`;
  const save = (after) => { pomo.checkpoint({ note, next, done: after === 'done' }); if (after === 'again') { pomo.skip(); setTimeout(() => pomo.start({ label: rv.label, todoId: rv.todoId, goal: next.trim() }), 0); } };
  // ---- 检查点：一轮结束后问两句，写回这件事；计时结束 ≠ 任务完成 ----
  const review = rv && full && html`<div class="tt-info tt-cp">
    <div class="cp-k">这一轮 ${rv.mins} 分钟${rv.label ? html` · <b>${rv.label}</b>` : ''}</div>
    ${rv.goal && html`<div class="cp-goal">本来想推进：${rv.goal}</div>`}
    <label class="cp-f"><span>做到哪了？</span><textarea rows="2" value=${note} placeholder="一句话就行，比如：方法部分写完前两段" onInput=${(e) => setNote(e.target.value)}></textarea></label>
    <label class="cp-f"><span>下一步是什么？</span><input type="text" value=${next} placeholder="下次打开就从这里接着做" onInput=${(e) => setNext(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') save('break'); }} /></label>
    <div class="tt-acts cp-acts">
      <button type="button" class="tt-go" onClick=${() => save('again')}><${Icon} name="play" size=${14} /> 记下，再来一轮</button>
      <button type="button" class="tt-chip" onClick=${() => save('break')}>记下，先休息</button>
      ${rv.todoId && html`<button type="button" class="tt-chip" title="把这件待办标为完成" onClick=${() => save('done')}><${Icon} name="check" size=${13} /> 这件事做完了</button>`}
    </div>
    <button type="button" class="cp-skip" onClick=${() => pomo.dismissReview()}>这次不记</button>
  </div>`;
  // ---- 准备：选一件事、写一句这轮最小目标（可选）、选时长 ----
  const prep = full && html`<div class="tt-prep">
    ${task ? html`<div class="tp-task"><span class="tp-k">现在做</span><b>${task.title}</b><button type="button" class="ibtn" title="不绑定待办" onClick=${() => { pomo.setLabel('', ''); pomo.setGoal(''); }}><${Icon} name="x" size=${13} /></button></div>
      ${(task.lastNote || task.next) && html`<div class="tp-resume">${task.lastNote && html`<span>上次停在：${task.lastNote}</span>`}${task.next && html`<span>下一步：${task.next}</span>`}</div>`}`
    : html`<input class="tt-label" type="text" value=${pst.label || ''} placeholder="这一轮推进什么？也可以从右边点一件待办" onInput=${(e) => pomo.setLabel(e.target.value, '')} onKeyDown=${(e) => { if (e.key === 'Enter') begin(); }} />`}
    <input class="tt-label tt-goal" type="text" value=${pst.goal || ''} placeholder="这轮最小目标（可选）：比如先列三个要点" onInput=${(e) => pomo.setGoal(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') begin(); }} />
  </div>`;
  return html`<${Card} class=${'focus-w tt-card tc-' + tint + ' ' + pst.phase + (pst.paused ? ' paused' : '') + (full ? ' full' : '') + (rv && full ? ' reviewing' : '')} pad=${false}>
    <div class="fw-hero">
      ${!full && html`<div class="fw-top"><span class="fh-k">专注</span><a class="ibtn" href="#/focus" title="打开专注页"><${Icon} name="right" size=${15} /></a></div>`}
      <${Dial} rem=${rem} phase=${pst.phase} full=${full} />
      ${review || html`<div class="tt-info">
        ${full && pst.phase !== 'idle' && html`<div class="tt-now">${pst.phase === 'break' ? '休息' : (pst.label || '专注')}${pst.phase === 'work' && pst.goal && html`<small>这轮：${pst.goal}</small>`}</div>`}
        <div class="tt-time">${pomo.fmt(rem)}</div>
        <div class="tt-sub">${sub}</div>
        ${!full && rv && html`<a class="tt-cp-link" href="#/focus">记一下这轮做到哪了 →</a>`}
        ${pst.phase === 'idle' ? html`
          ${prep}
          <div class="tt-chips">${presets.map(([w, b]) => html`<button key=${w} type="button" class=${'tt-chip ' + (pst.workLen === w && !customLen ? 'on' : '')} title=${`${w} 分钟 · 到 ${endAt(w)}`} onClick=${() => { setCustomLen(false); pomo.setLens(w, b); }}>${w} 分</button>`)}${full && (customLen ? html`<input class="tt-chip tt-chip-in" type="number" min="1" max="180" value=${pst.workLen} autofocus onBlur=${() => setCustomLen(false)} onInput=${(e) => { const w = Math.max(1, Math.min(180, +e.target.value || 25)); pomo.setLens(w, Math.max(2, Math.round(w / 5))); }} />` : html`<button type="button" class=${'tt-chip ' + (custom ? 'on' : '')} title="输入任意分钟数" onClick=${() => setCustomLen(true)}>${custom ? `${pst.workLen} 分` : '自定义'}</button>`)}</div>
          <div class="tt-acts">
            <button type="button" class="tt-go" onClick=${() => begin()}><${Icon} name="play" size=${15} /> 开始专注</button>
            ${full ? html`<button type="button" class="tt-chip tt-two" title="不想开始的时候，先只做 2 分钟；到点可以停，也可以接着做" onClick=${() => begin(2)}>先做 2 分钟</button>` : html`<button type="button" class="tt-round" title="恢复 25 分钟" onClick=${() => { setCustomLen(false); pomo.setLens(25, 5); }}><${Icon} name="refresh" size=${16} /></button>`}
          </div>`
        : html`<div class="tt-acts">
            <button type="button" class="tt-go" onClick=${() => (pst.paused ? pomo.resume() : pomo.pause())}><${Icon} name=${pst.paused ? 'play' : 'pause'} size=${15} /> ${pst.paused ? '继续' : '暂停'}</button>
            ${pst.phase === 'work' ? html`<button type="button" class="tt-round" title="这轮先到这，记一下" onClick=${() => pomo.stop(true)}><${Icon} name="check" size=${16} /></button>` : html`<button type="button" class="tt-round" title="跳过休息" onClick=${() => pomo.skip()}><${Icon} name="right" size=${16} /></button>`}
            <button type="button" class="tt-round" title="放弃这一轮（不记录）" onClick=${() => pomo.stop(false)}><${Icon} name="x" size=${16} /></button>
          </div>`}
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
  const [drag, setDrag] = useState(null); // 拖表盘设时长（只在没开始时）
  const ref = useRef();
  const C = 140, RIM = 134, FACE = 117, SEC = 76; // 外圈 / 表盘 / 番茄扇形半径
  const idle = phase === 'idle';
  const mins = drag != null ? drag : rem / 60;
  const span = Math.max(0, Math.min(359.99, mins * 6)); // 0 在正上方，顺时针是剩余时间
  const pt = (a, r) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
  const angleAt = (e) => { const r = ref.current.getBoundingClientRect(); const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2); return ((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360; };
  const minsAt = (e) => { let m = Math.round(angleAt(e) / 6 / 5) * 5; if (m === 0) m = 60; return Math.max(5, Math.min(60, m)); };
  const down = (e) => { if (!idle || e.button) return; e.preventDefault(); ref.current.setPointerCapture(e.pointerId); setDrag(minsAt(e)); };
  const move = (e) => { if (drag != null) setDrag(minsAt(e)); };
  const up = () => { if (drag == null) return; const m = drag; setDrag(null); pomo.setLens(m, Math.max(3, Math.round(m / 5))); };
  const wheel = (e) => { if (!idle) return; e.preventDefault(); const cur = pomo.get().workLen; const m = Math.max(5, Math.min(180, cur + (e.deltaY < 0 ? 5 : -5))); pomo.setLens(m, Math.max(3, Math.round(m / 5))); };
  const [ex, ey] = pt(span, SEC); const large = span > 180 ? 1 : 0;
  const sector = span <= 0 ? '' : `M${C},${C} L${C},${C - SEC} A${SEC},${SEC} 0 ${large} 1 ${ex.toFixed(2)},${ey.toFixed(2)} Z`;
  const running = !idle && !pomo.get().paused;
  const secA = idle ? 0 : ((60 - (Math.ceil(rem) % 60)) % 60) * 6; // 秒针：开始后每秒走一格
  const id = full ? 'f' : 'w';
  const colorMenu = (e) => { const cur = get().settings.pomoColor || 'blue'; ctxMenu(e, [['blue', '蓝', '#2383e2'], ['tomato', '番茄红', '#e4513b'], ['ink', '墨', '#37352f'], ['teal', '青绿', '#2f9e8f']].map(([v, l, c]) => ({ label: l, color: c, icon: cur === v ? 'check' : '', onClick: () => update((d) => { d.settings.pomoColor = v; }) })), '扇形颜色'); };
  return html`<div class=${'ttd ' + phase + (drag != null ? ' turning' : '') + (idle ? ' idle' : '')} ref=${ref} onContextMenu=${colorMenu} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} title=${idle ? '拖动表盘或滚轮设置时长' : ''}>
    <svg viewBox="0 0 280 280" aria-hidden="true">
      <defs>
        <linearGradient id=${'tt-rim' + id} x1="0.15" y1="0.1" x2="0.85" y2="0.95"><stop offset="0" stop-color="var(--tt-rim1)" /><stop offset="1" stop-color="var(--tt-rim2)" /></linearGradient>
        <linearGradient id=${'tt-groove' + id} x1="0.15" y1="0.1" x2="0.85" y2="0.95"><stop offset="0" stop-color="var(--tt-groove1)" /><stop offset="1" stop-color="var(--tt-groove2)" /></linearGradient>
        <radialGradient id=${'tt-face' + id} cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="var(--tt-face1)" /><stop offset="1" stop-color="var(--tt-face2)" /></radialGradient>
        <linearGradient id=${'tt-sec' + id} x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="var(--tt-red1)" /><stop offset="1" stop-color="var(--tt-red2)" /></linearGradient>
        <filter id=${'tt-hs' + id} filterUnits="userSpaceOnUse" x="0" y="0" width="280" height="280"><feDropShadow dx="1.2" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".22" /></filter>
      </defs>
      <circle cx=${C} cy=${C} r=${RIM} fill=${'url(#tt-rim' + id + ')'} class="tt-rim" />
      <circle cx=${C} cy=${C} r=${FACE + 2.5} fill="none" stroke=${'url(#tt-groove' + id + ')'} stroke-width="5" />
      <circle cx=${C} cy=${C} r=${FACE} fill=${'url(#tt-face' + id + ')'} class="tt-face" />
      <circle cx=${C} cy=${C} r=${SEC + 3} class="tt-well" />
      ${sector && html`<path d=${sector} fill=${'url(#tt-sec' + id + ')'} class="tt-sector" />`}
      ${Array.from({ length: 60 }, (_, i) => { const lv = i % 15 === 0 ? 3 : i % 5 === 0 ? 2 : 1; const [x1, y1] = pt(i * 6, FACE - 4), [x2, y2] = pt(i * 6, FACE - (lv === 3 ? 17 : lv === 2 ? 11 : 6)); return html`<line key=${i} x1=${x1} y1=${y1} x2=${x2} y2=${y2} class=${'tt-tick l' + lv} />`; })}
      ${[0, 15, 30, 45].map((n) => { const [x, y] = pt(n * 6, FACE - 29); return html`<text key=${n} x=${x} y=${y + 4.5} class="tt-num">${n}</text>`; })}
      <g style=${`transform:rotate(${span}deg);transform-origin:${C}px ${C}px`} class="tt-hand" filter=${'url(#tt-hs' + id + ')'}><line x1=${C} y1=${C + 12} x2=${C} y2=${C - SEC - 2} class="tt-hand-l" /></g>
      <g style=${`transform:rotate(${secA}deg);transform-origin:${C}px ${C}px`} class=${'tt-sec ' + (running ? 'run' : '')}><line x1=${C} y1=${C + 22} x2=${C} y2=${C - FACE + 8} class="tt-sec-l" /><circle cx=${C} cy=${C + 22} r="3.2" class="tt-sec-t" /></g>
      <circle cx=${C} cy=${C} r="8.5" class="tt-hub" /><circle cx=${C} cy=${C} r="3.2" class="tt-hub-in" />
    </svg>
    ${drag != null && html`<div class="tt-bubble">${drag} 分钟</div>`}
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
    <div class="fs-nums"><div><b>${focus.length}</b><small>次</small></div><div><b>${perDay.size}</b><small>天</small></div></div>
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
