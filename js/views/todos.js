import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, update, upsert, remove, toggleTodo, removeUndo, get } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, TagInput, Seg, confirmDel, DateInput, TimeInput, Select, useClock } from '../ui.js';
import { uid, todayStr, addDays, relDay, PRIORITY, AREAS, sortBy, fmtShort, lsGet, lsSet, pad, weekStart, timeToMin, minToTime } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { brainMenu, stepCat, stepRegionItems } from '../brain.js';
import { doThis } from '../doing.js';
import { goalMenu } from '../quest.js';
import { askConfirm, askDate, askPrompt } from '../confirm.js';
import { linkedPage } from './notes.js';
import { go } from '../nav.js';
import { dragProps, dropProps, current as dragNow } from '../dnd.js';
import { toast } from '../nav.js';
import { NoteTasks, noteTasks } from './ntasks.js';
import { stepsOf, stepsProgress, toggleStep, setStep, removeStep, moveStep, addSteps, nextStep, clampMin } from '../steps.js';
import * as pomo from '../pomo.js';


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

// 弹窗里的步骤编辑：每行一个输入框 + 分钟，回车加一行
function StepsField({ value, onChange }) {
  const rows = value;
  const [nv, setNv] = useState('');
  const upd = (i, patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const parse = (q) => { const m = q.trim().match(/^(.*?)\s*(\d{1,3})\s*分(?:钟)?$/); return m ? { title: m[1].trim(), minutes: Math.max(5, Math.min(180, +m[2])) } : { title: q.trim(), minutes: 25 }; };
  const add = () => { if (!nv.trim()) return; onChange([...rows, { id: uid(), kind: '', done: false, ...parse(nv) }]); setNv(''); };
  const move = (id, targetId, after) => { const list = rows.filter((x) => x.id !== id); const it = rows.find((x) => x.id === id); let i = list.findIndex((x) => x.id === targetId); if (after) i++; list.splice(i, 0, it); onChange(list); };
  const total = rows.reduce((n, x) => n + (x.minutes || 0), 0);
  const fmt = (t) => (t >= 60 ? `${Math.floor(t / 60)} 小时${t % 60 ? ' ' + (t % 60) + ' 分' : ''}` : `${t} 分钟`);
  return html`<div class="steps-f">
    ${rows.map((x, i) => html`<div class=${'sf-row ' + (x.done ? 'done' : '')} key=${x.id} ...${dragProps('mstep', { id: x.id })} ...${dropProps('mstep', (d, { after }) => { if (d.id !== x.id) move(d.id, x.id, !!after); }, { position: true })}>
      <span class="sf-grip" title="拖动排序"><${Icon} name="dots" size=${12} /></span>
      <button type="button" class=${'cb ' + (x.done ? 'on' : '')} title=${x.done ? '标为未完成' : '标为完成'} onClick=${() => upd(i, { done: !x.done })}><${Icon} name="check" size=${10} /></button>
      <span class="sf-n">${i + 1}</span>
      <input class="sf-t" type="text" value=${x.title} placeholder="这一步做什么" onInput=${(e) => upd(i, { title: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); const nx = e.target.closest('.sf-row').nextElementSibling; const inp = nx && nx.querySelector('input.sf-t, input.sf-new'); if (inp) inp.focus(); } if (e.key === 'Backspace' && !x.title) { e.preventDefault(); onChange(rows.filter((_, j) => j !== i)); } }} />
      <span class="sf-m"><input type="number" min="5" max="180" step="5" value=${x.minutes} onInput=${(e) => upd(i, { minutes: Math.max(5, Math.min(180, +e.target.value || 25)) })} /><i>分</i></span>
      <button type="button" class="sf-x" title="删除" onClick=${() => onChange(rows.filter((_, j) => j !== i))}><${Icon} name="x" size=${11} /></button>
    </div>`)}
    <div class="sf-row sf-add">
      <span class="sf-grip"></span><span class="sf-plus"><${Icon} name="plus" size=${11} /></span>
      <input class="sf-new" type="text" value=${nv} placeholder=${rows.length ? '再加一步…  可以带时长，比如「买菜 45分」' : '第一步做什么？  可以带时长，比如「列清单 15分」'} onInput=${(e) => setNv(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur=${add} />
    </div>
    ${rows.length > 0 && html`<div class="sf-sum">共 ${rows.length} 步 · 约 ${fmt(total)}</div>`}
  </div>`;
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
    const { _new, ...clean } = f; upsert('todos', { ...clean, title: f.title.trim(), steps: (f.steps || []).filter((x) => x.title && x.title.trim()).map((x) => ({ ...x, title: x.title.trim() })) });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${todo && !todo._new ? '编辑待办' : '新建待办'} foot=${html`
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
      <${Field} label="步骤" hint="保存后在待办行里展开勾选；也可以右键待办让汤圆拆。">
        <${StepsField} value=${f.steps || []} onChange=${(v) => set('steps', v)} />
      <//>
    </div>
  <//>`;
}

export function todoPage(t) { const n = linkedPage('todo:' + t.id, { title: t.title, nb: '收件箱', tags: t.tags, body: `${t.note ? t.note + '\n\n' : ''}` }); go('notes/' + n.id); }
// ---- 过期 / 推迟 ----
const nowHHMM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// 已经到点但没完成：今天的时间过了，或日期本身是过去
export function lateState(t, now = new Date()) {
  if (t.done || !t.due) return '';
  const today = todayStr(now);
  if (t.due < today) return 'late';
  if (t.due === today && t.time && t.time <= nowHHMM(now)) return 'passed';
  return '';
}
export function postponeItems(t) {
  const today = todayStr(); const now = new Date();
  // 推迟会记次数：推了好几次的事会在行上标出来，提醒你是不是该拆开或者放弃
  const move = (patch, msg) => { const undo = { id: t.id, due: t.due, time: t.time, deferred: t.deferred || 0 }; upsert('todos', { id: t.id, ...patch, deferred: (t.deferred || 0) + 1, deferredAt: todayStr() }); toast(msg, { label: '撤销', onClick: () => upsert('todos', undo) }); };
  const plus1h = minToTime(Math.min(23 * 60 + 55, Math.ceil((now.getHours() * 60 + now.getMinutes() + 60) / 5) * 5));
  const nextMon = addDays(weekStart(today), 7);
  return [
    t.time && { label: '推迟 1 小时', icon: 'clock', hint: `今天 ${plus1h}`, onClick: () => move({ due: today, time: plus1h }, `推到今天 ${plus1h}`) },
    { label: '今晚', icon: 'moon', hint: '20:00', onClick: () => move({ due: today, time: '20:00' }, '推到今晚 20:00') },
    { label: '明天', icon: 'calendar', hint: t.time || '', onClick: () => move({ due: addDays(today, 1) }, '推到明天') },
    { label: '后天', icon: 'calendar', onClick: () => move({ due: addDays(today, 2) }, '推到后天') },
    { label: '下周一', icon: 'calendar', hint: nextMon.slice(5).replace('-', '/'), onClick: () => move({ due: nextMon }, '推到下周一') },
    { label: '选日期…', icon: 'edit', onClick: async () => { const v = await askDate('', t.due || today, { title: '推迟到' }); if (v) move({ due: v }, `推到 ${relDay(v)}`); } },
    'sep',
    t.time && { label: '去掉时间，今天内完成即可', icon: 'x', onClick: () => move({ due: today, time: '' }, '已去掉时间') },
    { label: '不排期', icon: 'minus', onClick: () => move({ due: '', time: '' }, '已移到未排期') },
  ].filter(Boolean);
}
export const postponeMenu = (e, t) => ctxMenu(e, postponeItems(t), `推迟「${t.title}」`);

export function todoMenu(t, onEdit) {
  const today = todayStr();
  return [
    !t.done && { label: '做这件', icon: 'target', hint: '放到专注', onClick: () => doThis(t) },
    { label: '开始专注', icon: 'clock', onClick: () => go('focus?todo=' + t.id) },
    { label: '笔记页', icon: 'note', onClick: () => todoPage(t) },
    !t.done && { label: '卡住了…', icon: 'chat', hint: '问汤圆', onClick: () => window.dispatchEvent(new CustomEvent('stuck:open', { detail: t.id })) },
    !t.done && { label: '拆解成步骤', icon: 'sparkle', hint: '汤圆', onClick: () => window.dispatchEvent(new CustomEvent('seal:breakdown', { detail: t })) },
    !t.done && { label: stepsOf(t).length ? '添加一步' : '添加子步骤', icon: 'list', onClick: () => window.dispatchEvent(new CustomEvent('todo:addstep', { detail: t.id })) },
    !t.done && brainMenu(t),
    !t.done && (!t.src || t.src.kind === 'goal') && goalMenu(t),
    { label: t.done ? '标为未完成' : '标为完成', icon: 'check', onClick: () => toggleTodo(t.id) },
    onEdit && { label: '编辑', icon: 'edit', onClick: () => onEdit(t) },
    !t.done && t.due && { label: lateState(t) ? '推迟…' : '改期…', icon: 'right', sub: postponeItems(t) },
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

// 子任务：缩进的一列，勾选 / 拖序 / 右键改分钟 / 播放键直接开始番茄钟
function stepMenu(e, t, x) {
  ctxMenu(e, [
    { label: `开始这一步 · ${x.minutes} 分钟`, icon: 'play', onClick: () => startStep(t, x) },
    { label: x.done ? '标为未完成' : '标为完成', icon: 'check', onClick: () => toggleStep(t.id, x.id) },
    'sep',
    ...[15, 25, 45, 60, 90].map((m) => ({ label: `${m} 分钟`, icon: x.minutes === m ? 'check' : 'clock', onClick: () => setStep(t.id, x.id, { minutes: m }) })),
    { label: '改名…', icon: 'edit', onClick: async () => { const v = await askPrompt('', x.title, { title: '这一步' }); if (v && v.trim()) setStep(t.id, x.id, { title: v.trim() }); } },
    'sep',
    { label: '删除这一步', icon: 'trash', danger: true, onClick: () => removeStep(t.id, x.id) },
  ], x.title);
}
export const startStep = (t, x) => { pomo.start({ label: x.title, todoId: t.id, stepId: x.id, workLen: x.minutes || 25, breakLen: Math.max(3, Math.round((x.minutes || 25) / 5)) }); toast(`开始：${x.title} · ${x.minutes || 25} 分钟`, { label: '去专注', onClick: () => go('focus') }); };
export function StepList({ t, autoAdd = false, hideCat = null }) {
  const steps = stepsOf(t);
  const [adding, setAdding] = useState(autoAdd); const [v, setV] = useState('');
  const [edit, setEdit] = useState(null); // { id, title } 正在改名的那一步
  const [minEdit, setMinEdit] = useState(null); // 正在改分钟的那一步
  const add = () => { const q = v.trim(); if (q) { const m = q.match(/^(.*?)\s*(\d{1,3})\s*分(?:钟)?$/); addSteps(t.id, [m ? { title: m[1].trim(), minutes: +m[2] } : { title: q, minutes: 25 }]); } setV(''); if (!q) setAdding(false); };
  const commitTitle = () => { if (edit && edit.title.trim()) setStep(t.id, edit.id, { title: edit.title.trim() }); setEdit(null); };
  return html`<ul class="steps-l">
    ${steps.map((x) => html`<li key=${x.id} class=${'step ' + (x.done ? 'done' : '')} ...${dragProps('step', { id: x.id, todo: t.id }, { onStart: (e) => e.stopPropagation(), onEnd: (e) => e.stopPropagation() })} ...${dropProps('step', (d, { after }) => { if (d.todo === t.id && d.id !== x.id) moveStep(t.id, d.id, x.id, !!after); }, { position: true })} onContextMenu=${(e) => { e.stopPropagation(); stepMenu(e, t, x); }}>
      <button class="cb" onClick=${() => toggleStep(t.id, x.id)} aria-label="完成这一步"><${Icon} name="check" size=${10} /></button>
      ${edit && edit.id === x.id
        ? html`<input class="st-in" autofocus value=${edit.title} onInput=${(e) => setEdit({ ...edit, title: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEdit(null); }} onBlur=${commitTitle} />`
        : html`<span class="st-t" title="点击改名，拖动排序" onClick=${() => !x.done && setEdit({ id: x.id, title: x.title })}>${x.title}</span>`}
      ${minEdit === x.id
        ? html`<input class="st-min" type="number" min="5" max="180" step="5" autofocus value=${x.minutes} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }} onBlur=${(e) => { const m = +e.target.value; if (m) setStep(t.id, x.id, { minutes: Math.max(5, Math.min(180, m)) }); setMinEdit(null); }} />`
        : html`<button class="st-m" title="点击改分钟" onClick=${() => setMinEdit(x.id)}>${clampMin(x.minutes)} 分</button>`}
      ${(() => { const c = stepCat(x); if (hideCat != null && c && c.id === hideCat) return html`<button class="st-cat none" title=${`跟这件事一样是「${c.label}」· 点一下换`} onClick=${(e) => ctxMenu(e, stepRegionItems(t.id, x), '这一步是')}><${Icon} name=${c.icon} size=${11} />${c.label}</button>`; return html`<button class=${'st-cat ' + (c ? '' : 'none')} title=${c ? `这一步是「${c.label}」· 点一下换` : '这一步还没分类 · 点一下选'} onClick=${(e) => ctxMenu(e, stepRegionItems(t.id, x), '这一步是')}><${Icon} name=${c ? c.icon : 'dots'} size=${11} />${c ? c.label : ''}</button>`; })()}
      ${!x.done && html`<button class="st-go" title="开始这一步（番茄钟）" onClick=${() => startStep(t, x)}><${Icon} name="play" size=${10} /></button>`}
      <button class="st-x" title="删除这一步" onClick=${() => removeStep(t.id, x.id)}><${Icon} name="x" size=${10} /></button>
    </li>`)}
    ${adding ? html`<li class="step new"><input class="st-in" autofocus ref=${(el) => { if (el && !el.dataset.f) { el.dataset.f = 1; el.focus(); } }} onClick=${(e) => e.stopPropagation()} value=${v} placeholder="再加一步，可以带时长：买菜 45分 · 回车保存，Esc 退出" onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setV(''); setAdding(false); } }} onBlur=${() => { if (v.trim()) add(); else setAdding(false); }} /></li>`
      : html`<li class="step new"><button onClick=${() => setAdding(true)}><${Icon} name="plus" size=${10} /> 加一步</button></li>`}
  </ul>`;
}

