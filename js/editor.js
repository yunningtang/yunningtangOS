// Notion-style block editor on contenteditable blocks.
import { html, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from '../vendor/preact.js';
import { marked } from '../vendor/marked.js';
import { Icon } from './ui.js';
import { ctxMenu } from './ctx.js';
import { askPrompt } from './confirm.js';
import { get as storeGet } from './store.js';
import { TYPES, LIST_TYPES, TEXT_TYPES, block, sanitize, textOf, mdToBlocks, htmlToBlocks, blocksToMd } from './blocks.js';
import { todayStr, escapeHtml, imageToDataUrl } from './util.js';
import { toast } from './nav.js';

// Last thing copied from any editor in this tab: lets paste keep block types (lists, headings, todos) intact.
let lastCopy = null;
let vclock = 1;

const SLASH_EXTRA = [
  { k: 'date', label: '今天的日期', hint: todayStr() },
  { k: 'link', label: '链接到页面', hint: '[[ 双链' },
  { k: 'sub', label: '新建子页面', hint: '在这里嵌入' },
];
const SLASH_TYPES = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code', 'divider', 'image', 'md'];

/* ---------- caret helpers ---------- */
function sel() { return window.getSelection(); }
function caretOffset(el) {
  const s = sel(); if (!s.rangeCount || !el.contains(s.anchorNode)) return null;
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.focusNode, s.focusOffset);
  return r.toString().length;
}
function setCaret(el, pos) {
  el.focus();
  const s = sel(), r = document.createRange();
  const len = el.textContent.length;
  let target = pos === 'end' ? len : pos === 'start' ? 0 : Math.max(0, Math.min(len, pos));
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, acc = 0, done = false;
  while ((node = walker.nextNode())) {
    const l = node.nodeValue.length;
    if (acc + l >= target) { r.setStart(node, target - acc); done = true; break; }
    acc += l;
  }
  if (!done) { r.selectNodeContents(el); r.collapse(false); } else r.collapse(true);
  s.removeAllRanges(); s.addRange(r);
}
function serialize(frag) { const d = document.createElement('div'); d.appendChild(frag); return d.innerHTML; }
function splitAtCaret(el) {
  const s = sel(); const r = s.getRangeAt(0);
  const a = document.createRange(); a.setStart(el, 0); a.setEnd(r.startContainer, r.startOffset);
  const b = document.createRange(); b.setStart(r.endContainer, r.endOffset); b.setEnd(el, el.childNodes.length);
  return [serialize(a.cloneContents()), serialize(b.cloneContents())];
}
function textBeforeCaret(el) {
  const s = sel(); if (!s.rangeCount) return '';
  const r = document.createRange(); r.setStart(el, 0); r.setEnd(s.focusNode, s.focusOffset); return r.toString();
}
function deleteBeforeCaret(el, n) {
  const s = sel(); const r = s.getRangeAt(0);
  const start = caretOffset(el) - n;
  const a = document.createRange(); a.setStart(el, 0); a.setEnd(r.endContainer, r.endOffset);
  // walk to find start position
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node, acc = 0;
  while ((node = walker.nextNode())) { const l = node.nodeValue.length; if (acc + l >= start) { a.setStart(node, start - acc); break; } acc += l; }
  a.deleteContents(); return a;
}
// Insert a node at a (collapsed) range and put the caret after it. Used inside input handlers, where execCommand is ignored.
function insertNodeAt(range, node, trailingSpace = true) {
  range.insertNode(node); let last = node;
  if (trailingSpace) { const sp = document.createTextNode('\u00a0'); node.after(sp); last = sp; }
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
      case 'image': return `<img src="${escapeHtml(b.url || '')}" alt="${escapeHtml(textOf(h))}">`;
      default: return `<p>${h}</p>`;
    }
  }).join('\n').replace(/<\/ul>\n<ul>/g, '\n').replace(/<\/ol>\n<ol>/g, '\n');
}
function cloneBlock(x) { return { ...block(x.type, x.html, { indent: x.indent || 0, checked: !!x.checked, url: x.url, lang: x.lang, icon: x.icon }), v: 0 }; }
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
function toggleWrap(tagName) {
  const s = sel(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const inside = (n) => { while (n && n.nodeType !== 1) n = n.parentNode; return n && n.closest(tagName); };
  const c = inside(r.startContainer);
  if (c) { const frag = document.createDocumentFragment(); while (c.firstChild) frag.appendChild(c.firstChild); c.replaceWith(frag); return; }
  if (r.collapsed) return;
  const el = document.createElement(tagName);
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

/* ---------- editor ---------- */
export function BlockEditor({ blocks: initial, onChange, notes = [], notesRef, noteId, onCreatePage, onOpenLink, pageFont }) {
  const allNotes = () => (notesRef ? notesRef.current : notes);
  const [bs, setBs] = useState(() => (initial && initial.length ? initial.map((b) => ({ ...b, v: 0 })) : [block('p', '', { v: 0 })]));
  const [focusReq, setFocusReq] = useState(null);
  const [menu, setMenu] = useState(null);
  const [hmenu, setHmenu] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const [mdEdit, setMdEdit] = useState(null);
  const [tb, setTb] = useState(null); // { x, y }
  const [bsel, setBsel] = useState(null); // block selection: { from, to } ids
  const bselRef = useRef(null); bselRef.current = bsel;
  const [lp, setLp] = useState(null); // link popover: { x, y, href, el }
  const hist = useRef({ past: [], future: [], lock: false });
  const refs = useRef(new Map());
  const root = useRef();
  const bsRef = useRef(bs); bsRef.current = bs;
  const emitTimer = useRef();

  const cleanCache = useRef(new Map()); // raw html -> sanitized html, so unchanged blocks are not re-parsed
  const sameDoc = (a, b) => a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && x.type === b[i].type && x.html === b[i].html && (x.indent || 0) === (b[i].indent || 0) && !!x.checked === !!b[i].checked && x.url === b[i].url && !!x.open === !!b[i].open));
  const emit = useCallback((next) => {
    clearTimeout(emitTimer.current);
    const prev = bsRef.current;
    if (!hist.current.lock && prev && !sameDoc(prev, next)) { hist.current.past.push(prev); if (hist.current.past.length > 200) hist.current.past.shift(); hist.current.future = []; }
    bsRef.current = next; setBs(next);
    const cache = cleanCache.current, fresh = new Map();
    const out = next.map(({ v, ...b }) => { let c = cache.get(b.html); if (c === undefined) c = sanitize(b.html); fresh.set(b.html, c); return { ...b, html: c }; });
    cleanCache.current = fresh;
    onChange(out);
  }, [onChange]);
  const readHtml = (id) => { const el = refs.current.get(id); return el ? el.innerHTML : ''; };
  const syncFromDom = (list = bsRef.current) => list.map((b) => (refs.current.get(b.id) && TEXT_TYPES.includes(b.type) ? { ...b, html: readHtml(b.id) } : b));
  const bump = (b, patch) => ({ ...b, ...patch, v: (b.v || 0) + 1 });

  useLayoutEffect(() => {
    if (!focusReq) return;
    const el = refs.current.get(focusReq.id);
    if (el) setCaret(el, focusReq.pos);
    const then = focusReq.then; setFocusReq(null);
    if (then) then();
  }, [focusReq, bs]);

  const update = (id, patch, focus) => { const next = syncFromDom(bsRef.current).map((b) => (b.id === id ? bump(b, patch) : b)); emit(next); if (focus) setFocusReq({ id, pos: focus }); };
  const insertAfter = (id, nb, focus = 'start') => { const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === id); list.splice(i + 1, 0, { ...nb, v: 0 }); emit(list); setFocusReq({ id: nb.id, pos: focus }); };
  const removeBlock = (id, focusPrev = true) => {
    const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === id);
    if (list.length === 1) { emit([bump(list[0], { type: 'p', html: '' })]); setFocusReq({ id: list[0].id, pos: 'start' }); return; }
    list.splice(i, 1); emit(list);
    const t = list[Math.max(0, focusPrev ? i - 1 : i)]; if (t) setFocusReq({ id: t.id, pos: 'end' });
  };

  /* --- undo / redo across block operations --- */
  const restore = (snap) => {
    const next = snap.map((b) => ({ ...b, v: ++vclock }));
    hist.current.lock = true; emit(next); hist.current.lock = false;
    return next;
  };
  const undo = () => {
    const cur = syncFromDom(bsRef.current); const h = hist.current;
    if (!sameDoc(cur, bsRef.current)) { h.past.push(bsRef.current); bsRef.current = cur; }
    const prev = h.past.pop(); if (!prev) { toast('没有可撤销的了'); return; }
    h.future.push(cur); const next = restore(prev);
    const i = next.findIndex((b, k) => !cur[k] || cur[k].id !== b.id || cur[k].html !== b.html); const t = next[Math.max(0, Math.min(next.length - 1, i < 0 ? next.length - 1 : i))];
    if (t && TEXT_TYPES.includes(t.type)) setFocusReq({ id: t.id, pos: 'end' });
  };
  const redo = () => {
    const h = hist.current; const nxt = h.future.pop(); if (!nxt) return;
    const cur = syncFromDom(bsRef.current); h.past.push(cur); const next = restore(nxt);
    const i = next.findIndex((b, k) => !cur[k] || cur[k].id !== b.id || cur[k].html !== b.html); const t = next[Math.max(0, Math.min(next.length - 1, i < 0 ? next.length - 1 : i))];
    if (t && TEXT_TYPES.includes(t.type)) setFocusReq({ id: t.id, pos: 'end' });
  };

  /* --- block selection (drag across blocks, shift-click, ⌘A twice) --- */
  const orderIds = () => visible().map((b) => b.id);
  const selectedIds = () => {
    const b = bselRef.current; if (!b) return [];
    const ids = orderIds(); let i = ids.indexOf(b.from), j = ids.indexOf(b.to); if (i < 0 || j < 0) return [];
    if (i > j) [i, j] = [j, i]; return ids.slice(i, j + 1);
  };
  const selectBlocks = (from, to) => { setBsel({ from, to }); const s = sel(); if (s) s.removeAllRanges(); setTb(null); setMenu(null); if (root.current) root.current.focus({ preventScroll: true }); };
  const clearBsel = () => { if (bselRef.current) setBsel(null); };
  const selectedBlocks = () => { const set = new Set(selectedIds()); return bsRef.current.filter((b) => set.has(b.id)); };
  const removeSelected = (replaceWith) => {
    const set = new Set(selectedIds()); if (!set.size) return;
    const list = syncFromDom(bsRef.current); const i0 = list.findIndex((b) => set.has(b.id));
    const kept = list.filter((b) => !set.has(b.id)); const ins = replaceWith && replaceWith.length ? replaceWith : (kept.length ? [] : [{ ...block('p'), v: 0 }]);
    kept.splice(i0, 0, ...ins); emit(kept); setBsel(null);
    const t = ins.length ? ins[ins.length - 1] : kept[Math.max(0, i0 - 1)]; if (t && TEXT_TYPES.includes(t.type)) setFocusReq({ id: t.id, pos: 'end' });
  };
  const copySelected = (e) => {
    const blocks = selectedBlocks(); if (!blocks.length) return false;
    const text = blocksToMd(blocks); lastCopy = { text, blocks: blocks.map(({ v, ...b }) => b) };
    e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', blocksToHtml(blocks)); e.preventDefault(); return true;
  };
  // mouse: drag from inside one block into another turns into block selection
  const dragSel = useRef(null);
  const onRootMouseDown = (e) => {
    if (e.button !== 0) return;
    const row = e.target.closest && e.target.closest('.b-row'); const inText = e.target.closest && e.target.closest('.b-text');
    if (e.target.closest && e.target.closest('.link-pop')) return;
    setLp(null);
    if (e.shiftKey && row && bselRef.current) { e.preventDefault(); selectBlocks(bselRef.current.from, row.dataset.id); return; }
    if (e.shiftKey && row && document.activeElement && document.activeElement.closest) { const cur = document.activeElement.closest('.b-row'); if (cur && cur !== row) { e.preventDefault(); selectBlocks(cur.dataset.id, row.dataset.id); return; } }
    if (bselRef.current && !(e.target.closest && e.target.closest('.b-gutter'))) clearBsel();
    if (!inText || !row) return;
    dragSel.current = { from: row.dataset.id, x: e.clientX, y: e.clientY, active: false };
    const move = (ev) => {
      const d = dragSel.current; if (!d) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY); const r = under && under.closest && under.closest('.b-row');
      const to = r && root.current.contains(r) ? r.dataset.id : null;
      if (!to) { if (Math.abs(ev.clientY - d.y) > 24 && root.current.contains(under)) { const ids = orderIds(); const last = ids[ev.clientY > d.y ? ids.length - 1 : 0]; if (last !== d.from || d.active) { d.active = true; root.current.classList.add('bselecting'); selectBlocks(d.from, last); } } return; }
      if (to !== d.from || d.active) { if (!d.active) { d.active = true; root.current.classList.add('bselecting'); } selectBlocks(d.from, to); }
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); if (root.current) root.current.classList.remove('bselecting'); dragSel.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  useEffect(() => {
    if (!bsel) return;
    const h = (e) => { if (root.current && !root.current.contains(e.target)) setBsel(null); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [bsel]);

  /* --- delete a native selection that spans several blocks --- */
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
  const moveBlock = (id, dir) => {
    const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= list.length) return;
    const pos = caretOffset(refs.current.get(id)); const [mv] = list.splice(i, 1); list.splice(j, 0, mv); emit(list); setFocusReq({ id, pos: pos == null ? 'end' : pos });
  };
  // keys that apply to the whole editor, handled before the block's own handler
  const onRootKeyCapture = (e) => {
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (lp) { setLp(null); if (e.key === 'Escape') { e.preventDefault(); return; } }
    if (mod && !e.altKey && k === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && !e.altKey && k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); return; }
    if (bselRef.current) {
      const ids = selectedIds(); const all = orderIds();
      if (e.key === 'Escape') { e.preventDefault(); setBsel(null); const t = bsRef.current.find((b) => b.id === ids[ids.length - 1]); if (t && TEXT_TYPES.includes(t.type)) setFocusReq({ id: t.id, pos: 'end' }); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeSelected(); return; }
      if (mod && k === 'a') { e.preventDefault(); selectBlocks(all[0], all[all.length - 1]); return; }
      if (mod && k === 'd') { e.preventDefault(); const bl = selectedBlocks(); const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === ids[ids.length - 1]); list.splice(i + 1, 0, ...bl.map(cloneBlock)); emit(list); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const b = bselRef.current; const i = all.indexOf(b.to); const j = Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); if (e.shiftKey) selectBlocks(b.from, all[j]); else { setBsel(null); const t = bsRef.current.find((x) => x.id === all[j]); if (t) setFocusReq({ id: t.id, pos: e.key === 'ArrowDown' ? 'end' : 'start' }); } return; }
      if (e.key === 'Enter' && !mod) { e.preventDefault(); const nb = { ...block('p'), v: 0 }; removeSelected([nb]); return; }
      if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); const nb = { ...block('p'), v: 0 }; const ch = e.key; removeSelected([nb]); setFocusReq({ id: nb.id, pos: 'start', then: () => exec('insertText', ch) }); return; }
      if (mod && (k === 'c' || k === 'x' || k === 'v')) return; // clipboard events handle these
      return;
    }
    const inText = e.target.closest && e.target.closest('.b-text');
    if (mod && !e.shiftKey && k === 'a' && inText) {
      const s = sel(); const len = inText.textContent.length;
      const whole = !len || (s && !s.isCollapsed && s.toString().length >= len);
      if (whole) { e.preventDefault(); e.stopPropagation(); const all = orderIds(); selectBlocks(all[0], all[all.length - 1]); }
      return;
    }
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && inText) { const row = inText.closest('.b-row'); if (row) { e.preventDefault(); e.stopPropagation(); moveBlock(row.dataset.id, e.key === 'ArrowUp' ? -1 : 1); } return; }
    if (mod && e.key === 'Enter' && inText) { const row = inText.closest('.b-row'); const b = row && bsRef.current.find((x) => x.id === row.dataset.id); if (b && b.type === 'todo') { e.preventDefault(); e.stopPropagation(); update(b.id, { checked: !b.checked }); } else if (b && b.type === 'toggle') { e.preventDefault(); e.stopPropagation(); update(b.id, { open: !b.open }); } return; }
    // native selection spanning several blocks (Firefox / Safari allow it)
    if (rowsInSelection(root.current).length >= 2) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); deleteAcross(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); deleteAcross(() => { const el = document.activeElement; const b = el && el.closest && bsRef.current.find((x) => x.id === (el.closest('.b-row') || {}).dataset?.id); if (b) splitBlock(b, el); }); return; }
      if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); e.stopPropagation(); const ch = e.key; deleteAcross(() => exec('insertText', ch)); return; }
    }
  };
  const onRootCopy = (e) => {
    if (bselRef.current) { copySelected(e); return; }
    const rows = rowsInSelection(root.current);
    if (rows.length < 2) { lastCopy = null; return; }
    const s = sel(); const r = s.getRangeAt(0); const byId = new Map(bsRef.current.map((b) => [b.id, b]));
    const blocks = rows.map((row, i) => { const b = byId.get(row.dataset.id); if (!b) return null; const el = refs.current.get(b.id); if (!el || !TEXT_TYPES.includes(b.type)) return { ...b }; let h = el.innerHTML; if (i === 0 && el.contains(r.startContainer)) h = htmlAfter(el, r.startContainer, r.startOffset); if (i === rows.length - 1 && el.contains(r.endContainer)) h = i === 0 ? serialize(r.cloneContents()) : htmlBefore(el, r.endContainer, r.endOffset); return { ...b, html: h }; }).filter(Boolean);
    const text = blocksToMd(blocks); lastCopy = { text, blocks: blocks.map(({ v, ...b }) => b) };
    e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', blocksToHtml(blocks)); e.preventDefault();
  };
  const onRootCut = (e) => {
    if (bselRef.current) { if (copySelected(e)) removeSelected(); return; }
    if (rowsInSelection(root.current).length >= 2) { onRootCopy(e); deleteAcross(); }
  };
  const onRootPaste = async (e) => {
    if (!bselRef.current) return;
    e.preventDefault(); const parsed = await parseClipboard(e.clipboardData, 'p');
    if (parsed && parsed.length) removeSelected(parsed.map((x) => ({ ...x, v: 0 })));
  };

  /* --- key handling --- */
  const onKey = (e, b) => {
    const el = e.currentTarget;
    if (menu && menu.id === b.id) {
      const items = menuItems();
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, idx: (menu.idx + 1) % Math.max(1, items.length) }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, idx: (menu.idx - 1 + items.length) % Math.max(1, items.length) }); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && items.length) { e.preventDefault(); applyMenu(items[menu.idx], b); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); exec('bold'); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); exec('italic'); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); exec('underline'); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleCode(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); applyMark('y'); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); exec('strikeThrough'); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); const sel0 = window.getSelection(); const range = sel0.rangeCount ? sel0.getRangeAt(0).cloneRange() : null; askPrompt('链接地址', '', { title: '插入链接', placeholder: 'https://' }).then((url) => { if (!url) return; el.focus(); if (range) { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); } exec('createLink', /^https?:/.test(url) ? url : 'https://' + url); }); return; }
    if (b.type === 'code' || b.type === 'md') {
      if (e.key === 'Escape') { el.blur(); setMdEdit(null); }
      if (e.key === 'Tab') { e.preventDefault(); exec('insertText', '  '); }
      if (e.key === 'ArrowDown' && caretOffset(el) === el.textContent.length) { const n = neighbor(b.id, 1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'start' }); } }
      if (e.key === 'ArrowUp' && caretOffset(el) === 0) { const n = neighbor(b.id, -1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'end' }); } }
      if (e.key === 'Backspace' && !el.textContent) { e.preventDefault(); removeBlock(b.id); }
      return;
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) { e.preventDefault(); exec('insertHTML', '<br>'); return; }
      e.preventDefault(); splitBlock(b, el); return;
    }
    if (e.key === 'Backspace') {
      const s = sel(); if (!s.isCollapsed) return;
      if (caretOffset(el) !== 0) return;
      e.preventDefault();
      if (b.type !== 'p') { update(b.id, { type: 'p' }, 'start'); return; }
      if (b.indent > 0) { update(b.id, { indent: b.indent - 1 }, 'start'); return; }
      const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id);
      if (i === 0) return;
      const prev = list[i - 1];
      if (!TEXT_TYPES.includes(prev.type)) { if (!el.textContent) { list.splice(i, 1); emit(list); setFocusReq({ id: prev.id, pos: 'end' }); } else setFocusReq({ id: prev.id, pos: 'end' }); return; }
      const pos = textOf(prev.html).length;
      list[i - 1] = bump(prev, { html: prev.html + el.innerHTML }); list.splice(i, 1); emit(list); setFocusReq({ id: prev.id, pos }); return;
    }
    if (e.key === 'Delete') {
      if (caretOffset(el) !== el.textContent.length) return;
      const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); const next = list[i + 1];
      if (!next || !TEXT_TYPES.includes(next.type)) return;
      e.preventDefault(); const pos = el.textContent.length;
      list[i] = bump(list[i], { html: el.innerHTML + next.html }); list.splice(i + 1, 1); emit(list); setFocusReq({ id: b.id, pos }); return;
    }
    if (e.key === 'ArrowUp' && onEdgeLine(el, 'up')) { const n = neighbor(b.id, -1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'end' }); } return; }
    if (e.key === 'ArrowDown' && onEdgeLine(el, 'down')) { const n = neighbor(b.id, 1); if (n) { e.preventDefault(); setFocusReq({ id: n.id, pos: 'start' }); } return; }
    if (e.key === 'Tab') { e.preventDefault(); const pos = caretOffset(el); update(b.id, { indent: Math.max(0, Math.min(3, (b.indent || 0) + (e.shiftKey ? -1 : 1))) }, pos); return; }
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

  /* --- input: markdown shortcuts and menus --- */
  const onInput = (e, b) => {
    const el = e.currentTarget;
    if (b.type === 'code' || b.type === 'md') { b.html = el.innerHTML; scheduleEmit(); return; }
    const before = textBeforeCaret(el);
    const off = caretOffset(el);
    // typed a URL followed by a space -> make it a link
    { const m = before.match(/(?:^|\s)(https?:\/\/[^\s<>"']{4,})\s$/); const s0 = sel(); const inA = s0 && s0.anchorNode && (s0.anchorNode.nodeType === 1 ? s0.anchorNode : s0.anchorNode.parentElement).closest('a');
      if (m && off === before.length && !inA) { const r = deleteBeforeCaret(el, m[1].length + 1); const a = document.createElement('a'); a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m[1]; insertNodeAt(r, a); b.html = el.innerHTML; scheduleEmit(); return; } }
    // markdown shortcuts at block start
    const sc = [[/^#\s$/, 'h1'], [/^##\s$/, 'h2'], [/^###\s$/, 'h3'], [/^[-*]\s$/, 'bullet'], [/^1[.)]\s$/, 'number'], [/^\[\]\s$/, 'todo'], [/^\[ \]\s$/, 'todo'], [/^>\s$/, 'quote'], [/^>>\s$/, 'callout'], [/^```$/, 'code'], [/^---$/, 'divider'], [/^(\^|▸)\s$/, 'toggle']];
    for (const [re, type] of sc) {
      if (re.test(before) && off === before.length && b.type === 'p') {
        deleteBeforeCaret(el, before.length);
        if (type === 'divider') { const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { type: 'divider', html: '' }) : x)); const i = list.findIndex((x) => x.id === b.id); const nb = { ...block('p'), v: 0 }; list.splice(i + 1, 0, nb); emit(list); setFocusReq({ id: nb.id, pos: 'start' }); return; }
        update(b.id, { type, html: el.innerHTML, checked: false }, 'start'); return;
      }
    }
    let m;
    if ((m = before.match(/\[\[([^\]]*)$/))) setMenu({ kind: 'link', id: b.id, q: m[1], idx: 0 });
    else if ((m = before.match(/(?:^|\s)\/([^\s/]*)$/))) setMenu({ kind: 'slash', id: b.id, q: m[1], idx: 0 });
    else if ((m = before.match(/(?:^|\s)@([^\s@]*)$/))) setMenu({ kind: 'ref', id: b.id, q: m[1], idx: 0 });
    else if (menu) setMenu(null);
    b.html = el.innerHTML; scheduleEmit();
  };
  const scheduleEmit = () => { clearTimeout(emitTimer.current); emitTimer.current = setTimeout(() => emit(syncFromDom(bsRef.current)), 600); };
  useEffect(() => () => clearTimeout(emitTimer.current), []);
  useEffect(() => {
    const upd = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount || !root.current) return setTb(null);
      setLp(null);
      const r = s.getRangeAt(0); const a = r.commonAncestorContainer; const el = a.nodeType === 1 ? a : a.parentElement;
      if (!el || !root.current.contains(el) || !el.closest('.b-text') || el.closest('pre')) return setTb(null);
      const rect = r.getBoundingClientRect(); if (!rect.width && !rect.height) return setTb(null);
      const rr = root.current.getBoundingClientRect();
      setTb({ x: rect.left + rect.width / 2 - rr.left, y: rect.top - rr.top });
    };
    document.addEventListener('selectionchange', upd);
    return () => document.removeEventListener('selectionchange', upd);
  }, []);

  const menuItems = () => {
    if (!menu) return [];
    const k = menu.q.toLowerCase();
    if (menu.kind === 'link') {
      const ns = allNotes();
      const list = ns.filter((n) => n.id !== noteId && n.title && n.title.toLowerCase().includes(k)).slice(0, 8).map((n) => ({ label: n.title, title: n.title }));
      if (k.trim() && !ns.some((n) => n.title.toLowerCase() === k.trim())) list.push({ label: `＋ 新建页面「${menu.q.trim()}」`, title: menu.q.trim(), create: true });
      return list;
    }
    if (menu.kind === 'ref') return refTargets(menu.q);
    const all = [...SLASH_TYPES.map((t) => ({ k: t, type: t, label: TYPES[t].label, hint: TYPES[t].hint })), ...SLASH_EXTRA];
    return all.filter((x) => !k || x.label.toLowerCase().includes(k) || x.k.includes(k) || (x.hint || '').toLowerCase().includes(k));
  };
  const applyMenu = (it, b) => {
    const el = refs.current.get(b.id); el.focus();
    if (menu.kind === 'ref') {
      deleteBeforeCaret(el, menu.q.length + 1);
      exec('insertHTML', `<a class="ref" data-kind="${it.kind}" data-id="${it.id}" contenteditable="false">${escapeHtml(it.title)}</a>&nbsp;`);
      setMenu(null); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return;
    }
    if (menu.kind === 'link') {
      deleteBeforeCaret(el, menu.q.length + 2);
      exec('insertHTML', `<a class="wiki" data-title="${escapeHtml(it.title)}" contenteditable="false">${escapeHtml(it.title)}</a>&nbsp;`);
      if (it.create && onCreatePage) onCreatePage(it.title);
      setMenu(null); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return;
    }
    deleteBeforeCaret(el, menu.q.length + 1);
    setMenu(null);
    if (it.k === 'date') { exec('insertText', todayStr() + ' '); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return; }
    if (it.k === 'link') { exec('insertText', '[['); setMenu({ kind: 'link', id: b.id, q: '', idx: 0 }); return; }
    if (it.k === 'sub') { askPrompt('子页面标题', '', { title: '新建子页面', placeholder: '标题' }).then((title) => { if (!title) return; if (onCreatePage) onCreatePage(title); el.focus(); exec('insertHTML', `<a class="wiki" data-title="${escapeHtml(title)}" contenteditable="false">${escapeHtml(title)}</a>&nbsp;`); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); }); return; }
    const type = it.type;
    if (type === 'image') { askPrompt('图片链接', '', { title: '插入图片', placeholder: 'https://…' }).then((url) => { if (!url) return; if (!el.textContent.trim()) update(b.id, { type: 'image', url, html: '' }); else insertAfter(b.id, block('image', '', { url })); }); return; }
    if (type === 'divider') { if (!el.textContent.trim()) { const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { type: 'divider', html: '' }) : x)); const i = list.findIndex((x) => x.id === b.id); const nb = { ...block('p'), v: 0 }; list.splice(i + 1, 0, nb); emit(list); setFocusReq({ id: nb.id, pos: 'start' }); } else insertAfter(b.id, block('divider'), null); return; }
    if (type === 'code' || type === 'md') { update(b.id, { type, html: escapeHtml(el.textContent) }, 'end'); if (type === 'md') setMdEdit(b.id); return; }
    update(b.id, { type, html: el.innerHTML, checked: false }, 'end');
  };

  // clipboard -> blocks. Prefers our own last copy (keeps block types), then images, then rich html, then text.
  const parseClipboard = async (cd, curType) => {
    const files = [...(cd.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { const urls = await Promise.all(files.map((f) => imageToDataUrl(f, 1600).catch(() => null))); return urls.filter(Boolean).map((u) => block('image', '', { url: u })); }
    const text = cd.getData('text/plain') || ''; const rich = cd.getData('text/html') || '';
    if (lastCopy && text && text === lastCopy.text) return lastCopy.blocks.map(cloneBlock);
    if (rich && /<(p|div|h[1-6]|li|ul|ol|blockquote|pre|table|img|br|span|b|i|u|strong|em|a|mark|s|strike|code)\b/i.test(rich)) { const parsed = htmlToBlocks(rich); if (parsed.length) return parsed; }
    if (!text) return [];
    if (curType === 'code' || curType === 'md') return [block(curType, escapeHtml(text))];
    return mdToBlocks(text);
  };
  const insertBlocksAt = (b, el, parsed) => {
    if (!parsed.length) return;
    const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); if (i < 0) return;
    const empty = !el || !el.textContent.trim();
    const v0 = parsed.map((x) => ({ ...x, v: 0 }));
    if (empty && (b.type === 'p' || !TEXT_TYPES.includes(v0[0].type) || v0.length > 1)) { list.splice(i, 1, ...v0.map((x, k) => (k === 0 && TEXT_TYPES.includes(x.type) && b.type !== 'p' && v0.length === 1 ? { ...x, type: b.type, indent: b.indent || 0 } : x))); }
    else if (el && (v0[0].type === 'p' || v0[0].type === b.type)) { exec('insertHTML', v0[0].html); list[i] = bump(list[i], { html: el.innerHTML }); list.splice(i + 1, 0, ...v0.slice(1)); if (v0.length === 1) { emit(list); return; } }
    else list.splice(i + 1, 0, ...v0);
    emit(list); const last = v0[v0.length - 1]; setFocusReq({ id: last.id, pos: 'end' });
  };
  const onPaste = async (e, b) => {
    const el = e.currentTarget; const cd = e.clipboardData;
    const text = cd.getData('text/plain') || ''; const rich = cd.getData('text/html') || '';
    const files = [...(cd.files || [])].filter((f) => /^image\//.test(f.type));
    if (!text && !rich && !files.length) return;
    e.preventDefault();
    if (b.type === 'code' || b.type === 'md') { if (text) exec('insertText', text); return; }
    // a bare URL pasted over selected text becomes a link
    const url = text.trim(); const s0 = sel();
    if (!files.length && /^https?:\/\/\S+$/.test(url) && !(lastCopy && lastCopy.text === text)) {
      if (s0 && !s0.isCollapsed && el.contains(s0.anchorNode)) { exec('createLink', url); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return; }
      exec('insertHTML', `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`); b.html = el.innerHTML; scheduleEmit(); return;
    }
    const parsed = await parseClipboard(cd, b.type);
    if (!parsed.length) { if (text) exec('insertText', text); return; }
    if (parsed.length === 1 && parsed[0].type === 'p' && el.textContent.trim()) { exec('insertHTML', parsed[0].html); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return; }
    if (parsed.length === 1 && parsed[0].type === 'p' && !el.textContent.trim() && b.type !== 'p') { exec('insertHTML', parsed[0].html); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return; }
    insertBlocksAt(b, el, parsed);
  };

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

  /* --- drag & drop --- */
  const onDrop = (e, targetId) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); setDropAt(null); return; }
    const list = syncFromDom(bsRef.current); const from = list.findIndex((x) => x.id === dragId); const [mv] = list.splice(from, 1);
    let to = list.findIndex((x) => x.id === targetId); if (dropAt && dropAt.after) to++;
    list.splice(to, 0, mv); emit(list); setDragId(null); setDropAt(null);
  };

  const addBelow = (id) => insertAfter(id, block('p'));
  const items = menuItems();

  const selIds = new Set(selectedIds());
  const onRootClick = (e) => {
    const wk = e.target.closest && e.target.closest('a.wiki'); if (wk) { e.preventDefault(); onOpenLink && onOpenLink(wk.dataset.title || wk.textContent); return; }
    const rf = e.target.closest && e.target.closest('a.ref'); if (rf) { e.preventDefault(); openRef(rf.dataset.kind, rf.dataset.id); return; }
    const lk = e.target.closest && e.target.closest('a[href]');
    if (lk) { e.preventDefault(); if (e.metaKey || e.ctrlKey) { window.open(lk.getAttribute('href'), '_blank', 'noopener'); return; } const r = lk.getBoundingClientRect(), rr = root.current.getBoundingClientRect(); setLp({ x: r.left - rr.left, y: r.bottom - rr.top + 6, href: lk.getAttribute('href'), el: lk }); return; }
    if (e.target === root.current || e.target.classList.contains('liq')) { const last = bs[bs.length - 1]; if (last && TEXT_TYPES.includes(last.type) && !textOf(last.html)) setFocusReq({ id: last.id, pos: 'end' }); else insertAfter(last.id, block('p')); }
  };
  const editLink = async () => { const a = lp.el; const url = await askPrompt('链接地址', lp.href, { title: '编辑链接', placeholder: 'https://' }); if (url == null) return; const v = url.trim(); if (!v) { unlink(a); } else a.setAttribute('href', /^(https?:|mailto:)/.test(v) ? v : 'https://' + v); setLp(null); emit(syncFromDom(bsRef.current)); };
  const unlink = (a) => { const frag = document.createDocumentFragment(); while (a.firstChild) frag.appendChild(a.firstChild); a.replaceWith(frag); setLp(null); emit(syncFromDom(bsRef.current)); };
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

  return html`<div class=${'beditor font-' + (pageFont || 'default') + (bsel ? ' has-bsel' : '')} ref=${root} tabindex="-1" data-liquid=".b-row" onClick=${onRootClick} onMouseDown=${onRootMouseDown} onKeyDownCapture=${onRootKeyCapture} onCopy=${onRootCopy} onCut=${onRootCut} onPaste=${onRootPaste}
    onContextMenu=${(e) => { if (!bselRef.current) return; e.preventDefault(); const n = selectedIds().length; ctxMenu(e, [{ label: '复制', icon: 'layers', hint: '⌘C', onClick: () => document.execCommand('copy') }, { label: '复制一份', icon: 'plus', hint: '⌘D', onClick: () => { const bl = selectedBlocks(); const ids = selectedIds(); const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === ids[ids.length - 1]); list.splice(i + 1, 0, ...bl.map(cloneBlock)); emit(list); } }, 'sep', ...['p', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote'].map((t) => ({ label: '转为' + TYPES[t].label, icon: 'note', onClick: () => { const set = new Set(selectedIds()); emit(syncFromDom(bsRef.current).map((b) => (set.has(b.id) && TEXT_TYPES.includes(b.type) ? bump(b, { type: t }) : b))); } })), 'sep', { label: '删除', icon: 'trash', danger: true, hint: '⌫', onClick: () => removeSelected() }], `${n} 个块`); }}>
    ${lp && html`<div class="link-pop" style=${`left:${lp.x}px;top:${lp.y}px`} onMouseDown=${(e) => e.stopPropagation()}>
      <a class="lp-url" href=${lp.href} target="_blank" rel="noopener" title=${lp.href}><${Icon} name="external" size=${12} /> ${hostOf(lp.href)}</a>
      <button class="ibtn" title="编辑链接" onClick=${editLink}><${Icon} name="edit" size=${13} /></button>
      <button class="ibtn" title="复制链接" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(lp.href); toast('已复制链接'); setLp(null); }}><${Icon} name="layers" size=${13} /></button>
      <button class="ibtn danger" title="移除链接" onClick=${() => unlink(lp.el)}><${Icon} name="x" size=${13} /></button>
    </div>`}
    <span class="liq"></span>
    ${tb && html`<div class="sel-tb" style=${`left:${tb.x}px;top:${tb.y}px`} onMouseDown=${(e) => e.preventDefault()} onClick=${() => setTimeout(() => emit(syncFromDom(bsRef.current)), 0)}>
      <button title="粗体 ⌘B" onClick=${() => exec('bold')}><b>B</b></button>
      <button title="斜体 ⌘I" onClick=${() => exec('italic')}><i>I</i></button>
      <button title="下划线 ⌘U" onClick=${() => exec('underline')}><u>U</u></button>
      <button title="删除线" onClick=${() => exec('strikeThrough')}><s>S</s></button>
      <button title="代码 ⌘E" class="mono" onClick=${() => toggleCode()}>${'</>'}</button>
      <span class="tb-hl"><button title="荧光标记 ⌘⇧H" class="hl" onClick=${() => applyMark('y')}>A</button>${['y', 'g', 'b', 'p', 'r'].map((c) => html`<button class=${'hl-dot hl-' + c} title="标记颜色" onClick=${() => applyMark(c)}></button>`)}</span>
      <button title="链接 ⌘K" onClick=${() => { const s2 = window.getSelection(); const range = s2.rangeCount ? s2.getRangeAt(0).cloneRange() : null; askPrompt('链接地址', '', { title: '插入链接', placeholder: 'https://' }).then((url) => { if (!url) return; if (range) { s2.removeAllRanges(); s2.addRange(range); } exec('createLink', /^https?:/.test(url) ? url : 'https://' + url); const n = range && range.commonAncestorContainer; const row = n && (n.nodeType === 1 ? n : n.parentElement).closest('.b-row'); if (row) { const id = row.dataset.id; } emit(syncFromDom(bsRef.current)); }); }}><${Icon} name="link" size=${13} /></button>
      <button title="清除格式" onClick=${() => exec('removeFormat')}><${Icon} name="x" size=${13} /></button>
    </div>`}
    ${vis.map((b) => html`<${Row} key=${b.id} b=${b} selected=${selIds.has(b.id)} editor=${{ refs, onKey, onInput, onPaste, update, removeBlock, insertAfter, addBelow, setHmenu, hmenu, dragId, setDragId, dropAt, setDropAt, onDrop, numberOf, mdEdit, setMdEdit, emit, bs, syncFromDom }} />
      ${menu && menu.id === b.id && items.length > 0 && html`<div class="popmenu bmenu">${items.map((it, i) => html`<div class=${'pm ' + (i === menu.idx ? 'on' : '')} onMouseDown=${(e) => { e.preventDefault(); applyMenu(it, b); }}><b>${it.label}</b>${it.hint && html`<small>${it.hint}</small>`}</div>`)}</div>`}`)}
    <div class="b-tail" onClick=${() => { const last = bs[bs.length - 1]; if (last && TEXT_TYPES.includes(last.type) && !textOf(last.html)) setFocusReq({ id: last.id, pos: 'end' }); else insertAfter(last.id, block('p')); }}></div>
  </div>`;
}

