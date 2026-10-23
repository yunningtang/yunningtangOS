// 整理: pages with properties (领域 / 主题 / 状态 / 复习日期) seen together, as a table or a kanban.
import { html, useState, useMemo } from '../../vendor/preact.js';
import { upsert } from '../store.js';
import { Icon, Seg, Select, Empty, Btn } from '../ui.js';
import { todayStr, addDays, sortBy, AREAS, relDay } from '../util.js';
import { go, toast } from '../nav.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt, askDate } from '../confirm.js';
import { dragProps, dropProps } from '../dnd.js';
import { snippetOf } from './notes.js';

export const STATUS = [
  { v: 'idea', label: '待开始', color: '#8a8f98' },
  { v: 'doing', label: '进行中', color: '#4f7cf5' },
  { v: 'review', label: '待复习', color: '#c7873a' },
  { v: 'done', label: '已完成', color: '#4a9a6a' },
];
export const statusOf = (v) => STATUS.find((s) => s.v === v);
export const isCard = (n) => !!(n.area || n.topic || n.status || n.review);
export function reviewState(n) { if (!n.review) return ''; const t = todayStr(); return n.review < t ? 'late' : n.review === t ? 'today' : n.review <= addDays(t, 3) ? 'soon' : ''; }
export function reviewLabel(n) { const st = reviewState(n); if (!n.review) return ''; if (st === 'late') { const d = Math.round((new Date(todayStr()) - new Date(n.review)) / 86400000); return `逾期 ${d} 天`; } return relDay(n.review); }
const GAPS = [1, 3, 7, 14, 30, 60, 120];
export function markReviewed(n) {
  const rep = n.rep || 0; const gap = GAPS[Math.min(rep, GAPS.length - 1)];
  upsert('notes', { id: n.id, review: addDays(todayStr(), gap), rep: rep + 1, reviewedAt: todayStr() });
  toast(`复习 +1 · 下次 ${gap} 天后`, { label: '撤销', onClick: () => upsert('notes', { id: n.id, review: n.review, rep, reviewedAt: n.reviewedAt || '' }) });
}
export const setProp = (n, k, v) => upsert('notes', { id: n.id, [k]: v });
const at = (e) => ({ clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} });

export function statusMenu(e, n) {
  ctxMenu(at(e), [...STATUS.map((s) => ({ label: s.label, icon: n.status === s.v ? 'check' : 'square', onClick: () => setProp(n, 'status', s.v) })), 'sep', { label: '清除状态', icon: 'x', disabled: !n.status, onClick: () => setProp(n, 'status', '') }], '状态');
}
export function areaMenu(e, n, notes = []) {
  const all = [...new Set([...AREAS, ...notes.map((x) => x.area).filter(Boolean)])];
  ctxMenu(at(e), [...all.map((a) => ({ label: a, icon: n.area === a ? 'check' : 'layers', onClick: () => setProp(n, 'area', a) })), 'sep',
    { label: '自定义…', icon: 'edit', onClick: async () => { const v = await askPrompt('领域名称', n.area || '', { title: '领域', placeholder: '比如：数学 / 设计' }); if (v != null) setProp(n, 'area', v.trim()); } },
    { label: '清除', icon: 'x', disabled: !n.area, onClick: () => setProp(n, 'area', '') }], '领域');
}
export function reviewMenu(e, n) {
  const t = todayStr();
  ctxMenu(at(e), [
    n.review && { label: '复习过了 ✓', icon: 'check', hint: `第 ${(n.rep || 0) + 1} 次`, onClick: () => markReviewed(n) }, n.review && 'sep',
    ...[['今天', 0], ['明天', 1], ['3 天后', 3], ['一周后', 7], ['两周后', 14], ['一个月后', 30]].map(([l, d]) => ({ label: l, icon: n.review === addDays(t, d) ? 'check' : 'calendar', onClick: () => setProp(n, 'review', addDays(t, d)) })),
    'sep',
    { label: '选择日期…', icon: 'edit', onClick: async () => { const v = await askDate('', n.review || t, { title: '复习日期' }); if (v) setProp(n, 'review', v); } },
    { label: '清除', icon: 'x', disabled: !n.review, onClick: () => setProp(n, 'review', '') },
  ], '复习日期');
}
export async function editTopic(n) { const v = await askPrompt('主题', n.topic || '', { title: '主题', placeholder: '比如：线性代数 / 产品设计' }); if (v != null) setProp(n, 'topic', v.trim()); }
export function propsMenu(e, n, notes) {
  const ev = at(e);
  ctxMenu(ev, [
    { label: '领域', icon: 'layers', hint: n.area || '', onClick: () => areaMenu(ev, n, notes) },
    { label: '主题', icon: 'tag', hint: n.topic || '', onClick: () => editTopic(n) },
    { label: '状态', icon: 'kanban', hint: n.status ? statusOf(n.status).label : '', onClick: () => statusMenu(ev, n) },
    { label: '复习日期', icon: 'calendar', hint: n.review || '', onClick: () => reviewMenu(ev, n) },
  ], '属性');
}