// 把一件待办拖到另一件的中间 → 变成它的一个步骤（自己原来的步骤接在后面）。拖到卡片上下边缘还是原来的行为（换列 / 换日期）
export function nestTodo(fromId, intoId) {
  const st = get(); const a = st.todos.find((x) => x.id === fromId), b = st.todos.find((x) => x.id === intoId);
  if (!a || !b || a.id === b.id || b.done) return;
  const before = JSON.parse(JSON.stringify(b));
  const add = [{ id: uid(), title: a.title, minutes: a.focusLen || 25, kind: '', done: !!a.done }, ...stepsOf(a).map((x) => ({ ...x, id: uid() }))];
  update((d) => { const t = d.todos.find((x) => x.id === intoId); if (!t) return; t.steps = [...stepsOf(t), ...add]; d.todos = d.todos.filter((x) => x.id !== fromId); });
  toast(`「${a.title.slice(0, 14)}」变成了「${b.title.slice(0, 14)}」的一步`, { label: '撤销', onClick: () => update((d) => { d.todos = d.todos.map((x) => (x.id === intoId ? before : x)); if (!d.todos.some((x) => x.id === a.id)) d.todos.unshift(a); }) });
}
// 只有拖到卡片中间那一半才算「放进去」，并高亮提示；边缘的事件照常冒泡给外面的列 / 分组
const inMiddle = (e) => { const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; return y > 0.25 && y < 0.75; };
export const nestProps = (t) => (t.done ? {} : {
  onDragOver: (e) => { const p = dragNow(); if (!p || p.type !== 'todo' || p.data.id === t.id) return; const on = inMiddle(e); e.currentTarget.classList.toggle('nest-over', on); if (on) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; } },
  onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('nest-over'); },
  onDrop: (e) => { const el = e.currentTarget; const on = el.classList.contains('nest-over'); el.classList.remove('nest-over'); const p = dragNow(); if (!on || !p || p.type !== 'todo' || p.data.id === t.id) return; e.preventDefault(); e.stopPropagation(); nestTodo(p.data.id, t.id); },
});

