import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, upsert, remove } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, Progress, Stars, TagInput, confirmDel } from '../ui.js';
import { uid, todayStr, sortBy } from '../util.js';
import { ctxMenu } from '../ctx.js';

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
    ${book && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { if (confirmDel()) { remove('books', book.id); onClose(); } }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <div class="grid2">
        <${Field} label="标题"><input type="text" autofocus value=${f.title} onInput=${(e) => set('title', e.target.value)} /><//>
        <${Field} label="作者"><input type="text" value=${f.author} onInput=${(e) => set('author', e.target.value)} /><//>
      </div>
      <div class="grid3">
        <${Field} label="类型"><select value=${f.type} onChange=${(e) => set('type', e.target.value)}>${TYPES.map(([v, n]) => html`<option value=${v}>${n}</option>`)}</select><//>
        <${Field} label="状态"><select value=${f.status} onChange=${(e) => set('status', e.target.value)}>${STATUS.map(([v, n]) => html`<option value=${v}>${n}</option>`)}</select><//>
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

export default function Reading() {
  const s = useStore();
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [open, setOpen] = useState(null);
  const books = useMemo(() => {
    let l = s.books;
    if (status !== 'all') l = l.filter((b) => b.status === status);
    if (type !== 'all') l = l.filter((b) => b.type === type);
    return sortBy(l, '-created');
  }, [s.books, status, type]);
  const reading = s.books.filter((b) => b.status === 'reading');
  const doneThisYear = s.books.filter((b) => b.status === 'done' && (b.finished || '').startsWith(todayStr().slice(0, 4))).length;
  const pct = (b) => (b.total ? (b.progress / b.total) * 100 : b.progress);
  const sel = open ? s.books.find((b) => b.id === open) : null;
  const bump = (b, n) => upsert('books', { id: b.id, progress: Math.max(0, b.total ? Math.min(b.total, b.progress + n) : Math.min(100, b.progress + n)) });

  return html`<div>
    <div class="page-h">
      <div><div class="kicker">Reading</div><h1>阅读</h1><div class="desc">${reading.length} 本在读 · 今年读完 ${doneThisYear} 本 · 共 ${s.books.length} 本</div></div>
      <div class="acts"><${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>加入书架<//></div>
    </div>
    ${reading.length > 0 && html`<div class="reading-h">${reading.slice(0, 2).map((b) => html`<${Card} class="now-reading" key=${b.id}>
      <${Cover} b=${b} />
      <div class="flex1">
        <div class="kicker">正在读</div>
        <h3 style="font-size:1rem">${b.title}</h3>
        <div class="small muted">${b.author}</div>
        <div class="row" style="margin-top:10px;gap:8px"><div class="flex1"><${Progress} value=${pct(b)} color=${b.color} /></div><span class="small mono muted">${b.total ? `${b.progress}/${b.total}` : Math.round(b.progress) + '%'}</span></div>
        <div class="row" style="margin-top:10px;gap:6px"><${Btn} small onClick=${() => bump(b, b.total ? 10 : 5)}>+${b.total ? '10 页' : '5%'}<//><${Btn} small onClick=${() => bump(b, b.total ? 30 : 10)}>+${b.total ? '30 页' : '10%'}<//><${Btn} small kind="ghost" onClick=${() => setOpen(b.id)}>笔记<//></div>
      </div>
    <//>`)}</div>`}
    <div class="filters">
      <${Seg} options=${[{ v: 'all', label: '全部' }, ...STATUS.map(([v, n]) => ({ v, label: n }))]} value=${status} onChange=${setStatus} />
      <${Seg} options=${[{ v: 'all', label: '所有类型' }, ...TYPES.map(([v, n]) => ({ v, label: n }))]} value=${type} onChange=${setType} />
    </div>
    ${books.length === 0 ? html`<${Card}><${Empty} icon="book" text="书架上还没有东西。" /><//>` : html`<div class="shelf">${books.map((b) => html`<${Card} class="bk lift" pad=${false} key=${b.id} onClick=${() => setOpen(b.id)} onContextMenu=${(e) => ctxMenu(e, [{ label: '打开', icon: 'book', onClick: () => setOpen(b.id) }, { label: '编辑', icon: 'edit', onClick: () => { setEditing(b); setModal(true); } }, 'sep', ...STATUS.map(([v, n]) => ({ label: n, icon: v === b.status ? 'check' : 'tag', onClick: () => upsert('books', { id: b.id, status: v, ...(v === 'reading' && !b.started ? { started: todayStr() } : {}), ...(v === 'done' ? { finished: b.finished || todayStr(), progress: b.total || 100 } : {}) }) })), 'sep', b.link && { label: '打开链接', icon: 'external', onClick: () => window.open(b.link, '_blank', 'noopener') }, { label: '删除', icon: 'trash', danger: true, onClick: () => confirmDel() && remove('books', b.id) }], b.title)}>
      <${Cover} b=${b} />
      <div class="bi">
        <h4>${b.title}</h4>
        <div class="au">${b.author || TYPES.find(([v]) => v === b.type)?.[1]}</div>
        <div class="row" style="gap:4px;flex-wrap:wrap"><${Tag}>${STATUS.find(([v]) => v === b.status)?.[1]}<//>${b.rating > 0 && html`<${Stars} value=${b.rating} size=${10} />`}</div>
        ${b.status === 'reading' && html`<div class="pr"><div class="prog" style="flex:1"><i style=${`width:${pct(b)}%;background:${b.color}`}></i></div><span>${Math.round(pct(b))}%</span></div>`}
      </div>
    <//>`)}</div>`}
    <${BookModal} open=${modal} book=${editing} onClose=${() => setModal(false)} />
    <${Modal} open=${!!sel} onClose=${() => setOpen(null)} title=${sel?.title || ''} wide foot=${sel && html`<${Btn} kind="ghost" icon="edit" onClick=${() => { setEditing(sel); setModal(true); }}>编辑<//><span class="flex1"></span>${sel.link && html`<a class="btn" href=${sel.link} target="_blank" rel="noopener"><${Icon} name="external" size=${13} /> 打开链接</a>`}`}>
      ${sel && html`<div class="row" style="align-items:flex-start;gap:18px">
        <div class="bk" style="padding:0"><${Cover} b=${sel} class="" /></div>
        <div class="flex1">
          <div class="row wrap" style="gap:6px;margin-bottom:8px"><${Tag}>${TYPES.find(([v]) => v === sel.type)?.[1]}<//><${Tag}>${STATUS.find(([v]) => v === sel.status)?.[1]}<//>${sel.tags.map((t) => html`<${Tag}>#${t}<//>`)}<${Stars} value=${sel.rating} onChange=${(v) => upsert('books', { id: sel.id, rating: v })} /></div>
          <div class="small muted">${sel.author}${sel.started ? ` · 开始 ${sel.started}` : ''}${sel.finished ? ` · 读完 ${sel.finished}` : ''}</div>
          <div class="row" style="margin-top:10px;gap:8px"><div class="flex1"><${Progress} value=${pct(sel)} color=${sel.color} /></div><span class="small mono muted">${sel.total ? `${sel.progress}/${sel.total}` : Math.round(sel.progress) + '%'}</span></div>
          <${Field} label="笔记" class="" style="margin-top:14px"><textarea rows="8" value=${sel.note} placeholder="摘录、想法、读后感…" onInput=${(e) => upsert('books', { id: sel.id, note: e.target.value })}></textarea><//>
        </div>
      </div>`}
    <//>
  </div>`;
}
