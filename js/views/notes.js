import { html, useState, useMemo, useEffect, useRef, Component } from '../../vendor/preact.js';
import { marked } from '../../vendor/marked.js';
import { useStore, upsert, remove, update, get } from '../store.js';
import { Icon, IconBtn, Btn, Card, Tag, Empty, Seg, TagInput, confirmDel, Modal, Field } from '../ui.js';
import { uid, todayStr, sortBy, debounce, escapeHtml } from '../util.js';
import { go, toast } from '../nav.js';
import { ctxMenu } from '../ctx.js';
import { dragProps, dropProps } from '../dnd.js';
import { Splitter } from '../resize.js';
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
export const NB_COLORS = ['#4f7cf5', '#7461c9', '#2d8f88', '#c9588a', '#c7873a', '#4a9a6a', '#d2524f', '#8a8f98'];
export function nbOf(s, id) { return s.notebooks.find((b) => b.id === id); }
export function newNotebook(name, color) {
  const nb = { id: uid(), name: name || '新本子', color: color || NB_COLORS[get().notebooks.length % NB_COLORS.length], order: Date.now() };
  update((d) => { d.notebooks.push(nb); });
  return nb;
}
export function notebookMenu(nb, s, onRename) {
  const count = s.notes.filter((n) => n.nb === nb.id).length;
  return [
    { label: '新建页面', icon: 'plus', onClick: () => { const n = newNote({ nb: nb.id }); go('notes/' + n.id); } },
    { label: '重命名', icon: 'edit', onClick: onRename },
    { label: '换颜色', icon: 'tag', onClick: () => update((d) => { const b = d.notebooks.find((x) => x.id === nb.id); b.color = NB_COLORS[(NB_COLORS.indexOf(b.color) + 1) % NB_COLORS.length]; }) },
    'sep',
    { label: '删除本子', icon: 'trash', danger: true, hint: count ? `${count} 页进最近删除` : '', disabled: nb.id === 'nb-inbox', onClick: () => { if (count && !confirmDel(`删除本子「${nb.name}」？里面的 ${count} 页会进入「最近删除」，30 天内可恢复。`)) return; const ids = s.notes.filter((n) => n.nb === nb.id).map((n) => n.id); update((d) => { d.notebooks = d.notebooks.filter((x) => x.id !== nb.id); }); if (ids.length) trashPages(ids, nb.name); } },
  ];
}
export function trashPages(ids, label) {
  const set = ids instanceof Set ? ids : new Set(ids);
  const now = new Date().toISOString();
  let moved = [];
  update((d) => {
    moved = d.notes.filter((n) => set.has(n.id)).map((n) => ({ ...n, deletedAt: now }));
    d.trash = [...moved, ...(d.trash || [])];
    d.notes = d.notes.filter((n) => !set.has(n.id));
  });
  const cur = location.hash.split('/')[2];
  if (cur && set.has(cur)) go('notes');
  toast(`已删除${label ? '「' + label + '」' : ''}${moved.length > 1 ? ' 等 ' + moved.length + ' 页' : ''}`, { label: '撤销', onClick: () => restorePages(moved.map((n) => n.id)) });
}
export function restorePages(ids) {
  const set = new Set(ids);
  update((d) => {
    const back = (d.trash || []).filter((n) => set.has(n.id));
    d.trash = (d.trash || []).filter((n) => !set.has(n.id));
    back.forEach((n) => { delete n.deletedAt; if (n.parent && !d.notes.some((x) => x.id === n.parent) && !back.some((x) => x.id === n.parent)) n.parent = null; if (!d.notebooks.some((b) => b.id === n.nb)) n.nb = 'nb-inbox'; });
    d.notes = [...back, ...d.notes];
  });
}
export function purgePages(ids) { const set = new Set(ids); update((d) => { d.trash = (d.trash || []).filter((n) => !set.has(n.id)); }); }
export function daysLeft(n) { return Math.max(0, 30 - Math.floor((Date.now() - new Date(n.deletedAt).getTime()) / 86400000)); }
export function subtreeIds(notes, id) { const ids = new Set([id]); let grew = true; while (grew) { grew = false; notes.forEach((x) => { if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }); } return ids; }
export function movePage(pageId, { nb, parent = null, before = null, after = null } = {}) {
  update((d) => {
    const ids = subtreeIds(d.notes, pageId);
    if (parent && ids.has(parent)) return;
    const page = d.notes.find((x) => x.id === pageId); if (!page) return;
    const targetNb = nb || (parent ? (d.notes.find((x) => x.id === parent) || {}).nb : null) || page.nb;
    d.notes.forEach((x) => { if (ids.has(x.id)) x.nb = targetNb; });
    page.parent = parent || null;
    const ref = before || after; if (ref) { const r = d.notes.find((x) => x.id === ref); if (r) page.order = (r.order || 0) + (after ? 0.5 : -0.5); }
    // normalise orders among siblings
    const sib = d.notes.filter((x) => (x.parent || null) === (page.parent || null) && x.nb === targetNb).sort((a, b) => (a.order || 0) - (b.order || 0));
    sib.forEach((x, i) => { x.order = i; });
  });
}
export function newNote(patch = {}) {
  const inherit = patch.parent ? (get().notes.find((x) => x.id === patch.parent) || {}).nb : null;
  const n = { id: uid(), title: '', body: '', tags: [], parent: null, nb: inherit || patch.nb || currentNb() || 'nb-inbox', order: Date.now(), pinned: false, icon: '', created: todayStr(), updated: new Date().toISOString(), ...patch };
  upsert('notes', n);
  return n;
}
export function isBlank(n) { return !n.title.trim() && !(n.body || '').trim() && !n.cover; }
let _curNb = null;
export function currentNb() { return _curNb; }
export function findByTitle(notes, title) { return notes.find((x) => x.title.trim().toLowerCase() === title.trim().toLowerCase()); }