function Row({ b, editor, selected }) {
  const { refs, onKey, onInput, onPaste, update, removeBlock, insertAfter, addBelow, setHmenu, hmenu, dragId, setDragId, dropAt, setDropAt, onDrop, numberOf, mdEdit, setMdEdit } = editor;
  const ref = useRef();
  useLayoutEffect(() => { if (ref.current) refs.current.set(b.id, ref.current); return () => refs.current.delete(b.id); }, [b.id, b.type]);
  useLayoutEffect(() => { const el = ref.current; if (el && el.innerHTML !== b.html) el.innerHTML = b.html; }, [b.v, b.type]);
  const isText = TEXT_TYPES.includes(b.type);
  const common = { ref, class: 'b-text', contenteditable: 'true', 'data-ph': phFor(b), onKeyDown: (e) => onKey(e, b), onInput: (e) => onInput(e, b), onPaste: (e) => onPaste(e, b), spellcheck: 'false' };
  const dropCls = dropAt && dropAt.id === b.id ? (dropAt.after ? ' drop-after' : ' drop-before') : '';
  let body;
  if (b.type === 'divider') body = html`<div class="b-divider" tabindex="0" onKeyDown=${(e) => { if (e.key === 'Backspace' || e.key === 'Delete') removeBlock(b.id); }}><hr/></div>`;
  else if (b.type === 'image') body = html`<figure class="b-image"><img src=${b.url} alt="" onError=${(e) => { e.target.style.opacity = .3; }} /><figcaption ...${common} class="b-text b-cap"></figcaption></figure>`;
  else if (b.type === 'code') body = html`<div class="b-code"><input class="b-lang" value=${b.lang || ''} placeholder="语言" onInput=${(e) => update(b.id, { lang: e.target.value })} /><pre ...${common} contenteditable="plaintext-only" class="b-text"></pre></div>`;
  else if (b.type === 'md') body = mdEdit === b.id
    ? html`<pre ...${common} contenteditable="plaintext-only" class="b-text b-mdsrc" onBlur=${() => setMdEdit(null)}></pre>`
    : html`<div class="b-mdview md" title="点击编辑 Markdown" onClick=${() => { setMdEdit(b.id); }} dangerouslySetInnerHTML=${{ __html: marked.parse(textOf(b.html)) }}></div>`;
  else body = html`<div class=${'b-' + b.type}>
    ${b.type === 'bullet' && html`<span class="b-mark">•</span>`}
    ${b.type === 'number' && html`<span class="b-mark num">${numberOf(b)}.</span>`}
    ${b.type === 'todo' && html`<button class=${'b-check ' + (b.checked ? 'on' : '')} onMouseDown=${(e) => e.preventDefault()} onClick=${() => update(b.id, { checked: !b.checked })}><${Icon} name="check" size=${11} /></button>`}
    ${b.type === 'toggle' && html`<button class=${'b-tg ' + (b.open ? 'open' : '')} onMouseDown=${(e) => e.preventDefault()} onClick=${() => update(b.id, { open: !b.open })}><${Icon} name="right" size=${12} /></button>`}
    ${b.type === 'callout' && html`<span class="b-ico">│</span>`}
    <div ...${common} class=${'b-text ' + (b.type === 'todo' && b.checked ? 'done' : '')}></div>
  </div>`;
  useEffect(() => { if (mdEdit === b.id && ref.current) { ref.current.focus(); } }, [mdEdit]);
  const menu = (e) => { if (selected) return; if (window.getSelection && !window.getSelection().isCollapsed) return; e.stopPropagation(); ctxMenu(e, [
    ...['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code'].map((t) => ({ label: TYPES[t].label, icon: b.type === t ? 'check' : 'note', onClick: () => { if (isText && t === 'code') update(b.id, { type: t, html: escapeHtml(textOf(b.html)) }); else if (b.type === 'code' && t !== 'code') update(b.id, { type: t, html: escapeHtml(textOf(b.html)).replace(/\n/g, '<br>') }); else update(b.id, { type: t }); } })),
    'sep',
    { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) },
    { label: '复制一份', icon: 'layers', onClick: () => insertAfter(b.id, { ...block(b.type, b.html, { indent: b.indent, checked: b.checked, url: b.url, lang: b.lang, icon: b.icon }) }) },
    { label: '删除块', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) },
  ], '块'); };
  return html`<div class=${'b-row' + dropCls + (dragId === b.id ? ' dragging' : '') + (selected ? ' bsel' : '')} style=${`--ind:${b.indent || 0}`} data-type=${b.type} data-id=${b.id} onContextMenu=${menu}
    onDragOver=${(e) => { if (!dragId) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ id: b.id, after: e.clientY > r.top + r.height / 2 }); }}
    onDrop=${(e) => onDrop(e, b.id)}>
    <div class="b-gutter" contenteditable="false">
      <button class="b-plus" title="在下方添加块" onMouseDown=${(e) => e.preventDefault()} onClick=${() => addBelow(b.id)}><${Icon} name="plus" size=${14} /></button>
      <button class="b-handle" title="拖动 · 点击打开菜单" draggable="true" onDragStart=${(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }} onDragEnd=${() => { setDragId(null); setDropAt(null); }} onMouseDown=${(e) => e.preventDefault()} onClick=${() => setHmenu(hmenu === b.id ? null : b.id)}>⋮⋮</button>
      ${hmenu === b.id && html`<div class="popmenu hmenu" onMouseDown=${(e) => e.preventDefault()}>
        <div class="pm-sec">转换为</div>
        ${['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code'].map((t) => html`<div class=${'pm ' + (b.type === t ? 'on' : '')} onClick=${() => { if (isText && (t === 'code')) update(b.id, { type: t, html: escapeHtml(textOf(b.html)) }); else if (b.type === 'code' && t !== 'code') update(b.id, { type: t, html: escapeHtml(textOf(b.html)).replace(/\n/g, '<br>') }); else update(b.id, { type: t }); setHmenu(null); }}><b>${TYPES[t].label}</b></div>`)}
        <div class="pm-sec">操作</div>
        <div class="pm" onClick=${() => { insertAfter(b.id, { ...block(b.type, b.html, { indent: b.indent, checked: b.checked, url: b.url, lang: b.lang, icon: b.icon }) }); setHmenu(null); }}><b>复制一份</b></div>
        <div class="pm danger" onClick=${() => { removeBlock(b.id); setHmenu(null); }}><b>删除</b><small>⌫</small></div>
      </div>`}
    </div>
    ${body}
  </div>`;
}

function phFor(b) {
  return { p: '输入 / 插入块，[[ 链接页面', h1: '标题 1', h2: '标题 2', h3: '标题 3', bullet: '列表', number: '列表', todo: '待办', toggle: '折叠标题', quote: '引用', callout: '标注', image: '图片说明', code: '代码' }[b.type] || '';
}