// 下一步：第一个没做完的步骤，一行：勾选框（直接勾掉，下一步自动顶上来）+ 是什么 + 多久 + ▶ 开始 + 「1/8」点开看全部。列表和看板共用
export function NextLine({ t, open, onToggle }) {
  const ns = !t.done && nextStep(t); if (!ns) return null; const sp = stepsProgress(t);
  const startStep = (e) => { e.stopPropagation(); pomo.start({ label: ns.title, todoId: t.id, stepId: ns.id, workLen: clampMin(ns.minutes) }); toast(`开始：${ns.title} · ${clampMin(ns.minutes)} 分钟`, { label: '去专注', onClick: () => go('focus') }); };
  const tog = (e) => { e.stopPropagation(); onToggle && onToggle(); };
  return html`<div class="nxt" onClick=${(e) => e.stopPropagation()}>
    <button type="button" class="nxt-cb" title="这一步做完了" aria-label="完成这一步" onClick=${(e) => { e.stopPropagation(); toggleStep(t.id, ns.id); }}><${Icon} name="check" size=${9} /></button>
    <span class="nxt-t" title=${open ? '收起步骤' : '展开全部步骤'} onClick=${tog}>${ns.title}</span>
    <span class="nxt-m">${clampMin(ns.minutes)} 分</span>
    <button type="button" class="nxt-go" title=${`开始这一步 · ${clampMin(ns.minutes)} 分钟`} onClick=${startStep}><${Icon} name="play" size=${10} /></button>
    <button type="button" class=${'nxt-all ' + (open ? 'open' : '')} title=${open ? '收起步骤' : '展开全部步骤'} onClick=${tog}>${sp.done}/${sp.total}<${Icon} name=${open ? 'up' : 'down'} size=${9} /></button>
  </div>`;
}

