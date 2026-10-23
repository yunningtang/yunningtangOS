// Block editor on a single contenteditable surface (like a document), with one row per block.
// Text selection, copy and formatting flow across blocks natively; structure (split/merge/convert) is ours.
import { html, useState, useRef, useEffect, useLayoutEffect, useCallback, Component } from '../vendor/preact.js';
import { marked } from '../vendor/marked.js';
import { Icon } from './ui.js';
import { ctxMenu } from './ctx.js';
import { askPrompt } from './confirm.js';
import { get as storeGet } from './store.js';
import { TYPES, LIST_TYPES, TEXT_TYPES, block, sanitize, textOf, mdToBlocks, htmlToBlocks, blocksToMd, emptyTable } from './blocks.js';
import { todayStr, escapeHtml, imageToDataUrl, pickFile } from './util.js';
import { saveFile, fileUrl, forgetUrl, deleteFile, fmtSize, isPdf } from './files.js';
import { fetchAttachment } from './sync.js';
import { toast } from './nav.js';
import { TEMPLATES, templateBlocks } from './templates.js';

// Last thing copied from any editor in this tab: lets paste keep block types (lists, headings, todos) intact.
let lastCopy = null;
let vclock = 1;

const SLASH_EXTRA = [
  { k: 'date', label: '今天的日期', hint: todayStr() },
  { k: 'link', label: '链接到页面', hint: '[[ 双链' },
  { k: 'sub', label: '新建子页面', hint: '在这里嵌入' },
  ...TEMPLATES.map((t) => ({ k: 'tpl:' + t.k, label: '模板：' + t.label, hint: t.hint })),
];
const SLASH_TYPES = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'table', 'code', 'divider', 'image', 'file'];
const CONVERT_TYPES = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code'];

