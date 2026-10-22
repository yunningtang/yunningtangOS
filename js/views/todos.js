import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, update, upsert, remove, toggleTodo } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, TagInput, Seg, confirmDel } from '../ui.js';
import { uid, todayStr, addDays, relDay, PRIORITY, AREAS, sortBy, fmtShort } from '../util.js';

// Quick-add grammar: "写论文 @明天 14:00 !1 #研究 #写作"
export function quickParse(text) {
  const out = { title: text, due: '', time: '', priority: 2, tags: [] };
  const t = todayStr();
  const dateWords = { '今天': t, '明天': addDays(t, 1), '后天': addDays(t, 2), 'today': t, 'tomorrow': addDays(t, 1) };
  let s = text;
  s = s.replace(/!([0-3])/g, (_, p) => { out.priority = +p; return ''; });
  s = s.replace(/#([^\s#]+)/g, (_, tg) => { out.tags.push(tg); return ''; });
  s = s.replace(/@(今天|明天|后天|today|tomorrow|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})/g, (_, d) => {
    if (dateWords[d]) out.due = dateWords[d];
    else if (d.includes('/')) { const [m, dd] = d.split('/'); out.due = `${t.slice(0, 4)}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; }
    else out.due = d;
    return '';
  });
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/, (_, h, m) => { out.time = `${String(h).padStart(2, '0')}:${m}`; if (!out.due) out.due = t; return ''; });
  out.title = s.replace(/\s+/g, ' ').trim();
  return out;
}

export function TodoModal({ open, todo, onClose, defaults = {} }) {
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open) setF(todo ? { ...todo } : { id: uid(), title: '', done: false, priority: 2, due: '', time: '', tags: [], area: '', note: '', created: todayStr(), ...defaults });
  }, [open, todo]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.title.trim()) return;
    upsert('todos', { ...f, title: f.title.trim() });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${todo ? '编辑待办' : '新建待办'} foot=${html`
    ${todo && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { if (confirmDel()) { remove('todos', todo.id); onClose(); } }}>删除<//>`}
    <span class="flex1"></span>
    <${Btn} kind="ghost" onClick=${onClose}>取消<//>
    <${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="标题"><input type="text" autofocus value=${f.title} placeholder="要做什么？" onInput=${(e) => set('title', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <div class="grid3">
        <${Field} label="日期"><input type="date" value=${f.due} onInput=${(e) => set('due', e.target.value)} /><//>
        <${Field} label="时间"><input type="time" value=${f.time} onInput=${(e) => set('time', e.target.value)} /><//>
        <${Field} label="领域"><select value=${f.area} onChange=${(e) => set('area', e.target.value)}><option value="">—</option>${AREAS.map((a) => html`<option value=${a}>${a}</option>`)}</select><//>
      </div>
      <${Field} label="优先级"><div class="pri-pick">${PRIORITY.map((p) => html`<button type="button" style=${`--pc:${p.color}`} class=${f.priority === p.v ? 'on' : ''} title=${p.name} onClick=${() => set('priority', p.v)}>${p.label}</button>`)}</div><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="备注"><textarea rows="3" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

export function TodoItem({ t, onEdit, compact }) {
  const p = PRIORITY[t.priority] || PRIORITY[2];
  const today = todayStr();
  const dueCls = t.due && !t.done ? (t.due < today ? 'late' : t.due === today ? 'today' : '') : '';
  return html`<div class=${'todo ' + (t.done ? 'done' : '')}>
    <span class="pr" style=${`--pc:${p.color}`}></span>
    <button class="cb" onClick=${() => toggleTodo(t.id)} aria-label="完成"><${Icon} name="check" size=${12} /></button>
    <div class="tt">
      <div class="ti" onClick=${() => onEdit && onEdit(t)}>${t.title}</div>
      ${!compact && html`<div class="meta">
        ${t.due && html`<span class=${'due ' + dueCls}>${relDay(t.due)}${t.time ? ' ' + t.time : ''}</span>`}
        ${t.area && html`<span>${t.area}</span>`}
        ${t.tags.map((x) => html`<${Tag}>#${x}<//>`)}
        ${t.note && html`<span title=${t.note}>· ${t.note.slice(0, 40)}${t.note.length > 40 ? '…' : ''}</span>`}
      </div>`}
      ${compact && t.time && html`<div class="meta"><span class=${'due ' + dueCls}>${t.time}</span></div>`}
    </div>
    ${onEdit && html`<div class="acts"><${IconBtn} icon="edit" title="编辑" size=${13} onClick=${() => onEdit(t)} /></div>`}
  </div>`;
}

export function QuickAdd({ defaults = {}, placeholder = '添加待办… 例如：写论文 @明天 14:00 !1 #研究' }) {
  const [v, setV] = useState('');
  const add = () => {
    const q = quickParse(v);
    if (!q.title) return;
    upsert('todos', { id: uid(), done: false, area: '', note: '', created: todayStr(), ...defaults, ...q, tags: [...(defaults.tags || []), ...q.tags] });
    setV('');
  };
  return html`<div class="quickadd">
        <input class="flex1" type="text" value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && add()} />
    <span class="hint">@日期 时间 !优先级 #标签</span>
  </div>`;
}

export default function Todos() {
  const s = useStore();
  const [view, setView] = useState('open');
  const [layout, setLayout] = useState('list');
  const [tagF, setTagF] = useState('');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const today = todayStr();

  const todos = useMemo(() => {
    let list = s.todos;
    if (tagF) list = list.filter((t) => t.tags.includes(tagF) || t.area === tagF);
    if (view === 'open') list = list.filter((t) => !t.done);
    if (view === 'done') list = list.filter((t) => t.done);
    return list;
  }, [s.todos, view, tagF]);

  const groups = useMemo(() => {
    if (view === 'done') return [['已完成', sortBy(todos, '-completedAt')]];
    const g = { 逾期: [], 今天: [], 明天: [], 本周: [], 之后: [], 未排期: [] };
    const week = addDays(today, 7);
    for (const t of sortBy(todos, 'priority', 'due', 'time')) {
      if (!t.due) g.未排期.push(t);
      else if (t.due < today && !t.done) g.逾期.push(t);
      else if (t.due === today) g.今天.push(t);
      else if (t.due === addDays(today, 1)) g.明天.push(t);
      else if (t.due < week) g.本周.push(t);
      else g.之后.push(t);
    }
    return Object.entries(g).filter(([, v]) => v.length);
  }, [todos, view]);

  const allTags = useMemo(() => {
    const m = new Map();
    s.todos.forEach((t) => { t.tags.forEach((x) => m.set(x, (m.get(x) || 0) + 1)); if (t.area) m.set(t.area, (m.get(t.area) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [s.todos]);

  const openCount = s.todos.filter((t) => !t.done).length;
  const doneToday = s.todos.filter((t) => t.done && t.completedAt === today).length;

  return html`<div>
    <div class="page-h">
      <div><div class="kicker">To-do</div><h1>待办</h1><div class="desc">${openCount} 项未完成 · 今天完成 ${doneToday} 项</div></div>
      <div class="acts">
        <${Seg} options=${[{ v: 'open', label: '未完成' }, { v: 'all', label: '全部' }, { v: 'done', label: '已完成' }]} value=${view} onChange=${setView} />
        <${Seg} options=${[{ v: 'list', label: '列表' }, { v: 'board', label: '看板' }]} value=${layout} onChange=${setLayout} />
        <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>新建<//>
      </div>
    </div>
    <${Card}>
      <${QuickAdd} />
      ${allTags.length > 0 && html`<div class="filters">${allTags.map(([x, n]) => html`<${Tag} class=${'click ' + (tagF === x ? 'on' : '')} color=${tagF === x ? 'var(--teal)' : undefined} onClick=${() => setTagF(tagF === x ? '' : x)}>${x} <span class="muted">${n}</span><//>`)}</div>`}
      ${layout === 'board' ? html`<div class="board-cols">${PRIORITY.map((p) => { const list = sortBy(todos.filter((t) => t.priority === p.v), 'done', 'due', 'time'); return html`<div class="card bcol" key=${p.v} style=${`--pc:${p.color}`}>
        <div class="bh"><i></i>${p.label} · ${p.name}<span>${list.length}</span></div>
        ${list.map((t) => html`<div class=${'bcard ' + (t.done ? 'done' : '')} key=${t.id} onClick=${() => { setEditing(t); setModal(true); }}><button class="cb" onClick=${(e) => { e.stopPropagation(); toggleTodo(t.id); }}><${Icon} name="check" size=${10} /></button><div class="flex1"><div>${t.title}</div><span class="meta">${t.due ? relDay(t.due) : ''}${t.time ? ' ' + t.time : ''}${t.area ? ' · ' + t.area : ''}${t.tags.map((x) => ' #' + x).join('')}</span></div></div>`)}
        <button class="pt-row flat new" style="min-height:26px;font-size:.76rem" onClick=${() => { setEditing(null); setModal(true); }}><span class="pt-ic"><${Icon} name="plus" size=${11} /></span><span class="pt-t">添加</span></button>
      </div>`; })}</div>`
      : groups.length === 0 ? html`<${Empty} icon="checksq" text=${view === 'done' ? '还没有完成的事。' : '清清爽爽，没有待办。'} />` : groups.map(([name, list]) => html`
        <div class="group-h">${name}<i></i><span>${list.length}</span></div>
        ${list.map((t) => html`<${TodoItem} key=${t.id} t=${t} onEdit=${(x) => { setEditing(x); setModal(true); }} />`)}`)}
      ${view === 'done' && todos.length > 0 && html`<div class="row" style="justify-content:flex-end;margin-top:10px"><${Btn} kind="ghost" small icon="archive" onClick=${() => { if (confirmDel('清空所有已完成的待办？')) update((d) => { d.todos = d.todos.filter((t) => !t.done); }); }}>清空已完成<//></div>`}
    <//>
    <${TodoModal} open=${modal} todo=${editing} onClose=${() => setModal(false)} />
  </div>`;
}