// 看板卡片：标题 + 时间标签；有步骤的显示下一步那一行；右上角的小箭头展开全部步骤和备注，都在卡片里改，不用打开弹窗
function BoardCard({ t, p, onEdit }) {
  const [open, setOpen] = useState(false);
  const sp = stepsProgress(t); const ls = lateState(t); const canOpen = !t.done && (sp.total > 0 || t.note);
  return html`<div class=${'bcard p' + t.priority + ' ' + (t.done ? 'done ' : '') + (open ? 'open' : '')} style=${`--pc:${p.color}`} ...${dragProps('todo', { id: t.id })} ...${nestProps(t)} onClick=${() => onEdit(t)} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, onEdit), t.title)}>
    <button class="cb" onClick=${(e) => { e.stopPropagation(); toggleTodo(t.id); }}><${Icon} name="check" size=${10} /></button>
    <div class="flex1 bc-body">
      <div class="bt">${t.title}</div>
      <span class="meta">${ls && html`<button class=${'bl ' + ls} title="推迟到…" onClick=${(e) => { e.stopPropagation(); postponeMenu(e, t); }}>${ls === 'late' ? '逾期' : '已过'} · 推迟</button>`}${t.due ? html`<b class="bd">${relDay(t.due)}${t.time ? ' ' + t.time : ''}</b>` : ''}${t.area ? html`<i>${t.area}</i>` : ''}${t.tags.map((x) => html`<i>#${x}</i>`)}${(t.done || !nextStep(t)) && sp.total > 0 && html`<i class=${'bs ' + (sp.done === sp.total ? 'all' : '')}>${sp.done}/${sp.total} 步</i>`}</span>
      ${!open && html`<${NextLine} t=${t} open=${open} onToggle=${() => setOpen(true)} />`}
      ${open && html`<div class="bc-more" onClick=${(e) => e.stopPropagation()}>
        ${t.note && html`<p class="bc-note">${t.note}</p>`}
        <${StepList} t=${t} autoAdd=${sp.total === 0} />
      </div>`}
    </div>
    ${canOpen || open ? html`<button type="button" class=${'bc-tg ' + (open ? 'on' : '')} title=${open ? '收起' : '展开步骤和备注'} onClick=${(e) => { e.stopPropagation(); setOpen(!open); }}><${Icon} name=${open ? 'up' : 'down'} size=${12} /></button>`
      : !t.done && html`<button type="button" class="bc-tg add" title="加步骤" onClick=${(e) => { e.stopPropagation(); setOpen(true); }}><${Icon} name="plus" size=${12} /></button>`}
  </div>`;
}

export function TodoItem({ t, onEdit, compact }) {
  const p = PRIORITY[t.priority] || PRIORITY[2];
  const now = useClock();
  const today = todayStr();
  const ls = lateState(t, now);
  const dueCls = t.due && !t.done ? (ls === 'late' ? 'late' : ls === 'passed' ? 'passed' : t.due === today ? 'today' : '') : '';
  const lateTxt = ls === 'late' ? `逾期 ${Math.max(1, Math.round((new Date(today) - new Date(t.due)) / 864e5))} 天` : ls === 'passed' ? '已过' : '';
  const sp = stepsProgress(t);
  const [showSteps, setShowSteps] = useState(false); // 默认收起：「下一步」那一行已经说了最要紧的，点它再展开全部步骤
  const [forceAdd, setForceAdd] = useState(false); // 右键「添加步骤」：展开并直接给输入框
  useEffect(() => { const h = (e) => { if (e.detail === t.id) { setShowSteps(true); setForceAdd(true); } }; window.addEventListener('todo:addstep', h); return () => window.removeEventListener('todo:addstep', h); }, [t.id]);
  const ns = !t.done && nextStep(t);
  const nxt = ns && html`<${NextLine} t=${t} open=${showSteps} onToggle=${() => setShowSteps(!showSteps)} />`;
  const chip = sp.total > 0 && html`<button class=${'steps ' + (sp.done === sp.total ? 'all ' : '') + (showSteps ? 'open' : '')} title=${showSteps ? '收起步骤' : '展开步骤'} onClick=${(e) => { e.stopPropagation(); setShowSteps(!showSteps); }}><${Icon} name="list" size=${10} /> ${sp.done}/${sp.total} 步 <${Icon} name=${showSteps ? 'up' : 'down'} size=${9} /></button>`;
  return html`<div class=${'todo p' + t.priority + ' ' + (t.done ? 'done ' : '') + (showSteps && sp.total ? 'has-steps' : '')} style=${`--pc:${p.color}`} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, onEdit), t.title)} ...${dragProps('todo', { id: t.id })} ...${nestProps(t)}>
    <button class="cb" title=${`${p.label} ${p.name}`} onClick=${() => toggleTodo(t.id)} aria-label="完成"><${Icon} name="check" size=${12} /></button>
    <div class="tt">
      <div class="ti" onClick=${() => onEdit && onEdit(t)}>${t.title}</div>
      ${!compact && html`<div class="meta">
        ${t.priority <= 1 && !t.done && html`<span class="pri">${p.label} ${p.name}</span>`}
        ${t.due && html`<span class=${'due ' + dueCls}><${Icon} name="calendar" size=${10} /> ${relDay(t.due)}${t.time ? ' ' + t.time : ''}</span>`}
        ${ls && html`<button class=${'defer ' + ls} title="推迟到…" onClick=${(e) => postponeMenu(e, t)}>${lateTxt} · 推迟 <${Icon} name="down" size=${9} /></button>`}
        ${!ls && !t.done && t.deferred > 0 && html`<span class=${'deferred ' + (t.deferred >= 3 ? 'many' : '')} title=${`推迟过 ${t.deferred} 次` + (t.deferred >= 3 ? '，要不要拆开或者放弃？' : '')}><${Icon} name="right" size=${9} /> 推迟 ×${t.deferred}</span>`}
        ${!ns && chip}
        ${t.src && t.src.id && html`<a class="src-chip" href=${'#/' + (t.src.kind === 'goal' ? 'plan/month?open=' + t.src.id : t.src.kind === 'book' ? 'reading?open=' + t.src.id : 'notes/' + t.src.id)} title="汤圆从这里拆出来的，点开回到原处" onClick=${(e) => e.stopPropagation()}><${Icon} name=${t.src.kind === 'goal' ? 'target' : t.src.kind === 'book' ? 'book' : 'note'} size=${10} />${t.src.title || ''}</a>`}
        ${t.area && html`<span>${t.area}</span>`}
        ${t.tags.map((x) => html`<${Tag}>#${x}<//>`)}
        ${t.note && html`<span title=${t.note}>· ${t.note.slice(0, 40)}${t.note.length > 40 ? '…' : ''}</span>`}
      </div>`}
      ${compact && (t.time || ls || (sp.total > 0 && !ns)) && html`<div class="meta">${ls ? html`<button class=${'defer ' + ls} title=${lateTxt + ' · 点击推迟'} onClick=${(e) => postponeMenu(e, t)}>${ls === 'late' ? relDay(t.due) + (t.time ? ' ' + t.time : '') : t.time + ' 已过'} <${Icon} name="down" size=${9} /></button>` : t.time && html`<span class=${'due ' + dueCls}>${t.time}</span>`}${!ns && chip}</div>`}
      ${nxt}
      ${(showSteps && sp.total > 0 || forceAdd) && html`<${StepList} t=${t} autoAdd=${forceAdd} />`}
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
  // 记住上次用的视图：下次打开直接是看板就是看板
  const [view, setViewS] = useState(() => lsGet('ytos.todos.view', 'open')); const setView = (v) => { setViewS(v); lsSet('ytos.todos.view', v); };
  const [layout, setLayoutS] = useState(() => lsGet('ytos.todos.layout', 'list')); const setLayout = (v) => { setLayoutS(v); lsSet('ytos.todos.layout', v); };
  const [tagF, setTagF] = useState('');
  useEffect(() => { const t = route && route.query && route.query.tag; if (t) { setTagF(t); setView('all'); } }, [route && route.query && route.query.tag]);
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
    ${layout === 'board' ? html`
      <div class="todo-tools">
        <${QuickAdd} />
        ${allTags.length > 0 && html`<div class="filters">${allTags.map(([x, n]) => html`<${Tag} class=${'click ' + (tagF === x ? 'on' : '')} onClick=${() => setTagF(tagF === x ? '' : x)}>${x} <span class="muted">${n}</span><//>`)}</div>`}
      </div>
      <div class="board-cols">${PRIORITY.map((p) => { const list = sortBy(todos.filter((t) => t.priority === p.v), 'done', 'due', 'time'); return html`<div class="bcol" key=${p.v} style=${`--pc:${p.color}`} ...${dropProps('todo', (d) => upsert('todos', { id: d.id, priority: p.v }))}>
        <div class="bh"><b class="bh-p">${p.label}</b>${p.name}<span>${list.length}</span></div>
        ${list.length === 0 && html`<div class="bcol-none">没有${p.name}的事</div>`}
        ${list.map((t) => html`<${BoardCard} key=${t.id} t=${t} p=${p} onEdit=${(x) => { setEditing(x); setModal(true); }} />`)}
        <button class="pt-row flat new" style="min-height:26px;font-size:.76rem" onClick=${() => { setEditing({ id: uid(), title: '', done: false, priority: p.v, due: '', time: '', tags: [], area: '', note: '', created: today, _new: true }); setModal(true); }}><span class="pt-ic"><${Icon} name="plus" size=${11} /></span><span class="pt-t">添加</span></button>
      </div>`; })}</div>`
    : html`<${Card}>
      <${QuickAdd} />
      ${allTags.length > 0 && html`<div class="filters">${allTags.map(([x, n]) => html`<${Tag} class=${'click ' + (tagF === x ? 'on' : '')} onClick=${() => setTagF(tagF === x ? '' : x)}>${x} <span class="muted">${n}</span><//>`)}</div>`}
      ${groups.length === 0 ? html`<${Empty} icon="checksq" text=${view === 'done' ? '还没有完成的事。' : '清清爽爽，没有待办。'} />` : groups.map(([name, list]) => html`
        <div class="todo-group" ...${dropProps('todo', (d) => { const map = { 逾期: addDays(today, -1), 今天: today, 明天: addDays(today, 1), 本周: addDays(today, 2), 之后: addDays(today, 8), 未排期: '', 已完成: null }; const due = map[name]; if (due === null) { const t = s.todos.find((x) => x.id === d.id); if (t && !t.done) toggleTodo(d.id); } else upsert('todos', { id: d.id, due, ...(due === '' ? { time: '' } : {}) }); })}>
        <div class=${'group-h ' + (name === '逾期' ? 'late' : name === '今天' ? 'today' : '')}>${name}<i></i><span>${list.length}</span></div>
        ${list.map((t) => html`<${TodoItem} key=${t.id} t=${t} onEdit=${(x) => { setEditing(x); setModal(true); }} />`)}</div>`)}
      ${view === 'done' && todos.length > 0 && html`<div class="row" style="justify-content:flex-end;margin-top:10px"><${Btn} kind="ghost" small icon="archive" onClick=${async () => { if (await askConfirm(`将移除 ${todos.length} 项已完成的待办。`, { title: '清空已完成？', ok: '清空' })) update((d) => { d.todos = d.todos.filter((t) => !t.done); }); }}>清空已完成<//></div>`}
    <//>`}
    ${!tagF && noteTasks(s.notes, { done: view === 'done' }).length > 0 && html`<${Card} class="nt-card" title=${view === 'done' ? '笔记里已完成的待办' : '笔记里的待办'} sub="页面里的待办块，勾选会写回原页面。和上面的待办清单是两套数据。" action=${html`<a class="more" href=${'#/notes/tasks' + (view === 'done' ? '?v=done' : '')}>查看全部 ${noteTasks(s.notes, { done: view === 'done' }).length} 项<${Icon} name="right" size=${12} /></a>`}>
      <${NoteTasks} notes=${s.notes} notebooks=${s.notebooks} done=${view === 'done'} limit=${8} />
    <//>`}
    <${TodoModal} open=${modal} todo=${editing} onClose=${() => setModal(false)} />
  </div>`;
}