/* ---------- caret helpers ---------- */
function sel() { return window.getSelection(); }
function hostOf(el) { return el.closest('[contenteditable="true"],[contenteditable="plaintext-only"]'); }
function caretOffset(el) {
  const s = sel(); if (!s.rangeCount || !el.contains(s.anchorNode)) return null;
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.focusNode, s.focusOffset);
  return r.toString().length;
}
function setCaret(el, pos) {
  if (el.tagName === 'TABLE') { const cells = el.querySelectorAll('td,th'); el = pos === 'end' ? cells[cells.length - 1] : cells[0]; if (!el) return; }
  const host = hostOf(el); if (host && document.activeElement !== host) host.focus({ preventScroll: true });
  const s = sel(), r = document.createRange();
  const len = el.textContent.length;
  const target = pos === 'end' ? len : pos === 'start' ? 0 : Math.max(0, Math.min(len, pos));
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, acc = 0, done = false;
  while ((node = walker.nextNode())) {
    const l = node.nodeValue.length;
    if (acc + l >= target) { r.setStart(node, target - acc); done = true; break; }
    acc += l;
  }
  if (!done) { if (!el.textContent.length) { r.setStart(el, 0); r.collapse(true); } else { r.selectNodeContents(el); r.collapse(false); } } else r.collapse(true);
  s.removeAllRanges(); s.addRange(r);
  const rect = el.getBoundingClientRect();
  if (rect.bottom > innerHeight - 40 || rect.top < 60) el.scrollIntoView({ block: 'nearest' });
}
function serialize(frag) { const d = document.createElement('div'); d.appendChild(frag); return d.innerHTML; }
function splitAtCaret(el) {
  const s = sel(); const r = s.getRangeAt(0);
  const a = document.createRange(); a.setStart(el, 0); a.setEnd(r.startContainer, r.startOffset);
  const b = document.createRange(); b.setStart(r.endContainer, r.endOffset); b.setEnd(el, el.childNodes.length);
  return [serialize(a.cloneContents()), serialize(b.cloneContents())];
}
function textBeforeCaret(el) {
  const s = sel(); if (!s.rangeCount || !el.contains(s.focusNode)) return '';
  const r = document.createRange(); r.setStart(el, 0); r.setEnd(s.focusNode, s.focusOffset); return r.toString();
}
function deleteBeforeCaret(el, n) {
  const s = sel(); const r = s.getRangeAt(0);
  const start = caretOffset(el) - n;
  const a = document.createRange(); a.setStart(el, 0); a.setEnd(r.endContainer, r.endOffset);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node, acc = 0;
  while ((node = walker.nextNode())) { const l = node.nodeValue.length; if (acc + l >= start) { a.setStart(node, start - acc); break; } acc += l; }
  a.deleteContents(); return a;
}
// Insert a node at a (collapsed) range and put the caret after it. Used inside input handlers, where execCommand is ignored.
function insertNodeAt(range, node, trailingSpace = true) {
  range.insertNode(node); let last = node;
  if (trailingSpace) { const sp = document.createTextNode(' '); node.after(sp); last = sp; }
  const r = document.createRange(); r.setStartAfter(last); r.collapse(true); const s = sel(); s.removeAllRanges(); s.addRange(r);
}
function rowsInSelection(root) {
  const s = sel(); if (!root || !s || !s.rangeCount || s.isCollapsed) return [];
  const r = s.getRangeAt(0);
  return [...root.querySelectorAll('.b-row')].filter((row) => r.intersectsNode(row));
}
function htmlBefore(el, node, off) { const a = document.createRange(); a.setStart(el, 0); try { a.setEnd(node, off); } catch { return ''; } return serialize(a.cloneContents()); }
function htmlAfter(el, node, off) { const b = document.createRange(); try { b.setStart(node, off); } catch { return ''; } b.setEnd(el, el.childNodes.length); return serialize(b.cloneContents()); }
function blocksToHtml(blocks) {
  return blocks.map((b) => {
    const h = b.html || '';
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': return `<${b.type}>${h}</${b.type}>`;
      case 'bullet': case 'toggle': return `<ul><li>${h}</li></ul>`;
      case 'number': return `<ol><li>${h}</li></ol>`;
      case 'todo': return `<ul><li><input type="checkbox"${b.checked ? ' checked' : ''}> ${h}</li></ul>`;
      case 'quote': case 'callout': return `<blockquote>${h}</blockquote>`;
      case 'code': return `<pre><code>${h}</code></pre>`;
      case 'divider': return '<hr>';
      case 'table': return '<table>' + (b.rows || []).map((r, i) => '<tr>' + r.map((c) => (b.header !== false && i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>').join('') + '</table>';
      case 'image': return `<img src="${escapeHtml(b.url || '')}" alt="${escapeHtml(textOf(h))}">`;
      default: return `<p>${h}</p>`;
    }
  }).join('\n').replace(/<\/ul>\n<ul>/g, '\n').replace(/<\/ol>\n<ol>/g, '\n');
}
function cloneBlock(x) { return { ...block(x.type, x.html, { indent: x.indent || 0, checked: !!x.checked, url: x.url, lang: x.lang, icon: x.icon, width: x.width, align: x.align, ...(x.rows ? { rows: x.rows.map((r) => [...r]), header: x.header } : {}) }), v: 0 }; }
/* ---------- tables ---------- */
const tableRows = (tbl) => [...tbl.rows].map((tr) => [...tr.cells].map((td) => td.innerHTML.replace(/^(<br>)+|(<br>)+$/g, '')));
function renderTable(tbl, b) {
  const rows = b.rows || emptyTable(); const header = b.header !== false;
  // an empty cell gets a <br> so the caret can sit in it (Chrome does the same while editing)
  tbl.innerHTML = rows.map((r, i) => '<tr>' + r.map((c) => `<${header && i === 0 ? 'th' : 'td'} class="b-cell">${c || '<br>'}</${header && i === 0 ? 'th' : 'td'}>`).join('') + '</tr>').join('');
  tbl.dataset.json = JSON.stringify([rows, header]);
}
function cellOf(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest('td,th') : null; }
function onEdgeLine(el, which) {
  const s = sel(); if (!s.rangeCount) return true;
  const r = s.getRangeAt(0).cloneRange(); const rects = r.getClientRects(); const box = el.getBoundingClientRect();
  let rect = rects[0];
  if (!rect) { r.selectNodeContents(el); const rr = r.getClientRects(); rect = rr[which === 'up' ? 0 : rr.length - 1]; if (!rect) return true; }
  return which === 'up' ? rect.top - box.top < 14 : box.bottom - rect.bottom < 14;
}
function exec(cmd, val) { document.execCommand(cmd, false, val); }
function applyMark(color) {
  const s = sel(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const inside = (n) => { while (n && n.nodeType !== 1) n = n.parentNode; return n && n.closest('mark'); };
  const c = inside(r.startContainer);
  const cls = color && color !== 'y' ? 'hl-' + color : '';
  if (c) {
    if ((c.className || '') === cls || !color) { const frag = document.createDocumentFragment(); while (c.firstChild) frag.appendChild(c.firstChild); c.replaceWith(frag); return; }
    c.className = cls; return;
  }
  if (r.collapsed) return;
  const el = document.createElement('mark'); if (cls) el.className = cls;
  try { r.surroundContents(el); } catch { el.appendChild(r.extractContents()); r.insertNode(el); }
  s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); s.addRange(nr);
}
export function refTargets(q) {
  const st = storeGet(); const k = (q || '').toLowerCase(); const out = [];
  const add = (kind, id, title, hint) => { if (!k || title.toLowerCase().includes(k)) out.push({ kind, id, title, hint, label: title }); };
  st.todos.filter((t) => !t.done).forEach((t) => add('todo', t.id, t.title, '待办'));
  st.books.forEach((b) => add('book', b.id, b.title, b.author ? '书 · ' + b.author : '书'));
  st.trips.forEach((t) => add('trip', t.id, t.place, '足迹 · ' + (t.country || '')));
  Object.entries(st.goals).forEach(([m, gs]) => gs.forEach((g) => add('goal', g.id, g.title, '目标 · ' + m)));
  st.links.forEach((l) => add('link', l.id, l.title, '收藏 · ' + (l.host || '')));
  return out.slice(0, 10);
}
export function openRef(kind, id) {
  const map = { todo: 'todos?open=' + id, book: 'reading?open=' + id, trip: 'explore?sel=' + id, goal: 'plan/month?open=' + id, link: 'links?open=' + id };
  if (map[kind]) location.hash = '#/' + map[kind];
}
function toggleCode() {
  const s = sel(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const inCode = (n) => { while (n && n.nodeType !== 1) n = n.parentNode; return n && n.closest('code'); };
  const c = inCode(r.startContainer);
  if (c) { const t = document.createTextNode(c.textContent); c.replaceWith(t); return; }
  if (r.collapsed) return;
  const code = document.createElement('code');
  try { r.surroundContents(code); } catch { code.appendChild(r.extractContents()); r.insertNode(code); }
}

// Put the caret at the start (or end) of the first (or last) text block of an editor root.
export function focusEditor(root, where = 'start') {
  if (!root) return false;
  const texts = root.querySelectorAll('.b-row .b-text'); const el = where === 'end' ? texts[texts.length - 1] : texts[0];
  if (!el) return false;
  setCaret(el, where); return true;
}

/* ---------- editor ---------- */
export function BlockEditor({ blocks: initial, onChange, notes = [], notesRef, noteId, onCreatePage, onOpenLink, pageFont, onExitTop, onExport }) {
  const allNotes = () => (notesRef ? notesRef.current : notes);
  const [bs, setBs] = useState(() => (initial && initial.length ? initial.map((b) => ({ ...b, v: 0 })) : [block('p', '', { v: 0 })]));
  const [focusReq, setFocusReq] = useState(null);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null); menuRef.current = menu;
  const [hmenu, setHmenu] = useState(null);
  const [dragId, setDragIdState] = useState(null);
  const dragRef = useRef(null);
  const setDragId = (v) => { dragRef.current = v; setDragIdState(v); };
  const [dropAt, setDropAtState] = useState(null);
  const dropRef = useRef(null);
  const setDropAt = (v) => { dropRef.current = v; setDropAtState(v); };
  const [mdEdit, setMdEdit] = useState(null);
  const [tb, setTb] = useState(null); // selection toolbar { x, y }
  const [lp, setLp] = useState(null); // link popover: { x, y, href, el }
  const lpRef = useRef(null); lpRef.current = lp;
  const hist = useRef({ past: [], future: [], lock: false });
  const refs = useRef(new Map());
  const root = useRef();
  const bsRef = useRef(bs); bsRef.current = bs;
  const emitTimer = useRef();
  const composing = useRef(false);
  const downAt = useRef(null);
  const api = useRef({}); // stable object handed to rows; fields refreshed every render

  const cleanCache = useRef(new Map()); // raw html -> sanitized html, so unchanged blocks are not re-parsed
  const sameDoc = (a, b) => a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && x.type === b[i].type && x.html === b[i].html && (x.indent || 0) === (b[i].indent || 0) && !!x.checked === !!b[i].checked && x.url === b[i].url && !!x.open === !!b[i].open));
  const emit = useCallback((next) => {
    clearTimeout(emitTimer.current);
    const prev = bsRef.current;
    if (!hist.current.lock && prev && !sameDoc(prev, next)) { hist.current.past.push(prev); if (hist.current.past.length > 200) hist.current.past.shift(); hist.current.future = []; }
    bsRef.current = next; setBs(next);
    const cache = cleanCache.current, fresh = new Map();
    const out = next.map(({ v, ...b }) => { if (b.type === 'table') return { ...b, html: '', rows: (b.rows || []).map((r) => r.map((c) => sanitize(c))) }; let c = cache.get(b.html); if (c === undefined) c = sanitize(b.html); fresh.set(b.html, c); return { ...b, html: c }; });
    cleanCache.current = fresh;
    onChange(out);
  }, [onChange]);
  const syncFromDom = (list = bsRef.current) => list.map((b) => {
    const el = refs.current.get(b.id); if (!el || !el.isConnected || b.type === 'divider') return b;
    if (b.type === 'table') { const rows = tableRows(el); const json = JSON.stringify([rows, b.header !== false]); if (json === el.dataset.json) return b; el.dataset.json = json; return { ...b, rows }; }
    return el.innerHTML !== b.html ? { ...b, html: el.innerHTML } : b;
  });
  const bump = (b, patch) => ({ ...b, ...patch, v: (b.v || 0) + 1 });
  const scheduleEmit = () => { clearTimeout(emitTimer.current); emitTimer.current = setTimeout(() => emit(syncFromDom(bsRef.current)), 500); };
  useEffect(() => () => clearTimeout(emitTimer.current), []);

  useLayoutEffect(() => {
    if (!focusReq) return;
    const el = refs.current.get(focusReq.id);
    if (el) setCaret(el, focusReq.pos);
    const then = focusReq.then; setFocusReq(null);
    if (then) then();
  }, [focusReq, bs]);

  /* --- where is the caret --- */
  const curBlock = (node) => {
    const s = sel(); const n = node || (s && s.rangeCount ? s.anchorNode : null); if (!n) return null;
    const el = n.nodeType === 1 ? n : n.parentElement; if (!el || !root.current || !root.current.contains(el)) return null;
    const row = el.closest('.b-row'); if (!row) return null;
    const b = bsRef.current.find((x) => x.id === row.dataset.id); if (!b) return null;
    return { b, el: refs.current.get(b.id), row };
  };

  const update = (id, patch, focus) => { const next = syncFromDom(bsRef.current).map((b) => (b.id === id ? bump(b, patch) : b)); emit(next); if (focus) setFocusReq({ id, pos: focus }); };
  const insertAfter = (id, nb, focus = 'start') => { const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === id); list.splice(i + 1, 0, { ...nb, v: 0 }); emit(list); setFocusReq({ id: nb.id, pos: focus }); };
  const removeBlock = (id, focusPrev = true) => {
    const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === id);
    if (list.length === 1) { emit([bump(list[0], { type: 'p', html: '' })]); setFocusReq({ id: list[0].id, pos: 'start' }); return; }
    list.splice(i, 1); emit(list);
    const t = list[Math.max(0, focusPrev ? i - 1 : i)]; if (t) setFocusReq({ id: t.id, pos: 'end' });
  };
  const convert = (b, t) => {
    if (b.type === t) return;
    if (t === 'code' && TEXT_TYPES.includes(b.type)) update(b.id, { type: t, html: escapeHtml(textOf(b.html)) });
    else if (b.type === 'code' && t !== 'code') update(b.id, { type: t, html: escapeHtml(textOf(b.html)).replace(/\n/g, '<br>') });
    else update(b.id, { type: t });
  };

  /* --- table operations (row / column indices from the DOM cell) --- */
  const tableOp = (b, op, ri = 0, ci = 0) => {
    const cur = syncFromDom(bsRef.current).find((x) => x.id === b.id); if (!cur) return;
    let rows = (cur.rows || emptyTable()).map((r) => [...r]); let header = cur.header !== false;
    const w = rows[0] ? rows[0].length : 1;
    if (op === 'rowBelow') rows.splice(ri + 1, 0, Array(w).fill(''));
    else if (op === 'rowAbove') rows.splice(ri, 0, Array(w).fill(''));
    else if (op === 'colRight') rows.forEach((r) => r.splice(ci + 1, 0, ''));
    else if (op === 'colLeft') rows.forEach((r) => r.splice(ci, 0, ''));
    else if (op === 'delRow') { if (rows.length > 1) rows.splice(ri, 1); else { removeBlock(b.id); return; } }
    else if (op === 'delCol') { if (w > 1) rows.forEach((r) => r.splice(ci, 1)); else { removeBlock(b.id); return; } }
    else if (op === 'header') header = !header;
    const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { rows, header }) : x)); emit(list);
    const fr = op === 'rowBelow' ? ri + 1 : op === 'rowAbove' ? ri : Math.min(ri, rows.length - 1), fc = op === 'colRight' ? ci + 1 : op === 'colLeft' ? ci : Math.min(ci, rows[0].length - 1);
    setFocusReq({ id: b.id, pos: 'start', then: () => { const tbl = refs.current.get(b.id); const cell = tbl && tbl.rows[fr] && tbl.rows[fr].cells[fc]; if (cell) setCaret(cell, 'end'); } });
  };
  const tableMenu = (b, cell) => { const ri = cell ? cell.parentElement.rowIndex : 0, ci = cell ? cell.cellIndex : 0; return [
    { label: '上方插入行', icon: 'up', onClick: () => tableOp(b, 'rowAbove', ri, ci) }, { label: '下方插入行', icon: 'down', onClick: () => tableOp(b, 'rowBelow', ri, ci) },
    { label: '左侧插入列', icon: 'left', onClick: () => tableOp(b, 'colLeft', ri, ci) }, { label: '右侧插入列', icon: 'right', onClick: () => tableOp(b, 'colRight', ri, ci) },
    'sep', { label: b.header === false ? '首行作为表头' : '取消表头', icon: 'grid', onClick: () => tableOp(b, 'header', ri, ci) },
    'sep', { label: '删除这一行', icon: 'x', onClick: () => tableOp(b, 'delRow', ri, ci) }, { label: '删除这一列', icon: 'x', onClick: () => tableOp(b, 'delCol', ri, ci) }, { label: '删除表格', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) },
  ]; };
  // drag the side handles of an image to resize it (stored as % of the editor width)
  const imgResize = (e, b, dir) => {
    e.preventDefault(); e.stopPropagation();
    const fig = e.currentTarget.closest('figure'); const row = fig.closest('.b-row'); const full = row.getBoundingClientRect().width - 2;
    const x0 = e.clientX, w0 = fig.getBoundingClientRect().width; const center = (b.align || 'left') === 'center';
    document.body.classList.add('resizing');
    const move = (ev) => { const dx = (ev.clientX - x0) * dir * (center ? 2 : 1); const pct = Math.max(18, Math.min(100, ((w0 + dx) / full) * 100)); fig.style.width = pct + '%'; fig.dataset.pct = pct.toFixed(0); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); if (fig.dataset.pct) update(b.id, { width: +fig.dataset.pct }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  Object.assign(api.current, { tableOp, tableMenu, imgResize });

  /* --- undo / redo across block operations --- */
  const restore = (snap) => { const next = snap.map((b) => ({ ...b, v: ++vclock })); hist.current.lock = true; emit(next); hist.current.lock = false; return next; };
  const focusDiff = (next, cur) => { const i = next.findIndex((b, k) => !cur[k] || cur[k].id !== b.id || cur[k].html !== b.html); const t = next[Math.max(0, Math.min(next.length - 1, i < 0 ? next.length - 1 : i))]; if (t && TEXT_TYPES.includes(t.type)) setFocusReq({ id: t.id, pos: 'end' }); };
  const undo = () => {
    const cur = syncFromDom(bsRef.current); const h = hist.current;
    if (!sameDoc(cur, bsRef.current)) { h.past.push(bsRef.current); bsRef.current = cur; }
    const prev = h.past.pop(); if (!prev) return;
    h.future.push(cur); focusDiff(restore(prev), cur);
  };
  const redo = () => { const h = hist.current; const nxt = h.future.pop(); if (!nxt) return; const cur = syncFromDom(bsRef.current); h.past.push(cur); focusDiff(restore(nxt), cur); };

  /* --- selection spanning several blocks --- */
  const deleteAcross = (then) => {
    const rows = rowsInSelection(root.current); if (rows.length < 2) return false;
    const s = sel(); const r = s.getRangeAt(0);
    const list = syncFromDom(bsRef.current);
    const firstId = rows[0].dataset.id, lastId = rows[rows.length - 1].dataset.id;
    const firstEl = refs.current.get(firstId), lastEl = refs.current.get(lastId);
    const before = firstEl && firstEl.contains(r.startContainer) ? htmlBefore(firstEl, r.startContainer, r.startOffset) : '';
    const after = lastEl && lastEl.contains(r.endContainer) ? htmlAfter(lastEl, r.endContainer, r.endOffset) : '';
    const i0 = list.findIndex((x) => x.id === firstId), i1 = list.findIndex((x) => x.id === lastId); if (i0 < 0 || i1 < 0) return false;
    const first = list[i0];
    const merged = TEXT_TYPES.includes(first.type) ? bump(first, { html: before + after }) : { ...block('p', after), v: 0 };
    list.splice(i0, i1 - i0 + 1, merged); emit(list);
    setFocusReq({ id: merged.id, pos: textOf(before).length, then }); return true;
  };
  const selectedBlocks = () => {
    const rows = rowsInSelection(root.current); if (rows.length < 2) return [];
    const s = sel(); const r = s.getRangeAt(0); const byId = new Map(bsRef.current.map((b) => [b.id, b]));
    return rows.map((row, i) => { const b = byId.get(row.dataset.id); if (!b) return null; const el = refs.current.get(b.id); if (!el || !TEXT_TYPES.includes(b.type)) return { ...b }; let h = el.innerHTML; if (i === 0 && el.contains(r.startContainer)) h = htmlAfter(el, r.startContainer, r.startOffset); if (i === rows.length - 1 && el.contains(r.endContainer)) h = i === 0 ? serialize(r.cloneContents()) : htmlBefore(el, r.endContainer, r.endOffset); return { ...b, html: h }; }).filter(Boolean);
  };
  const moveBlock = (id, dir) => {
    const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= list.length) return;
    const pos = caretOffset(refs.current.get(id)); const [mv] = list.splice(i, 1); list.splice(j, 0, mv); emit(list); setFocusReq({ id, pos: pos == null ? 'end' : pos });
  };
  const splitBlock = (b, el) => {
    const empty = !el.textContent.trim();
    if (empty && (LIST_TYPES.includes(b.type) || b.type === 'quote' || b.type === 'callout')) { update(b.id, b.indent > 0 ? { indent: b.indent - 1 } : { type: 'p', html: '' }, 'start'); return; }
    const s0 = sel(); if (s0 && !s0.isCollapsed && el.contains(s0.anchorNode) && el.contains(s0.focusNode)) s0.deleteFromDocument();
    const [before, after] = splitAtCaret(el);
    const nt = LIST_TYPES.includes(b.type) ? b.type : 'p';
    const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { html: before }) : x));
    const i = list.findIndex((x) => x.id === b.id);
    const nb = { ...block(nt, after, { indent: b.indent || 0 }), v: 0 };
    list.splice(i + 1, 0, nb); emit(list); setFocusReq({ id: nb.id, pos: 'start' });
  };
  const neighbor = (id, dir) => { const vis = visible(); const i = vis.findIndex((x) => x.id === id); return vis[i + dir]; };

  /* --- key handling (root) --- */
  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return; // let the IME finish
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (lpRef.current) { setLp(null); if (e.key === 'Escape') { e.preventDefault(); return; } }
    if (mod && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && !e.altKey && k === 'y') { e.preventDefault(); redo(); return; }
    // selection across blocks: structure changes are ours
    if (rowsInSelection(root.current).length >= 2) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteAcross(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); deleteAcross(() => { const c = curBlock(); if (c && c.el) splitBlock(c.b, c.el); }); return; }
      if (e.key === 'Tab') { e.preventDefault(); const ids = new Set(rowsInSelection(root.current).map((r) => r.dataset.id)); emit(syncFromDom(bsRef.current).map((b) => (ids.has(b.id) ? bump(b, { indent: Math.max(0, Math.min(3, (b.indent || 0) + (e.shiftKey ? -1 : 1))) }) : b))); return; }
      if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); const ch = e.key; deleteAcross(() => exec('insertText', ch)); return; }
      if (!(mod && ['b', 'i', 'u', 'e', 'k', 'h', 's'].includes(k))) return; // inline formatting still works across blocks
    }
    const c = curBlock(); if (!c) return;
    const { b, el } = c;
    const m = menuRef.current;
    if (m && m.id === b.id) {
      const items = menuItems(m);
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...m, idx: (m.idx + 1) % Math.max(1, items.length) }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...m, idx: (m.idx - 1 + items.length) % Math.max(1, items.length) }); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && items.length) { e.preventDefault(); applyMenu(items[m.idx], b, m); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    if (mod && !e.shiftKey && k === 'b') { e.preventDefault(); exec('bold'); scheduleEmit(); return; }
    if (mod && !e.shiftKey && k === 'i') { e.preventDefault(); exec('italic'); scheduleEmit(); return; }
    if (mod && !e.shiftKey && k === 'u') { e.preventDefault(); exec('underline'); scheduleEmit(); return; }
    if (mod && k === 'e') { e.preventDefault(); toggleCode(); scheduleEmit(); return; }
    if (mod && e.shiftKey && k === 'h') { e.preventDefault(); applyMark('y'); scheduleEmit(); return; }
    if (mod && e.shiftKey && k === 's') { e.preventDefault(); exec('strikeThrough'); scheduleEmit(); return; }
    if (mod && k === 'k') { e.preventDefault(); linkPrompt(); return; }
    if (mod && k === 'd') { e.preventDefault(); insertAfter(b.id, cloneBlock(syncFromDom(bsRef.current).find((x) => x.id === b.id)), 'end'); return; }
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBlock(b.id, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (mod && e.key === 'Enter') { if (b.type === 'todo') { e.preventDefault(); update(b.id, { checked: !b.checked }); } else if (b.type === 'toggle') { e.preventDefault(); update(b.id, { open: !b.open }); } return; }
    if (!el) return;
    if (b.type === 'table') {
      const cell = cellOf(sel().anchorNode); if (!cell) return;
      const cells = [...el.querySelectorAll('td,th')]; const i = cells.indexOf(cell);
      if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) { if (i > 0) setCaret(cells[i - 1], 'end'); else { const n = neighbor(b.id, -1); if (n) setFocusReq({ id: n.id, pos: 'end' }); } } else if (i < cells.length - 1) setCaret(cells[i + 1], 'end'); else tableOp(b, 'rowBelow', el.rows.length - 1, 0); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) { tableOp(b, 'rowBelow', cell.parentElement.rowIndex, cell.cellIndex); return; } exec('insertLineBreak'); scheduleEmit(); return; }
      if (e.key === 'ArrowDown' && !e.shiftKey && cell.parentElement.rowIndex === el.rows.length - 1 && onEdgeLine(cell, 'down')) { const n = neighbor(b.id, 1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'start' }); } else { e.preventDefault(); insertAfter(b.id, block('p')); } return; }
      if (e.key === 'ArrowUp' && !e.shiftKey && cell.parentElement.rowIndex === 0 && onEdgeLine(cell, 'up')) { const n = neighbor(b.id, -1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'end' }); } else if (onExitTop) { e.preventDefault(); onExitTop(); } return; }
      if (e.key === 'Backspace' && !cell.textContent && sel().isCollapsed) { e.preventDefault(); if (i > 0) setCaret(cells[i - 1], 'end'); return; }
      return;
    }
    if (b.type === 'code' || b.type === 'md') {
      if (e.key === 'Escape') { el.blur(); setMdEdit(null); root.current.focus({ preventScroll: true }); }
      if (e.key === 'Tab') { e.preventDefault(); exec('insertText', '  '); }
      if (e.key === 'ArrowDown' && caretOffset(el) === el.textContent.length) { const n = neighbor(b.id, 1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'start' }); } }
      if (e.key === 'ArrowUp' && caretOffset(el) === 0) { const n = neighbor(b.id, -1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'end' }); } }
      if (e.key === 'Backspace' && !el.textContent) { e.preventDefault(); removeBlock(b.id); }
      return;
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) { e.preventDefault(); exec('insertLineBreak'); scheduleEmit(); return; }
      e.preventDefault(); splitBlock(b, el); return;
    }
    if (e.key === 'Backspace') {
      const s = sel(); if (!s.isCollapsed) return;
      if (caretOffset(el) !== 0) return;
      e.preventDefault();
      if (b.type !== 'p') { update(b.id, { type: 'p' }, 'start'); return; }
      if (b.indent > 0) { update(b.id, { indent: b.indent - 1 }, 'start'); return; }
      const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id);
      if (i === 0) { if (!el.textContent && onExitTop) onExitTop(); return; }
      const prev = list[i - 1];
      if (!TEXT_TYPES.includes(prev.type)) { if (!el.textContent) { list.splice(i, 1); emit(list); setFocusReq({ id: prev.id, pos: 'end' }); } else setFocusReq({ id: prev.id, pos: 'end' }); return; }
      const pos = textOf(prev.html).length;
      list[i - 1] = bump(prev, { html: prev.html + el.innerHTML }); list.splice(i, 1); emit(list); setFocusReq({ id: prev.id, pos }); return;
    }
    if (e.key === 'Delete') {
      const s = sel(); if (!s.isCollapsed) return;
      if (caretOffset(el) !== el.textContent.length) return;
      e.preventDefault();
      const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); const next = list[i + 1];
      if (!next || !TEXT_TYPES.includes(next.type)) return;
      const pos = el.textContent.length;
      list[i] = bump(list[i], { html: el.innerHTML + next.html }); list.splice(i + 1, 1); emit(list); setFocusReq({ id: b.id, pos }); return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && onEdgeLine(el, 'up')) { const n = neighbor(b.id, -1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'end' }); } else if (onExitTop) { e.preventDefault(); onExitTop(); } return; }
    if (e.key === 'ArrowDown' && !e.shiftKey && onEdgeLine(el, 'down')) { const n = neighbor(b.id, 1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'start' }); } return; }
    if (e.key === 'Tab') { e.preventDefault(); const pos = caretOffset(el); update(b.id, { indent: Math.max(0, Math.min(3, (b.indent || 0) + (e.shiftKey ? -1 : 1))) }, pos); return; }
  };

  /* --- input: list auto-format, auto-link and menus, only on typed characters --- */
  const onInput = (e) => {
    const c = curBlock(); if (!c || !c.el) { scheduleEmit(); return; }
    const { b, el } = c;
    const t = e.inputType || ''; const d = e.data;
    if (composing.current || t === 'insertCompositionText') { scheduleEmit(); return; }
    if (b.type === 'code' || b.type === 'md' || b.type === 'table') { scheduleEmit(); return; }
    const m = menuRef.current;
    if (m && m.id === b.id) {
      const before = textBeforeCaret(el); let mm;
      if (m.kind === 'link' && (mm = before.match(/\[\[([^\]]*)$/))) setMenu({ ...m, q: mm[1], idx: 0 });
      else if (m.kind === 'slash' && (mm = before.match(/(?:^|\s)\/([^\s/]*)$/))) setMenu({ ...m, q: mm[1], idx: 0 });
      else if (m.kind === 'ref' && (mm = before.match(/(?:^|\s)@([^\s@]*)$/))) setMenu({ ...m, q: mm[1], idx: 0 });
      else setMenu(null);
      scheduleEmit(); return;
    }
    if (t === 'insertText' && d) {
      const before = textBeforeCaret(el); const off = caretOffset(el);
      if (d === ' ' && off === before.length) {
        // typed a URL followed by a space -> link
        const u = before.match(/(?:^|\s)(https?:\/\/[^\s<>"']{4,})\s$/); const s0 = sel(); const inA = s0 && s0.anchorNode && (s0.anchorNode.nodeType === 1 ? s0.anchorNode : s0.anchorNode.parentElement).closest('a');
        if (u && !inA) { const r = deleteBeforeCaret(el, u[1].length + 1); const a = document.createElement('a'); a.href = u[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = u[1]; insertNodeAt(r, a); scheduleEmit(); return; }
        // list auto-format at the start of a paragraph, the way a document editor does it
        if (['p', 'bullet', 'number', 'todo'].includes(b.type)) {
          const sc = [[/^[-*]\s$/, 'bullet'], [/^1[.)]\s$/, 'number'], [/^\[\]\s$/, 'todo'], [/^\[ \]\s$/, 'todo']];
          for (const [re, type] of sc) if (re.test(before) && type !== b.type) { deleteBeforeCaret(el, before.length); update(b.id, { type, html: el.innerHTML, checked: false }, 'start'); return; }
        }
      }
      if (d === '[' && /\[\[$/.test(before)) { setMenu({ kind: 'link', id: b.id, q: '', idx: 0 }); scheduleEmit(); return; }
      if (d === '/' && /(?:^|\s)\/$/.test(before)) { setMenu({ kind: 'slash', id: b.id, q: '', idx: 0 }); scheduleEmit(); return; }
      if (d === '@' && /(?:^|\s)@$/.test(before)) { setMenu({ kind: 'ref', id: b.id, q: '', idx: 0 }); scheduleEmit(); return; }
    }
    scheduleEmit();
  };

  /* --- selection toolbar / caret row (cheap: direct DOM class, one update per frame) --- */
  useEffect(() => {
    let t = 0;
    const upd = () => {
      cancelAnimationFrame(t);
      t = requestAnimationFrame(() => {
        const s = window.getSelection(); const r0 = root.current; if (!r0) return;
        const a = s && s.rangeCount ? s.getRangeAt(0).commonAncestorContainer : null; const el = a ? (a.nodeType === 1 ? a : a.parentElement) : null;
        const inside = !!(el && r0.contains(el));
        const prevCur = r0.querySelector('.b-row.cur'); const row = inside && s.isCollapsed ? el.closest('.b-row') : null;
        if (prevCur && prevCur !== row) prevCur.classList.remove('cur'); if (row && row !== prevCur) row.classList.add('cur');
        if (!inside || s.isCollapsed || el.closest('pre')) { setTb((x) => (x ? null : x)); return; }
        if (lpRef.current) setLp(null);
        const rect = s.getRangeAt(0).getBoundingClientRect(); if (!rect.width && !rect.height) { setTb((x) => (x ? null : x)); return; }
        const rr = r0.getBoundingClientRect();
        const nx = Math.round(rect.left + rect.width / 2 - rr.left), ny = Math.round(rect.top - rr.top);
        setTb((x) => (x && x.x === nx && x.y === ny ? x : { x: nx, y: ny }));
      });
    };
    document.addEventListener('selectionchange', upd);
    return () => { document.removeEventListener('selectionchange', upd); cancelAnimationFrame(t); };
  }, []);

  const menuItems = (m = menuRef.current) => {
    if (!m) return [];
    const k = m.q.toLowerCase();
    if (m.kind === 'link') {
      const ns = allNotes();
      const list = ns.filter((n) => n.id !== noteId && n.title && n.title.toLowerCase().includes(k)).slice(0, 8).map((n) => ({ label: n.title, title: n.title }));
      if (k.trim() && !ns.some((n) => n.title.toLowerCase() === k.trim())) list.push({ label: `＋ 新建页面「${m.q.trim()}」`, title: m.q.trim(), create: true });
      return list;
    }
    if (m.kind === 'ref') return refTargets(m.q);
    const all = [...SLASH_TYPES.map((t) => ({ k: t, type: t, label: TYPES[t].label, hint: TYPES[t].hint })), ...SLASH_EXTRA];
    return all.filter((x) => !k || x.label.toLowerCase().includes(k) || x.k.includes(k) || (x.hint || '').toLowerCase().includes(k));
  };
  const mkAnchor = (cls, data, text) => { const a = document.createElement('a'); a.className = cls; Object.entries(data).forEach(([k, v]) => { a.dataset[k] = v; }); a.contentEditable = 'false'; a.textContent = text; return a; };
  const applyMenu = (it, b, m = menuRef.current) => {
    const el = refs.current.get(b.id); if (!el) return;
    if (caretOffset(el) == null) setCaret(el, 'end');
    if (m.kind === 'ref') { insertNodeAt(deleteBeforeCaret(el, m.q.length + 1), mkAnchor('ref', { kind: it.kind, id: it.id }, it.title)); setMenu(null); emit(syncFromDom(bsRef.current)); return; }
    if (m.kind === 'link') { insertNodeAt(deleteBeforeCaret(el, m.q.length + 2), mkAnchor('wiki', { title: it.title }, it.title)); if (it.create && onCreatePage) onCreatePage(it.title); setMenu(null); emit(syncFromDom(bsRef.current)); return; }
    deleteBeforeCaret(el, m.q.length + 1);
    setMenu(null);
    if (it.k === 'date') { exec('insertText', todayStr() + ' '); emit(syncFromDom(bsRef.current)); return; }
    if (it.k && it.k.startsWith('tpl:')) { const tpl = templateBlocks(it.k.slice(4)).map((x) => ({ ...x, v: 0 })); const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); const empty = !el.textContent.trim(); list.splice(empty ? i : i + 1, empty ? 1 : 0, ...tpl); emit(list); const first = tpl.find((x) => TEXT_TYPES.includes(x.type) && !textOf(x.html)) || tpl[0]; setFocusReq({ id: first.id, pos: 'end' }); return; }
    if (it.k === 'link') { exec('insertText', '[['); setMenu({ kind: 'link', id: b.id, q: '', idx: 0 }); return; }
    if (it.k === 'sub') { askPrompt('子页面标题', '', { title: '新建子页面', placeholder: '标题' }).then((title) => { if (!title) return; if (onCreatePage) onCreatePage(title); setCaret(el, 'end'); insertNodeAt(sel().getRangeAt(0), mkAnchor('wiki', { title }, title)); emit(syncFromDom(bsRef.current)); }); return; }
    const type = it.type;
    if (type === 'image') { askPrompt('图片链接', '', { title: '插入图片', placeholder: 'https://…' }).then((url) => { if (!url) return; if (!el.textContent.trim()) update(b.id, { type: 'image', url, html: '' }); else insertAfter(b.id, block('image', '', { url })); }); return; }
    if (type === 'divider') { if (!el.textContent.trim()) { const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { type: 'divider', html: '' }) : x)); const i = list.findIndex((x) => x.id === b.id); const nb = { ...block('p'), v: 0 }; list.splice(i + 1, 0, nb); emit(list); setFocusReq({ id: nb.id, pos: 'start' }); } else insertAfter(b.id, block('divider'), null); return; }
    if (type === 'code') { update(b.id, { type, html: escapeHtml(el.textContent) }, 'end'); return; }
    if (type === 'file') { pickFile('*/*').then(async (f) => { if (!f) return; const parsed = await filesToBlocks([f]); if (!parsed.length) return; if (!el.textContent.trim()) { const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); list.splice(i, 1, ...parsed.map((x) => ({ ...x, v: 0 }))); emit(list); } else insertAfter(b.id, parsed[0], null); }); return; }
    if (type === 'table') { const rows = emptyTable(); if (!el.textContent.trim()) update(b.id, { type, html: '', rows, header: true }, 'start'); else insertAfter(b.id, block('table', '', { rows, header: true }), 'start'); return; }
    update(b.id, { type, html: el.innerHTML, checked: false }, 'end');
  };

  /* --- links --- */
  const linkPrompt = () => {
    const s0 = sel(); const range = s0 && s0.rangeCount ? s0.getRangeAt(0).cloneRange() : null; if (!range || range.collapsed) { toast('先选中要加链接的文字'); return; }
    askPrompt('链接地址', '', { title: '插入链接', placeholder: 'https://' }).then((url) => { if (!url) return; const s2 = sel(); s2.removeAllRanges(); s2.addRange(range); exec('createLink', /^https?:/.test(url) ? url : 'https://' + url); emit(syncFromDom(bsRef.current)); });
  };
  const unlink = (a) => { const frag = document.createDocumentFragment(); while (a.firstChild) frag.appendChild(a.firstChild); a.replaceWith(frag); setLp(null); emit(syncFromDom(bsRef.current)); };
  const editLink = async () => { const a = lp.el; const url = await askPrompt('链接地址', lp.href, { title: '编辑链接', placeholder: 'https://' }); if (url == null) return; const v = url.trim(); if (!v) { unlink(a); return; } a.setAttribute('href', /^(https?:|mailto:)/.test(v) ? v : 'https://' + v); setLp(null); emit(syncFromDom(bsRef.current)); };
  const hostName = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

  /* --- clipboard --- */
  const parseClipboard = async ({ text, rich, files }, curType) => {
    if (files.length) return filesToBlocks(files);
    if (lastCopy && text && text === lastCopy.text) return lastCopy.blocks.map(cloneBlock);
    if (rich && /<(p|div|h[1-6]|li|ul|ol|blockquote|pre|table|img|br|span|b|i|u|strong|em|a|mark|s|strike|code)\b/i.test(rich)) { const parsed = htmlToBlocks(rich); if (parsed.length) return parsed; }
    if (!text) return [];
    if (curType === 'code' || curType === 'md') return [block(curType, escapeHtml(text))];
    return mdToBlocks(text);
  };
  // images become image blocks; everything else (PDF, docs, …) is stored in IndexedDB and shown as a file block
  const filesToBlocks = async (files) => {
    const out = [];
    for (const f of files) {
      if (/^image\//.test(f.type)) { const u = await imageToDataUrl(f, 1600).catch(() => null); if (u) out.push(block('image', '', { url: u })); continue; }
      if (f.size > 40 * 1048576) { toast(`「${f.name}」超过 40 MB，没有导入`); continue; }
      const rec = await saveFile(f); out.push(block('file', '', { fid: rec.id, name: rec.name, mime: rec.type, size: rec.size }));
    }
    return out;
  };
  const dropFiles = async (e) => {
    const fs = [...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])]; if (!fs.length) return false;
    e.preventDefault(); const parsed = await filesToBlocks(fs); if (!parsed.length) return true;
    const row = e.target.closest && e.target.closest('.b-row'); const list = syncFromDom(bsRef.current);
    const i = row ? list.findIndex((x) => x.id === row.dataset.id) : list.length - 1;
    const v0 = parsed.map((x) => ({ ...x, v: 0 })); list.splice(i + 1, 0, ...v0); emit(list); toast(`已添加 ${parsed.length} 个附件`); return true;
  };
  const insertBlocksAt = (b, el, parsed) => {
    if (!parsed.length) return;
    const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); if (i < 0) return;
    const empty = TEXT_TYPES.includes(b.type) && (!el || !el.textContent.trim());
    const v0 = parsed.map((x) => ({ ...x, v: 0 }));
    if (!TEXT_TYPES.includes(b.type)) { if (b.type === 'table' && v0.length === 1 && v0[0].type === 'p') { exec('insertHTML', v0[0].html); scheduleEmit(); return; } list.splice(i + 1, 0, ...v0); emit(list); const last = v0[v0.length - 1]; setFocusReq({ id: last.id, pos: 'end' }); return; }
    if (empty && (b.type === 'p' || !TEXT_TYPES.includes(v0[0].type) || v0.length > 1)) { list.splice(i, 1, ...v0.map((x, k) => (k === 0 && TEXT_TYPES.includes(x.type) && b.type !== 'p' && v0.length === 1 ? { ...x, type: b.type, indent: b.indent || 0 } : x))); }
    else if (el && (v0[0].type === 'p' || v0[0].type === b.type)) { exec('insertHTML', v0[0].html); list[i] = bump(list[i], { html: el.innerHTML }); list.splice(i + 1, 0, ...v0.slice(1)); if (v0.length === 1) { emit(list); return; } }
    else list.splice(i + 1, 0, ...v0);
    emit(list); const last = v0[v0.length - 1]; setFocusReq({ id: last.id, pos: 'end' });
  };
  const onPaste = (e) => {
    const cd = e.clipboardData; if (!cd) return;
    const data = { text: cd.getData('text/plain') || '', rich: cd.getData('text/html') || '', files: [...(cd.files || [])] };
    if (!data.text && !data.rich && !data.files.length) return;
    e.preventDefault();
    const go = async () => {
      const c = curBlock(); if (!c || !c.el) return;
      const { b, el } = c;
      if (b.type === 'code' || b.type === 'md') { if (data.text) exec('insertText', data.text); scheduleEmit(); return; }
      const url = data.text.trim(); const s0 = sel();
      if (!data.files.length && /^https?:\/\/\S+$/.test(url) && !(lastCopy && lastCopy.text === data.text)) {
        if (s0 && !s0.isCollapsed) { exec('createLink', url); emit(syncFromDom(bsRef.current)); return; }
        exec('insertHTML', `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`); scheduleEmit(); return;
      }
      const parsed = await parseClipboard(data, b.type);
      if (!parsed.length) { if (data.text) exec('insertText', data.text); scheduleEmit(); return; }
      if (s0 && !s0.isCollapsed) s0.deleteFromDocument();
      if (parsed.length === 1 && parsed[0].type === 'p' && TEXT_TYPES.includes(b.type) && (el.textContent.trim() || b.type !== 'p')) { exec('insertHTML', parsed[0].html); emit(syncFromDom(bsRef.current)); return; }
      insertBlocksAt(b, el, parsed);
    };
    if (rowsInSelection(root.current).length >= 2) deleteAcross(() => { go(); }); else go();
  };
  const onCopy = (e) => {
    const blocks = selectedBlocks();
    if (!blocks.length) { lastCopy = null; return; }
    const text = blocksToMd(blocks); lastCopy = { text, blocks: blocks.map(({ v, ...b }) => b) };
    e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', blocksToHtml(blocks)); e.preventDefault();
  };
  const onCut = (e) => { if (rowsInSelection(root.current).length >= 2) { onCopy(e); deleteAcross(); } else setTimeout(scheduleEmit, 0); };

  /* --- toggles hide following deeper blocks --- */
  const visible = () => {
    const out = []; let hideBelow = null;
    for (const b of bs) {
      if (hideBelow !== null) { if ((b.indent || 0) > hideBelow) continue; hideBelow = null; }
      out.push(b);
      if (b.type === 'toggle' && !b.open) hideBelow = b.indent || 0;
    }
    return out;
  };
  const vis = visible();
  const numberOf = (b) => { const i = bs.indexOf(b); let n = 1; for (let j = i - 1; j >= 0; j--) { const p = bs[j]; if (p.type === 'number' && (p.indent || 0) === (b.indent || 0)) n++; else if (p.type !== 'number' || (p.indent || 0) < (b.indent || 0)) break; } return n; };

  /* --- block drag & drop (gutter handle) --- */
  const onDropRow = (e, targetId) => {
    e.preventDefault();
    const dragId = dragRef.current;
    if (!dragId || dragId === targetId) { setDragId(null); setDropAt(null); return; }
    const list = syncFromDom(bsRef.current); const from = list.findIndex((x) => x.id === dragId); const [mv] = list.splice(from, 1);
    let to = list.findIndex((x) => x.id === targetId); if (dropRef.current && dropRef.current.after) to++;
    list.splice(to, 0, mv); emit(list); setDragId(null); setDropAt(null);
  };
  const addBelow = (id) => insertAfter(id, block('p'));

  const onClick = (e) => {
    const wk = e.target.closest && e.target.closest('a.wiki'); if (wk) { e.preventDefault(); onOpenLink && onOpenLink(wk.dataset.title || wk.textContent); return; }
    const rf = e.target.closest && e.target.closest('a.ref'); if (rf) { e.preventDefault(); openRef(rf.dataset.kind, rf.dataset.id); return; }
    const lk = e.target.closest && e.target.closest('a[href]');
    if (lk) { e.preventDefault(); if (e.metaKey || e.ctrlKey) { window.open(lk.getAttribute('href'), '_blank', 'noopener'); return; } const r = lk.getBoundingClientRect(), rr = root.current.getBoundingClientRect(); setLp({ x: r.left - rr.left, y: r.bottom - rr.top + 6, href: lk.getAttribute('href'), el: lk }); return; }
    // click on the empty space below the last block: a drag that ends in another block also "clicks" the root, so require press and release there
    const blank = (t) => t === root.current || t.classList.contains('b-tail');
    if (blank(e.target) && downAt.current && blank(downAt.current)) { const last = bs[bs.length - 1]; if (last && TEXT_TYPES.includes(last.type) && !textOf(last.html)) setFocusReq({ id: last.id, pos: 'end' }); else insertAfter(last.id, block('p')); }
  };
  const onCtx = (e) => {
    const rows = rowsInSelection(root.current);
    if (rows.length < 2) return; // the row handles single-block menus
    const ids = new Set(rows.map((r) => r.dataset.id));
    ctxMenu(e, [
      { label: '复制', icon: 'layers', hint: '⌘C', onClick: () => document.execCommand('copy') },
      { label: '删除选中内容', icon: 'trash', danger: true, hint: '⌫', onClick: () => deleteAcross() },
      'sep',
      onExport && { label: '导出选中为图片卡片', icon: 'image', onClick: () => onExport(selectedBlocks(), 'save') },
      onExport && { label: '复制选中为图片', icon: 'image', onClick: () => onExport(selectedBlocks(), 'copy') },
      onExport && 'sep',
      ...['p', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote'].map((t) => ({ label: '转为' + TYPES[t].label, icon: 'note', onClick: () => emit(syncFromDom(bsRef.current).map((b) => (ids.has(b.id) && TEXT_TYPES.includes(b.type) ? bump(b, { type: t }) : b))) })),
    ], `${rows.length} 个块`);
  };
  // native text drag/drop between rows: the browser moves the text, then we read the rows back
  const onDrop = (e) => { if (dragRef.current) return; if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { dropFiles(e); return; } setTimeout(() => emit(syncFromDom(bsRef.current)), 0); };
  const onDragOverRoot = (e) => { if (dragRef.current) return; if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };

  Object.assign(api.current, { refs, dragRef, update, removeBlock, insertAfter, addBelow, setHmenu, setDragId, setDropAt, onDropRow, setMdEdit, convert });
  const items = menuItems();
  const tbBtn = (title, fn, child, cls = '') => html`<button title=${title} class=${cls} onMouseDown=${(e) => e.preventDefault()} onClick=${() => { fn(); setTimeout(() => emit(syncFromDom(bsRef.current)), 0); }}>${child}</button>`;

  return html`<div class=${'beditor font-' + (pageFont || 'default')} ref=${root} contenteditable="true" spellcheck="false"
    onKeyDown=${onKey} onInput=${onInput} onPaste=${onPaste} onCopy=${onCopy} onCut=${onCut} onClick=${onClick} onContextMenu=${onCtx} onDrop=${onDrop} onDragOver=${onDragOverRoot}
    onCompositionStart=${() => { composing.current = true; }} onCompositionEnd=${() => { composing.current = false; scheduleEmit(); }}
    onMouseDown=${(e) => { downAt.current = e.target; if (lpRef.current && !(e.target.closest && e.target.closest('.link-pop'))) setLp(null); }}>
    ${lp && html`<div class="link-pop" contenteditable="false" style=${`left:${lp.x}px;top:${lp.y}px`} onMouseDown=${(e) => e.stopPropagation()}>
      <a class="lp-url" href=${lp.href} target="_blank" rel="noopener" title=${lp.href}><${Icon} name="external" size=${12} /> ${hostName(lp.href)}</a>
      <button class="ibtn" title="编辑链接" onClick=${editLink}><${Icon} name="edit" size=${13} /></button>
      <button class="ibtn" title="复制链接" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(lp.href); toast('已复制链接'); setLp(null); }}><${Icon} name="layers" size=${13} /></button>
      <button class="ibtn danger" title="移除链接" onClick=${() => unlink(lp.el)}><${Icon} name="x" size=${13} /></button>
    </div>`}
    ${tb && html`<div class="sel-tb" contenteditable="false" style=${`left:${tb.x}px;top:${tb.y}px`} onMouseDown=${(e) => e.preventDefault()}>
      ${tbBtn('粗体 ⌘B', () => exec('bold'), html`<b>B</b>`)}
      ${tbBtn('斜体 ⌘I', () => exec('italic'), html`<i>I</i>`)}
      ${tbBtn('下划线 ⌘U', () => exec('underline'), html`<u>U</u>`)}
      ${tbBtn('删除线', () => exec('strikeThrough'), html`<s>S</s>`)}
      ${tbBtn('代码 ⌘E', () => toggleCode(), '</>', 'mono')}
      <span class="tb-hl">${tbBtn('荧光标记 ⌘⇧H', () => applyMark('y'), 'A', 'hl')}${['y', 'g', 'b', 'p', 'r'].map((c) => tbBtn('标记颜色', () => applyMark(c), '', 'hl-dot hl-' + c))}</span>
      ${tbBtn('链接 ⌘K', () => linkPrompt(), html`<${Icon} name="link" size=${13} />`)}
      ${tbBtn('清除格式', () => exec('removeFormat'), html`<${Icon} name="x" size=${13} />`)}
    </div>`}
    ${vis.map((b) => html`<${Row} key=${b.id} b=${b} api=${api.current} hm=${hmenu === b.id} drag=${dragId === b.id} dragging=${!!dragId} drop=${dropAt && dropAt.id === b.id ? (dropAt.after ? 'after' : 'before') : ''} md=${mdEdit === b.id} num=${b.type === 'number' ? numberOf(b) : 0} />
      ${menu && menu.id === b.id && items.length > 0 && html`<div class="popmenu bmenu" contenteditable="false">${items.map((it, i) => html`<div class=${'pm ' + (i === menu.idx ? 'on' : '')} onMouseDown=${(e) => { e.preventDefault(); applyMenu(it, b); }}><b>${it.label}</b>${it.hint && html`<small>${it.hint}</small>`}</div>`)}</div>`}`)}
    <div class="b-tail" contenteditable="false"></div>
  </div>`;
}

