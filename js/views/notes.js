import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { marked } from '../../vendor/marked.js';
import { useStore, upsert, remove, update, get } from '../store.js';
import { Icon, IconBtn, Btn, Card, Tag, Empty, Seg, TagInput, confirmDel, Modal, Field } from '../ui.js';
import { uid, todayStr, sortBy, debounce, escapeHtml } from '../util.js';
import { go } from '../nav.js';
import { mountGraph } from '../graph.js';
import { BlockEditor } from '../editor.js';
import { blocksToMd, mdToBlocks } from '../blocks.js';

marked.setOptions({ breaks: true, gfm: true });

/* ---------- helpers ---------- */
export const LINK_RE = /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g;

export function linksOf(body) {
  const out = new Set();
  const plain = (body || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of plain.matchAll(LINK_RE)) out.add(m[1].trim());
  return [...out];
}

export function renderMd(src) {
  let h = marked.parse((src || '').replace(/^> ?(💡|⚠️|✅|📌|❗)\s?/gm, '> **$1** '));
  h = h.replace(/<\/?(script|iframe|object|embed)[^>]*>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '');
  // Resolve [[links]] everywhere except inside code.
  return h.split(/(<code[\s\S]*?<\/code>|<pre[\s\S]*?<\/pre>)/).map((part, i) => i % 2 ? part : part.replace(LINK_RE, (_, t, alias) => `<a href="#/notes/t:${encodeURIComponent(t.trim())}" class="wiki">${escapeHtml(alias || t)}</a>`)).join('');
}

export function noteTitle(n) { return n.title || '无标题'; }
export function childrenOf(notes, id) { return sortBy(notes.filter((n) => (n.parent || null) === id), 'order', 'created'); }
export function ancestors(notes, n) {
  const out = [];
  let cur = n;
  while (cur && cur.parent) { cur = notes.find((x) => x.id === cur.parent); if (!cur || out.includes(cur)) break; out.unshift(cur); }
  return out;
}
export function newNote(patch = {}) {
  const n = { id: uid(), title: '', body: '', tags: [], parent: null, order: Date.now(), pinned: false, icon: '', created: todayStr(), updated: new Date().toISOString(), ...patch };
  upsert('notes', n);
  return n;
}
export function findByTitle(notes, title) { return notes.find((x) => x.title.trim().toLowerCase() === title.trim().toLowerCase()); }


/* ---------- page tree (sidebar) ---------- */
export function PageTree({ notes, parent = null, depth = 0, activeId, open, toggle, onCreate, max = 60 }) {
  const kids = childrenOf(notes, parent).slice(0, max);
  if (!kids.length) return null;
  return html`<ul class=${'ptree ' + (depth === 0 ? 'root' : '')}>${kids.map((n) => {
    const has = notes.some((x) => x.parent === n.id);
    const isOpen = !!open[n.id];
    return html`<li key=${n.id}>
      <div class=${'pt-row ' + (n.id === activeId ? 'active' : '')} style=${`padding-left:${8 + depth * 14}px`}>
        <button class=${'pt-tg ' + (has ? '' : 'none')} onClick=${() => toggle(n.id)} aria-label="展开"><${Icon} name=${isOpen ? 'down' : 'right'} size=${11} /></button>
        <a href=${'#/notes/' + n.id} class="pt-link"><${Icon} name="note" size=${14} class="pt-ic" /><span class="pt-t">${noteTitle(n)}</span></a>
        <button class="pt-add" title="新建子页面" onClick=${() => onCreate(n.id)}><${Icon} name="plus" size=${11} /></button>
      </div>
      ${isOpen && has && html`<${PageTree} notes=${notes} parent=${n.id} depth=${depth + 1} activeId=${activeId} open=${open} toggle=${toggle} onCreate=${onCreate} />`}
    </li>`;
  })}</ul>`;
}

