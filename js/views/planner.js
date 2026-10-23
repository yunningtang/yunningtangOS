import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update, upsert, remove, get, removeUndo } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, Progress, confirmDel, AutoTextarea, DateInput, TimeInput } from '../ui.js';
import { uid, todayStr, addDays, weekStart, weekKey, weekDays, WEEKDAY, fmtShort, fmtDate, monthKey, shiftMonth, timeToMin, minToTime, BLOCK_KINDS, kindColor, PRIORITY, AREAS, sortBy, relDay } from '../util.js';
import { TodoItem, TodoModal, todoMenu } from './todos.js';
import { ctxMenu } from '../ctx.js';
import { toast } from '../nav.js';
import { Splitter } from '../resize.js';
import { dragProps, dropProps } from '../dnd.js';

/* ---------- Weekly plan ---------- */
function WeekBoard() {
  const s = useStore();
  const [start, setStart] = useState(weekStart());
  const [editing, setEditing] = useState(null);
  const key = weekKey(start);
  const days = weekDays(start);
  const wk = s.weeks[key] || { focus: '', items: {}, review: '' };
  const today = todayStr();

  const setWeek = (fn) => update((d) => { d.weeks[key] = d.weeks[key] || { focus: '', items: {}, review: '' }; fn(d.weeks[key]); });
  const addItem = (date, text) => setWeek((w) => { w.items[date] = w.items[date] || []; w.items[date].push({ id: uid(), text, done: false }); });
  const toggle = (date, id) => setWeek((w) => { const it = (w.items[date] || []).find((x) => x.id === id); if (it) it.done = !it.done; });
  const del = (date, id) => setWeek((w) => { w.items[date] = (w.items[date] || []).filter((x) => x.id !== id); });

  const total = days.reduce((n, d) => n + (wk.items[d] || []).length + s.todos.filter((t) => t.due === d).length, 0);
  const done = days.reduce((n, d) => n + (wk.items[d] || []).filter((x) => x.done).length + s.todos.filter((t) => t.due === d && t.done).length, 0);

  return html`<div class="stack">
    <div class="page-h" style="margin-bottom:0">
      <div class="wnav">
        <${IconBtn} icon="left" title="上一周" onClick=${() => setStart(addDays(start, -7))} />
        <span class="lbl">${key} · ${fmtShort(days[0])} – ${fmtShort(days[6])}</span>
        <${IconBtn} icon="right" title="下一周" onClick=${() => setStart(addDays(start, 7))} />
        <${Btn} kind="ghost" small onClick=${() => setStart(weekStart())}>本周<//>
      </div>
      <div class="row small muted">${done}/${total} 完成<div style="width:120px"><${Progress} value=${total ? (done / total) * 100 : 0} /></div></div>
    </div>
    <${Card} class="focus-box">
      <div class="fb-h"><b>本周焦点</b><span class="muted small">这一周最重要的三件事</span></div>
      <ol class="focus3">${[0, 1, 2].map((i) => { const lines = (wk.focus || '').split('\n').map((l) => l.replace(/^\s*\d+[.、)]\s*/, '')); return html`<li key=${i}><span class="n">${i + 1}</span><input type="text" value=${lines[i] || ''} placeholder=${['这周最重要的一件事…', '第二件…', '第三件…'][i]} onInput=${(e) => setWeek((w) => { const ls = (w.focus || '').split('\n').map((l) => l.replace(/^\s*\d+[.、)]\s*/, '')); while (ls.length < 3) ls.push(''); ls[i] = e.target.value; w.focus = ls.slice(0, 3).join('\n').replace(/\n+$/, ''); })} onKeyDown=${(e) => { if (e.key === 'Enter' && i < 2) { e.preventDefault(); const nx = e.target.closest('li').nextElementSibling; nx && nx.querySelector('input').focus(); } }} /></li>`; })}</ol>
    <//>
    <div class="week">
      ${days.map((d, i) => {
        const items = wk.items[d] || [];
        const todos = sortBy(s.todos.filter((t) => t.due === d), 'priority', 'time');
        return html`<${Card} class=${'wday ' + (d === today ? 'today' : '')} pad=${false} ...${dropProps(['todo', 'wkitem', 'block'], (x) => { if (x.kind === 'wkitem') { if (x.date === d) return; setWeek((w) => { const it = (w.items[x.date] || []).find((i) => i.id === x.id); if (!it) return; w.items[x.date] = w.items[x.date].filter((i) => i.id !== x.id); w.items[d] = w.items[d] || []; w.items[d].push(it); }); } else if (x.kind === 'block') upsert('blocks', { id: x.id, date: d }); else upsert('todos', { id: x.id, due: d }); })}>
          <div class="dh"><b>${WEEKDAY[i]}</b><span>${fmtShort(d)}${d === today ? ' · 今天' : ''}</span></div>
          <ul>
            ${todos.map((t) => html`<li class=${'todo-ref ' + (t.done ? 'done' : '')} style=${`--pc:${PRIORITY[t.priority].color}`} onClick=${() => setEditing(t)} title="待办（点击编辑）" ...${dragProps('todo', { id: t.id })} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, setEditing), t.title)}><span class="dot"></span><span>${t.time ? html`<span class="mono muted">${t.time} </span>` : ''}${t.title}</span></li>`)}
            ${items.map((it) => html`<li class=${it.done ? 'done' : ''} onClick=${() => toggle(d, it.id)} ...${dragProps('wkitem', { kind: 'wkitem', id: it.id, date: d })} onContextMenu=${(e) => ctxMenu(e, [{ label: it.done ? '标为未完成' : '标为完成', icon: 'check', onClick: () => toggle(d, it.id) }, { label: '转为待办', icon: 'checksq', onClick: () => { upsert('todos', { id: uid(), title: it.text, done: it.done, priority: 2, due: d, time: '', tags: [], area: '', note: '', created: todayStr() }); del(d, it.id); } }, ...[1, 2, 3].map((n) => ({ label: `移到 ${n} 天后`, icon: 'right', onClick: () => { del(d, it.id); const nd = addDays(d, n); setWeek((w) => { w.items[nd] = w.items[nd] || []; w.items[nd].push({ ...it }); }); if (!days.includes(nd)) setStart(weekStart(nd)); } })), 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => del(d, it.id) }], it.text)}><span class="dot"></span><span class="flex1">${it.text}</span><button class="ibtn" style="width:18px;height:18px" onClick=${(e) => { e.stopPropagation(); del(d, it.id); }}><${Icon} name="x" size=${10} /></button></li>`)}
          </ul>
          <div class="add"><input type="text" placeholder="+ 计划" onKeyDown=${(e) => { if (e.key === 'Enter' && e.target.value.trim()) { addItem(d, e.target.value.trim()); e.target.value = ''; } }} /></div>
        <//>`;
      })}
    </div>
    <${Card} title="周回顾" sub="周末花十分钟：这周学到了什么、下周要调整什么">
      <${AutoTextarea} class="review-ta" rows="3" value=${wk.review} placeholder="这周学到了什么？哪里卡住了？下周想换个什么做法…" onInput=${(e) => setWeek((w) => { w.review = e.target.value; })} />
    <//>
    <${TodoModal} open=${!!editing} todo=${editing} onClose=${() => setEditing(null)} />
  </div>`;
}

/* ---------- Daily timeline ---------- */
export function BlockModal({ open, block, onClose, date, start = '09:00' }) {
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open) setF(block ? { ...block } : { id: uid(), date, start, end: minToTime(timeToMin(start) + 60), title: '', kind: 'focus', note: '' });
  }, [open, block]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.title.trim()) return;
    if (timeToMin(f.end) <= timeToMin(f.start)) f.end = minToTime(timeToMin(f.start) + 30);
    upsert('blocks', { ...f, title: f.title.trim() });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${block ? '编辑时间块' : '新建时间块'} foot=${html`
    ${block && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { removeUndo('blocks', block.id, block.title); onClose(); }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="做什么"><input type="text" autofocus value=${f.title} onInput=${(e) => set('title', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <div class="grid3">
        <${Field} label="日期"><${DateInput} value=${f.date} clearable=${false} onChange=${(v) => set('date', v)} /><//>
        <${Field} label="开始"><${TimeInput} value=${f.start} clearable=${false} onChange=${(v) => set('start', v)} /><//>
        <${Field} label="结束"><${TimeInput} value=${f.end} clearable=${false} onChange=${(v) => set('end', v)} /><//>
      </div>
      <${Field} label="类型"><div class="kind-pick">${BLOCK_KINDS.map((k) => html`<button type="button" style=${`--kc:${k.color}`} class=${f.kind === k.v ? 'on' : ''} onClick=${() => set('kind', k.v)}><i></i>${k.name}</button>`)}</div><//>
      <${Field} label="备注"><textarea rows="2" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

export function Timeline({ date, blocks, onEdit, onCreate, from = 6, to = 24, hourH = 52 }) {
  const [now, setNow] = useState(new Date());
  const [ghost, setGhost] = useState(null); // { id, start, end }
  const dragRef = useRef(null);
  const SNAP = 15;
  const beginDrag = (ev, b, mode) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const st = timeToMin(b.start), en = timeToMin(b.end);
    dragRef.current = { id: b.id, mode, y0: ev.clientY, st, en, moved: false };
    const onMove = (e) => {
      const d = dragRef.current; if (!d) return;
      const dm = Math.round(((e.clientY - d.y0) / hourH) * 60 / SNAP) * SNAP;
      if (Math.abs(e.clientY - d.y0) > 3) d.moved = true;
      let ns = d.st, ne = d.en;
      if (d.mode === 'move') { ns = Math.max(from * 60, Math.min(to * 60 - (d.en - d.st), d.st + dm)); ne = ns + (d.en - d.st); }
      else { ne = Math.max(d.st + SNAP, Math.min(to * 60, d.en + dm)); }
      setGhost({ id: d.id, start: minToTime(ns), end: minToTime(ne) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      const d = dragRef.current; dragRef.current = null;
      setGhost((g) => { if (d && d.moved && g && g.id === d.id) upsert('blocks', { id: d.id, start: g.start, end: g.end }); else if (d && !d.moved && mode === 'move') onEdit && onEdit(b); return null; });
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const hours = [];
  for (let h = from; h < to; h++) hours.push(h);
  const y = (min) => ((min - from * 60) / 60) * hourH;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = date === todayStr();
  return html`<div class="tl" style=${`--h:${hourH}px`}>
    ${hours.map((h) => html`<div class=${'hour ' + (onCreate ? 'click' : '')} onClick=${onCreate ? () => onCreate(minToTime(h * 60)) : undefined} ...${dropProps(['todo', 'block'], (d) => { if (d.kind === 'block') { const b = get().blocks.find((x) => x.id === d.id); if (!b) return; const len = timeToMin(b.end) - timeToMin(b.start); upsert('blocks', { id: b.id, date, start: minToTime(h * 60), end: minToTime(h * 60 + len) }); } else { const t = get().todos.find((x) => x.id === d.id); if (!t) return; upsert('todos', { id: t.id, due: date, time: minToTime(h * 60) }); if (onCreate && !get().blocks.some((x) => x.date === date && x.title === t.title)) upsert('blocks', { id: uid(), date, start: minToTime(h * 60), end: minToTime(h * 60 + 60), title: t.title, kind: 'focus', note: '' }); } })}><span>${String(h).padStart(2, '0')}:00</span></div>`)}
    ${blocks.map((b0) => {
      const b = ghost && ghost.id === b0.id ? { ...b0, start: ghost.start, end: ghost.end } : b0;
      const s = Math.max(timeToMin(b.start), from * 60), e = Math.min(timeToMin(b.end), to * 60);
      if (e <= s) return null;
      return html`<div class=${'blk ' + (ghost && ghost.id === b.id ? 'moving' : '')} key=${b.id} style=${`top:${y(s)}px;height:${Math.max(y(e) - y(s) - 3, 20)}px;--bc:${kindColor(b.kind)}`} onPointerDown=${(ev) => beginDrag(ev, b0, 'move')} onClick=${(ev) => ev.stopPropagation()} onContextMenu=${(ev) => ctxMenu(ev, [
        { label: '编辑', icon: 'edit', onClick: () => onEdit && onEdit(b) },
        { label: '复制到明天', icon: 'calendar', onClick: () => upsert('blocks', { ...b, id: uid(), date: addDays(b.date, 1) }) },
        { label: '复制一份（+1h）', icon: 'layers', onClick: () => upsert('blocks', { ...b, id: uid(), start: minToTime(timeToMin(b.start) + 60), end: minToTime(timeToMin(b.end) + 60) }) },
        'sep',
        ...BLOCK_KINDS.map((k) => ({ label: k.name, icon: k.v === b.kind ? 'check' : 'tag', onClick: () => upsert('blocks', { id: b.id, kind: k.v }) })),
        'sep',
        { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('blocks', b.id, b.title || b.place || b.url) },
      ], b.title)}><b>${b.title}</b><small>${b.start}–${b.end}</small><span class="rz" onPointerDown=${(ev) => beginDrag(ev, b0, 'resize')}></span></div>`;
    })}
    ${isToday && nowMin >= from * 60 && nowMin <= to * 60 && html`<div class="now" style=${`top:${y(nowMin)}px`}></div>`}
  </div>`;
}

function DayView({ initial }) {
  const s = useStore();
  const [date, setDate] = useState(initial || todayStr());
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [start, setStart] = useState('09:00');
  const [tEdit, setTEdit] = useState(null);
  const blocks = useMemo(() => sortBy(s.blocks.filter((b) => b.date === date), 'start'), [s.blocks, date]);
  const todos = useMemo(() => sortBy(s.todos.filter((t) => t.due === date), 'done', 'priority', 'time'), [s.todos, date]);
  const sum = useMemo(() => {
    const m = {};
    blocks.forEach((b) => { m[b.kind] = (m[b.kind] || 0) + Math.max(0, timeToMin(b.end) - timeToMin(b.start)); });
    return BLOCK_KINDS.filter((k) => m[k.v]).map((k) => ({ ...k, min: m[k.v] }));
  }, [blocks]);
  const copyYesterday = () => {
    const prev = s.blocks.filter((b) => b.date === addDays(date, -1));
    if (!prev.length) return;
    update((d) => { prev.forEach((b) => d.blocks.push({ ...b, id: uid(), date })); });
  };
  return html`<div class="stack">
    <div class="page-h" style="margin-bottom:0">
      <div class="wnav">
        <${IconBtn} icon="left" title="前一天" onClick=${() => setDate(addDays(date, -1))} />
        <span class="lbl">${fmtDate(date, true)} · ${relDay(date)}</span>
        <${IconBtn} icon="right" title="后一天" onClick=${() => setDate(addDays(date, 1))} />
        <${Btn} kind="ghost" small onClick=${() => setDate(todayStr())}>今天<//>
        <${DateInput} value=${date} clearable=${false} onChange=${(v) => v && setDate(v)} />
      </div>
      <div class="acts">
        ${blocks.length === 0 && html`<${Btn} small kind="ghost" icon="refresh" onClick=${copyYesterday}>复制昨天<//>`}
        <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setStart('09:00'); setModal(true); }}>时间块<//>
      </div>
    </div>
    <div class="day-layout">
      <${Card} title="时间线" sub="点击空白处在该小时新建">
        <${Timeline} date=${date} blocks=${blocks} onEdit=${(b) => { setEditing(b); setModal(true); }} onCreate=${(t) => { setEditing(null); setStart(t); setModal(true); }} />
      <//>
      <${Splitter} varName="dayside" min=${240} max=${520} dir=${-1} class="sp-col" />
      <div class="stack">
        <${Card} title="当天待办" sub=${`${todos.filter((t) => t.done).length}/${todos.length}`}>
          ${todos.length === 0 ? html`<${Empty} icon="checksq" text="这天没有安排待办。" />` : todos.map((t) => html`<${TodoItem} t=${t} compact onEdit=${(x) => setTEdit(x)} />`)}
        <//>
        <${Card} title="时间分配">
          ${sum.length === 0 ? html`<p class="small muted">还没有时间块。</p>` : html`<div class="day-sum">${sum.map((k) => html`<div class="r"><i style=${`background:${k.color}`}></i>${k.name}<b>${(k.min / 60).toFixed(1)}h</b></div>`)}<div class="r" style="border-top:1px solid var(--line);padding-top:6px"><i style="background:transparent"></i>合计<b>${(sum.reduce((n, k) => n + k.min, 0) / 60).toFixed(1)}h</b></div></div>`}
        <//>
      </div>
    </div>
    <${BlockModal} open=${modal} block=${editing} date=${date} start=${start} onClose=${() => setModal(false)} />
    <${TodoModal} open=${!!tEdit} todo=${tEdit} onClose=${() => setTEdit(null)} />
  </div>`;
}
/* ---------- Monthly goals ---------- */
function GoalModal({ open, goal, onClose, month }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open) setF(goal ? { ...goal } : { id: uid(), title: '', area: '', why: '', krs: [], progress: 0 }); }, [open, goal]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.title.trim()) return;
    update((d) => {
      d.goals[month] = d.goals[month] || [];
      const i = d.goals[month].findIndex((g) => g.id === f.id);
      if (i >= 0) d.goals[month][i] = f; else d.goals[month].push(f);
    });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${goal ? '编辑目标' : '本月新目标'} foot=${html`
    ${goal && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { const snap = goal; update((d) => { d.goals[month] = (d.goals[month] || []).filter((g) => g.id !== goal.id); }); onClose(); toast(`已删除「${goal.title}」`, { label: '撤销', onClick: () => update((d) => { d.goals[month] = [...(d.goals[month] || []), snap]; }) }); }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="目标"><input type="text" autofocus value=${f.title} placeholder="这个月想达成…" onInput=${(e) => set('title', e.target.value)} /><//>
      <div class="grid2">
        <${Field} label="领域"><select value=${f.area} onChange=${(e) => set('area', e.target.value)}><option value="">—</option>${AREAS.map((a) => html`<option value=${a}>${a}</option>`)}</select><//>
        <${Field} label=${`手动进度 ${f.progress}%`} hint="有关键结果时按勾选自动计算"><input type="range" min="0" max="100" step="5" value=${f.progress} onInput=${(e) => set('progress', +e.target.value)} /><//>
      </div>
      <${Field} label="为什么重要"><textarea rows="2" value=${f.why} onInput=${(e) => set('why', e.target.value)}></textarea><//>
      <${Field} label="关键结果 · 每行一个"><textarea rows="4" value=${f.krs.map((k) => k.text).join('\n')} placeholder="读完两本书\n每周跑步三次" onInput=${(e) => {
        const lines = e.target.value.split('\n');
        set('krs', lines.map((text, i) => ({ id: f.krs[i]?.id || uid(), text, done: f.krs[i]?.done || false })));
      }}></textarea><//>
    </div>
  <//>`;
}

export function goalPct(g) {
  const krs = (g.krs || []).filter((k) => k.text.trim());
  if (!krs.length) return g.progress || 0;
  return Math.round((krs.filter((k) => k.done).length / krs.length) * 100);
}

function MonthGoals({ openId }) {
  const s = useStore();
  const [month, setMonth] = useState(monthKey());
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  useEffect(() => { if (!openId) return; for (const [m, gs] of Object.entries(s.goals)) { const g = gs.find((x) => x.id === openId); if (g) { setMonth(m); setEditing(g); setModal(true); break; } } }, [openId]);
  const goals = s.goals[month] || [];
  const [y, m] = month.split('-');
  const toggleKr = (gid, kid) => update((d) => { const g = d.goals[month].find((x) => x.id === gid); const k = g.krs.find((x) => x.id === kid); k.done = !k.done; });
  const avg = goals.length ? Math.round(goals.reduce((n, g) => n + goalPct(g), 0) / goals.length) : 0;
  return html`<div class="stack">
    <div class="page-h" style="margin-bottom:0">
      <div class="wnav">
        <${IconBtn} icon="left" title="上个月" onClick=${() => setMonth(shiftMonth(month, -1))} />
        <span class="lbl">${y} 年 ${Number(m)} 月</span>
        <${IconBtn} icon="right" title="下个月" onClick=${() => setMonth(shiftMonth(month, 1))} />
        <${Btn} kind="ghost" small onClick=${() => setMonth(monthKey())}>本月<//>
      </div>
      <div class="acts">
        <span class="small muted">平均进度 ${avg}%</span>
        ${goals.length === 0 && s.goals[shiftMonth(month, -1)]?.length > 0 && html`<${Btn} small kind="ghost" icon="refresh" onClick=${() => update((d) => { d.goals[month] = d.goals[shiftMonth(month, -1)].filter((g) => goalPct(g) < 100).map((g) => ({ ...g, id: uid(), krs: g.krs.map((k) => ({ ...k, id: uid(), done: false })), progress: 0 })); })}>延续上月未完成<//>`}
        <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>新目标<//>
      </div>
    </div>
    ${goals.length === 0 ? html`<${Card}><${Empty} icon="target" text="这个月还没有目标。定三个就好，少即是多。" /><//>` : html`<div class="goals">${goals.map((g) => {
      const pct = goalPct(g);
      return html`<${Card} class=${'goal ' + (pct >= 100 ? 'done-all' : '')} key=${g.id} ...${dragProps('goal', { id: g.id })} ...${dropProps('goal', (d, { after }) => { if (d.id === g.id) return; update((dd) => { const list = dd.goals[month]; const from = list.findIndex((x) => x.id === d.id); const [mv] = list.splice(from, 1); let to = list.findIndex((x) => x.id === g.id); if (after) to++; list.splice(to, 0, mv); }); }, { position: true })} onContextMenu=${(e) => ctxMenu(e, [{ label: '编辑', icon: 'edit', onClick: () => { setEditing(g); setModal(true); } }, { label: '复制到下个月', icon: 'calendar', onClick: () => update((d) => { const nm = shiftMonth(month, 1); d.goals[nm] = d.goals[nm] || []; d.goals[nm].push({ ...g, id: uid(), progress: 0, krs: g.krs.map((k) => ({ ...k, id: uid(), done: false })) }); }) }, { label: '全部关键结果标为完成', icon: 'check', disabled: !g.krs.length, onClick: () => update((d) => { d.goals[month].find((x) => x.id === g.id).krs.forEach((k) => { k.done = true; }); }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => { update((d) => { d.goals[month] = d.goals[month].filter((x) => x.id !== g.id); }); toast(`已删除「${g.title}」`, { label: '撤销', onClick: () => update((d) => { d.goals[month] = [...(d.goals[month] || []), g]; }) }); } }], g.title)}>
        <div class="gh"><div class="flex1"><h4>${g.title}</h4>${g.area && html`<${Tag}>${g.area}<//>`}</div><span class="pct">${pct}%</span><${IconBtn} icon="edit" title="编辑" size=${13} onClick=${() => { setEditing(g); setModal(true); }} /></div>
        <div style="margin-top:10px"><${Progress} value=${pct} /></div>
        ${g.why && html`<p class="small muted" style="margin-top:8px">${g.why}</p>`}
        ${g.krs.filter((k) => k.text.trim()).length > 0 && html`<ul class="krs">${g.krs.filter((k) => k.text.trim()).map((k) => html`<li class=${k.done ? 'done' : ''} onClick=${() => toggleKr(g.id, k.id)} onContextMenu=${(e) => ctxMenu(e, [{ label: k.done ? '标为未完成' : '标为完成', icon: 'check', onClick: () => toggleKr(g.id, k.id) }, { label: '转为待办', icon: 'checksq', onClick: () => upsert('todos', { id: uid(), title: k.text, done: false, priority: 1, due: '', time: '', tags: [], area: g.area || '', note: `来自目标「${g.title}」`, created: todayStr() }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => update((d) => { const gg = d.goals[month].find((x) => x.id === g.id); gg.krs = gg.krs.filter((x) => x.id !== k.id); }) }], k.text)}><span class="cb"><${Icon} name="check" size=${10} /></span><span>${k.text}</span></li>`)}</ul>`}
      <//>`;
    })}</div>`}
    <${GoalModal} open=${modal} goal=${editing} month=${month} onClose=${() => setModal(false)} />
  </div>`;
}

export default function Planner({ route }) {
  const sub = route.sub || 'week';
  const tabs = [['week', '周计划'], ['day', '每日时间线'], ['month', '月度目标']];
  return html`<div>
    <div class="page-h"><div><div class="kicker">Planner</div><h1>计划</h1><div class="desc">月定方向，周定节奏，日定时间。</div></div></div>
    <nav class="subnav" data-liquid="a"><span class="liq"></span>${tabs.map(([k, n]) => html`<a href=${'#/plan/' + k} class=${sub === k ? 'active' : ''}>${n}</a>`)}</nav>
    ${sub === 'week' && html`<${WeekBoard} />`}
    ${sub === 'day' && html`<${DayView} initial=${route.query && route.query.d} />`}
    ${sub === 'month' && html`<${MonthGoals} openId=${route.query && route.query.open} />`}
  </div>`;
}
