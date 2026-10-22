// Notion-style block editor on contenteditable blocks.
import { html, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from '../vendor/preact.js';
import { marked } from '../vendor/marked.js';
import { Icon } from './ui.js';
import { TYPES, LIST_TYPES, TEXT_TYPES, block, sanitize, textOf, mdToBlocks } from './blocks.js';
import { todayStr, escapeHtml } from './util.js';

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
  a.deleteContents();
}
function onEdgeLine(el, which) {
  const s = sel(); if (!s.rangeCount) return true;
  const r = s.getRangeAt(0).cloneRange(); const rects = r.getClientRects(); const box = el.getBoundingClientRect();
  let rect = rects[0];
  if (!rect) { r.selectNodeContents(el); const rr = r.getClientRects(); rect = rr[which === 'up' ? 0 : rr.length - 1]; if (!rect) return true; }
  return which === 'up' ? rect.top - box.top < 14 : box.bottom - rect.bottom < 14;
}
function exec(cmd, val) { document.execCommand(cmd, false, val); }
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
export function BlockEditor({ blocks: initial, onChange, notes = [], noteId, onCreatePage, onOpenLink, pageFont }) {
  const [bs, setBs] = useState(() => (initial && initial.length ? initial.map((b) => ({ ...b, v: 0 })) : [block('p', '', { v: 0 })]));
  const [focusReq, setFocusReq] = useState(null);
  const [menu, setMenu] = useState(null);
  const [hmenu, setHmenu] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const [mdEdit, setMdEdit] = useState(null);
  const refs = useRef(new Map());
  const root = useRef();
  const bsRef = useRef(bs); bsRef.current = bs;
  const emitTimer = useRef();

  const emit = useCallback((next) => { clearTimeout(emitTimer.current); bsRef.current = next; setBs(next); onChange(next.map(({ v, ...b }) => ({ ...b, html: sanitize(b.html) }))); }, [onChange]);
  const readHtml = (id) => { const el = refs.current.get(id); return el ? el.innerHTML : ''; };
  const syncFromDom = (list = bsRef.current) => list.map((b) => (refs.current.get(b.id) && TEXT_TYPES.includes(b.type) ? { ...b, html: readHtml(b.id) } : b));
  const bump = (b, patch) => ({ ...b, ...patch, v: (b.v || 0) + 1 });

  useLayoutEffect(() => {
    if (!focusReq) return;
    const el = refs.current.get(focusReq.id);
    if (el) setCaret(el, focusReq.pos);
    setFocusReq(null);
  }, [focusReq, bs]);

  const update = (id, patch, focus) => { const next = syncFromDom(bsRef.current).map((b) => (b.id === id ? bump(b, patch) : b)); emit(next); if (focus) setFocusReq({ id, pos: focus }); };
  const insertAfter = (id, nb, focus = 'start') => { const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === id); list.splice(i + 1, 0, { ...nb, v: 0 }); emit(list); setFocusReq({ id: nb.id, pos: focus }); };
  const removeBlock = (id, focusPrev = true) => {
    const list = syncFromDom(bsRef.current); const i = list.findIndex((b) => b.id === id);
    if (list.length === 1) { emit([bump(list[0], { type: 'p', html: '' })]); setFocusReq({ id: list[0].id, pos: 'start' }); return; }
    list.splice(i, 1); emit(list);
    const t = list[Math.max(0, focusPrev ? i - 1 : i)]; if (t) setFocusReq({ id: t.id, pos: 'end' });
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
    if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); exec('strikeThrough'); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); const url = prompt('链接地址'); if (url) exec('createLink', /^https?:/.test(url) ? url : 'https://' + url); return; }
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
      e.preventDefault();
      const empty = !el.textContent.trim();
      if (empty && (LIST_TYPES.includes(b.type) || b.type === 'quote' || b.type === 'callout')) { update(b.id, b.indent > 0 ? { indent: b.indent - 1 } : { type: 'p', html: '' }, 'start'); return; }
      const [before, after] = splitAtCaret(el);
      const nt = LIST_TYPES.includes(b.type) ? b.type : 'p';
      const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { html: before }) : x));
      const i = list.findIndex((x) => x.id === b.id);
      const nb = { ...block(nt, after, { indent: b.indent || 0 }), v: 0 };
      list.splice(i + 1, 0, nb); emit(list); setFocusReq({ id: nb.id, pos: 'start' }); return;
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
  const neighbor = (id, dir) => { const vis = visible(); const i = vis.findIndex((x) => x.id === id); return vis[i + dir]; };

  /* --- input: markdown shortcuts and menus --- */
  const onInput = (e, b) => {
    const el = e.currentTarget;
    if (b.type === 'code' || b.type === 'md') { b.html = el.innerHTML; scheduleEmit(); return; }
    const before = textBeforeCaret(el);
    const off = caretOffset(el);
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
    else if (menu) setMenu(null);
    b.html = el.innerHTML; scheduleEmit();
  };
  const scheduleEmit = () => { clearTimeout(emitTimer.current); emitTimer.current = setTimeout(() => emit(syncFromDom(bsRef.current)), 300); };
  useEffect(() => () => clearTimeout(emitTimer.current), []);

  const menuItems = () => {
    if (!menu) return [];
    const k = menu.q.toLowerCase();
    if (menu.kind === 'link') {
      const list = notes.filter((n) => n.id !== noteId && n.title && n.title.toLowerCase().includes(k)).slice(0, 8).map((n) => ({ label: `${n.icon || '📄'} ${n.title}`, title: n.title }));
      if (k.trim() && !notes.some((n) => n.title.toLowerCase() === k.trim())) list.push({ label: `＋ 新建页面「${menu.q.trim()}」`, title: menu.q.trim(), create: true });
      return list;
    }
    const all = [...SLASH_TYPES.map((t) => ({ k: t, type: t, label: TYPES[t].label, hint: TYPES[t].hint })), ...SLASH_EXTRA];
    return all.filter((x) => !k || x.label.toLowerCase().includes(k) || x.k.includes(k) || (x.hint || '').toLowerCase().includes(k));
  };
  const applyMenu = (it, b) => {
    const el = refs.current.get(b.id); el.focus();
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
    if (it.k === 'sub') { const title = prompt('子页面标题', '新页面'); if (!title) return; if (onCreatePage) onCreatePage(title); exec('insertHTML', `<a class="wiki" data-title="${escapeHtml(title)}" contenteditable="false">${escapeHtml(title)}</a>&nbsp;`); b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return; }
    const type = it.type;
    if (type === 'image') { const url = prompt('图片链接'); if (!url) return; if (!el.textContent.trim()) update(b.id, { type: 'image', url, html: '' }); else insertAfter(b.id, block('image', '', { url })); return; }
    if (type === 'divider') { if (!el.textContent.trim()) { const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { type: 'divider', html: '' }) : x)); const i = list.findIndex((x) => x.id === b.id); const nb = { ...block('p'), v: 0 }; list.splice(i + 1, 0, nb); emit(list); setFocusReq({ id: nb.id, pos: 'start' }); } else insertAfter(b.id, block('divider'), null); return; }
    if (type === 'code' || type === 'md') { update(b.id, { type, html: escapeHtml(el.textContent) }, 'end'); if (type === 'md') setMdEdit(b.id); return; }
    update(b.id, { type, html: el.innerHTML, checked: false }, 'end');
  };

  const onPaste = (e, b) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    if (b.type === 'code' || b.type === 'md' || !text.includes('\n')) { exec('insertText', text); return; }
    const parsed = mdToBlocks(text);
    const el = e.currentTarget;
    exec('insertHTML', parsed[0].type === 'p' ? parsed[0].html : textOf(parsed[0].html));
    const rest = parsed.slice(1);
    if (!rest.length) { b.html = el.innerHTML; emit(syncFromDom(bsRef.current)); return; }
    const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id);
    list.splice(i + 1, 0, ...rest.map((x) => ({ ...x, v: 0 }))); emit(list); setFocusReq({ id: rest[rest.length - 1].id, pos: 'end' });
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

  return html`<div class=${'beditor font-' + (pageFont || 'default')} ref=${root} onClick=${(e) => { const wk = e.target.closest && e.target.closest('a.wiki'); if (wk) { e.preventDefault(); onOpenLink && onOpenLink(wk.dataset.title || wk.textContent); return; } const lk = e.target.closest && e.target.closest('a[href]'); if (lk && !e.shiftKey) { e.preventDefault(); window.open(lk.getAttribute('href'), '_blank', 'noopener'); return; } if (e.target === root.current) { const last = bs[bs.length - 1]; if (last && TEXT_TYPES.includes(last.type) && !textOf(last.html)) setFocusReq({ id: last.id, pos: 'end' }); else insertAfter(last.id, block('p')); } }}>
    ${vis.map((b) => html`<${Row} key=${b.id} b=${b} editor=${{ refs, onKey, onInput, onPaste, update, removeBlock, insertAfter, addBelow, setHmenu, hmenu, dragId, setDragId, dropAt, setDropAt, onDrop, numberOf, mdEdit, setMdEdit, emit, bs, syncFromDom }} />
      ${menu && menu.id === b.id && items.length > 0 && html`<div class="popmenu bmenu">${items.map((it, i) => html`<div class=${'pm ' + (i === menu.idx ? 'on' : '')} onMouseDown=${(e) => { e.preventDefault(); applyMenu(it, b); }}><b>${it.label}</b>${it.hint && html`<small>${it.hint}</small>`}</div>`)}</div>`}`)}
    <div class="b-tail" onClick=${() => { const last = bs[bs.length - 1]; if (last && TEXT_TYPES.includes(last.type) && !textOf(last.html)) setFocusReq({ id: last.id, pos: 'end' }); else insertAfter(last.id, block('p')); }}></div>
  </div>`;
}

function Row({ b, editor }) {
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
    ${b.type === 'callout' && html`<button class="b-ico" onMouseDown=${(e) => e.preventDefault()} onClick=${() => { const v = prompt('标注图标', b.icon || '💡'); if (v !== null) update(b.id, { icon: v.trim().slice(0, 4) || '💡' }); }}>${b.icon || '💡'}</button>`}
    <div ...${common} class=${'b-text ' + (b.type === 'todo' && b.checked ? 'done' : '')}></div>
  </div>`;
  useEffect(() => { if (mdEdit === b.id && ref.current) { ref.current.focus(); } }, [mdEdit]);
  return html`<div class=${'b-row' + dropCls + (dragId === b.id ? ' dragging' : '')} style=${`--ind:${b.indent || 0}`} data-type=${b.type}
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