export function useTreeState() {
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.tree') || '{}'); } catch { return {}; } });
  const toggle = (id) => setOpen((o) => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem('ytos.tree', JSON.stringify(n)); } catch {} return n; });
  const openPath = (ids) => setOpen((o) => { const n = { ...o }; ids.forEach((i) => { n[i] = true; }); try { localStorage.setItem('ytos.tree', JSON.stringify(n)); } catch {} return n; });
  return { open, toggle, openPath };
}

/* ---------- main view ---------- */
export default function Notes({ route }) {
  const s = useStore();
  const id = route.sub;
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('pages');
  const tree = useTreeState();

  useEffect(() => {
    if (id && id.startsWith('t:')) {
      const title = decodeURIComponent(id.slice(2));
      let n = findByTitle(s.notes, title);
      if (!n) n = newNote({ title });
      go('notes/' + n.id);
    }
  }, [id]);

  const note = s.notes.find((n) => n.id === id);
  useEffect(() => { if (note) tree.openPath(ancestors(s.notes, note).map((a) => a.id)); }, [id]);

  const create = (parent = null) => { const n = newNote({ parent }); if (parent) tree.openPath([parent]); go('notes/' + n.id); };
  const results = useMemo(() => {
    if (!q.trim()) return null;
    const k = q.toLowerCase();
    return sortBy(s.notes.filter((n) => (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(k)), '-updated').slice(0, 30);
  }, [q, s.notes]);
  const recent = useMemo(() => sortBy(s.notes, '-updated').slice(0, 8), [s.notes]);
  const pinned = s.notes.filter((n) => n.pinned);
  const tags = useMemo(() => { const m = new Map(); s.notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [s.notes]);

  return html`<div class="notes-layout">
    <aside class="card notes-side">
      <div class="ns-top">
        <div class="searchin"><${Icon} name="search" size=${13} /><input type="search" value=${q} placeholder="搜索页面…" onInput=${(e) => setQ(e.target.value)} /></div>
        <${IconBtn} icon="plus" title="新页面" onClick=${() => create(null)} />
      </div>
      <div class="ns-tabs"><${Seg} options=${[{ v: 'pages', label: '页面' }, { v: 'tags', label: '标签' }, { v: 'graph', label: '图谱' }]} value=${tab} onChange=${(v) => { setTab(v); if (v === 'graph') go('notes/graph'); }} /></div>
      <div class="ns-body" data-liquid=".pt-row, summary"><span class="liq"></span>
        ${results ? html`<div class="ns-sec">搜索结果 · ${results.length}</div>${results.length === 0 ? html`<div class="small muted" style="padding:6px 10px">没有匹配的页面。</div>` : results.map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id}><span class="pt-t">${noteTitle(n)}</span><span class="pt-sub">${ancestors(s.notes, n).map(noteTitle).join(' / ')}</span></a>`)}`
        : tab === 'tags' ? html`${tags.length === 0 ? html`<div class="small muted" style="padding:6px 10px">还没有标签。</div>` : tags.map(([t, c]) => html`<details class="ns-tag" key=${t}><summary><span class="pt-t">${t}</span><span class="pt-cnt">${c}</span></summary>${s.notes.filter((n) => n.tags.includes(t)).map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} style="padding-left:26px" href=${'#/notes/' + n.id}><span class="pt-t">${noteTitle(n)}</span></a>`)}</details>`)}`
        : html`
          ${pinned.length > 0 && html`<div class="ns-sec">收藏</div>${pinned.map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id}><span class="pt-t">${noteTitle(n)}</span></a>`)}`}
          <div class="ns-sec">页面 <span class="muted">${s.notes.length}</span></div>
          ${s.notes.length === 0 ? html`<div class="small muted" style="padding:6px 10px">还没有页面。</div>` : html`<${PageTree} notes=${s.notes} activeId=${id} open=${tree.open} toggle=${tree.toggle} onCreate=${create} />`}
          <button class="pt-row flat new" onClick=${() => create(null)}><span class="pt-t">+ 新页面</span></button>
          <div class="ns-sec">最近</div>
          ${recent.map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id}><span class="pt-t">${noteTitle(n)}</span></a>`)}`}
      </div>
    </aside>
    <section class="card notes-main">
      ${id === 'graph' ? html`<${GraphView} notes=${s.notes} />`
      : !note ? html`<div class="notes-empty"><${Empty} icon="note" text="选择左侧一个页面，或新建一页。"><div class="row" style="gap:8px"><${Btn} small kind="primary" onClick=${() => create(null)}>新页面<//><${Btn} small onClick=${() => go('notes/graph')}>看图谱<//></div><//></div>`
      : html`<${Page} key=${note.id} note=${note} notes=${s.notes} onCreateChild=${() => create(note.id)} />`}
    </section>
  </div>`;
}

/* ---------- page ---------- */
function Page({ note, notes, onCreateChild }) {
  const [moveOpen, setMoveOpen] = useState(false);
  const save = useMemo(() => debounce((patch) => upsert('notes', { ...patch, updated: new Date().toISOString() }), 250), []);
  const onBlocks = useMemo(() => (blocks) => upsert('notes', { id: note.id, blocks, body: blocksToMd(blocks), updated: new Date().toISOString() }), [note.id]);
  const blocks = useMemo(() => (note.blocks && note.blocks.length ? note.blocks : mdToBlocks(note.body)), [note.id]);
  const createLinked = (title) => { if (!findByTitle(get().notes, title)) newNote({ title, parent: note.id }); };
  const crumbs = ancestors(notes, note);
  const kids = childrenOf(notes, note.id);
  const title = noteTitle(note);
  const backlinks = useMemo(() => notes.filter((n) => n.id !== note.id && linksOf(n.body).some((t) => t.toLowerCase() === note.title.trim().toLowerCase()) && note.title.trim()), [notes, note.title]);
  const mentions = useMemo(() => {
    const t = note.title.trim();
    if (!t || t.length < 2) return [];
    return notes.filter((n) => n.id !== note.id && !backlinks.includes(n) && n.body.includes(t));
  }, [notes, note.title, backlinks]);
  const outgoing = useMemo(() => linksOf(note.body).map((t) => ({ t, n: findByTitle(notes, t) })), [notes, note.body]);
  const snippet = (n, key) => { const line = n.body.split('\n').find((l) => l.includes(key)) || ''; return line.replace(/[#>*`]/g, '').trim().slice(0, 120); };
  const words = note.body.replace(/\s/g, '').length;

  return html`<div class="page">
    <div class="crumbs">
      <a href="#/notes">笔记</a>${crumbs.map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${title}</b>
      <span class="flex1"></span>
      <div class="page-acts">
        <div class="seg mini"><button class=${!note.font || note.font === 'default' ? 'on' : ''} title="默认字体" onClick=${() => upsert('notes', { id: note.id, font: 'default' })}>Ag</button><button class=${'serif-f ' + (note.font === 'serif' ? 'on' : '')} title="衬线" onClick=${() => upsert('notes', { id: note.id, font: 'serif' })}>Ag</button><button class=${'mono-f ' + (note.font === 'mono' ? 'on' : '')} title="等宽" onClick=${() => upsert('notes', { id: note.id, font: 'mono' })}>Ag</button></div>
        <${IconBtn} icon="grid" title=${note.wide ? '标准宽度' : '全宽'} onClick=${() => upsert('notes', { id: note.id, wide: !note.wide })} />
        <${IconBtn} icon="pin" title=${note.pinned ? '取消收藏' : '收藏'} class=${'ibtn ' + (note.pinned ? 'on' : '')} onClick=${() => upsert('notes', { id: note.id, pinned: !note.pinned })} />
        <${IconBtn} icon="layers" title="移动到…" onClick=${() => setMoveOpen(true)} />
        <${IconBtn} icon="plus" title="新建子页面" onClick=${onCreateChild} />
        <${IconBtn} icon="trash" class="ibtn danger" title="删除" onClick=${() => { if (confirmDel(kids.length ? `删除「${title}」及其 ${kids.length} 个子页面？` : undefined)) { const ids = new Set([note.id]); let grew = true; while (grew) { grew = false; notes.forEach((n) => { if (n.parent && ids.has(n.parent) && !ids.has(n.id)) { ids.add(n.id); grew = true; } }); } update((d) => { d.notes = d.notes.filter((n) => !ids.has(n.id)); }); go('notes'); } }} />
      </div>
    </div>
    ${note.cover && html`<div class="page-cover" style=${coverStyle(note.cover)}><div class="cover-acts"><button class="btn sm" onClick=${() => upsert('notes', { id: note.id, cover: nextCover(note.cover) })}>换一张</button><button class="btn sm" onClick=${() => upsert('notes', { id: note.id, cover: '' })}>移除</button></div></div>`}
    <div class=${'page-body ' + (note.wide ? 'wide' : '')}>
      <div class="page-top">
        <div class="page-hover-acts">
          ${!note.cover && html`<button class="btn ghost sm" onClick=${() => upsert('notes', { id: note.id, cover: nextCover('') })}>添加封面</button>`}
        </div>
      </div>
      <input class="page-title" type="text" value=${note.title} placeholder="无标题" onInput=${(e) => save({ id: note.id, title: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); const el = document.querySelector('.beditor .b-text'); if (el) el.focus(); } }} />
      <div class="props">
        <div class="prop"><span class="pk"><${Icon} name="tag" size=${12} /> 标签</span><span class="pv"><${TagInput} value=${note.tags} onChange=${(v) => upsert('notes', { id: note.id, tags: v })} placeholder="空" /></span></div>
        <div class="prop"><span class="pk"><${Icon} name="layers" size=${12} /> 位置</span><span class="pv click" onClick=${() => setMoveOpen(true)}>${crumbs.length ? crumbs.map(noteTitle).join(' / ') : '顶层'}</span></div>
        <div class="prop"><span class="pk"><${Icon} name="clock" size=${12} /> 更新</span><span class="pv muted">${new Date(note.updated).toLocaleString('zh-CN', { hour12: false })} · 创建 ${note.created} · ${words} 字</span></div>
      </div>
      <${BlockEditor} key=${note.id} blocks=${blocks} onChange=${onBlocks} notes=${notes} noteId=${note.id} onCreatePage=${createLinked} onOpenLink=${(t) => go('notes/t:' + encodeURIComponent(t))} pageFont=${note.font} />
      ${kids.length > 0 && html`<div class="subpages"><div class="sec-h">子页面</div>${kids.map((k) => html`<a class="sub-row" href=${'#/notes/' + k.id}><${Icon} name="note" size=${14} class="muted" />${noteTitle(k)}<span class="muted small" style="margin-left:auto">${k.updated.slice(0, 10)}</span></a>`)}</div>`}
      <div class="links-sec">
        ${outgoing.length > 0 && html`<div class="sec-h">链接到 <span class="muted">${outgoing.length}</span></div><div class="row wrap" style="gap:6px">${outgoing.map(({ t, n }) => html`<a class=${'tag click ' + (n ? '' : 'ghost')} href=${'#/notes/t:' + encodeURIComponent(t)}>${n ? '' : '＋ '}${t}</a>`)}</div>`}
        <div class="sec-h" style="margin-top:14px">反向链接 <span class="muted">${backlinks.length}</span></div>
        ${backlinks.length === 0 ? html`<p class="small muted">还没有其他页面链接到这里。在别的页面里写 <code>[[${title}]]</code> 就会出现在这。</p>` : backlinks.map((n) => html`<a class="bl" href=${'#/notes/' + n.id}><b>${noteTitle(n)}</b><p dangerouslySetInnerHTML=${{ __html: escapeHtml(snippet(n, '[[' + note.title)).replace(escapeHtml('[[' + note.title + ']]'), `<mark>${escapeHtml(note.title)}</mark>`) }}></p></a>`)}
        ${mentions.length > 0 && html`<div class="sec-h" style="margin-top:14px">未链接的提及 <span class="muted">${mentions.length}</span></div>${mentions.map((n) => html`<div class="bl"><a href=${'#/notes/' + n.id}><b>${noteTitle(n)}</b></a><p>${snippet(n, note.title)}</p><button class="btn ghost sm" onClick=${() => upsert('notes', { id: n.id, body: n.body.split(note.title.trim()).join(`[[${note.title.trim()}]]`), updated: new Date().toISOString() })}>转为链接</button></div>`)}`}
      </div>
    </div>
    <${MoveModal} open=${moveOpen} note=${note} notes=${notes} onClose=${() => setMoveOpen(false)} />
  </div>`;
}