/* ---------- row: re-renders only when its own block or flags change ---------- */
class Row extends Component {
  shouldComponentUpdate(np) {
    const p = this.props;
    return np.b !== p.b || np.hm !== p.hm || np.drag !== p.drag || np.dragging !== p.dragging || np.drop !== p.drop || np.md !== p.md || np.num !== p.num;
  }
  componentDidMount() { this.sync(); }
  componentDidUpdate(prev) {
    if (prev.b.v !== this.props.b.v || prev.b.type !== this.props.b.type || prev.md !== this.props.md) this.sync();
    if (this.props.md && !prev.md && this.el) this.el.focus();
  }
  componentWillUnmount() { const { api, b } = this.props; if (api.refs.current.get(b.id) === this.el) api.refs.current.delete(b.id); }
  sync() { const el = this.el, b = this.props.b; if (!el) return; this.props.api.refs.current.set(b.id, el); if (b.type === 'table') { if (el.dataset.json !== JSON.stringify([b.rows || emptyTable(), b.header !== false])) renderTable(el, b); return; } if (el.innerHTML !== b.html) el.innerHTML = b.html; }
  render({ b, api, hm, drag, dragging, drop, md, num }) {
    const { update, removeBlock, insertAfter, addBelow, setHmenu, setDragId, setDropAt, onDropRow, setMdEdit, convert } = api;
    const setEl = (el) => { this.el = el; if (el) { api.refs.current.set(b.id, el); if (b.type === 'table' && !el.dataset.json) renderTable(el, b); } };
    const dropCls = drop ? ' drop-' + drop : '';
    let body;
    if (b.type === 'divider') body = html`<div class="b-divider" contenteditable="false" tabindex="0" onKeyDown=${(e) => { if (e.key === 'Backspace' || e.key === 'Delete') removeBlock(b.id); }}><hr/></div>`;
    else if (b.type === 'image') body = html`<figure class=${'b-image al-' + (b.align || 'left')} contenteditable="false" style=${`width:${b.width || 100}%`}>
      <div class="b-imgwrap"><img src=${b.url} alt="" draggable="false" onError=${(e) => { e.target.style.opacity = .3; }} /><span class="img-rz l" title="拖动调整大小" onPointerDown=${(e) => api.imgResize(e, b, -1)}></span><span class="img-rz r" title="拖动调整大小" onPointerDown=${(e) => api.imgResize(e, b, 1)}></span></div>
      <figcaption ref=${setEl} class="b-text b-cap" contenteditable="true" data-ph="图片说明"></figcaption></figure>`;
    else if (b.type === 'table') body = html`<div class="b-tablewrap"><table ref=${setEl} class="b-table b-text"></table><button class="tb-add col" contenteditable="false" title="添加一列" onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.tableOp(b, 'colRight', 0, (b.rows && b.rows[0] ? b.rows[0].length : 1) - 1)}>+</button><button class="tb-add row" contenteditable="false" title="添加一行" onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.tableOp(b, 'rowBelow', (b.rows ? b.rows.length : 1) - 1, 0)}>+</button></div>`;
    else if (b.type === 'file') body = html`<div class="b-filewrap" contenteditable="false"><${FileView} b=${b} onRemove=${() => removeBlock(b.id)} /><div ref=${setEl} class="b-text b-cap" contenteditable="true" data-ph="备注（可选）"></div></div>`;
    else if (b.type === 'code') body = html`<div class="b-code" contenteditable="false"><input class="b-lang" value=${b.lang || ''} placeholder="语言" onInput=${(e) => update(b.id, { lang: e.target.value })} /><pre ref=${setEl} contenteditable="plaintext-only" class="b-text" data-ph="代码"></pre></div>`;
    else if (b.type === 'md') body = md
      ? html`<pre ref=${setEl} contenteditable="plaintext-only" class="b-text b-mdsrc" onBlur=${() => setMdEdit(null)}></pre>`
      : html`<div class="b-mdview md" contenteditable="false" title="点击编辑" onClick=${() => setMdEdit(b.id)} dangerouslySetInnerHTML=${{ __html: marked.parse(textOf(b.html)) }}></div>`;
    else body = html`<div class=${'b-' + b.type}>
      ${b.type === 'bullet' && html`<span class="b-mark" contenteditable="false">•</span>`}
      ${b.type === 'number' && html`<span class="b-mark num" contenteditable="false">${num}.</span>`}
      ${b.type === 'todo' && html`<button class=${'b-check ' + (b.checked ? 'on' : '')} contenteditable="false" onMouseDown=${(e) => e.preventDefault()} onClick=${() => update(b.id, { checked: !b.checked })}><${Icon} name="check" size=${11} /></button>`}
      ${b.type === 'toggle' && html`<button class=${'b-tg ' + (b.open ? 'open' : '')} contenteditable="false" onMouseDown=${(e) => e.preventDefault()} onClick=${() => update(b.id, { open: !b.open })}><${Icon} name="right" size=${12} /></button>`}
      <div ref=${setEl} class=${'b-text ' + (b.type === 'todo' && b.checked ? 'done' : '')} data-ph=${phFor(b)}></div>
    </div>`;
    const menu = (e) => {
      if (window.getSelection && !window.getSelection().isCollapsed) return; e.stopPropagation();
      if (b.type === 'table') { const cell = e.target.closest && e.target.closest('td,th'); ctxMenu(e, [...api.tableMenu(b, cell), 'sep', { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) }], '表格'); return; }
      if (b.type === 'file') { ctxMenu(e, [{ label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) }, 'sep', { label: '移除附件', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) }], b.name || '附件'); return; }
      if (b.type === 'image') { ctxMenu(e, [
        ...[['小', 36], ['中', 60], ['大', 100]].map(([l, w]) => ({ label: l + (w === 100 ? '（原宽）' : ''), icon: (b.width || 100) === w ? 'check' : 'image', onClick: () => update(b.id, { width: w }) })),
        'sep',
        { label: '靠左', icon: (b.align || 'left') === 'left' ? 'check' : 'left', onClick: () => update(b.id, { align: 'left' }) },
        { label: '居中', icon: b.align === 'center' ? 'check' : 'menu', onClick: () => update(b.id, { align: 'center' }) },
        'sep',
        { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) },
        { label: '删除图片', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) },
      ], '图片'); return; }
      ctxMenu(e, [
        ...CONVERT_TYPES.map((t) => ({ label: TYPES[t].label, icon: b.type === t ? 'check' : 'note', onClick: () => convert(b, t) })),
        'sep',
        { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) },
        { label: '复制一份', icon: 'layers', hint: '⌘D', onClick: () => insertAfter(b.id, cloneBlock(b)) },
        { label: '删除块', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) },
      ], '块');
    };
    return html`<div class=${'b-row' + dropCls + (drag ? ' dragging' : '')} style=${`--ind:${b.indent || 0}`} data-type=${b.type} data-id=${b.id} onContextMenu=${menu}
      onDragOver=${(e) => { if (!api.dragRef.current) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ id: b.id, after: e.clientY > r.top + r.height / 2 }); }}
      onDrop=${(e) => { if (api.dragRef.current) onDropRow(e, b.id); }}>
      <div class="b-gutter" contenteditable="false">
        <button class="b-plus" title="在下方添加块" onMouseDown=${(e) => e.preventDefault()} onClick=${() => addBelow(b.id)}><${Icon} name="plus" size=${14} /></button>
        <button class="b-handle" title="拖动 · 点击打开菜单" draggable="true" onDragStart=${(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }} onDragEnd=${() => { setDragId(null); setDropAt(null); }} onMouseDown=${(e) => e.preventDefault()} onClick=${() => setHmenu(hm ? null : b.id)}>⋮⋮</button>
        ${hm && html`<div class="popmenu hmenu" onMouseDown=${(e) => e.preventDefault()}>
          <div class="pm-sec">转换为</div>
          ${CONVERT_TYPES.map((t) => html`<div class=${'pm ' + (b.type === t ? 'on' : '')} onClick=${() => { convert(b, t); setHmenu(null); }}><b>${TYPES[t].label}</b></div>`)}
          <div class="pm-sec">操作</div>
          <div class="pm" onClick=${() => { insertAfter(b.id, cloneBlock(b)); setHmenu(null); }}><b>复制一份</b><small>⌘D</small></div>
          <div class="pm danger" onClick=${() => { removeBlock(b.id); setHmenu(null); }}><b>删除</b><small>⌫</small></div>
        </div>`}
      </div>
      ${body}
    </div>`;
  }
}