const SORTS = { review: '复习日期', updated: '最近更新', title: '标题', area: '领域', status: '状态' };
const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export function CardsView({ notes, notebooks }) {
  const [mode, setModeS] = useState(() => ls('ytos.cards.mode', 'table')); const setMode = (v) => { setModeS(v); lset('ytos.cards.mode', v); };
  const [scope, setScope] = useState('cards');
  const [fArea, setFArea] = useState(''); const [fStatus, setFStatus] = useState(''); const [fNb, setFNb] = useState(''); const [q, setQ] = useState('');
  const [sortK, setSortK] = useState('review'); const [asc, setAsc] = useState(true);
  const areas = useMemo(() => [...new Set(notes.map((n) => n.area).filter(Boolean))].sort(), [notes]);
  const list = useMemo(() => {
    let l = notes.filter(scope === 'cards' ? isCard : () => true);
    if (fArea) l = l.filter((n) => n.area === fArea);
    if (fStatus) l = l.filter((n) => (n.status || 'idea') === fStatus);
    if (fNb) l = l.filter((n) => n.nb === fNb);
    if (q.trim()) { const k = q.trim().toLowerCase(); l = l.filter((n) => (n.title + ' ' + (n.topic || '') + ' ' + (n.area || '') + ' ' + n.tags.join(' ')).toLowerCase().includes(k)); }
    const key = (n) => sortK === 'review' ? (n.review || '9999') : sortK === 'updated' ? n.updated : sortK === 'title' ? (n.title || '') : sortK === 'area' ? (n.area || '~') : STATUS.findIndex((s) => s.v === (n.status || 'idea'));
    l = [...l].sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
    if (!asc) l.reverse();
    return l;
  }, [notes, scope, fArea, fStatus, fNb, q, sortK, asc]);
  const t = todayStr();
  const due = notes.filter((n) => n.review && n.review <= t);
  const sortBtn = (k, label) => html`<th class=${sortK === k ? 'on' : ''} onClick=${() => { if (sortK === k) setAsc(!asc); else { setSortK(k); setAsc(true); } }}>${label}${sortK === k && html`<${Icon} name=${asc ? 'up' : 'down'} size=${10} />`}</th>`;
  const nbOf = (id) => notebooks.find((b) => b.id === id);
  return html`<div class="page cards-page">
    <div class="crumbs"><a class="m-back" href="#/notes" title="返回"><${Icon} name="left" size=${16} /></a><a href="#/notes">笔记</a><span>/</span><b>卡片</b>
      <span class="flex1"></span>
      ${due.length > 0 && html`<span class="cards-due" title="到了复习日期的卡片"><${Icon} name="refresh" size=${12} /> 待复习 ${due.length}</span>`}
      <${Seg} options=${[{ v: 'table', label: '表格' }, { v: 'board', label: '看板' }]} value=${mode} onChange=${setMode} />
    </div>
    <div class="cards-bar">
      <${Seg} options=${[{ v: 'cards', label: '卡片' }, { v: 'all', label: '全部页面' }]} value=${scope} onChange=${setScope} />
      <${Select} value=${fArea} options=${areas} placeholder="领域" clearable onChange=${setFArea} class="sm" />
      <${Select} value=${fStatus} options=${STATUS} placeholder="状态" clearable onChange=${setFStatus} class="sm" />
      <${Select} value=${fNb} options=${notebooks.map((b) => ({ v: b.id, label: b.name }))} placeholder="本子" clearable onChange=${setFNb} class="sm" />
      <div class="searchin" style="flex:0 1 220px"><${Icon} name="search" size=${13} /><input type="text" value=${q} placeholder="筛选…" onInput=${(e) => setQ(e.target.value)} /></div>
      <span class="small muted" style="margin-left:auto">${list.length} 页${mode === 'table' ? ` · 按${SORTS[sortK]}` : ''}</span>
    </div>
    ${list.length === 0 ? html`<${Empty} icon="grid" text=${scope === 'cards' && !fArea && !fStatus && !fNb && !q ? '还没有卡片。在页面标题下方点「+ 属性」，给一页设置领域、主题、状态或复习日期，它就会出现在这里。' : '没有匹配的页面。'}>${scope === 'cards' && html`<${Btn} small onClick=${() => setScope('all')}>查看全部页面<//>`}<//>`
    : mode === 'table' ? html`<div class="ctable-wrap"><table class="ctable">
        <thead><tr>${sortBtn('title', '标题')}${sortBtn('area', '领域')}<th>主题</th>${sortBtn('status', '状态')}${sortBtn('review', '复习')}${sortBtn('updated', '更新')}</tr></thead>
        <tbody>${list.map((n) => { const nb = nbOf(n.nb); const st = statusOf(n.status); const rs = reviewState(n); return html`<tr key=${n.id}>
          <td class="c-title"><a href=${'#/notes/' + n.id}>${nb && html`<i class="nb-dot" style=${`background:${nb.color}`}></i>`}<span>${n.title || '无标题'}</span></a></td>
          <td><button class=${'c-cell ' + (n.area ? '' : 'empty')} onClick=${(e) => areaMenu(e, n, notes)}>${n.area || '—'}</button></td>
          <td><button class=${'c-cell ' + (n.topic ? '' : 'empty')} onClick=${() => editTopic(n)}>${n.topic || '—'}</button></td>
          <td><button class=${'c-cell ' + (st ? '' : 'empty')} onClick=${(e) => statusMenu(e, n)}>${st ? html`<i class="st-dot" style=${`background:${st.color}`}></i>${st.label}` : '—'}</button></td>
          <td><span class="c-rev"><button class=${'c-cell rv ' + rs + (n.review ? '' : ' empty')} onClick=${(e) => reviewMenu(e, n)}>${n.review ? reviewLabel(n) : '—'}</button>${(rs === 'late' || rs === 'today') && html`<button class="c-ok" title="复习过了" onClick=${() => markReviewed(n)}><${Icon} name="check" size=${12} /></button>`}</span></td>
          <td class="c-upd">${n.updated.slice(5, 10).replace('-', '/')}</td>
        </tr>`; })}</tbody></table></div>`
    : html`<div class="board-cols cards-board">${STATUS.map((s) => { const col = list.filter((n) => (n.status || 'idea') === s.v); return html`<div class="card bcol" key=${s.v} style=${`--pc:${s.color}`} ...${dropProps('page', (d) => upsert('notes', { id: d.id, status: s.v }))}>
        <div class="bh"><i></i>${s.label}<span>${col.length}</span></div>
        ${col.map((n) => { const nb = nbOf(n.nb); const rs = reviewState(n); return html`<div class="bcard ccard" key=${n.id} ...${dragProps('page', { id: n.id })} onClick=${() => go('notes/' + n.id)} onContextMenu=${(e) => propsMenu(e, n, notes)}>
          <div class="flex1" style="min-width:0"><div class="cc-t">${n.title || '无标题'}</div>${snippetOf(n) && html`<div class="cc-s">${snippetOf(n)}</div>`}
            <div class="cc-m">${nb && html`<i class="nb-dot" style=${`background:${nb.color}`}></i>`}${[n.area, n.topic].filter(Boolean).join(' · ')}${n.review && html`<span class=${'cc-rv ' + rs}><${Icon} name="refresh" size=${10} /> ${reviewLabel(n)}</span>`}</div></div>
        </div>`; })}
      </div>`; })}</div>`}
  </div>`;
}