/* ---------- page tree (sidebar) ---------- */
export function pageMenu(n, notes, extra = {}) {
  const kids = notes.filter((x) => x.parent === n.id).length;
  return [
    { label: '打开', icon: 'note', onClick: () => go('notes/' + n.id) },
    { label: '在新标签页打开', icon: 'external', onClick: () => window.open('#/notes/' + n.id, '_blank') },
    extra.focus && { label: '专注模式', icon: 'eye', onClick: extra.focus },
    extra.cover && { label: n.cover ? '更换封面' : '添加封面', icon: 'image', onClick: extra.cover },
    extra.cover && n.cover && { label: '移除封面', icon: 'x', onClick: () => upsert('notes', { id: n.id, cover: '' }) },
    'sep',
    { label: '新建子页面', icon: 'plus', onClick: () => { const c = newNote({ parent: n.id }); extra.openPath && extra.openPath([n.id]); go('notes/' + c.id); } },
    { label: n.pinned ? '取消收藏' : '收藏', icon: 'pin', onClick: () => upsert('notes', { id: n.id, pinned: !n.pinned }) },
    { label: '复制一份', icon: 'layers', onClick: () => { const c = newNote({ ...n, id: undefined, title: n.title + ' 副本', pinned: false, blocks: (n.blocks || []).map((b) => ({ ...b, id: uid() })) }); go('notes/' + c.id); } },
    { label: '复制链接', icon: 'link', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(location.origin + location.pathname + '#/notes/' + n.id); toast('已复制链接'); } },
    extra.move && { label: '移动到…', icon: 'layers', onClick: extra.move },
    ...(extra.notebooks ? ['sep', ...extra.notebooks.map((b) => ({ label: `放入「${b.name}」`, icon: b.id === n.nb ? 'check' : 'book', onClick: () => { const ids = new Set([n.id]); let grew = true; while (grew) { grew = false; notes.forEach((x) => { if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }); } update((d) => { d.notes.forEach((x) => { if (ids.has(x.id)) x.nb = b.id; if (x.id === n.id) x.parent = null; }); }); } }))] : []),
    'sep',
    { label: '删除', icon: 'trash', danger: true, hint: kids ? `含 ${kids} 子页` : '', onClick: () => trashPages(subtreeIds(notes, n.id), noteTitle(n)) },
  ];
}

