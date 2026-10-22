import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { marked } from '../../vendor/marked.js';
import { useStore, upsert, remove, update, get } from '../store.js';
import { Icon, IconBtn, Btn, Card, Tag, Empty, Seg, TagInput, confirmDel, Modal, Field } from '../ui.js';
import { uid, todayStr, sortBy, debounce, escapeHtml } from '../util.js';
import { go } from '../nav.js';
import { mountGraph } from '../graph.js';

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

const SLASH = [
  { k: 'h1', label: '标题 1', hint: '大标题', ins: '# ' },
  { k: 'h2', label: '标题 2', hint: '中标题', ins: '## ' },
  { k: 'h3', label: '标题 3', hint: '小标题', ins: '### ' },
  { k: 'todo', label: '待办清单', hint: '可勾选', ins: '- [ ] ' },
  { k: 'ul', label: '无序列表', hint: '项目符号', ins: '- ' },
  { k: 'ol', label: '有序列表', hint: '编号', ins: '1. ' },
  { k: 'quote', label: '引用', hint: '引述一段话', ins: '> ' },
  { k: 'callout', label: '标注', hint: '💡 提示块', ins: '> 💡 ' },
  { k: 'code', label: '代码块', hint: '```', ins: '```\n\n```', caret: -4 },
  { k: 'hr', label: '分割线', hint: '---', ins: '---\n' },
  { k: 'table', label: '表格', hint: '三列', ins: '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n' },
  { k: 'date', label: '今天的日期', hint: todayStr(), ins: todayStr() + ' ' },
  { k: 'link', label: '链接到页面', hint: '[[ ]] 双链', ins: '[[', special: 'link' },
  { k: 'sub', label: '子页面', hint: '新建并链接', special: 'sub' },
];

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
        <a href=${'#/notes/' + n.id} class="pt-link"><span class="pt-ic">${n.icon || '📄'}</span><span class="pt-t">${noteTitle(n)}</span></a>
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
      <div class="ns-body">
        ${results ? html`<div class="ns-sec">搜索结果 · ${results.length}</div>${results.length === 0 ? html`<div class="small muted" style="padding:6px 10px">没有匹配的页面。</div>` : results.map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id}><span class="pt-ic">${n.icon || '📄'}</span><span class="pt-t">${noteTitle(n)}</span><span class="pt-sub">${ancestors(s.notes, n).map(noteTitle).join(' / ')}</span></a>`)}`
        : tab === 'tags' ? html`${tags.length === 0 ? html`<div class="small muted" style="padding:6px 10px">还没有标签。</div>` : tags.map(([t, c]) => html`<details class="ns-tag" key=${t}><summary><span class="pt-ic">#</span><span class="pt-t">${t}</span><span class="pt-cnt">${c}</span></summary>${s.notes.filter((n) => n.tags.includes(t)).map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} style="padding-left:26px" href=${'#/notes/' + n.id}><span class="pt-ic">${n.icon || '📄'}</span><span class="pt-t">${noteTitle(n)}</span></a>`)}</details>`)}`
        : html`
          ${pinned.length > 0 && html`<div class="ns-sec">收藏</div>${pinned.map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id}><span class="pt-ic">${n.icon || '📌'}</span><span class="pt-t">${noteTitle(n)}</span></a>`)}`}
          <div class="ns-sec">页面 <span class="muted">${s.notes.length}</span></div>
          ${s.notes.length === 0 ? html`<div class="small muted" style="padding:6px 10px">还没有页面。</div>` : html`<${PageTree} notes=${s.notes} activeId=${id} open=${tree.open} toggle=${tree.toggle} onCreate=${create} />`}
          <button class="pt-row flat new" onClick=${() => create(null)}><span class="pt-ic"><${Icon} name="plus" size=${12} /></span><span class="pt-t">新页面</span></button>
          <div class="ns-sec">最近</div>
          ${recent.map((n) => html`<a class=${'pt-row flat ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id}><span class="pt-ic">${n.icon || '📄'}</span><span class="pt-t">${noteTitle(n)}</span></a>`)}`}
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
  const [editing, setEditing] = useState(!note.body && !note.title);
  const [moveOpen, setMoveOpen] = useState(false);
  const save = useMemo(() => debounce((patch) => upsert('notes', { ...patch, updated: new Date().toISOString() }), 250), []);
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
  const setIcon = () => { const v = prompt('页面图标（一个 emoji，留空清除）', note.icon || ''); if (v !== null) upsert('notes', { id: note.id, icon: v.trim().slice(0, 4) }); };

  return html`<div class="page">
    <div class="crumbs">
      <a href="#/notes">笔记</a>${crumbs.map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${title}</b>
      <span class="flex1"></span>
      <div class="page-acts">
        <${IconBtn} icon="pin" title=${note.pinned ? '取消收藏' : '收藏'} class=${'ibtn ' + (note.pinned ? 'on' : '')} onClick=${() => upsert('notes', { id: note.id, pinned: !note.pinned })} />
        <${IconBtn} icon="layers" title="移动到…" onClick=${() => setMoveOpen(true)} />
        <${IconBtn} icon="plus" title="新建子页面" onClick=${onCreateChild} />
        <${IconBtn} icon="trash" class="ibtn danger" title="删除" onClick=${() => { if (confirmDel(kids.length ? `删除「${title}」及其 ${kids.length} 个子页面？` : undefined)) { const ids = new Set([note.id]); let grew = true; while (grew) { grew = false; notes.forEach((n) => { if (n.parent && ids.has(n.parent) && !ids.has(n.id)) { ids.add(n.id); grew = true; } }); } update((d) => { d.notes = d.notes.filter((n) => !ids.has(n.id)); }); go('notes'); } }} />
      </div>
    </div>
    <div class="page-body">
      <button class="page-icon" onClick=${setIcon} title="更换图标">${note.icon || '📄'}</button>
      <input class="page-title" type="text" value=${note.title} placeholder="无标题" onInput=${(e) => save({ id: note.id, title: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true); } }} />
      <div class="props">
        <div class="prop"><span class="pk"><${Icon} name="tag" size=${12} /> 标签</span><span class="pv"><${TagInput} value=${note.tags} onChange=${(v) => upsert('notes', { id: note.id, tags: v })} placeholder="添加标签" /></span></div>
        <div class="prop"><span class="pk"><${Icon} name="layers" size=${12} /> 位置</span><span class="pv click" onClick=${() => setMoveOpen(true)}>${crumbs.length ? crumbs.map(noteTitle).join(' / ') : '顶层'}</span></div>
        <div class="prop"><span class="pk"><${Icon} name="clock" size=${12} /> 更新</span><span class="pv muted">${new Date(note.updated).toLocaleString('zh-CN', { hour12: false })} · 创建 ${note.created} · ${words} 字</span></div>
      </div>
      ${editing
        ? html`<${Editor} note=${note} notes=${notes} save=${save} onDone=${() => setEditing(false)} onCreateChild=${onCreateChild} />`
        : html`<div class="md page-md" onClick=${(e) => { if (e.target.closest('a')) return; setEditing(true); }} title="点击编辑">${note.body.trim() ? html`<div dangerouslySetInnerHTML=${{ __html: renderMd(note.body) }}></div>` : html`<p class="muted">点击开始写… 输入 <code>/</code> 插入块，<code>[[</code> 链接页面。</p>`}</div>`}
      ${kids.length > 0 && html`<div class="subpages"><div class="sec-h">子页面</div>${kids.map((k) => html`<a class="sub-row" href=${'#/notes/' + k.id}><span class="pt-ic">${k.icon || '📄'}</span>${noteTitle(k)}<span class="muted small" style="margin-left:auto">${k.updated.slice(0, 10)}</span></a>`)}</div>`}
      <div class="links-sec">
        ${outgoing.length > 0 && html`<div class="sec-h">链接到 <span class="muted">${outgoing.length}</span></div><div class="row wrap" style="gap:6px">${outgoing.map(({ t, n }) => html`<a class=${'tag click ' + (n ? '' : 'ghost')} href=${'#/notes/t:' + encodeURIComponent(t)}>${n ? (n.icon || '📄') : '＋'} ${t}</a>`)}</div>`}
        <div class="sec-h" style="margin-top:14px">反向链接 <span class="muted">${backlinks.length}</span></div>
        ${backlinks.length === 0 ? html`<p class="small muted">还没有其他页面链接到这里。在别的页面里写 <code>[[${title}]]</code> 就会出现在这。</p>` : backlinks.map((n) => html`<a class="bl" href=${'#/notes/' + n.id}><b>${n.icon || '📄'} ${noteTitle(n)}</b><p dangerouslySetInnerHTML=${{ __html: escapeHtml(snippet(n, '[[' + note.title)).replace(escapeHtml('[[' + note.title + ']]'), `<mark>${escapeHtml(note.title)}</mark>`) }}></p></a>`)}
        ${mentions.length > 0 && html`<div class="sec-h" style="margin-top:14px">未链接的提及 <span class="muted">${mentions.length}</span></div>${mentions.map((n) => html`<div class="bl"><a href=${'#/notes/' + n.id}><b>${n.icon || '📄'} ${noteTitle(n)}</b></a><p>${snippet(n, note.title)}</p><button class="btn ghost sm" onClick=${() => upsert('notes', { id: n.id, body: n.body.split(note.title.trim()).join(`[[${note.title.trim()}]]`), updated: new Date().toISOString() })}>转为链接</button></div>`)}`}
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
      <button class=${'pt-row flat ' + (!note.parent ? 'active' : '')} onClick=${() => { upsert('notes', { id: note.id, parent: null }); onClose(); }}><span class="pt-ic">🏠</span><span class="pt-t">顶层</span></button>
      ${opts.map(({ n, depth }) => html`<button class=${'pt-row flat ' + (note.parent === n.id ? 'active' : '')} style=${`padding-left:${10 + depth * 14}px`} onClick=${() => { upsert('notes', { id: note.id, parent: n.id }); onClose(); }}><span class="pt-ic">${n.icon || '📄'}</span><span class="pt-t">${noteTitle(n)}</span></button>`)}
    </div>
  <//>`;
}

/* ---------- editor with [[ ]] and / menus ---------- */
function Editor({ note, notes, save, onDone, onCreateChild }) {
  const [body, setBody] = useState(note.body);
  const [menu, setMenu] = useState(null); // {kind:'link'|'slash', q, start, idx}
  const ta = useRef();
  useEffect(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, []);
  const commit = (v) => { setBody(v); save({ id: note.id, body: v }); };
  const resize = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 240) + 'px'; };
  useEffect(resize, [body]);

  const detect = (v, pos) => {
    const before = v.slice(0, pos);
    const lk = before.lastIndexOf('[[');
    if (lk >= 0 && !before.slice(lk).includes(']]') && !before.slice(lk).includes('\n')) return { kind: 'link', q: before.slice(lk + 2), start: lk, idx: 0 };
    const ln = before.lastIndexOf('\n') + 1;
    const line = before.slice(ln);
    const m = line.match(/(?:^|\s)\/([^\s/]*)$/);
    if (m) return { kind: 'slash', q: m[1], start: pos - m[1].length - 1, idx: 0 };
    return null;
  };
  const onInput = (e) => { const v = e.target.value; commit(v); setMenu(detect(v, e.target.selectionStart)); };
  const items = useMemo(() => {
    if (!menu) return [];
    const k = menu.q.toLowerCase();
    if (menu.kind === 'link') {
      const list = notes.filter((n) => n.id !== note.id && n.title && n.title.toLowerCase().includes(k)).slice(0, 8).map((n) => ({ label: (n.icon || '📄') + ' ' + n.title, title: n.title }));
      if (k.trim() && !notes.some((n) => n.title.toLowerCase() === k.trim())) list.push({ label: `＋ 新建页面「${menu.q.trim()}」`, title: menu.q.trim(), create: true });
      return list;
    }
    return SLASH.filter((x) => !k || x.label.toLowerCase().includes(k) || x.k.includes(k) || x.hint.includes(k));
  }, [menu, notes]);

  const apply = (it) => {
    const el = ta.current; const pos = el.selectionStart;
    let v = body, caret;
    if (menu.kind === 'link') {
      const ins = `[[${it.title}]]`;
      v = body.slice(0, menu.start) + ins + body.slice(pos);
      caret = menu.start + ins.length;
      if (it.create) newNote({ title: it.title, parent: note.id });
    } else if (it.special === 'sub') {
      const child = newNote({ title: '新子页面', parent: note.id });
      const ins = `[[${child.title}]]`;
      v = body.slice(0, menu.start) + ins + body.slice(pos); caret = menu.start + ins.length;
    } else {
      v = body.slice(0, menu.start) + it.ins + body.slice(pos);
      caret = menu.start + it.ins.length + (it.caret || 0);
    }
    commit(v); setMenu(it.special === 'link' ? { kind: 'link', q: '', start: menu.start, idx: 0 } : null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = caret; });
  };
  const onKey = (e) => {
    if (menu && items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, idx: (menu.idx + 1) % items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, idx: (menu.idx - 1 + items.length) % items.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(items[menu.idx]); return; }
    }
    if (e.key === 'Escape') { if (menu) setMenu(null); else onDone(); return; }
    if (e.key === 'Tab') { e.preventDefault(); const el = e.target, a = el.selectionStart; commit(body.slice(0, a) + '  ' + body.slice(el.selectionEnd)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; }); }
    if (e.key === 'Enter' && !e.shiftKey) {
      // continue lists like Notion
      const el = e.target, a = el.selectionStart;
      const ln = body.lastIndexOf('\n', a - 1) + 1; const line = body.slice(ln, a);
      const m = line.match(/^(\s*)(- \[[ x]\] |- |\* |\d+\. |> )(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[3].trim()) { commit(body.slice(0, ln) + body.slice(a)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = ln; }); return; }
        let pre = m[2]; if (/^\d+\. $/.test(pre)) pre = (parseInt(pre) + 1) + '. '; if (pre.startsWith('- [')) pre = '- [ ] ';
        const ins = '\n' + m[1] + pre; commit(body.slice(0, a) + ins + body.slice(el.selectionEnd)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + ins.length; });
      }
    }
  };
  return html`<div class="editor-wrap">
    <textarea ref=${ta} class="page-ta" value=${body} placeholder="开始写… 输入 / 插入块，[[ 链接页面" onInput=${onInput} onKeyDown=${onKey} onClick=${(e) => setMenu(detect(body, e.target.selectionStart))} onBlur=${() => setTimeout(() => setMenu(null), 150)}></textarea>
    ${menu && items.length > 0 && html`<div class="popmenu">${items.map((it, i) => html`<div class=${'pm ' + (i === menu.idx ? 'on' : '')} onMouseDown=${(e) => { e.preventDefault(); apply(it); }}><b>${it.label}</b>${it.hint && html`<small>${it.hint}</small>`}</div>`)}</div>`}
    <div class="editor-foot"><span class="small muted">Markdown · <code>/</code> 块 · <code>[[</code> 链接 · Esc 完成</span><span class="flex1"></span><${Btn} small kind="primary" icon="check" onClick=${onDone}>完成<//></div>
  </div>`;
}

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