/* ---------- attachment (PDF preview, open, download) ---------- */
function FileView({ b, onRemove }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | fetching
  const [open, setOpen] = useState(() => isPdf({ type: b.mime, name: b.name }));
  const pdf = isPdf({ type: b.mime, name: b.name });
  useEffect(() => { let alive = true; (async () => { let u = await fileUrl(b.fid); if (!u) { setState('fetching'); const rec = await fetchAttachment(b.fid, { name: b.name, mime: b.mime }); if (rec) u = await fileUrl(b.fid); } if (!alive) return; if (u) { setUrl(u); setState('ready'); } else setState('missing'); })(); return () => { alive = false; }; }, [b.fid]);
  const dl = () => { if (!url) return; const a = document.createElement('a'); a.href = url; a.download = b.name || 'file'; a.click(); };
  return html`<div class=${'b-file ' + (pdf ? 'pdf' : '')}>
    <div class="bf-head" onClick=${() => pdf && url && setOpen(!open)}>
      <span class="bf-ic"><${Icon} name="file" size=${18} /></span>
      <div class="bf-meta"><b>${b.name || '附件'}</b><small>${pdf ? 'PDF' : (b.mime || '文件').split('/').pop().toUpperCase()}${b.size ? ' · ' + fmtSize(b.size) : ''}${state === 'missing' ? ' · 这台设备上还没有这个文件' : state === 'fetching' ? ' · 正在从云端获取…' : ''}</small></div>
      <div class="bf-acts" onClick=${(e) => e.stopPropagation()}>
        ${pdf && url && html`<button class="ibtn" title=${open ? '收起预览' : '展开预览'} onClick=${() => setOpen(!open)}><${Icon} name=${open ? 'up' : 'down'} size=${14} /></button>`}
        ${url && html`<a class="ibtn" title="新标签页打开" href=${url} target="_blank" rel="noopener"><${Icon} name="external" size=${14} /></a>`}
        ${url && html`<button class="ibtn" title="下载" onClick=${dl}><${Icon} name="download" size=${14} /></button>`}
        <button class="ibtn danger" title="移除附件" onClick=${onRemove}><${Icon} name="x" size=${14} /></button>
      </div>
    </div>
    ${pdf && open && url && html`<iframe class="bf-pdf" src=${url + '#toolbar=1&navpanes=0'} title=${b.name}></iframe>`}
  </div>`;
}

function phFor(b) {
  return { p: '输入 / 插入块，[[ 链接页面', h1: '标题 1', h2: '标题 2', h3: '标题 3', bullet: '列表', number: '列表', todo: '待办', toggle: '折叠标题', quote: '引用', callout: '标注', image: '图片说明', code: '代码' }[b.type] || '';
}
