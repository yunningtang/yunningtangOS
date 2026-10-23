import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, update, upsert, remove, toggleTodo, removeUndo } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, TagInput, Seg, confirmDel, DateInput, TimeInput, Select } from '../ui.js';
import { uid, todayStr, addDays, relDay, PRIORITY, AREAS, sortBy, fmtShort } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { askConfirm } from '../confirm.js';
import { linkedPage } from './notes.js';
import { go } from '../nav.js';
import { dragProps, dropProps } from '../dnd.js';
import { toast } from '../nav.js';
import { NoteTasks, noteTasks } from './ntasks.js';

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
    ${todo && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { removeUndo('todos', todo.id, todo.title || todo.place || todo.url); onClose(); }}>删除<//><${Btn} kind="ghost" icon="note" onClick=${() => { onClose(); todoPage(todo); }}>笔记页<//><${Btn} kind="ghost" icon="clock" onClick=${() => { onClose(); go('focus?todo=' + todo.id); }}>专注<//>`}
    <span class="flex1"></span>
    <${Btn} kind="ghost" onClick=${onClose}>取消<//>
    <${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="标题"><input type="text" autofocus value=${f.title} placeholder="要做什么？" onInput=${(e) => set('title', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <div class="grid3">
        <${Field} label="日期"><${DateInput} value=${f.due} onChange=${(v) => set('due', v)} /><//>
        <${Field} label="时间"><${TimeInput} value=${f.time} onChange=${(v) => set('time', v)} /><//>
        <${Field} label="领域"><${Select} value=${f.area} options=${AREAS} placeholder="—" clearable onChange=${(v) => set('area', v)} /><//>
      </div>
      <${Field} label="优先级"><div class="pri-pick">${PRIORITY.map((p) => html`<button type="button" style=${`--pc:${p.color}`} class=${f.priority === p.v ? 'on' : ''} title=${p.name} onClick=${() => set('priority', p.v)}>${p.label}</button>`)}</div><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="备注"><textarea rows="3" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

export function todoPage(t) { const n = linkedPage('todo:' + t.id, { title: t.title, nb: '收件箱', tags: t.tags, body: `${t.note ? t.note + '\n\n' : ''}` }); go('notes/' + n.id); }
export function todoMenu(t, onEdit) {
  const today = todayStr();
  return [
    { label: '开始专注', icon: 'clock', onClick: () => go('focus?todo=' + t.id) },
    { label: '笔记页', icon: 'note', onClick: () => todoPage(t) },
    { label: t.done ? '标为未完成' : '标为完成', icon: 'check', onClick: () => toggleTodo(t.id) },
    onEdit && { label: '编辑', icon: 'edit', onClick: () => onEdit(t) },
    'sep',
    { label: '今天', icon: 'calendar', onClick: () => upsert('todos', { id: t.id, due: today }) },
    { label: '明天', icon: 'calendar', onClick: () => upsert('todos', { id: t.id, due: addDays(today, 1) }) },
    { label: '下周', icon: 'calendar', onClick: () => upsert('todos', { id: t.id, due: addDays(today, 7) }) },
    { label: '取消日期', icon: 'x', disabled: !t.due, onClick: () => upsert('todos', { id: t.id, due: '', time: '' }) },
    'sep',
    ...PRIORITY.map((p) => ({ label: `${p.label} ${p.name}`, icon: p.v === t.priority ? 'check' : 'flag', onClick: () => upsert('todos', { id: t.id, priority: p.v }) })),
    'sep',
    { label: '复制一份', icon: 'layers', onClick: () => upsert('todos', { ...t, id: uid(), done: false, completedAt: null, created: today }) },
    { label: '复制标题', icon: 'link', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(t.title); toast('已复制'); } },
    { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('todos', t.id, t.title || t.place || t.url) },
  ];
}

export function TodoItem({ t, onEdit, compact }) {
  const p = PRIORITY[t.priority] || PRIORITY[2];
  const today = todayStr();
  const dueCls = t.due && !t.done ? (t.due < today ? 'late' : t.due === today ? 'today' : '') : '';
  return html`<div class=${'todo p' + t.priority + ' ' + (t.done ? 'done' : '')} style=${`--pc:${p.color}`} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, onEdit), t.title)} ...${dragProps('todo', { id: t.id })}>
    <button class="cb" onClick=${() => toggleTodo(t.id)} aria-label="完成"><${Icon} name="check" size=${12} /></button>
    <div class="tt">
      <div class="ti" onClick=${() => onEdit && onEdit(t)}>${t.priority <= 1 && !t.done && html`<span class="pflag" title=${p.name}><${Icon} name="flag" size=${11} /></span>`}${t.title}</div>
      ${!compact && html`<div class="meta">
        ${t.due && html`<span class=${'due ' + dueCls}><${Icon} name="calendar" size=${10} /> ${relDay(t.due)}${t.time ? ' ' + t.time : ''}</span>`}
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

export default function Todos({ route }) {
  const s = useStore();
  useEffect(() => { const id = route && route.query && route.query.open; const t = id && s.todos.find((x) => x.id === id); if (t) { setEditing(t); setModal(true); } }, [route && route.query && route.query.open]);
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
      <div><div class="desc">${openCount} 项未完成 · 今天完成 ${doneToday} 项</div></div>
      <div class="acts">
        <${Seg} options=${[{ v: 'open', label: '未完成' }, { v: 'all', label: '全部' }, { v: 'done', label: '已完成' }]} value=${view} onChange=${setView} />
        <${Seg} options=${[{ v: 'list', label: '列表' }, { v: 'board', label: '看板' }]} value=${layout} onChange=${setLayout} />
        <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>新建<//>
      </div>
    </div>
    <${Card}>
      <${QuickAdd} />
      ${allTags.length > 0 && html`<div class="filters">${allTags.map(([x, n]) => html`<${Tag} class=${'click ' + (tagF === x ? 'on' : '')} onClick=${() => setTagF(tagF === x ? '' : x)}>${x} <span class="muted">${n}</span><//>`)}</div>`}
      ${layout === 'board' ? html`<div class="board-cols">${PRIORITY.map((p) => { const list = sortBy(todos.filter((t) => t.priority === p.v), 'done', 'due', 'time'); return html`<div class="card bcol" key=${p.v} style=${`--pc:${p.color}`} ...${dropProps('todo', (d) => upsert('todos', { id: d.id, priority: p.v }))}>
        <div class="bh"><i></i>${p.label} · ${p.name}<span>${list.length}</span></div>
        ${list.map((t) => html`<div class=${'bcard ' + (t.done ? 'done' : '')} key=${t.id} ...${dragProps('todo', { id: t.id })} onClick=${() => { setEditing(t); setModal(true); }} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, (x) => { setEditing(x); setModal(true); }), t.title)}><button class="cb" onClick=${(e) => { e.stopPropagation(); toggleTodo(t.id); }}><${Icon} name="check" size=${10} /></button><div class="flex1"><div>${t.title}</div><span class="meta">${t.due ? relDay(t.due) : ''}${t.time ? ' ' + t.time : ''}${t.area ? ' · ' + t.area : ''}${t.tags.map((x) => ' #' + x).join('')}</span></div></div>`)}
        <button class="pt-row flat new" style="min-height:26px;font-size:.76rem" onClick=${() => { setEditing(null); setModal(true); }}><span class="pt-ic"><${Icon} name="plus" size=${11} /></span><span class="pt-t">添加</span></button>
      </div>`; })}</div>`
      : groups.length === 0 ? html`<${Empty} icon="checksq" text=${view === 'done' ? '还没有完成的事。' : '清清爽爽，没有待办。'} />` : groups.map(([name, list]) => html`
        <div class="todo-group" ...${dropProps('todo', (d) => { const map = { 逾期: addDays(today, -1), 今天: today, 明天: addDays(today, 1), 本周: addDays(today, 2), 之后: addDays(today, 8), 未排期: '', 已完成: null }; const due = map[name]; if (due === null) { const t = s.todos.find((x) => x.id === d.id); if (t && !t.done) toggleTodo(d.id); } else upsert('todos', { id: d.id, due, ...(due === '' ? { time: '' } : {}) }); })}>
        <div class="group-h">${name}<i></i><span>${list.length}</span></div>
        ${list.map((t) => html`<${TodoItem} key=${t.id} t=${t} onEdit=${(x) => { setEditing(x); setModal(true); }} />`)}</div>`)}
      ${view !== 'done' && !tagF && noteTasks(s.notes).length > 0 && html`<div class="todo-group nt-sec"><div class="group-h">笔记里的待办<i></i><a class="group-link" href="#/notes/tasks">查看全部 ${noteTasks(s.notes).length} 项 →</a></div><${NoteTasks} notes=${s.notes} notebooks=${s.notebooks} limit=${8} /></div>`}
      ${view === 'done' && todos.length > 0 && html`<div class="row" style="justify-content:flex-end;margin-top:10px"><${Btn} kind="ghost" small icon="archive" onClick=${async () => { if (await askConfirm(`将移除 ${todos.length} 项已完成的待办。`, { title: '清空已完成？', ok: '清空' })) update((d) => { d.todos = d.todos.filter((t) => !t.done); }); }}>清空已完成<//></div>`}
    <//>
    <${TodoModal} open=${modal} todo=${editing} onClose=${() => setModal(false)} />
  </div>`;
}
