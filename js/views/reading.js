import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, upsert, remove, removeUndo } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, Progress, Stars, TagInput, confirmDel, Select } from '../ui.js';
import { uid, todayStr, sortBy } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { dragProps, dropProps } from '../dnd.js';
import { linkedPage } from './notes.js';
import { go } from '../nav.js';

const TYPES = [['book', '书'], ['paper', '论文'], ['article', '文章'], ['course', '课程']];
const STATUS = [['want', '想读'], ['reading', '在读'], ['done', '读完'], ['paused', '搁置']];
const COLORS = ['#2d8f88', '#3b6fd6', '#7461c9', '#c9588a', '#c7873a', '#2f6b5a', '#8a5a44', '#3c4a5a'];

export function BookModal({ open, book, onClose }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open) setF(book ? { ...book } : { id: uid(), title: '', author: '', type: 'book', status: 'want', progress: 0, total: 0, rating: 0, cover: '', link: '', note: '', tags: [], color: COLORS[Math.floor(Math.random() * COLORS.length)], started: '', finished: '', created: todayStr() }); }, [open, book]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.title.trim()) return;
    const out = { ...f, title: f.title.trim() };
    if (out.status === 'reading' && !out.started) out.started = todayStr();
    if (out.status === 'done') { if (!out.finished) out.finished = todayStr(); if (out.total) out.progress = out.total; else out.progress = 100; }
    upsert('books', out);
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${book ? '编辑' : '加入书架'} foot=${html`
    ${book && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { removeUndo('books', book.id, book.title || book.place || book.url); onClose(); }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <div class="grid2">
        <${Field} label="标题"><input type="text" autofocus value=${f.title} onInput=${(e) => set('title', e.target.value)} /><//>
        <${Field} label="作者"><input type="text" value=${f.author} onInput=${(e) => set('author', e.target.value)} /><//>
      </div>
      <div class="grid3">
        <${Field} label="类型"><${Select} value=${f.type} options=${TYPES.map(([v, n]) => ({ v, label: n }))} onChange=${(v) => set('type', v)} /><//>
        <${Field} label="状态"><${Select} value=${f.status} options=${STATUS.map(([v, n]) => ({ v, label: n }))} onChange=${(v) => set('status', v)} /><//>
        <${Field} label="评分"><div style="padding-top:6px"><${Stars} value=${f.rating} onChange=${(v) => set('rating', v)} size=${16} /></div><//>
      </div>
      <div class="grid2">
        <${Field} label=${f.total ? '读到第几页 / 章' : '进度 %'}><input type="number" min="0" value=${f.progress} onInput=${(e) => set('progress', +e.target.value)} /><//>
        <${Field} label="总页数（可空）"><input type="number" min="0" value=${f.total} onInput=${(e) => set('total', +e.target.value)} /><//>
      </div>
      <div class="grid2">
        <${Field} label="封面图片 URL"><input type="url" value=${f.cover} placeholder="https://…" onInput=${(e) => set('cover', e.target.value)} /><//>
        <${Field} label="链接"><input type="url" value=${f.link} placeholder="豆瓣 / 原文 / PDF" onInput=${(e) => set('link', e.target.value)} /><//>
      </div>
      <${Field} label="封面色"><div class="row" style="gap:6px">${COLORS.map((c) => html`<button type="button" style=${`width:22px;height:22px;border-radius:50%;background:${c};outline:${f.color === c ? '2px solid var(--text)' : 'none'};outline-offset:2px`} onClick=${() => set('color', c)}></button>`)}</div><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="笔记 / 摘录 / 感想"><textarea rows="5" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

function Cover({ b, class: cls = '' }) {
  return html`<div class=${'cv ' + cls} style=${`--cc:${b.color || '#18a8a2'}`}>${b.cover ? html`<img src=${b.cover} alt="" loading="lazy" />` : b.title.slice(0, 10)}</div>`;
}

export default function Reading({ route }) {
  const s = useStore();
  useEffect(() => { const id = route && route.query && route.query.open; if (id && s.books.some((b) => b.id === id)) setOpen(id); }, [route && route.query && route.query.open]);
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [open, setOpen] = useState(null);
  const books = useMemo(() => {
    let l = s.books;
    if (status !== 'all') l = l.filter((b) => b.status === status);
    if (type !== 'all') l = l.filter((b) => b.type === type);
    if (q.trim()) { const k = q.toLowerCase(); l = l.filter((b) => (b.title + ' ' + b.author + ' ' + b.note + ' ' + b.tags.join(' ')).toLowerCase().includes(k)); }
    return l;
  }, [s.books, status, type, q]);
  const groups = useMemo(() => {
    if (status !== 'all') return [[STATUS.find(([v]) => v === status)[1], sortBy(books, '-created')]];
    return STATUS.map(([v, n]) => [n, sortBy(books.filter((b) => b.status === v), v === 'done' ? '-finished' : '-created')]).filter(([, l]) => l.length);
  }, [books, status]);
  const doneThisYear = s.books.filter((b) => b.status === 'done' && (b.finished || '').startsWith(todayStr().slice(0, 4))).length;
  const pct = (b) => (b.total ? (b.progress / b.total) * 100 : b.progress);
  const sel = open ? s.books.find((b) => b.id === open) : null;
  const bump = (b, n) => upsert('books', { id: b.id, progress: Math.max(0, b.total ? Math.min(b.total, b.progress + n) : Math.min(100, b.progress + n)) });
  const setStatusOf = (b, v) => upsert('books', { id: b.id, status: v, ...(v === 'reading' && !b.started ? { started: todayStr() } : {}), ...(v === 'done' ? { finished: b.finished || todayStr(), progress: b.total || 100 } : {}) });
  const quickAdd = () => {
    const raw = quick.trim(); if (!raw) return;
    const m = raw.match(/^(.*?)(?:\s*[-–—]\s*|\s+by\s+|\s*·\s*|\s*\/\s*)(.+)$/);
    upsert('books', { id: uid(), title: m ? m[1].trim() : raw, author: m ? m[2].trim() : '', type: 'book', status: status === 'all' ? 'want' : status, progress: 0, total: 0, rating: 0, cover: '', link: '', note: '', tags: [], color: COLORS[s.books.length % COLORS.length], started: '', finished: '', created: todayStr() });
    setQuick('');
  };
  const notePage = (b) => { const n = linkedPage('book:' + b.id, { title: b.title, nb: '读书笔记', color: '#7461c9', tags: ['读书', ...b.tags], body: `${b.author ? '作者：' + b.author + '\n\n' : ''}${b.note ? '> ' + b.note.replace(/\n/g, '\n> ') + '\n\n' : ''}## 摘录\n\n## 想法\n` }); go('notes/' + n.id); };
  const hasPage = (b) => s.notes.some((n) => n.ref === 'book:' + b.id);
  const menu = (b) => [{ label: '打开', icon: 'book', onClick: () => setOpen(b.id) }, { label: hasPage(b) ? '打开笔记页' : '新建笔记页', icon: 'note', onClick: () => notePage(b) }, { label: '编辑', icon: 'edit', onClick: () => { setEditing(b); setModal(true); } }, 'sep', ...STATUS.map(([v, n]) => ({ label: n, icon: v === b.status ? 'check' : 'tag', onClick: () => setStatusOf(b, v) })), 'sep', b.link && { label: '打开链接', icon: 'external', onClick: () => window.open(b.link, '_blank', 'noopener') }, { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('books', b.id, b.title) }];

  return html`<div>
    <div class="page-h">
      <div><h1>阅读</h1><div class="desc">${s.books.filter((b) => b.status === 'reading').length} 本在读 · 今年读完 ${doneThisYear} 本 · 共 ${s.books.length} 本</div></div>
      <div class="acts">
        <div class="seg" data-liquid="button"><span class="liq"></span>${[{ v: 'all', label: '全部' }, ...STATUS.map(([v, n]) => ({ v, label: n }))].map((o) => html`<button type="button" class=${o.v === status ? 'on' : ''} onClick=${() => setStatus(o.v)} ...${o.v === 'all' ? {} : dropProps('book', (d) => { const bk = s.books.find((x) => x.id === d.id); if (bk) setStatusOf(bk, o.v); })}>${o.label}</button>`)}</div>
        <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>加入书架<//>
      </div>
    </div>
    <${Card}>
      <div class="quickadd"><${Icon} name="book" size=${15} class="muted" /><input class="flex1" type="text" value=${quick} placeholder="书名 - 作者，回车快速加入" onInput=${(e) => setQuick(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && quickAdd()} /><input type="search" value=${q} placeholder="搜索…" style="width:160px" onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="filters">${[{ v: 'all', n: '所有类型' }, ...TYPES.map(([v, n]) => ({ v, n }))].map((t) => html`<${Tag} class=${'click ' + (type === t.v ? 'on' : '')} plain onClick=${() => setType(t.v)}>${t.n}<//>`)}</div>
      ${books.length === 0 ? html`<${Empty} icon="book" text="没有匹配的书。" />` : groups.map(([name, list]) => html`
        <div class="group-h">${name}<i></i><span>${list.length}</span></div>
        <div class="links">${list.map((b) => html`<div class="lk bk-row" key=${b.id} ...${dragProps('book', { id: b.id })} onContextMenu=${(e) => ctxMenu(e, menu(b), b.title)}>
          <button class="cv mini" style=${`--cc:${b.color || '#3b6fd6'}`} onClick=${() => setOpen(b.id)}>${b.cover ? html`<img src=${b.cover} alt="" loading="lazy" />` : b.title.slice(0, 4)}</button>
          <div class="li" onClick=${() => setOpen(b.id)}>
            <b>${b.title}${b.rating > 0 && html` <${Stars} value=${b.rating} size=${10} />`}</b>
            <span class="host">${b.author || TYPES.find(([v]) => v === b.type)?.[1]}${b.finished ? ` · 读完于 ${b.finished}` : b.started ? ` · 开始于 ${b.started}` : ''}</span>
            ${b.status === 'reading' && html`<div class="row" style="gap:8px;margin-top:6px;max-width:360px"><div class="flex1"><${Progress} value=${pct(b)} /></div><span class="small muted mono">${b.total ? `${b.progress}/${b.total}` : Math.round(pct(b)) + '%'}</span></div>`}
            ${b.note && html`<p>${b.note.slice(0, 120)}</p>`}
            ${b.tags.length > 0 && html`<div class="tags">${b.tags.map((t) => html`<${Tag}>${t}<//>`)}</div>`}
          </div>
          <div class="acts">
            ${b.status === 'reading' && html`<button class="btn ghost sm" onClick=${() => bump(b, b.total ? 10 : 5)}>+${b.total ? '10 页' : '5%'}</button>`}
            ${b.status === 'want' && html`<button class="btn ghost sm" onClick=${() => setStatusOf(b, 'reading')}>开始读</button>`}
            ${b.status === 'reading' && html`<button class="btn ghost sm" onClick=${() => setStatusOf(b, 'done')}>读完</button>`}
            <${IconBtn} icon="note" title=${hasPage(b) ? '打开笔记页' : '新建笔记页'} class=${'ibtn ' + (hasPage(b) ? 'on' : '')} size=${13} onClick=${() => notePage(b)} />
            <${IconBtn} icon="edit" title="编辑" size=${13} onClick=${() => { setEditing(b); setModal(true); }} />
            <${IconBtn} icon="trash" class="ibtn danger" title="删除" size=${13} onClick=${() => removeUndo('books', b.id, b.title)} />
          </div>
        </div>`)}</div>`)}
    <//>
    <${BookModal} open=${modal} book=${editing} onClose=${() => setModal(false)} />
    <${Modal} open=${!!sel} onClose=${() => setOpen(null)} title=${sel?.title || ''} wide foot=${sel && html`<${Btn} kind="ghost" icon="edit" onClick=${() => { setEditing(sel); setModal(true); }}>编辑<//><${Btn} kind="ghost" icon="note" onClick=${() => { setOpen(null); notePage(sel); }}>${hasPage(sel) ? '打开笔记页' : '新建笔记页'}<//><span class="flex1"></span>${sel.link && html`<a class="btn" href=${sel.link} target="_blank" rel="noopener"><${Icon} name="external" size=${13} /> 打开链接</a>`}`}>
      ${sel && html`<div class="row" style="align-items:flex-start;gap:18px">
        <div class="cv" style=${`--cc:${sel.color || '#3b6fd6'}`}>${sel.cover ? html`<img src=${sel.cover} alt="" />` : sel.title.slice(0, 10)}</div>
        <div class="flex1">
          <div class="row wrap" style="gap:6px;margin-bottom:8px"><${Tag}>${TYPES.find(([v]) => v === sel.type)?.[1]}<//><${Seg} options=${STATUS.map(([v, n]) => ({ v, label: n }))} value=${sel.status} onChange=${(v) => setStatusOf(sel, v)} /><${Stars} value=${sel.rating} onChange=${(v) => upsert('books', { id: sel.id, rating: v })} /></div>
          <div class="small muted">${sel.author}${sel.started ? ` · 开始 ${sel.started}` : ''}${sel.finished ? ` · 读完 ${sel.finished}` : ''}</div>
          <div class="row" style="margin-top:10px;gap:8px"><div class="flex1"><${Progress} value=${pct(sel)} /></div><span class="small mono muted">${sel.total ? `${sel.progress}/${sel.total}` : Math.round(sel.progress) + '%'}</span><${Btn} small onClick=${() => bump(sel, sel.total ? 10 : 5)}>+${sel.total ? '10 页' : '5%'}<//><${Btn} small onClick=${() => bump(sel, sel.total ? 30 : 10)}>+${sel.total ? '30 页' : '10%'}<//></div>
          <${Field} label="笔记" style="margin-top:14px"><textarea rows="8" value=${sel.note} placeholder="摘录、想法、读后感…" onInput=${(e) => upsert('books', { id: sel.id, note: e.target.value })}></textarea><//>
        </div>
      </div>`}
    <//>
  </div>`;
}