export function PageTree({ notes, parent = null, depth = 0, activeId, open, toggle, onCreate, max = 60, openPath, nb }) {
  const kids = childrenOf(notes, parent).filter((n) => !nb || n.nb === nb).slice(0, max);
  if (!kids.length) return null;
  return html`<ul class=${'ptree ' + (depth === 0 ? 'root' : '')}>${kids.map((n) => {
    const has = notes.some((x) => x.parent === n.id);
    const isOpen = !!open[n.id];
    return html`<li key=${n.id}>
      <div class=${'pt-row ' + (n.id === activeId ? 'active' : '')} style=${`padding-left:${8 + depth * 14}px`} onContextMenu=${(e) => ctxMenu(e, pageMenu(n, notes, { openPath }), noteTitle(n))} ...${dragProps('page', { id: n.id })} ...${dropProps('page', (d, { event }) => { if (d.id === n.id) return; const r = event.currentTarget.getBoundingClientRect(); const y = (event.clientY - r.top) / r.height; if (y > 0.3 && y < 0.7) { movePage(d.id, { parent: n.id }); openPath && openPath([n.id]); } else movePage(d.id, { parent: n.parent || null, nb: n.nb, [y >= 0.7 ? 'after' : 'before']: n.id }); })}>
        <button class=${'pt-tg ' + (has ? '' : 'none')} onClick=${() => toggle(n.id)} aria-label="展开"><${Icon} name=${isOpen ? 'down' : 'right'} size=${11} /></button>
        <a href=${'#/notes/' + n.id} class="pt-link"><${Icon} name="note" size=${14} class="pt-ic" /><span class="pt-t">${noteTitle(n)}</span></a>
        <button class="pt-add" title="新建子页面" onClick=${() => onCreate(n.id)}><${Icon} name="plus" size=${11} /></button>
      </div>
      ${isOpen && has && html`<${PageTree} notes=${notes} parent=${n.id} depth=${depth + 1} activeId=${activeId} open=${open} toggle=${toggle} onCreate=${onCreate} openPath=${openPath} nb=${nb} />`}
    </li>`;
  })}</ul>`;
}

export function useTreeState() {
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.tree') || '{}'); } catch { return {}; } });
  const toggle = (id) => setOpen((o) => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem('ytos.tree', JSON.stringify(n)); } catch {} return n; });
  const openPath = (ids) => setOpen((o) => { const n = { ...o }; ids.forEach((i) => { n[i] = true; }); try { localStorage.setItem('ytos.tree', JSON.stringify(n)); } catch {} return n; });
  const closeAll = () => setOpen(() => { try { localStorage.setItem('ytos.tree', '{}'); } catch {} return {}; });
  return { open, toggle, openPath, closeAll };
}

