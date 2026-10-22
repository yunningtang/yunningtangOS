import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { marked } from '../../vendor/marked.js';
import { useStore, upsert, remove, update } from '../store.js';
import { Icon, IconBtn, Btn, Card, Tag, Empty, Seg, TagInput, confirmDel } from '../ui.js';
import { uid, todayStr, sortBy, debounce } from '../util.js';
import { go } from '../nav.js';

marked.setOptions({ breaks: true, gfm: true });

export function renderMd(src) {
  // Minimal hardening: strip script/iframe tags and inline handlers from rendered markdown.
  let h = marked.parse(src || '');
  h = h.replace(/<\/?(script|iframe|object|embed)[^>]*>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '');
  // [[wiki links]] to other notes by title
  h = h.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a href="#/notes/t:${encodeURIComponent(t)}" class="wiki">${t}</a>`);
  return h;
}

export default function Notes({ route }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [tagF, setTagF] = useState('');
  const [mode, setMode] = useState('edit');
  const id = route.sub;
  const notes = useMemo(() => {
    let l = s.notes;
    if (tagF) l = l.filter((n) => n.tags.includes(tagF));
    if (q) { const k = q.toLowerCase(); l = l.filter((n) => (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(k)); }
    return sortBy(l, '-pinned', '-updated');
  }, [s.notes, q, tagF]);
  const tags = useMemo(() => { const m = new Map(); s.notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [s.notes]);

  // Resolve "t:Title" wiki links to an id, creating the note if needed.
  useEffect(() => {
    if (id && id.startsWith('t:')) {
      const title = decodeURIComponent(id.slice(2));
      let n = s.notes.find((x) => x.title === title);
      if (!n) { n = { id: uid(), title, body: '', tags: [], pinned: false, created: todayStr(), updated: new Date().toISOString() }; upsert('notes', n); }
      go('notes/' + n.id);
    }
  }, [id]);

  const note = s.notes.find((n) => n.id === id);
  const create = () => {
    const n = { id: uid(), title: '', body: '', tags: tagF ? [tagF] : [], pinned: false, created: todayStr(), updated: new Date().toISOString() };
    upsert('notes', n);
    setMode('edit');
    go('notes/' + n.id);
  };
  const save = useMemo(() => debounce((patch) => upsert('notes', { ...patch, updated: new Date().toISOString() }), 300), []);

  return html`<div>
    <div class="page-h">
      <div><div class="kicker">Knowledge base</div><h1>笔记</h1><div class="desc">${s.notes.length} 篇 · Markdown · 支持 [[双链]]</div></div>
      <div class="acts"><${Btn} kind="primary" icon="plus" onClick=${create}>新笔记<//></div>
    </div>
    <div class="notes-layout">
      <${Card}>
        <input type="search" value=${q} placeholder="搜索笔记…" onInput=${(e) => setQ(e.target.value)} style="margin-bottom:8px" />
        ${tags.length > 0 && html`<div class="filters" style="margin-bottom:8px">${tags.slice(0, 12).map(([t, n]) => html`<${Tag} class="click" color=${tagF === t ? 'var(--teal)' : undefined} onClick=${() => setTagF(tagF === t ? '' : t)}>${t} <span class="muted">${n}</span><//>`)}</div>`}
        <div class="note-list">
          ${notes.length === 0 ? html`<${Empty} icon="note" text="没有笔记。" />` : notes.map((n) => html`<a class=${'note-item ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id} key=${n.id}>
            <b>${n.pinned ? '📌 ' : ''}${n.title || '无标题'}</b>
            <p>${(n.body || '').replace(/[#*>\-\[\]`]/g, '').trim().slice(0, 70) || '空'}</p>
            ${n.tags.length > 0 && html`<div class="tags">${n.tags.slice(0, 3).map((t) => html`<${Tag}>${t}<//>`)}</div>`}
          </a>`)}
        </div>
      <//>
      <${Card}>
        ${!note ? html`<${Empty} icon="note" text="选择一篇笔记，或新建一篇。"><${Btn} small onClick=${create}>新笔记<//><//>` : html`<${Editor} key=${note.id} note=${note} mode=${mode} setMode=${setMode} save=${save} />`}
      <//>
    </div>
  </div>`;
}

function Editor({ note, mode, setMode, save }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const ta = useRef();
  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.id]);
  const onBody = (v) => { setBody(v); save({ id: note.id, body: v }); };
  const onTitle = (v) => { setTitle(v); save({ id: note.id, title: v }); };
  const insert = (before, after = '') => {
    const el = ta.current; if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const v = body.slice(0, a) + before + body.slice(a, b) + after + body.slice(b);
    onBody(v);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = a + before.length; el.selectionEnd = b + before.length; });
  };
  const words = body.replace(/\s/g, '').length;
  return html`<div class="editor">
    <div class="ebar">
      <${Seg} options=${[{ v: 'edit', label: '编辑' }, { v: 'split', label: '预览' }]} value=${mode} onChange=${setMode} />
      ${mode === 'edit' && html`<div class="row" style="gap:2px">
        <${IconBtn} title="标题" icon="list" onClick=${() => insert('## ')} />
        <button class="btn ghost sm" onClick=${() => insert('**', '**')}><b>B</b></button>
        <button class="btn ghost sm" onClick=${() => insert('- [ ] ')}>☐</button>
        <button class="btn ghost sm" onClick=${() => insert('> ')}>“</button>
        <button class="btn ghost sm" onClick=${() => insert('[[', ']]')}>[[ ]]</button>
        <button class="btn ghost sm mono" onClick=${() => insert('`', '`')}>${'</>'}</button>
      </div>`}
      <span class="flex1"></span>
      <span class="small muted mono">${words} 字 · ${new Date(note.updated).toLocaleString('zh-CN', { hour12: false })}</span>
      <${IconBtn} icon="pin" title=${note.pinned ? '取消置顶' : '置顶'} onClick=${() => upsert('notes', { id: note.id, pinned: !note.pinned })} />
      <${IconBtn} class="ibtn danger" icon="trash" title="删除" onClick=${() => { if (confirmDel()) { remove('notes', note.id); go('notes'); } }} />
    </div>
    <input class="title" type="text" value=${title} placeholder="标题" onInput=${(e) => onTitle(e.target.value)} />
    <${TagInput} value=${note.tags} onChange=${(v) => upsert('notes', { id: note.id, tags: v })} placeholder="标签" />
    ${mode === 'edit'
      ? html`<textarea ref=${ta} class="body" value=${body} placeholder="开始写… 支持 Markdown，[[标题]] 可链接到其他笔记" onInput=${(e) => onBody(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Tab') { e.preventDefault(); insert('  '); } }}></textarea>`
      : html`<div class="md" dangerouslySetInnerHTML=${{ __html: renderMd(body) }}></div>`}
  </div>`;
}