function MoveModal({ open, note, notes, onClose }) {
  if (!open) return null;
  const blocked = new Set([note.id]);
  let grew = true; while (grew) { grew = false; notes.forEach((n) => { if (n.parent && blocked.has(n.parent) && !blocked.has(n.id)) { blocked.add(n.id); grew = true; } }); }
  const opts = [];
  const walk = (parent, depth) => childrenOf(notes, parent).forEach((n) => { if (blocked.has(n.id)) return; opts.push({ n, depth }); walk(n.id, depth + 1); });
  walk(null, 0);
  return html`<${Modal} open=${open} onClose=${onClose} title="移动页面">
    <div class="move-list">
      <button class=${'pt-row flat ' + (!note.parent ? 'active' : '')} onClick=${() => { upsert('notes', { id: note.id, parent: null }); onClose(); }}><span class="pt-t">顶层</span></button>
      ${opts.map(({ n, depth }) => html`<button class=${'pt-row flat ' + (note.parent === n.id ? 'active' : '')} style=${`padding-left:${10 + depth * 14}px`} onClick=${() => { upsert('notes', { id: note.id, parent: n.id }); onClose(); }}><span class="pt-t">${noteTitle(n)}</span></button>`)}
    </div>
  <//>`;
}

/* ---------- covers ---------- */
export const COVERS = ['linear-gradient(120deg,#cfe3ff,#eaf2ff)', 'linear-gradient(120deg,#d9f1e6,#f4efe3)', 'linear-gradient(120deg,#ffe1d6,#f0e3ff)', 'linear-gradient(120deg,#1f2937,#4b5563)', 'linear-gradient(120deg,#1d5c66,#52ab98)', 'linear-gradient(120deg,#f7d9c4,#f4c6a5)', 'radial-gradient(120% 120% at 20% 20%,#fde68a,#f59e0b 60%,#b45309)', 'radial-gradient(100% 100% at 80% 10%,#c7d2fe,#6366f1 70%,#312e81)', 'linear-gradient(135deg,#0f172a,#1e3a8a 60%,#38bdf8)'];
export function nextCover(cur) { const i = COVERS.indexOf(cur); return COVERS[(i + 1) % COVERS.length]; }
export function coverStyle(c) { return /^https?:/.test(c) ? `background-image:url(${c})` : `background:${c}`; }

/* ---------- graph ---------- */
function GraphView({ notes }) {
  const ref = useRef();
  useEffect(() => {
    const g = mountGraph(ref.current, notes, (id) => go('notes/' + id));
    return () => g.destroy();
  }, [notes]);
  const links = notes.reduce((n, x) => n + linksOf(x.body).length, 0);
  return html`<div class="graph-wrap"><div class="crumbs"><a href="#/notes">笔记</a><span>/</span><b>图谱</b><span class="flex1"></span><span class="small muted">${notes.length} 页 · ${links} 条链接 · 拖动节点，点击打开</span></div><canvas ref=${ref} class="graph"></canvas></div>`;
}