/* ---------- main view: notebooks / pages / page ---------- */
function snippet(n) { return (n.body || '').replace(/[#>*`\[\]\-|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90); }

export default function Notes({ route }) {
  const s = useStore();
  const id = route.sub;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('ytos.nsort') || 'updated'; } catch { return 'updated'; } });
  const [nbSel, setNbSel] = useState(() => { try { return localStorage.getItem('ytos.nb') || 'all'; } catch { return 'all'; } });
  const [panes, setPanes] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.panes') || '{"nb":true,"list":true}'); } catch { return { nb: true, list: true }; } });
  const [renaming, setRenaming] = useState(null);
  const [expanded, setExpanded] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.nbx') || '{}'); } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem('ytos.nbx', JSON.stringify(expanded)); } catch {} }, [expanded]);
  const tree = useTreeState();
  const pick = (v) => { setNbSel(v); try { localStorage.setItem('ytos.nb', v); } catch {} };
  const setPane = (k, v) => setPanes((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem('ytos.panes', JSON.stringify(n)); } catch {} return n; });
  _curNb = s.notebooks.some((b) => b.id === nbSel) ? nbSel : null;

  useEffect(() => {
    if (id && id.startsWith('t:')) {
      const title = decodeURIComponent(id.slice(2));
      let n = findByTitle(s.notes, title);
      if (!n) n = newNote({ title });
      go('notes/' + n.id);
    }
  }, [id]);
  const note = s.notes.find((n) => n.id === id);
  useEffect(() => { if (note) { tree.openPath(ancestors(s.notes, note).map((a) => a.id)); if (note.nb && nbSel !== 'all' && nbSel !== 'fav' && nbSel !== note.nb) pick(note.nb); } }, [id]);
  useEffect(() => { if (nbSel === 'trash' && !(s.trash || []).length && !trashed) pick('all'); }, [s.trash]);

  const nbs = sortBy(s.notebooks, 'order');
  const inNb = (n) => nbSel === 'all' ? true : nbSel === 'fav' ? n.pinned : n.nb === nbSel;
  const inTrash = nbSel === 'trash';
  const visible = useMemo(() => {
    let l = inTrash ? [...(s.trash || [])] : s.notes.filter(inNb);
    if (inTrash) { if (q.trim()) { const k = q.toLowerCase(); l = l.filter((n) => (n.title + ' ' + n.body).toLowerCase().includes(k)); } return sortBy(l, '-deletedAt'); }
    if (q.trim()) { const k = q.toLowerCase(); l = l.filter((n) => (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(k)); }
    return sort === 'manual' ? sortBy(l, '-pinned', 'order') : sortBy(l, '-pinned', sort === 'title' ? 'title' : sort === 'created' ? '-created' : '-updated');
  }, [s.notes, s.trash, nbSel, q, sort]);
  const create = (parent = null) => { const n = newNote({ parent, nb: nbSel === 'all' || nbSel === 'fav' ? 'nb-inbox' : nbSel }); if (parent) tree.openPath([parent]); go('notes/' + n.id); };
  const counts = useMemo(() => { const m = new Map(); s.notes.forEach((n) => m.set(n.nb, (m.get(n.nb) || 0) + 1)); return m; }, [s.notes]);
  const cur = nbs.find((b) => b.id === nbSel);
  const listTitle = nbSel === 'all' ? '全部笔记' : nbSel === 'fav' ? '收藏' : nbSel === 'trash' ? '最近删除' : cur ? cur.name : '笔记';
  const trashed = inTrash ? (s.trash || []).find((n) => n.id === id) : null;

  return html`<div class=${'nb-layout ' + (panes.nb ? '' : 'no-nb ') + (panes.list ? '' : 'no-list ')}>
    ${panes.nb && html`<aside class="card nb-col">
      <div class="nb-h"><h3>本子</h3><div class="row" style="gap:2px"><${IconBtn} icon="plus" title="新本子" onClick=${() => { const nb = newNotebook(); setRenaming(nb.id); pick(nb.id); }} /><${IconBtn} icon="left" title="收起" onClick=${() => setPane('nb', false)} /></div></div>
      <div class="nb-list" data-liquid=".nb-i"><span class="liq"></span>
        <button class=${'nb-i ' + (nbSel === 'all' ? 'active' : '')} onClick=${() => pick('all')}><${Icon} name="note" size=${14} /><span class="flex1">全部笔记</span><small>${s.notes.length}</small></button>
        <button class=${'nb-i ' + (nbSel === 'fav' ? 'active' : '')} onClick=${() => pick('fav')} ...${dropProps('page', (d) => upsert('notes', { id: d.id, pinned: true }))}><${Icon} name="pin" size=${14} /><span class="flex1">收藏</span><small>${s.notes.filter((n) => n.pinned).length}</small></button>
        <div class="nb-sec">本子</div>
        ${nbs.map((b) => html`<div key=${b.id}><button class=${'nb-i ' + (nbSel === b.id ? 'active' : '')} onClick=${() => pick(b.id)} onDblClick=${() => setRenaming(b.id)} onContextMenu=${(e) => ctxMenu(e, notebookMenu(b, s, () => setRenaming(b.id)), b.name)}
          ...${dragProps('notebook', { id: b.id })} ...${dropProps(['page', 'notebook'], (d, { after }) => { if (d.id === b.id) return; if (s.notes.some((n) => n.id === d.id)) { movePage(d.id, { nb: b.id, parent: null }); } else { update((dd) => { const list = dd.notebooks.sort((x, y) => x.order - y.order); const from = list.findIndex((x) => x.id === d.id); const [mv] = list.splice(from, 1); let to = list.findIndex((x) => x.id === b.id); if (after) to++; list.splice(to, 0, mv); list.forEach((x, i) => { x.order = i; }); }); } }, { position: true })}>
          <span class=${'nb-tg ' + (expanded[b.id] ? 'open' : '')} onClick=${(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [b.id]: !x[b.id] })); }}><${Icon} name="right" size=${11} /></span>
          <i class="nb-dot" style=${`background:${b.color}`}></i>
          ${renaming === b.id ? html`<input class="nb-rename" autofocus value=${b.name} onClick=${(e) => e.stopPropagation()} onBlur=${(e) => { const v = e.target.value.trim(); if (v) update((d) => { d.notebooks.find((x) => x.id === b.id).name = v; }); setRenaming(null); }} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />` : html`<span class="flex1">${b.name}</span>`}
          <small>${counts.get(b.id) || 0}</small>
        </button>
        ${expanded[b.id] && html`<div class="nb-sub"><${PageTree} notes=${s.notes} nb=${b.id} activeId=${id} open=${tree.open} toggle=${tree.toggle} onCreate=${create} openPath=${tree.openPath} max=${200} /></div>`}
        </div>`)}
        <button class="nb-i new" onClick=${() => { const nb = newNotebook(); setRenaming(nb.id); pick(nb.id); }}><${Icon} name="plus" size=${13} /><span>新本子</span></button>
      </div>
      <button class=${'nb-i trash-i ' + (nbSel === 'trash' ? 'active' : '')} onClick=${() => pick('trash')} ...${dropProps('page', (d) => { const n = s.notes.find((x) => x.id === d.id); if (n) trashPages(subtreeIds(s.notes, n.id), noteTitle(n)); })}><${Icon} name="trash" size=${14} /><span class="flex1">最近删除</span><small>${(s.trash || []).length}</small></button>
      <div class="nb-foot" style="position:relative"><a class=${'nb-i ' + (id === 'graph' ? 'active' : '')} href="#/notes/graph"><${Icon} name="compass" size=${14} /><span>图谱</span></a><a class=${'nb-i ' + (id === 'tags' ? 'active' : '')} href="#/notes/tags"><${Icon} name="tag" size=${14} /><span>标签</span></a></div>
    </aside>`}
    ${panes.nb && html`<${Splitter} varName="nbw" min=${150} max=${360} />`}
    ${panes.list && html`<section class="card list-col">
      <div class="lc-h">
        ${!panes.nb && html`<${IconBtn} icon="right" title="显示本子" onClick=${() => setPane('nb', true)} />`}
        <h3 class="flex1">${listTitle} <span class="muted small">${visible.length}</span></h3>
        <select class="lc-sort" value=${sort} onChange=${(e) => { setSort(e.target.value); try { localStorage.setItem('ytos.nsort', e.target.value); } catch {} }}><option value="updated">最近更新</option><option value="created">创建时间</option><option value="title">标题</option><option value="manual">自定义顺序</option></select>
        ${inTrash ? html`<button class="btn ghost sm danger" disabled=${!(s.trash || []).length} onClick=${() => { if (confirmDel(`彻底删除最近删除中的 ${(s.trash || []).length} 页？此操作不可撤销。`)) purgePages((s.trash || []).map((n) => n.id)); }}>清空</button>` : html`<${IconBtn} icon="plus" title="新页面" onClick=${() => create(null)} />`}
        <${IconBtn} icon="left" title="收起列表" onClick=${() => setPane('list', false)} />
      </div>
      <div class="searchin"><${Icon} name="search" size=${13} /><input type="search" value=${q} placeholder="搜索…" onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="lc-list" data-liquid=".li-i"><span class="liq"></span>
        ${visible.length === 0 ? html`<${Empty} icon=${inTrash ? 'trash' : 'note'} text=${q ? '没有匹配的页面。' : inTrash ? '最近删除是空的。删除的页面会在这里保留 30 天。' : '这个本子还是空的。'}>${!inTrash && html`<${Btn} small onClick=${() => create(null)}>新页面<//>`}<//>` : inTrash ? visible.map((n) => html`<a key=${n.id} class=${'li-i trash ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id} onContextMenu=${(e) => ctxMenu(e, [{ label: '恢复', icon: 'refresh', onClick: () => restorePages([n.id]) }, { label: '彻底删除', icon: 'trash', danger: true, onClick: () => confirmDel('彻底删除这一页？不可撤销。') && purgePages([n.id]) }], noteTitle(n))}>
          <b>${noteTitle(n)}</b><p>${snippet(n) || '空白页'}</p><small>${daysLeft(n)} 天后自动删除</small>
          <span class="li-acts"><button class="ibtn" title="恢复" onClick=${(e) => { e.preventDefault(); restorePages([n.id]); }}><${Icon} name="refresh" size=${13} /></button><button class="ibtn danger" title="彻底删除" onClick=${(e) => { e.preventDefault(); if (confirmDel('彻底删除这一页？不可撤销。')) purgePages([n.id]); }}><${Icon} name="trash" size=${13} /></button></span>
        </a>`) : visible.map((n) => { const nb = nbOf(s, n.nb); const par = n.parent ? s.notes.find((x) => x.id === n.parent) : null; return html`<a key=${n.id} class=${'li-i ' + (n.id === id ? 'active' : '')} href=${'#/notes/' + n.id} onContextMenu=${(e) => ctxMenu(e, pageMenu(n, s.notes, { notebooks: nbs, openPath: tree.openPath }), noteTitle(n))} ...${dragProps('page', { id: n.id })} ...${dropProps('page', (d, { after }) => { if (d.id === n.id) return; movePage(d.id, { parent: n.parent || null, nb: n.nb, [after ? 'after' : 'before']: n.id }); if (sort !== 'manual') { setSort('manual'); try { localStorage.setItem('ytos.nsort', 'manual'); } catch {} } }, { position: true })}>
          <b>${n.pinned && html`<${Icon} name="pin" size=${11} class="li-pin" />`}${par ? html`<span class="li-par">${noteTitle(par)} / </span>` : ''}${noteTitle(n)}</b>
          <p>${snippet(n) || '空白页'}</p>
          <small>${n.updated.slice(5, 10).replace('-', '/')}${nbSel === 'all' || nbSel === 'fav' ? html` · <i style=${`background:${nb ? nb.color : '#999'}`}></i> ${nb ? nb.name : ''}` : ''}${n.tags.length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : ''}</small>
          <span class="li-acts"><button class="ibtn" title=${n.pinned ? '取消收藏' : '收藏'} onClick=${(e) => { e.preventDefault(); upsert('notes', { id: n.id, pinned: !n.pinned }); }}><${Icon} name="pin" size=${13} /></button><button class="ibtn danger" title="删除" onClick=${(e) => { e.preventDefault(); trashPages(subtreeIds(s.notes, n.id), noteTitle(n)); }}><${Icon} name="trash" size=${13} /></button></span>
        </a>`; })}
      </div>
    </section>`}
    ${panes.list && html`<${Splitter} varName="lcw" min=${200} max=${480} />`}
    <section class="card notes-main">
      ${!panes.list && html`<button class="pane-show" title="显示列表" onClick=${() => setPane('list', true)}><${Icon} name="right" size=${14} /></button>`}
      ${id === 'graph' ? html`<${GraphView} notes=${s.notes} />`
      : id === 'tags' ? html`<${TagsView} notes=${s.notes} />`
      : trashed ? html`<div class="page"><div class="trash-bar"><${Icon} name="trash" size=${14} /><span class="flex1">这一页在「最近删除」里，${daysLeft(trashed)} 天后会自动删除。</span><${Btn} small kind="primary" icon="refresh" onClick=${() => { restorePages([trashed.id]); }}>恢复<//><${Btn} small kind="ghost danger" onClick=${() => { if (confirmDel('彻底删除这一页？不可撤销。')) { purgePages([trashed.id]); go('notes'); } }}>彻底删除<//></div><div class="page-body"><h1 class="trash-title">${noteTitle(trashed)}</h1><div class="md" dangerouslySetInnerHTML=${{ __html: renderMd(trashed.body) }}></div></div></div>`
      : !note ? html`<div class="notes-empty"><${Empty} icon="note" text=${cur ? `「${cur.name}」· 选一页，或新建一页。` : '选一页，或新建一页。'}><div class="row" style="gap:8px"><${Btn} small kind="primary" onClick=${() => create(null)}>新页面<//></div><//></div>`
      : html`<${Page} key=${note.id} note=${note} notes=${s.notes} notebooks=${nbs} onCreateChild=${() => create(note.id)} />`}
    </section>
  </div>`;
}

function TagsView({ notes }) {
  const tags = useMemo(() => { const m = new Map(); notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [notes]);
  return html`<div class="page"><div class="crumbs"><a href="#/notes">笔记</a><span>/</span><b>标签</b></div><div class="page-body">
    ${tags.length === 0 ? html`<${Empty} icon="tag" text="还没有标签。在页面属性里给页面加标签。" />` : tags.map(([t, c]) => html`<div class="tag-group" key=${t}><div class="sec-h"><${Tag}>${t}<//> <span class="muted">${c}</span></div>${notes.filter((n) => n.tags.includes(t)).map((n) => html`<a class="sub-row" href=${'#/notes/' + n.id}><${Icon} name="note" size=${14} class="muted" />${noteTitle(n)}</a>`)}</div>`)}
  </div></div>`;
}

/* ---------- page ---------- */
// Re-renders only when the page changes; the editor keeps its own state while typing.
class Still extends Component {
  shouldComponentUpdate(p) { return p.k !== this.props.k; }
  render(p) { return p.children; }
}

function Page({ note, notes, notebooks = [], onCreateChild }) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [focus, setFocus] = useState(() => document.body.classList.contains('focus-mode'));
  const [propsOpen, setPropsOpen] = useState(() => { try { return localStorage.getItem('ytos.props') === '1'; } catch { return false; } });
  const toggleProps = () => setPropsOpen((v) => { try { localStorage.setItem('ytos.props', v ? '0' : '1'); } catch {} return !v; });
  useEffect(() => { document.body.classList.toggle('focus-mode', focus); const k = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-bg, .popmenu, .ctx')) setFocus(false); }; window.addEventListener('keydown', k); return () => { window.removeEventListener('keydown', k); document.body.classList.remove('focus-mode'); }; }, [focus]);
  const save = useMemo(() => debounce((patch) => upsert('notes', { ...patch, updated: new Date().toISOString() }), 250), []);
  const onBlocks = useMemo(() => (blocks) => upsert('notes', { id: note.id, blocks, body: blocksToMd(blocks), updated: new Date().toISOString() }), [note.id]);
  const blocks = useMemo(() => (note.blocks && note.blocks.length ? note.blocks : mdToBlocks(note.body)), [note.id]);
  const notesRef = useRef(notes); notesRef.current = notes;
  const openLink = useMemo(() => (t) => go('notes/t:' + encodeURIComponent(t)), []);
  const createRef = useRef(); createRef.current = (title) => { if (!findByTitle(get().notes, title)) newNote({ title, parent: note.id }); };
  const createLinkedStable = useMemo(() => (t) => createRef.current(t), []);
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
    <div class="crumbs" onContextMenu=${(e) => ctxMenu(e, pageMenu(note, notes, { move: () => setMoveOpen(true), notebooks, focus: () => setFocus(true), cover: () => upsert('notes', { id: note.id, cover: nextCover(note.cover || '') }) }), title)}>
      <a href="#/notes">笔记</a>${(() => { const b = notebooks.find((x) => x.id === note.nb); return b ? html`<span>/</span><a href="#/notes" onClick=${() => { try { localStorage.setItem('ytos.nb', b.id); } catch {} }}><i class="nb-dot" style=${`background:${b.color};margin-right:5px`}></i>${b.name}</a>` : ''; })()}${crumbs.map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${title}</b>
      <span class="flex1"></span>
      <div class="page-acts">
        <div class="seg mini"><button class=${!note.font || note.font === 'default' ? 'on' : ''} title="默认字体" onClick=${() => upsert('notes', { id: note.id, font: 'default' })}>Ag</button><button class=${'serif-f ' + (note.font === 'serif' ? 'on' : '')} title="衬线" onClick=${() => upsert('notes', { id: note.id, font: 'serif' })}>Ag</button><button class=${'mono-f ' + (note.font === 'mono' ? 'on' : '')} title="等宽" onClick=${() => upsert('notes', { id: note.id, font: 'mono' })}>Ag</button></div>
        <${IconBtn} icon=${focus ? 'x' : 'external'} title=${focus ? '退出专注（Esc）' : '专注模式（全屏）'} onClick=${() => setFocus(!focus)} />
        <${IconBtn} icon="image" title=${note.cover ? '更换封面' : '添加封面'} onClick=${() => upsert('notes', { id: note.id, cover: nextCover(note.cover || '') })} />
        <${IconBtn} icon="grid" title=${note.wide ? '标准宽度' : '全宽'} onClick=${() => upsert('notes', { id: note.id, wide: !note.wide })} />
        <${IconBtn} icon="pin" title=${note.pinned ? '取消收藏' : '收藏'} class=${'ibtn ' + (note.pinned ? 'on' : '')} onClick=${() => upsert('notes', { id: note.id, pinned: !note.pinned })} />
        <${IconBtn} icon="layers" title="移动到…" onClick=${() => setMoveOpen(true)} />
        <${IconBtn} icon="plus" title="新建子页面" onClick=${onCreateChild} />
        <${IconBtn} icon="trash" class="ibtn danger" title="删除（可在最近删除中恢复）" onClick=${() => trashPages(subtreeIds(notes, note.id), title)} />
      </div>
    </div>
    ${note.cover && html`<div class="page-cover" style=${coverStyle(note.cover)}><div class="cover-acts"><button class="btn sm" onClick=${() => upsert('notes', { id: note.id, cover: nextCover(note.cover) })}>换一张</button><button class="btn sm" onClick=${() => upsert('notes', { id: note.id, cover: '' })}>移除</button></div></div>`}
    <div class=${'page-body ' + (note.wide ? 'wide' : '')}>
      <input class="page-title" type="text" value=${note.title} placeholder="无标题" onInput=${(e) => save({ id: note.id, title: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); const el = document.querySelector('.beditor .b-text'); if (el) el.focus(); } }} />
      <div class=${'props ' + (propsOpen ? '' : 'collapsed')}>
        <button class="props-line" onClick=${toggleProps} title=${propsOpen ? '收起属性' : '展开属性'}>
          <${Icon} name=${propsOpen ? 'down' : 'right'} size=${12} />
          ${(() => { const b = notebooks.find((x) => x.id === note.nb); return b ? html`<span class="pl-i"><i class="nb-dot" style=${`background:${b.color}`}></i>${b.name}</span>` : ''; })()}
          ${note.tags.length ? note.tags.map((t) => html`<${Tag}>${t}<//>`) : html`<span class="pl-i muted">无标签</span>`}
          <span class="pl-i muted">${new Date(note.updated).toLocaleDateString('zh-CN')} · ${words} 字</span>
        </button>
        <div class="prop"><span class="pk"><${Icon} name="tag" size=${12} /> 标签</span><span class="pv"><${TagInput} value=${note.tags} onChange=${(v) => upsert('notes', { id: note.id, tags: v })} placeholder="空" /></span></div>
        <div class="prop"><span class="pk"><${Icon} name="book" size=${12} /> 本子</span><span class="pv"><select class="pv-sel" value=${note.nb || 'nb-inbox'} onChange=${(e) => { const b = e.target.value; const ids = new Set([note.id]); let grew = true; while (grew) { grew = false; notes.forEach((x) => { if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }); } update((d) => { d.notes.forEach((x) => { if (ids.has(x.id)) x.nb = b; if (x.id === note.id) x.parent = null; }); }); }}>${notebooks.map((b) => html`<option value=${b.id}>${b.name}</option>`)}</select></span></div>
        <div class="prop"><span class="pk"><${Icon} name="layers" size=${12} /> 位置</span><span class="pv click" onClick=${() => setMoveOpen(true)}>${crumbs.length ? crumbs.map(noteTitle).join(' / ') : '顶层'}</span></div>
        <div class="prop"><span class="pk"><${Icon} name="clock" size=${12} /> 更新</span><span class="pv muted">${new Date(note.updated).toLocaleString('zh-CN', { hour12: false })} · 创建 ${note.created} · ${words} 字</span></div>
      </div>
      <${Still} k=${note.id + ':' + (note.font || '')}><${BlockEditor} key=${note.id} blocks=${blocks} onChange=${onBlocks} notesRef=${notesRef} noteId=${note.id} onCreatePage=${createLinkedStable} onOpenLink=${openLink} pageFont=${note.font} /><//>
      ${kids.length > 0 && html`<div class="subpages"><div class="sec-h">子页面</div>${kids.map((k) => html`<a class="sub-row" href=${'#/notes/' + k.id} onContextMenu=${(e) => ctxMenu(e, pageMenu(k, notes), noteTitle(k))}><${Icon} name="note" size=${14} class="muted" />${noteTitle(k)}<span class="muted small" style="margin-left:auto">${k.updated.slice(0, 10)}</span></a>`)}</div>`}
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
  const walk = (parent, depth) => childrenOf(notes, parent).forEach((n) => { if (blocked.has(n.id) || n.nb !== note.nb) return; opts.push({ n, depth }); walk(n.id, depth + 1); });
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
