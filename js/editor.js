// Block editor on a single contenteditable surface (like a document), with one row per block.
// Text selection, copy and formatting flow across blocks natively; structure (split/merge/convert) is ours.
import { html, useState, useRef, useEffect, useLayoutEffect, useCallback, Component , createPortal } from '../vendor/preact.js';
import { marked } from '../vendor/marked.js';
import { Icon } from './ui.js';
import { ctxMenu } from './ctx.js';
import { openPalette } from './palette.js';
import { askPrompt } from './confirm.js';
import { get as storeGet, upsert as storeUpsert, remove as storeRemove } from './store.js';
import { TYPES, LIST_TYPES, TEXT_TYPES, block, sanitize, textOf, mdToBlocks, htmlToBlocks, blocksToMd, emptyTable, sanitizeDoc, structureScore, TEXT_COLORS, TEXT_COLOR_NAMES, TEXT_SIZES, TEXT_FONTS, isSize, HL_COLORS, HL_NAMES } from './blocks.js';
import { todayStr, escapeHtml, imageToDataUrl, pickFile, uid } from './util.js';
import { saveFile, fileUrl, forgetUrl, deleteFile, fmtSize, isPdf } from './files.js';
import { fetchAttachment } from './sync.js';
import { toast } from './nav.js';
import { fillPending, isRunning } from './docai.js';
import { FONTS, FONT_GROUPS, ensureFont } from './fonts.js';
import { TEMPLATES, templateBlocks } from './templates.js';

// Last thing copied from any editor in this tab: lets paste keep block types (lists, headings, todos) intact.
let lastCopy = null;
let vclock = 1;

const SLASH_EXTRA = [
  { k: 'ai', label: '让汤圆写…', hint: '先占位，写好后替换' },
  { k: 'size:20', label: '字号：大', hint: '这一块 20px' },
  { k: 'size:28', label: '字号：特大', hint: '这一块 28px' },
  { k: 'size:12', label: '字号：小', hint: '这一块 12px' },
  { k: 'size:', label: '字号：标准', hint: '恢复默认大小' },
  { k: 'color', label: '文字颜色…', hint: '这一块的颜色' },
  { k: 'font', label: '字体…', hint: '这一块用衬线 / 等宽 / 手写' },
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
  let rect = null; try { rect = r.getBoundingClientRect(); } catch {} if (!rect || (!rect.height && !rect.width)) rect = el.getBoundingClientRect();
  if (rect.bottom > innerHeight - 40 || rect.top < 100) { const top = window.scrollY + rect.top - (rect.top < 100 ? 120 : innerHeight - 120); window.scrollTo({ top: Math.max(0, top) }); }
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
  const bg = b.bg || {};
  tbl.innerHTML = rows.map((r, i) => '<tr>' + r.map((c, j) => `<${header && i === 0 ? 'th' : 'td'} class="b-cell${bg[i + ',' + j] ? ' bg-' + bg[i + ',' + j] : ''}">${c || '<br>'}</${header && i === 0 ? 'th' : 'td'}>`).join('') + '</tr>').join('');
  tbl.dataset.json = JSON.stringify([rows, header, bg]);
}
function cellOf(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest('td,th') : null; }
function onEdgeLine(el, which) {
  const s = sel(); if (!s.rangeCount) return true;
  const r = s.getRangeAt(0).cloneRange(); const rects = r.getClientRects(); const box = el.getBoundingClientRect();
  let rect = rects[0];
  if (!rect) { r.selectNodeContents(el); const rr = r.getClientRects(); rect = rr[which === 'up' ? 0 : rr.length - 1]; if (!rect) return true; }
  return which === 'up' ? rect.top - box.top < 14 : box.bottom - rect.bottom < 14;
}
export function exec(cmd, val) { document.execCommand(cmd, false, val); }
// 行内样式 span 上的一类样式（tc 文字颜色 / fs 字号 / ff 字体）：预设值是 class（tc-red），
// 文字颜色也可以是自定义的 #rrggbb（class tcx + data-c + style）
export const HEX = /^#[0-9a-f]{6}$/i;
function stripKind(el, prefix) {
  [...el.classList].forEach((k) => { if (k.startsWith(prefix + '-') || k === prefix + 'x') el.classList.remove(k); });
  if (prefix === 'tc') { el.style.removeProperty('color'); delete el.dataset.c; if (!el.getAttribute('style')) el.removeAttribute('style'); }
}
function addKind(el, prefix, v) {
  if (!v) return;
  if (prefix === 'tc' && HEX.test(v)) { el.classList.add('tcx'); el.dataset.c = v.toLowerCase(); el.style.color = v; } else el.classList.add(prefix + '-' + v);
}
const unwrapEl = (x) => { const f = document.createDocumentFragment(); while (x.firstChild) f.appendChild(x.firstChild); x.replaceWith(f); };
// 自定义荧光色太深时字用白色
const darkHex = (h) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 140; };
export function applyMark(color) {
  const s = sel(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const inside = (n) => { while (n && n.nodeType !== 1) n = n.parentNode; return n && n.closest('mark'); };
  const c = inside(r.startContainer);
  const hex = !!color && HEX.test(color);
  const cls = hex ? 'hlx' + (darkHex(color) ? ' hlx-d' : '') : color && color !== 'y' ? 'hl-' + color : '';
  const setC = (el) => { el.className = cls; if (hex) { el.dataset.c = color.toLowerCase(); el.style.backgroundColor = color; } else { delete el.dataset.c; el.removeAttribute('style'); } if (!cls) el.removeAttribute('class'); };
  if (c) {
    if (!color || ((c.className || '') === cls && (c.dataset.c || '') === (hex ? color.toLowerCase() : ''))) {
      // 去掉标记后仍然选着这段字，接着换颜色不用重选
      const first = c.firstChild, last = c.lastChild; unwrapEl(c);
      if (first) { const nr = document.createRange(); nr.setStartBefore(first); nr.setEndAfter(last); s.removeAllRanges(); s.addRange(nr); }
      return;
    }
    setC(c); return;
  }
  if (r.collapsed) return;
  const el = document.createElement('mark'); setC(el);
  try { r.surroundContents(el); } catch { el.appendChild(r.extractContents()); r.insertNode(el); }
  s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); s.addRange(nr);
}
// 选中文字工具条里的荧光笔：点 A 是黄色；鼠标移到旁边的小箭头上，弹出九色格子
function hlPicker(btn, after) {
  const more = html`<button type="button" class="hl-sw more" title="更多颜色 / 自定义" onMouseDown=${(e) => e.preventDefault()} onClick=${(e) => openPalette(e, { kind: 'hl', onPick: (v) => { applyMark(v); after && after(); } })}>⋯</button>`;
  return html`<span class="tb-hl">${btn('荧光标记 ⌘⇧H', () => applyMark('y'), 'A', 'hl')}<span class="hl-more"><button type="button" class="hl-caret" title="更多颜色" onMouseDown=${(e) => e.preventDefault()}>▾</button><span class="hl-grid">${HL_COLORS.map((c) => btn(HL_NAMES[c], () => applyMark(c), '', 'hl-sw hl-' + c))}${btn('去掉标记', () => applyMark(null), html`<${Icon} name="x" size=${11} />`, 'hl-sw none')}${more}</span></span></span>`;
}
// 选区的行内样式：prefix 是 tc / fs / ff，value 为空就是去掉。选区已经整个在一个这样的 span 里就改它，否则包一层。
export function applyInline(prefix, value) {
  const s = sel(); if (!s || !s.rangeCount) return;
  const r = s.getRangeAt(0);
  const up = (n) => { while (n && n.nodeType !== 1) n = n.parentNode; return n; };
  const tStart = up(r.startContainer), tEnd = up(r.endContainer);
  const bt = tStart && tStart.closest && tStart.closest('.b-text'); if (!bt || !tEnd || tEnd.closest('.b-text') !== bt) return false; // 跨了块（或根本不在正文里）
  const host = up(r.commonAncestorContainer); const span = host && host.closest && host.closest('span[class]');
  const inB = span && span.closest('.b-text') && span.textContent === r.toString();
  if (inB) {
    stripKind(span, prefix); addKind(span, prefix, value);
    if (!span.classList.length) { const first = span.firstChild, last = span.lastChild; unwrapEl(span); if (first) { const nr = document.createRange(); nr.setStartBefore(first); nr.setEndAfter(last); s.removeAllRanges(); s.addRange(nr); } }
    return true;
  }
  if (r.collapsed) return false;
  const el = document.createElement('span');
  // 先把选区里已有的同类样式去掉，免得嵌套两层
  const frag = r.extractContents(); frag.querySelectorAll('span[class]').forEach((x) => { stripKind(x, prefix); if (!x.classList.length) unwrapEl(x); });
  if (!value) { const first = frag.firstChild, last = frag.lastChild; r.insertNode(frag); if (first) { const nr = document.createRange(); nr.setStartBefore(first); nr.setEndAfter(last); s.removeAllRanges(); s.addRange(nr); } return true; }
  addKind(el, prefix, value); el.appendChild(frag); r.insertNode(el);
  s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); s.addRange(nr);
  return true;
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
export function BlockEditor({ blocks: initial, onChange, notes = [], notesRef, noteId, onCreatePage, onOpenLink, pageFont, onExitTop, onExport, onComment, onImportTitle, pageSize, fmtHost }) {
  const [fmt, setFmt] = useState(null); // 顶部格式栏显示的当前状态（块类型、字号、粗斜下划线、缩进）
  const [, tick] = useState(0); useEffect(() => tick(1), []); // 挂载后再渲染一次，格式栏的宿主 div 这时才有
  const allNotes = () => (notesRef ? notesRef.current : notes);
  const [bs, setBs] = useState(() => (initial && initial.length ? initial.map((b) => ({ ...b, v: 0 })) : [block('p', '', { v: 0 })]));
  const [focusReq, setFocusReq] = useState(null);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null); menuRef.current = menu;
  const [dragId, setDragIdState] = useState(null);
  const dragRef = useRef(null);
  const setDragId = (v) => { dragRef.current = v; setDragIdState(v); };
  const [dropAt, setDropAtState] = useState(null);
  const dropRef = useRef(null);
  const setDropAt = (v) => { dropRef.current = v; setDropAtState(v); };
  const [mdEdit, setMdEdit] = useState(null);
  const [tb, setTb] = useState(null); // selection toolbar { x, y }
  const [tbPop, setTbPop] = useState(false); // 工具栏里的样式面板（颜色 / 字号 / 字体）
  // 字号：像 Google Docs 那样 − [16] +。读当前选区的字号（行内 span 的 fs-N，否则是算出来的像素值）
  const startNode = (s0) => { if (!s0 || !s0.rangeCount) return null; const r = s0.getRangeAt(0); let n = r.startContainer; if (n.nodeType === 1 && n.childNodes.length) n = n.childNodes[Math.min(r.startOffset, n.childNodes.length - 1)]; while (n && n.nodeType === 1 && n.firstChild && !s0.isCollapsed) n = n.firstChild; return n; };
  const curFont = () => { const s0 = sel(); let n = startNode(s0); if (n && n.nodeType !== 1) n = n.parentElement; const sp = n && n.closest && n.closest('span[class*="ff-"]'); const m = sp && sp.className.match(/\bff-([a-z0-9-]+)/); if (m) return m[1]; const bt = n && n.closest && n.closest('.b-text'); const bm = bt && bt.className.match(/\bbf-([a-z0-9-]+)/); if (bm) return bm[1]; return pageFont && pageFont !== 'default' ? pageFont : ''; };
  const curSize = () => { const s0 = sel(); if (!s0 || !s0.rangeCount) return 16; let n = startNode(s0); if (n && n.nodeType !== 1) n = n.parentElement; const bt = n && n.closest && n.closest('.b-text'); const bm = bt && bt.className.match(/\bbs-(\d{1,2})\b/); if (bm && !(n.closest('span[class*="fs-"]'))) return +bm[1]; const sp = n && n.closest && n.closest('span[class*="fs-"]'); const m = sp && sp.className.match(/\bfs-(\d{1,2})\b/); if (m) return +m[1]; return Math.round(parseFloat(getComputedStyle(n || root.current).fontSize)) || 16; };
  const savedSel = useRef(null); // 点进字号输入框时编辑器的选区会丢，先记下来，应用时再放回去
  // 没选中文字时，像 Google Docs：光标在一个词里（或词尾）就改这个词，在词首 / 空白处就只影响接下来打的字
  const wordRangeAt = (s0) => {
    if (!s0 || !s0.rangeCount) return null; const r = s0.getRangeAt(0); let tn = r.startContainer, off = r.startOffset;
    // 光标落在元素上（比如刚套完样式的 span 末尾）：换算到旁边的文本节点
    if (tn.nodeType === 1) { const prev = off > 0 ? tn.childNodes[off - 1] : null, next = tn.childNodes[off]; if (prev && prev.nodeType === 3) { tn = prev; off = prev.length; } else if (next && next.nodeType === 3) { tn = next; off = 0; } else if (prev && prev.nodeType === 1 && prev.lastChild && prev.lastChild.nodeType === 3) { tn = prev.lastChild; off = tn.length; } else return null; }
    if (tn.nodeType !== 3 || !tn.parentElement.closest('.b-text')) return null;
    const text = tn.nodeValue; let seg; try { seg = new Intl.Segmenter('zh', { granularity: 'word' }); } catch { return null; }
    for (const x of seg.segment(text)) { const a = x.index, z = x.index + x.segment.length; if (x.isWordLike && off > a && off <= z) { const wr = document.createRange(); wr.setStart(tn, a); wr.setEnd(tn, z); return wr; } }
    return null;
  };
  // 光标处插一个带样式的空 span（零宽空格占位），之后打的字就在里面；保存时零宽空格会去掉
  const typingSpan = (prefix, v) => { const s0 = sel(); if (!s0 || !s0.rangeCount) return; const r = s0.getRangeAt(0); let n = r.startContainer; if (n.nodeType !== 1) n = n.parentElement; const cur = n.closest('span[class]'); if (cur && cur.closest('.b-text') && cur.textContent === '\u200b') { stripKind(cur, prefix); addKind(cur, prefix, v); return; } const el = document.createElement('span'); addKind(el, prefix, v); el.textContent = '\u200b'; r.insertNode(el); const nr = document.createRange(); nr.setStart(el.firstChild, 1); nr.collapse(true); s0.removeAllRanges(); s0.addRange(nr); };
  // 对光标处的词应用样式；没有词就只影响接下来打的字。返回 true 表示处理了
  const applyAtCaret = (prefix, v) => { const s0 = sel(); if (!s0 || !s0.isCollapsed || !inText(s0)) return false; const wr = wordRangeAt(s0); if (wr) { s0.removeAllRanges(); s0.addRange(wr); const ok = applyInline(prefix, v); if (ok) { const s1 = sel(); if (s1.rangeCount) s1.collapseToEnd(); return true; } } typingSpan(prefix, v); return true; };
  const inText = (s0) => { if (!s0 || !s0.rangeCount || !s0.anchorNode) return false; const n = s0.anchorNode.nodeType === 1 ? s0.anchorNode : s0.anchorNode.parentElement; return !!(n && n.closest && n.closest('.b-text')); };
  const setSize = (n) => { n = Math.max(8, Math.min(72, Math.round(n))); let s0 = sel(); if (savedSel.current && !inText(s0)) { s0.removeAllRanges(); s0.addRange(savedSel.current); s0 = sel(); } if (s0 && !s0.isCollapsed && applyInline('fs', String(n))) { setTimeout(() => emit(syncFromDom(bsRef.current)), 0); return; } if (applyAtCaret('fs', String(n))) { setTimeout(() => { emit(syncFromDom(bsRef.current)); refreshFmt(); }, 0); return; } const rows = rowsInSelection(root.current).map((r) => r.dataset.id); const ids = new Set(rows.length ? rows : [(curBlock() || { b: {} }).b.id]); emit(syncFromDom(bsRef.current).map((b) => (ids.has(b.id) ? bump(b, { size: String(n) }) : b))); setTimeout(refreshFmt, 30); };
  const stepSize = (d) => setSize(curSize() + d);
  const [lp, setLp] = useState(null); // link popover: { x, y, href, el }
  const lpRef = useRef(null); lpRef.current = lp;
  const hist = useRef({ past: [], future: [], lock: false });
  const refs = useRef(new Map());
  const root = useRef();
  const bsRef = useRef(bs); bsRef.current = bs;
  const emitTimer = useRef();
  const composing = useRef(false);
  const downAt = useRef(null);
  const forceMd = useRef(false); // ⌘⇧V：忽略富文本，把剪贴板的纯文本当 Markdown 粘贴
  const api = useRef({}); // stable object handed to rows; fields refreshed every render

  const cleanCache = useRef(new Map()); // raw html -> sanitized html, so unchanged blocks are not re-parsed
  const sameDoc = (a, b) => a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && x.type === b[i].type && x.html === b[i].html && (x.indent || 0) === (b[i].indent || 0) && !!x.checked === !!b[i].checked && x.size === b[i].size && x.color === b[i].color && x.font === b[i].font && x.url === b[i].url && !!x.open === !!b[i].open));
  const emit = useCallback((next) => {
    clearTimeout(emitTimer.current);
    const prev = bsRef.current;
    if (!hist.current.lock && prev && !sameDoc(prev, next)) { hist.current.past.push(prev); if (hist.current.past.length > 200) hist.current.past.shift(); hist.current.future = []; }
    bsRef.current = next; setBs(next);
    const cache = cleanCache.current, fresh = new Map();
    const out = next.map(({ v, ...b }) => { if (b.type === 'table') return { ...b, html: '', rows: (b.rows || []).map((r) => r.map((c) => sanitize(c))) }; let c = cache.get(b.html); if (c === undefined) c = sanitize(b.html).replace(/\u200b/g, '').replace(/<span class="[^"]*"><\/span>/g, ''); fresh.set(b.html, c); return { ...b, html: c }; });
    cleanCache.current = fresh;
    onChange(out);
  }, [onChange]);
  const syncFromDom = (list = bsRef.current) => list.map((b) => {
    const el = refs.current.get(b.id); if (!el || !el.isConnected || b.type === 'divider' || b.type === 'pending') return b;
    if (b.type === 'table') { const rows = tableRows(el); const json = JSON.stringify([rows, b.header !== false, b.bg || {}]); if (json === el.dataset.json) return b; el.dataset.json = json; return { ...b, rows }; }
    return el.innerHTML !== b.html ? { ...b, html: el.innerHTML } : b;
  });
  const bump = (b, patch) => ({ ...b, ...patch, v: (b.v || 0) + 1 });
  const scheduleEmit = () => { clearTimeout(emitTimer.current); emitTimer.current = setTimeout(() => emit(syncFromDom(bsRef.current)), 500); };
  useEffect(() => () => clearTimeout(emitTimer.current), []);

  useLayoutEffect(() => {
    if (!focusReq) return;
    const el = refs.current.get(focusReq.id);
    // 行组件可能还没把新内容写进 DOM（撤销 / 重做时）：先把内容换好再放光标，免得光标被随后的重画冲回开头
    const tb = bsRef.current.find((x) => x.id === focusReq.id); if (el && tb && tb.type !== 'table' && typeof tb.html === 'string' && el.innerHTML !== tb.html) el.innerHTML = tb.html;
    if (el) setCaret(el, focusReq.pos);
    const then = focusReq.then; setFocusReq(null);
    if (then) then();
  }, [focusReq, bs]);
  useEffect(() => {
    const h = (e) => { const d = e.detail; if (!d || d.noteId !== noteId || d.handled) return; if (api.current.applyDoc && api.current.applyDoc(d)) d.handled = true; };
    window.addEventListener('doc:apply', h); return () => window.removeEventListener('doc:apply', h);
  }, [noteId]);
  // 每块的未解决评论数：页面在评论变化时广播，这里只更新角标
  const [cm, setCm] = useState({});
  useEffect(() => {
    const h = (e) => { const d = e.detail; if (d && d.noteId === noteId) setCm(d.counts || {}); };
    window.addEventListener('doc:cm', h); window.dispatchEvent(new CustomEvent('doc:cm-ask', { detail: { noteId } })); return () => window.removeEventListener('doc:cm', h);
  }, [noteId]);

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
  const tableOp = (b, op, ri = 0, ci = 0, val = '') => {
    const cur = syncFromDom(bsRef.current).find((x) => x.id === b.id); if (!cur) return;
    let rows = (cur.rows || emptyTable()).map((r) => [...r]); let header = cur.header !== false;
    const w = rows[0] ? rows[0].length : 1;
    // 单元格底色跟着行列走：插入 / 删除后把 "行,列" 的键挪到新位置
    const shift = (fn) => { const out = {}; Object.entries(cur.bg || {}).forEach(([k, v]) => { const [r, c] = k.split(',').map(Number); const n = fn(r, c); if (n) out[n.join(',')] = v; }); return out; };
    let bg = cur.bg || {};
    if (op === 'rowBelow') bg = shift((r, c) => [r > ri ? r + 1 : r, c]); else if (op === 'rowAbove') bg = shift((r, c) => [r >= ri ? r + 1 : r, c]);
    else if (op === 'colRight') bg = shift((r, c) => [r, c > ci ? c + 1 : c]); else if (op === 'colLeft') bg = shift((r, c) => [r, c >= ci ? c + 1 : c]);
    else if (op === 'delRow') bg = shift((r, c) => (r === ri ? null : [r > ri ? r - 1 : r, c])); else if (op === 'delCol') bg = shift((r, c) => (c === ci ? null : [r, c > ci ? c - 1 : c]));
    else if (op === 'bg') { bg = { ...bg }; if (val) bg[ri + ',' + ci] = val; else delete bg[ri + ',' + ci]; }
    if (op === 'rowBelow') rows.splice(ri + 1, 0, Array(w).fill(''));
    else if (op === 'rowAbove') rows.splice(ri, 0, Array(w).fill(''));
    else if (op === 'colRight') rows.forEach((r) => r.splice(ci + 1, 0, ''));
    else if (op === 'colLeft') rows.forEach((r) => r.splice(ci, 0, ''));
    else if (op === 'delRow') { if (rows.length > 1) rows.splice(ri, 1); else { removeBlock(b.id); return; } }
    else if (op === 'delCol') { if (w > 1) rows.forEach((r) => r.splice(ci, 1)); else { removeBlock(b.id); return; } }
    else if (op === 'header') header = !header;
    const list = syncFromDom(bsRef.current).map((x) => (x.id === b.id ? bump(x, { rows, header, bg }) : x)); emit(list);
    const fr = op === 'rowBelow' ? ri + 1 : op === 'rowAbove' ? ri : Math.min(ri, rows.length - 1), fc = op === 'colRight' ? ci + 1 : op === 'colLeft' ? ci : Math.min(ci, rows[0].length - 1);
    setFocusReq({ id: b.id, pos: 'start', then: () => { const tbl = refs.current.get(b.id); const cell = tbl && tbl.rows[fr] && tbl.rows[fr].cells[fc]; if (cell) setCaret(cell, 'end'); } });
  };
  // 块级：文字颜色 / 字号 / 字体 的子菜单
  const colorItems = (b) => [{ label: '默认', icon: !b.color ? 'check' : '', onClick: () => update(b.id, { color: undefined }) }, ...TEXT_COLORS.map((c) => ({ label: TEXT_COLOR_NAMES[c], icon: b.color === c ? 'check' : '', color: `var(--tc-${c})`, onClick: () => update(b.id, { color: c }) }))];
  const sizeItems = (b) => [['', '标准'], ['12', '小 12'], ['14', '14'], ['18', '18'], ['20', '大 20'], ['24', '24'], ['28', '特大 28'], ['36', '36']].map(([v, n]) => ({ label: n, icon: (b.size || '') === v ? 'check' : '', onClick: () => update(b.id, { size: v || undefined }) }));
  // 字体菜单：按「系统 / 中文 / 中文开源 / 英文开源」分组，选到开源字体时按需加载
  const fontMenu = (cur, pick) => FONT_GROUPS.map((g) => ({ label: g, icon: FONTS.some((f) => f.g === g && (f.id === cur || (!cur && f.id === 'default'))) ? 'check' : '', sub: FONTS.filter((f) => f.g === g).map((f) => ({ label: f.n, icon: (cur || 'default') === f.id ? 'check' : '', onClick: () => { ensureFont(f.id); pick(f.id === 'default' ? '' : f.id); } })) }));
  const fontItems = (b) => fontMenu(b.font || '', (v) => update(b.id, { font: v || undefined }));
  const CELL_BG = [['gray', '灰'], ['red', '红'], ['orange', '橙'], ['yellow', '黄'], ['green', '绿'], ['blue', '蓝'], ['purple', '紫']];
  const tableMenu = (b, cell) => { const ri = cell ? cell.parentElement.rowIndex : 0, ci = cell ? cell.cellIndex : 0; const curBg = (b.bg || {})[ri + ',' + ci] || ''; return [
    { label: '单元格底色', icon: 'tag', sub: [{ label: '无', icon: curBg ? '' : 'check', onClick: () => tableOp(b, 'bg', ri, ci, '') }, ...CELL_BG.map(([k, n]) => ({ label: n, icon: curBg === k ? 'check' : '', color: `var(--cbg-${k}-dot)`, onClick: () => tableOp(b, 'bg', ri, ci, k) }))] },
    'sep',
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
  const sameBlock = (a, b) => !!a && !!b && a.id === b.id && a.type === b.type && a.html === b.html && (a.indent || 0) === (b.indent || 0) && !!a.checked === !!b.checked && a.size === b.size && a.color === b.color && a.font === b.font && a.url === b.url && a.lang === b.lang && JSON.stringify(a.rows || null) === JSON.stringify(b.rows || null) && JSON.stringify(a.bg || null) === JSON.stringify(b.bg || null) && a.header === b.header && !!a.open === !!b.open;
  const restore = (snap) => {
    const curMap = new Map(bsRef.current.map((b) => [b.id, b]));
    const next = snap.map((b) => { const c = curMap.get(b.id); return c && sameBlock(c, b) ? c : { ...b, v: ++vclock }; });
    hist.current.lock = true; emit(next); hist.current.lock = false; return next;
  };
  const focusDiff = (next, cur, caret) => {
    const i = next.findIndex((b, k) => !sameBlock(cur[k], b)); if (i < 0) return; // 什么都没变（比如只是块属性撤回了但内容一样）：光标别动
    const t = next[Math.min(next.length - 1, i)]; if (!t || !TEXT_TYPES.includes(t.type)) return;
    const pos = caret && caret.id === t.id && caret.off != null ? Math.min(caret.off, textOf(t.html).length) : 'end';
    setFocusReq({ id: t.id, pos });
  };
  const undo = () => {
    const cur = syncFromDom(bsRef.current); const h = hist.current;
    if (!sameDoc(cur, bsRef.current)) { h.past.push(bsRef.current); bsRef.current = cur; }
    const prev = h.past.pop(); if (!prev) return;
    const c = curBlock(); const caret = c && c.el ? { id: c.b.id, off: caretOffset(c.el) } : null;
    h.future.push(cur); focusDiff(restore(prev), cur, caret);
  };
  const redo = () => { const h = hist.current; const nxt = h.future.pop(); if (!nxt) return; const cur = syncFromDom(bsRef.current); const c = curBlock(); const caret = c && c.el ? { id: c.b.id, off: caretOffset(c.el) } : null; h.past.push(cur); focusDiff(restore(nxt), cur, caret); };

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
    let [before, after] = splitAtCaret(el);
    if (!textOf(after).trim()) after = ''; else after = after.replace(/^(?:<(span|b|i|u|s|mark)[^>]*>\s*<\/\1>)+/g, '');
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
    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBlocks(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (mod && e.shiftKey && !e.altKey && (e.key === '.' || e.key === '>' || e.key === ',' || e.key === '<')) { e.preventDefault(); stepSize(e.key === '.' || e.key === '>' ? 1 : -1); return; }
    if (mod && e.shiftKey && !e.altKey && k === 'v') { forceMd.current = true; setTimeout(() => { forceMd.current = false; }, 500); } // 浏览器随后触发 paste（纯文本），走 Markdown 解析
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
    if (!el) return; // 分割线 / 占位块自己处理按键
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
      const list0 = syncFromDom(bsRef.current); const i0 = list0.findIndex((x) => x.id === b.id); const prev0 = list0[i0 - 1];
      // 上一块是空段落：把它删掉，这一块（标题、列表都一样）原样留着并顶上去——不要先把标题降成文本
      if (prev0 && TEXT_TYPES.includes(prev0.type) && !textOf(prev0.html).trim()) { const pos0 = caretOffset(el); list0.splice(i0 - 1, 1); emit(list0); setFocusReq({ id: b.id, pos: pos0 || 'start' }); return; }
      // 第一块是空的、后面还有内容：删掉这一空行，光标到下一块开头
      if (i0 === 0 && !el.textContent.trim() && list0.length > 1) { list0.splice(0, 1); emit(list0); setFocusReq({ id: list0[0].id, pos: 'start' }); return; }
      if (b.type !== 'p') { update(b.id, { type: 'p' }, 'start'); return; }
      if (b.indent > 0) { update(b.id, { indent: b.indent - 1 }, 'start'); return; }
      const list = list0; const i = i0;
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
      if (!next) return;
      if (!el.textContent.trim() && TEXT_TYPES.includes(b.type)) { list.splice(i, 1); emit(list); setFocusReq({ id: next.id, pos: 'start' }); return; }
      if (!TEXT_TYPES.includes(next.type)) return;
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
        if (fmtHost) {
          const rowAny = inside ? el.closest('.b-row') : null; const b = rowAny && bsRef.current.find((x) => x.id === rowAny.dataset.id);
          const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
          const sn = (() => { let n = startNode(s); if (n && n.nodeType !== 1) n = n.parentElement; return n; })();
          const tcm = sn && sn.closest && sn.closest('span[class*="tc"]'); const mk = sn && sn.closest && sn.closest('mark');
          const nf = b ? { type: b.type, indent: b.indent || 0, size: curSize(), bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'), sel: !s.isCollapsed, font: curFont(), color: tcm ? tcm.dataset.c || (tcm.className.match(/\btc-(\w+)/) || [])[1] : (b.color || ''), mark: mk ? mk.dataset.c || ((mk.className.match(/\bhl-([ygbprokna])\b/) || [])[1] || 'y') : '' } : null;
          setFmt((o) => (JSON.stringify(o) === JSON.stringify(nf) ? o : nf));
        }
        if (prevCur && prevCur !== row) prevCur.classList.remove('cur'); if (row && row !== prevCur) row.classList.add('cur');
        if (!inside || s.isCollapsed || el.closest('pre')) { if (!(document.activeElement && document.activeElement.classList.contains('tp-num'))) { setTb((x) => (x ? null : x)); setTbPop(false); } return; }
        savedSel.current = s.getRangeAt(0).cloneRange();
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
    if (it.k && it.k.startsWith('size:')) { update(b.id, { size: it.k.slice(5) || undefined }, 'end'); return; }
    if (it.k === 'color' || it.k === 'font') { const rect = el.getBoundingClientRect(); const fake = { clientX: rect.left + 24, clientY: rect.bottom + 4, preventDefault() {}, stopPropagation() {} }; ctxMenu(fake, it.k === 'color' ? colorItems(b) : fontItems(b), it.k === 'color' ? '文字颜色' : '字体', it.k === 'color' ? { grid: 'text' } : undefined); emit(syncFromDom(bsRef.current)); return; }
    if (it.k === 'ai') { askPrompt('要汤圆写什么', '', { title: '让汤圆写一段', ok: '开始写', placeholder: '比如：总结上面三点 / 写一段这个方案的风险 / 列一个对比表' }).then((intent) => { if (!intent || !intent.trim()) return; const nb = { ...block('pending', '', { intent: intent.trim(), status: 'idle' }), v: 0 }; const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === b.id); if (i < 0) return; if (!el.textContent.trim()) list[i] = { ...nb, id: b.id }; else list.splice(i + 1, 0, nb); emit(list); setTimeout(() => startPending(el.textContent.trim() ? nb.id : b.id), 0); }); return; }
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
  const wikiFromSelection = () => {
    const s0 = sel(); if (!s0 || !s0.rangeCount || s0.isCollapsed) { toast('先选中要链接的文字'); return; }
    const range = s0.getRangeAt(0); const title = range.toString().trim(); if (!title) return;
    if (rowsInSelection(root.current).length > 1) { toast('一次只能链接一个块里的文字'); return; }
    range.deleteContents(); insertNodeAt(range, mkAnchor('wiki', { title }, title), false);
    if (onCreatePage) onCreatePage(title);
    emit(syncFromDom(bsRef.current)); setTb(null);
  };
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
    if (curType === 'code' || curType === 'md') return text ? [block(curType, escapeHtml(text))] : [];
    // 富文本和纯文本两条路都解析，谁保留的结构多（表格 / 列表 / 待办 / 标题）就用谁：
    // 从 Claude Docs、聊天窗口复制出来的 HTML 常是一堆 div，列表和表格只在纯文本（Markdown）里还完整
    const fromHtml = rich && /<(p|div|h[1-6]|li|ul|ol|blockquote|pre|table|img|br|span|b|i|u|strong|em|a|mark|s|strike|code)\b/i.test(rich) ? htmlToBlocks(rich) : [];
    const fromText = text && !forceMd.current ? mdToBlocks(text) : [];
    if (forceMd.current) { forceMd.current = false; return text ? mdToBlocks(text) : fromHtml; }
    if (!fromHtml.length) return fromText;
    if (!text) return fromHtml;
    const hs = structureScore(fromHtml), ts = structureScore(fromText);
    // HTML 几乎没结构、而纯文本按 Markdown 能解出更多：用 Markdown；否则保留 HTML（它带着粗体、链接、图片）
    if (ts > hs && (ts >= 2 || fromHtml.length === 1)) return fromText;
    return fromHtml;
  };
  // images become image blocks; everything else (PDF, docs, …) is stored in IndexedDB and shown as a file block
  const filesToBlocks = async (files) => {
    const out = [];
    for (const f of files) {
      if (/^image\//.test(f.type)) { const u = await imageToDataUrl(f, 1600).catch(() => null); if (u) out.push(block('image', '', { url: u })); continue; }
      // Markdown / 纯文本文件：直接解析成块，不当附件
      if (/\.(md|markdown|txt)$/i.test(f.name) || f.type === 'text/markdown' || f.type === 'text/plain') { const t = await f.text().catch(() => ''); if (t.trim()) out.push(...mdToBlocks(t)); continue; }
      if (f.size > 4 * 1048576) { toast(`「${f.name}」超过 4 MB，没有导入（同步接口的上限）`); continue; }
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
    // 空页面里贴进一整份文档：第一个一级标题升为页面标题（像导入一样）
    if (parsed[0].type === 'h1' && onImportTitle && bsRef.current.length === 1 && !textOf(bsRef.current[0].html) && TEXT_TYPES.includes(bsRef.current[0].type) && onImportTitle(textOf(parsed[0].html))) parsed = parsed.slice(1);
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
  // ⌥↑ / ⌥↓：光标所在块（或选中的几块）上移 / 下移一格，光标跟着走
  const moveBlocks = (dir) => {
    const rows = rowsInSelection(root.current).map((r) => r.dataset.id); const c = curBlock(); const ids = rows.length ? rows : c ? [c.b.id] : []; if (!ids.length) return;
    const list = syncFromDom(bsRef.current); const idx = ids.map((id) => list.findIndex((x) => x.id === id)).filter((i) => i >= 0).sort((a, b) => a - b); if (!idx.length) return;
    const first = idx[0], last = idx[idx.length - 1]; if (dir < 0 && first === 0) return; if (dir > 0 && last === list.length - 1) return;
    const group = list.splice(first, last - first + 1); list.splice(first + dir, 0, ...group); emit(list);
    const keep = c ? caretOffset(c.el) : 0; if (c) setFocusReq({ id: c.b.id, pos: keep == null ? 'end' : keep, then: () => { const el = refs.current.get(c.b.id); if (el) el.scrollIntoView({ block: 'nearest' }); } });
  };

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

  /* --- 汤圆写入：占位块开始 / 改要求；结果通过 doc:apply 事件回到这里 --- */
  const startPending = (id) => { const list = syncFromDom(bsRef.current); const b = list.find((x) => x.id === id); if (!b || b.type !== 'pending' || isRunning(id)) return; fillPending(noteId, b, list.map(({ v, ...x }) => x)); };
  const editPending = (b) => askPrompt('要汤圆写什么', b.intent || '', { title: '改要求', ok: '重新写', placeholder: '写得具体一点，汤圆更好发挥' }).then((intent) => { if (!intent || !intent.trim()) return; update(b.id, { intent: intent.trim(), status: 'idle', error: '' }); setTimeout(() => startPending(b.id), 0); });
  api.current.applyDoc = (d) => {
    const list = syncFromDom(bsRef.current); const i = list.findIndex((x) => x.id === d.blockId); if (i < 0) return false;
    const v = (list[i].v || 0) + 1; // 同 id 的块要换版本号，行组件才会重画 DOM
    if (d.replacement) list.splice(i, 1, ...d.replacement.map((x) => ({ ...x, v }))); else list[i] = bump(list[i], d.patch || {});
    emit(list); return true;
  };
  // 笔记 → 待办：右键列表块，把连在一起的那一串列表项变成待办（本地，不调模型），待办上挂「来自笔记」
  const noteTitleOf = () => { const n = allNotes().find((x) => x.id === noteId); return (n && n.title) || '无标题'; };
  const listToTodos = (b) => {
    const i = bs.findIndex((x) => x.id === b.id); if (i < 0) return;
    const ok = (x) => x && ['bullet', 'number', 'todo'].includes(x.type);
    let a = i, z = i; while (ok(bs[a - 1])) a--; while (ok(bs[z + 1])) z++;
    const items = bs.slice(a, z + 1).filter((x) => !(x.type === 'todo' && x.checked)).map((x) => textOf(x.html || '').trim()).filter(Boolean);
    if (!items.length) { toast('这一串里没有要做的事'); return; }
    const src = { kind: 'note', id: noteId, title: noteTitleOf() };
    const made = items.map((title) => { const t = { id: uid(), title: title.slice(0, 120), done: false, priority: 2, due: '', time: '', tags: [], area: '', note: '', created: todayStr(), steps: [], src }; storeUpsert('todos', t); return t; });
    toast(`变成了 ${made.length} 条待办`, { label: '撤销', onClick: () => made.forEach((t) => storeRemove('todos', t.id)) });
  };
  const breakToSteps = (b) => {
    const t = textOf(b.html || '').trim(); if (!t) { toast('这一块是空的'); return; }
    const i = bs.findIndex((x) => x.id === b.id); const around = bs.slice(Math.max(0, i - 3), i + 4).map((x) => textOf(x.html || '')).filter(Boolean).join(' / ').slice(0, 500);
    window.dispatchEvent(new CustomEvent('seal:breakdown', { detail: { title: t.slice(0, 80), note: '上下文：' + around, src: { kind: 'note', id: noteId, title: noteTitleOf() } } }));
  };
  Object.assign(api.current, { listToTodos, breakToSteps, refs, dragRef, update, removeBlock, insertAfter, addBelow, setDragId, setDropAt, onDropRow, setMdEdit, convert, startPending, editPending, colorItems, sizeItems, fontItems, onComment: (bid, quote, view) => onComment && onComment(bid, quote, view) });
  const items = menuItems();
  const tbBtn = (title, fn, child, cls = '') => html`<button title=${title} class=${cls} onMouseDown=${(e) => e.preventDefault()} onClick=${() => { fn(); setTimeout(() => emit(syncFromDom(bsRef.current)), 0); }}>${child}</button>`;

  /* --- 顶部固定格式栏（像 Word / Google Docs）：作用于光标所在块或选中的文字 --- */
  const refreshFmt = () => document.dispatchEvent(new Event('selectionchange'));
  const fb = (title, fn, child, cls = '') => html`<button type="button" title=${title} class=${'fb ' + cls} onMouseDown=${(e) => { e.preventDefault(); const s0 = sel(); if (inText(s0)) savedSel.current = s0.getRangeAt(0).cloneRange(); }} onClick=${(e) => { fn(e); setTimeout(() => { emit(syncFromDom(bsRef.current)); refreshFmt(); }, 0); }}>${child}</button>`;
  const restoreSel = () => { const s0 = sel(); if (!inText(s0) && savedSel.current) { s0.removeAllRanges(); s0.addRange(savedSel.current); } };
  const curB = () => { restoreSel(); const c = curBlock(); return c ? c.b : null; };
  const selRows = () => { const rows = rowsInSelection(root.current); if (rows.length) return rows.map((r) => r.dataset.id); const b = curB(); return b ? [b.id] : []; };
  const setTypeFor = (t) => { restoreSel(); const ids = new Set(selRows()); if (!ids.size) return; const list = syncFromDom(bsRef.current); emit(list.map((b) => (ids.has(b.id) && (TEXT_TYPES.includes(b.type) || t === 'p') ? bump(b, { type: b.type === t && LIST_TYPES.includes(t) ? 'p' : t, checked: false }) : b))); if (ids.size === 1) setFocusReq({ id: [...ids][0], pos: 'end' }); setTimeout(refreshFmt, 30); };
  const indentBy = (d) => { restoreSel(); const ids = new Set(selRows()); if (!ids.size) return; emit(syncFromDom(bsRef.current).map((b) => (ids.has(b.id) ? bump(b, { indent: Math.max(0, Math.min(3, (b.indent || 0) + d)) }) : b))); };
  const inlineOrBlock = (prefix, key, v) => { restoreSel(); const s0 = sel(); if (applyAtCaret(prefix, v)) { setTimeout(() => { emit(syncFromDom(bsRef.current)); refreshFmt(); }, 0); return; } if (!(s0 && !s0.isCollapsed && applyInline(prefix, v))) { const ids = new Set(selRows()); emit(syncFromDom(bsRef.current).map((b) => (ids.has(b.id) ? bump(b, { [key]: v || undefined }) : b))); } setTimeout(() => { emit(syncFromDom(bsRef.current)); refreshFmt(); }, 0); };
  const typeLabel = fmt && TYPES[fmt.type] ? TYPES[fmt.type].label : '文本';
  const bar = fmtHost && fmtHost.current && createPortal(html`<div class="fmt-bar" onMouseDown=${(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}>
    ${fb('撤销 ⌘Z', () => undo(), html`<${Icon} name="undo" size=${15} />`)}${fb('重做 ⌘⇧Z', () => redo(), html`<${Icon} name="redo" size=${15} />`)}
    <span class="fb-sep"></span>
    ${fb('块类型', (e) => ctxMenu(e, CONVERT_TYPES.map((t) => ({ label: TYPES[t].label, icon: fmt && fmt.type === t ? 'check' : '', onClick: () => setTypeFor(t) })), '块类型'), html`${typeLabel}<${Icon} name="down" size=${11} />`, 'fb-dd')}
    ${fb('字体', (e) => ctxMenu(e, fontMenu(curFont(), (v) => inlineOrBlock('ff', 'font', v)), '字体'), html`<span class="fb-lbl">${(FONTS.find((f) => f.id === (curFont() || 'default')) || FONTS[0]).n}</span><${Icon} name="down" size=${11} />`, 'fb-dd fb-font')}
    <span class="fb-sep"></span>
    ${fb('减小字号 ⌘⇧,', () => stepSize(-1), '−', 'fb-step')}<input class="fb-num" type="number" min="8" max="72" value=${fmt ? fmt.size : 16} onMouseDown=${(e) => e.stopPropagation()} onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); setSize(+e.target.value); e.target.blur(); } }} onChange=${(e) => setSize(+e.target.value)} />${fb('增大字号 ⌘⇧.', () => stepSize(1), '+', 'fb-step')}
    <span class="fb-sep"></span>
    ${fb('粗体 ⌘B', () => exec('bold'), html`<b>B</b>`, fmt && fmt.bold ? 'on' : '')}${fb('斜体 ⌘I', () => exec('italic'), html`<i>I</i>`, fmt && fmt.italic ? 'on' : '')}${fb('下划线 ⌘U', () => exec('underline'), html`<u>U</u>`, fmt && fmt.underline ? 'on' : '')}${fb('删除线', () => exec('strikeThrough'), html`<s>S</s>`, 'fb-opt ' + (fmt && fmt.strike ? 'on' : ''))}
    ${fb('文字颜色', (e) => openPalette(e, { kind: 'text', cur: fmt && fmt.color, onPick: (v) => inlineOrBlock('tc', 'color', v) }), html`<span class="fb-a" style=${fmt && fmt.color ? `border-color:${HEX.test(fmt.color) ? fmt.color : `var(--tc-${fmt.color})`}` : ''}>A</span>`, 'fb-color')}
    ${fb('荧光标记', (e) => openPalette(e, { kind: 'hl', cur: fmt && fmt.mark, onPick: (v) => { restoreSel(); applyMark(v); setTimeout(() => { emit(syncFromDom(bsRef.current)); refreshFmt(); }, 0); } }), html`<span class=${'fb-hl ' + (fmt && fmt.mark ? (HEX.test(fmt.mark) ? 'hlx' : 'hl-' + fmt.mark) : 'none')} style=${fmt && fmt.mark && HEX.test(fmt.mark) ? `--hx:${fmt.mark}` : ''}><${Icon} name="highlighter" size=${15} /></span>`, fmt && fmt.mark ? 'on' : '')}
    <span class="fb-sep"></span>
    ${fb('链接 ⌘K', () => linkPrompt(), html`<${Icon} name="link" size=${14} />`)}
    ${onComment && fb('评论', () => { const s0 = sel(); const q = s0 ? s0.toString().trim().slice(0, 160) : ''; const b = curB(); if (b) onComment(b.id, q); }, html`<${Icon} name="chat" size=${14} />`)}
    ${fb('插入', (e) => { const b = curB(); if (!b) return; const ins = (nb, pos) => insertAfter(b.id, nb, pos === undefined ? 'start' : pos); ctxMenu(e, [
      { label: '表格', icon: 'grid', onClick: () => ins(block('table', '', { rows: emptyTable(), header: true })) },
      { label: '图片…', icon: 'image', onClick: () => askPrompt('图片链接', '', { title: '插入图片', placeholder: 'https://…' }).then((url) => { if (url) ins(block('image', '', { url }), null); }) },
      { label: '文件 / PDF…', icon: 'file', onClick: () => pickFile('*/*').then(async (f) => { if (!f) return; const parsed = await filesToBlocks([f]); parsed.forEach((x, i) => { const list = syncFromDom(bsRef.current); const at = list.findIndex((y) => y.id === b.id); list.splice(at + 1 + i, 0, { ...x, v: 0 }); emit(list); }); }) },
      'sep',
      { label: '代码块', icon: 'note', onClick: () => ins(block('code', '', { lang: '' })) },
      { label: '引用', icon: 'quote', onClick: () => ins(block('quote')) },
      { label: '标注', icon: 'flag', onClick: () => ins(block('callout')) },
      { label: '折叠标题', icon: 'right', onClick: () => ins(block('toggle')) },
      { label: '分割线', icon: 'minus', onClick: () => ins(block('divider'), null) },
      'sep',
      { label: '让汤圆写…', icon: 'sparkle', onClick: () => askPrompt('要汤圆写什么', '', { title: '让汤圆写一段', ok: '开始写' }).then((intent) => { if (!intent || !intent.trim()) return; const nb = block('pending', '', { intent: intent.trim(), status: 'idle' }); ins(nb, null); setTimeout(() => startPending(nb.id), 0); }) },
    ], '插入'); }, html`<${Icon} name="plus" size=${14} /><span class="fb-lbl">插入</span><${Icon} name="down" size=${11} />`, 'fb-dd fb-ins')}
    <span class="fb-sep"></span>
    ${fb('待办列表', () => setTypeFor('todo'), html`<${Icon} name="checksq" size=${14} />`, fmt && fmt.type === 'todo' ? 'on' : '')}${fb('无序列表', () => setTypeFor('bullet'), html`<${Icon} name="list" size=${14} />`, fmt && fmt.type === 'bullet' ? 'on' : '')}${fb('有序列表', () => setTypeFor('number'), html`<${Icon} name="listol" size=${15} />`, fmt && fmt.type === 'number' ? 'on' : '')}
    ${fb('减少缩进 ⇧Tab', () => indentBy(-1), html`<${Icon} name="outdent" size=${15} />`, 'fb-ind fb-opt')}${fb('增加缩进 Tab', () => indentBy(1), html`<${Icon} name="indent" size=${15} />`, 'fb-ind fb-opt')}
    <span class="fb-sep"></span>
    ${fb('清除格式', () => { const s0 = sel(); if (s0 && s0.isCollapsed) { const wr = wordRangeAt(s0); if (wr) { s0.removeAllRanges(); s0.addRange(wr); } } exec('removeFormat'); applyInline('tc', ''); applyInline('fs', ''); applyInline('ff', ''); applyMark(null); const b = curB(); if (b) update(b.id, { color: undefined, size: undefined, font: undefined }); }, html`<${Icon} name="x" size=${14} />`)}
  </div>`, fmtHost.current);
  return html`${bar}<div class=${'beditor font-' + (pageFont || 'default') + (pageSize ? ' ps-' + pageSize : '')} ref=${root} contenteditable="true" spellcheck="false"
    onKeyDown=${onKey} onInput=${onInput} onPaste=${onPaste} onCopy=${onCopy} onCut=${onCut} onClick=${onClick} onContextMenu=${onCtx} onDrop=${onDrop} onDragOver=${onDragOverRoot}
    onCompositionStart=${() => { composing.current = true; }} onCompositionEnd=${() => { composing.current = false; scheduleEmit(); }}
    onMouseDown=${(e) => { downAt.current = e.target; if (lpRef.current && !(e.target.closest && e.target.closest('.link-pop'))) setLp(null); }}>
    ${lp && html`<div class="link-pop" contenteditable="false" style=${`left:${lp.x}px;top:${lp.y}px`} onMouseDown=${(e) => e.stopPropagation()}>
      <a class="lp-url" href=${lp.href} target="_blank" rel="noopener" title=${lp.href}><${Icon} name="external" size=${12} /> ${hostName(lp.href)}</a>
      <button class="ibtn" title="编辑链接" onClick=${editLink}><${Icon} name="edit" size=${13} /></button>
      <button class="ibtn" title="复制链接" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(lp.href); toast('已复制链接'); setLp(null); }}><${Icon} name="layers" size=${13} /></button>
      <button class="ibtn danger" title="移除链接" onClick=${() => unlink(lp.el)}><${Icon} name="x" size=${13} /></button>
    </div>`}
    ${tb && !(fmtHost && fmtHost.current && !fmtHost.current.classList.contains('off')) && html`<div class="sel-tb" contenteditable="false" style=${`left:${tb.x}px;top:${tb.y}px`} onMouseDown=${(e) => e.preventDefault()}>
      ${tbBtn('粗体 ⌘B', () => exec('bold'), html`<b>B</b>`)}
      ${tbBtn('斜体 ⌘I', () => exec('italic'), html`<i>I</i>`)}
      ${tbBtn('下划线 ⌘U', () => exec('underline'), html`<u>U</u>`)}
      ${tbBtn('删除线', () => exec('strikeThrough'), html`<s>S</s>`)}
      ${tbBtn('代码 ⌘E', () => toggleCode(), '</>', 'mono')}
      ${hlPicker(tbBtn, () => setTimeout(() => emit(syncFromDom(bsRef.current)), 0))}
      ${tbBtn('链接 ⌘K', () => linkPrompt(), html`<${Icon} name="link" size=${13} />`)}
      ${tbBtn('链接到页面（选中文字变成 [[页面]]）', () => wikiFromSelection(), '[[ ]]', 'mono')}
      <button title="文字颜色 / 字号 / 字体" class=${'tb-style ' + (tbPop ? 'on' : '')} onMouseDown=${(e) => e.preventDefault()} onClick=${() => setTbPop(!tbPop)}>A<small>a</small></button>
      ${tbBtn('清除格式', () => { exec('removeFormat'); applyInline('tc', ''); applyInline('fs', ''); applyInline('ff', ''); }, html`<${Icon} name="x" size=${13} />`)}
      ${tbPop && html`<div class="tb-pop" onMouseDown=${(e) => e.preventDefault()}>
        <div class="tp-row"><span>颜色</span>${tbBtn('默认颜色', () => applyInline('tc', ''), html`<i class="tp-dot none"></i>`, 'tp-b')}${TEXT_COLORS.map((c) => tbBtn(TEXT_COLOR_NAMES[c], () => applyInline('tc', c), html`<i class="tp-dot" style=${`background:var(--tc-${c})`}></i>`, 'tp-b'))}<button type="button" class="tp-b tp-more" title="更多颜色 / 自定义" onMouseDown=${(e) => e.preventDefault()} onClick=${(e) => openPalette(e, { kind: 'text', onPick: (v) => { applyInline('tc', v); setTimeout(() => emit(syncFromDom(bsRef.current)), 0); } })}><i class="tp-dot rainbow"></i></button></div>
        <div class="tp-row"><span>字号</span><button class="tp-t tp-step" title="减小（⌘⇧,）" onMouseDown=${(e) => e.preventDefault()} onClick=${() => stepSize(-1)}>−</button><input class="tp-num" type="number" min="8" max="72" value=${curSize()} onMouseDown=${(e) => e.stopPropagation()} onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); setSize(+e.target.value); } }} onChange=${(e) => setSize(+e.target.value)} /><button class="tp-t tp-step" title="增大（⌘⇧.）" onMouseDown=${(e) => e.preventDefault()} onClick=${() => stepSize(1)}>+</button>${[['12', '小'], ['', '标准'], ['20', '大'], ['28', '特大']].map(([v, n]) => tbBtn('字号 ' + n, () => applyInline('fs', v), n, 'tp-t tp-preset'))}</div>
        <div class="tp-row"><span>字体</span>${tbBtn('字体', (e) => ctxMenu(e, fontMenu(curFont(), (v) => inlineOrBlock('ff', 'font', v)), '字体'), html`${(FONTS.find((f) => f.id === (curFont() || 'default')) || FONTS[0]).n} ›`, 'tp-t')}</div>
      </div>`}
      ${onComment && tbBtn('评论选中的文字', () => { const s0 = sel(); const q = s0 ? s0.toString().trim().slice(0, 160) : ''; const c = curBlock(); if (c) onComment(c.b.id, q); setTb(null); }, html`<${Icon} name="chat" size=${13} />`)}
    </div>`}
    ${vis.map((b) => html`<${Row} key=${b.id} b=${b} api=${api.current} cmn=${cm[b.id] || 0} drag=${dragId === b.id} dragging=${!!dragId} drop=${dropAt && dropAt.id === b.id ? (dropAt.after ? 'after' : 'before') : ''} md=${mdEdit === b.id} num=${b.type === 'number' ? numberOf(b) : 0} />
      ${menu && menu.id === b.id && items.length > 0 && html`<div class="popmenu bmenu" contenteditable="false">${items.map((it, i) => html`<div class=${'pm ' + (i === menu.idx ? 'on' : '')} onMouseDown=${(e) => { e.preventDefault(); applyMenu(it, b); }}><b>${it.label}</b>${it.hint && html`<small>${it.hint}</small>`}</div>`)}</div>`}`)}
    <div class="b-tail" contenteditable="false"></div>
  </div>`;
}

/* ---------- row: re-renders only when its own block or flags change ---------- */
class Row extends Component {
  shouldComponentUpdate(np) {
    const p = this.props;
    return np.b !== p.b || np.drag !== p.drag || np.dragging !== p.dragging || np.drop !== p.drop || np.md !== p.md || np.num !== p.num || np.cmn !== p.cmn;
  }
  componentDidMount() { this.sync(); }
  componentDidUpdate(prev) {
    if (prev.b.v !== this.props.b.v || prev.b.type !== this.props.b.type || prev.md !== this.props.md) this.sync();
    if (this.props.md && !prev.md && this.el) this.el.focus();
  }
  componentWillUnmount() { const { api, b } = this.props; if (api.refs.current.get(b.id) === this.el) api.refs.current.delete(b.id); }
  sync() { const el = this.el, b = this.props.b; if (!el) return; this.props.api.refs.current.set(b.id, el); if (b.type === 'table') { if (el.dataset.json !== JSON.stringify([b.rows || emptyTable(), b.header !== false, b.bg || {}])) renderTable(el, b); return; } if (el.innerHTML !== b.html) el.innerHTML = b.html; }
  render({ b, api, drag, dragging, drop, md, num, cmn }) {
    const { update, removeBlock, insertAfter, addBelow, setDragId, setDropAt, onDropRow, setMdEdit, convert } = api;
    const setEl = (el) => { this.el = el; if (el) { api.refs.current.set(b.id, el); if (b.type === 'table' && !el.dataset.json) renderTable(el, b); } };
    const dropCls = drop ? ' drop-' + drop : '';
    let body;
    if (b.type === 'divider') body = html`<div class="b-divider" contenteditable="false" tabindex="0" onKeyDown=${(e) => { if (e.key === 'Backspace' || e.key === 'Delete') removeBlock(b.id); }}><hr/></div>`;
    else if (b.type === 'pending') body = html`<div class=${'b-pending st-' + (b.status || 'idle')} contenteditable="false" tabindex="0" onKeyDown=${(e) => { if ((e.key === 'Backspace' || e.key === 'Delete') && b.status !== 'writing') { e.preventDefault(); removeBlock(b.id); } if (e.key === 'Enter') { e.preventDefault(); addBelow(b.id); } }}>
      <span class="bp-ico">${b.status === 'writing' ? html`<span class="bp-spin"></span>` : html`<${Icon} name="sparkle" size=${14} />`}</span>
      <div class="bp-body"><b>${b.status === 'writing' ? '汤圆正在写…' : b.status === 'error' ? '没写成' : '等汤圆写'}</b><div class="bp-intent">${b.intent || ''}</div>${b.status === 'error' && b.error ? html`<div class="bp-err">${b.error}</div>` : ''}</div>
      <div class="bp-acts">${b.status !== 'writing' && html`<button class="btn sm primary" onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.startPending(b.id)}>${b.status === 'error' ? '重试' : '开始写'}</button>`}<button class="btn sm ghost" onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.editPending(b)}>改要求</button><button class="ibtn" title="删除" onMouseDown=${(e) => e.preventDefault()} onClick=${() => removeBlock(b.id)}><${Icon} name="x" size=${13} /></button></div>
    </div>`;
    else if (b.type === 'image') body = html`<figure class=${'b-image al-' + (b.align || 'left')} contenteditable="false" style=${`width:${b.width || 100}%`}>
      <div class="b-imgwrap"><img src=${b.url} alt="" draggable="false" onError=${(e) => { e.target.style.opacity = .3; }} /><span class="img-rz l" title="拖动调整大小" onPointerDown=${(e) => api.imgResize(e, b, -1)}></span><span class="img-rz r" title="拖动调整大小" onPointerDown=${(e) => api.imgResize(e, b, 1)}></span></div>
      <figcaption ref=${setEl} class="b-text b-cap" contenteditable="true" data-ph="图片说明"></figcaption></figure>`;
    else if (b.type === 'table') body = html`<div class="b-tablewrap"><table ref=${setEl} class="b-table b-text"></table><button class="tb-add col" contenteditable="false" title="添加一列" onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.tableOp(b, 'colRight', 0, (b.rows && b.rows[0] ? b.rows[0].length : 1) - 1)}>+</button><button class="tb-add row" contenteditable="false" title="添加一行" onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.tableOp(b, 'rowBelow', (b.rows ? b.rows.length : 1) - 1, 0)}>+</button></div>`;
    else if (b.type === 'file') body = html`<div class="b-filewrap" contenteditable="false"><${FileView} b=${b} onRemove=${() => removeBlock(b.id)} /><div ref=${setEl} class="b-text b-cap" contenteditable="true" data-ph="备注（可选）"></div></div>`;
    else if (b.type === 'code') body = html`<div class="b-code" contenteditable="false"><input class="b-lang" value=${b.lang || ''} placeholder="语言" onInput=${(e) => update(b.id, { lang: e.target.value })} /><pre ref=${setEl} contenteditable="plaintext-only" class="b-text" data-ph="代码"></pre></div>`;
    else if (b.type === 'md') body = md
      ? html`<pre ref=${setEl} contenteditable="plaintext-only" class="b-text b-mdsrc" onBlur=${() => setMdEdit(null)}></pre>`
      : html`<div class="b-mdview md" contenteditable="false" title="点击编辑" onClick=${() => setMdEdit(b.id)} dangerouslySetInnerHTML=${{ __html: sanitizeDoc(marked.parse(textOf(b.html))) }}></div>`;
    else body = html`<div class=${'b-' + b.type}>
      ${b.type === 'bullet' && html`<span class="b-mark" contenteditable="false">•</span>`}
      ${b.type === 'number' && html`<span class="b-mark num" contenteditable="false">${num}.</span>`}
      ${b.type === 'todo' && html`<button class=${'b-check ' + (b.checked ? 'on' : '')} contenteditable="false" onMouseDown=${(e) => e.preventDefault()} onClick=${() => update(b.id, { checked: !b.checked })}><${Icon} name="check" size=${11} /></button>`}
      ${b.type === 'toggle' && html`<button class=${'b-tg ' + (b.open ? 'open' : '')} contenteditable="false" onMouseDown=${(e) => e.preventDefault()} onClick=${() => update(b.id, { open: !b.open })}><${Icon} name="right" size=${12} /></button>`}
      <div ref=${setEl} class=${'b-text ' + (b.type === 'todo' && b.checked ? 'done' : '') + (b.size ? ' bs-' + b.size : '') + (b.color && !HEX.test(b.color) ? ' bc-' + b.color : '') + (b.font ? ' bf-' + b.font : '')} style=${b.color && HEX.test(b.color) ? `color:${b.color}` : ''} data-ph=${phFor(b)}></div>
    </div>`;
    const menu = (e) => {
      if (window.getSelection && !window.getSelection().isCollapsed) return; e.stopPropagation();
      if (b.type === 'table') { const cell = e.target.closest && e.target.closest('td,th'); ctxMenu(e, [...api.tableMenu(b, cell), 'sep', { label: '评论这个表格…', icon: 'chat', onClick: () => api.onComment(b.id, '表格') }, { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) }], '表格'); return; }
      if (b.type === 'pending') { ctxMenu(e, [b.status !== 'writing' && { label: b.status === 'error' ? '重试' : '开始写', icon: 'sparkle', onClick: () => api.startPending(b.id) }, { label: '改要求', icon: 'edit', onClick: () => api.editPending(b) }, 'sep', { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) }, { label: '删除', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) }].filter(Boolean), '汤圆待写'); return; }
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
        { label: '文字颜色', icon: 'tag', sub: api.colorItems(b) },
        { label: '字号', icon: 'type', sub: api.sizeItems(b) },
        { label: '字体', icon: 'type', sub: api.fontItems(b) },
        'sep',
        ['bullet', 'number', 'todo'].includes(b.type) && { label: '变成待办', icon: 'checksq', hint: '这一串列表', onClick: () => api.listToTodos(b) },
        { label: '让汤圆拆成步骤', icon: 'sparkle', onClick: () => api.breakToSteps(b) },
        { label: '评论这一块…', icon: 'chat', onClick: () => api.onComment(b.id, '') },
        { label: '在下方添加块', icon: 'plus', onClick: () => addBelow(b.id) },
        { label: '复制一份', icon: 'layers', hint: '⌘D', onClick: () => insertAfter(b.id, cloneBlock(b)) },
        { label: '删除块', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) },
      ], '块');
    };
    return html`<div class=${'b-row' + dropCls + (drag ? ' dragging' : '')} style=${`--ind:${b.indent || 0}`} data-type=${b.type} data-id=${b.id} onContextMenu=${menu}
      onDragOver=${(e) => { if (!api.dragRef.current) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ id: b.id, after: e.clientY > r.top + r.height / 2 }); }}
      onDrop=${(e) => { if (api.dragRef.current) onDropRow(e, b.id); }}>
      <div class="b-gutter" contenteditable="false">
        <button class="b-handle" title="拖动调整顺序（⌥↑ / ⌥↓ 也可以）" draggable="true" onDragStart=${(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }} onDragEnd=${() => { setDragId(null); setDropAt(null); }} onMouseDown=${(e) => e.preventDefault()}>⋮⋮</button>
      </div>
      ${body}
      ${cmn > 0 && html`<button class="b-cm" contenteditable="false" title=${`${cmn} 条评论`} onMouseDown=${(e) => e.preventDefault()} onClick=${() => api.onComment(b.id, '', true)}><${Icon} name="chat" size=${12} />${cmn}</button>`}
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
    ${pdf && open && url && html`<iframe class="bf-pdf" sandbox="" src=${url + '#toolbar=1&navpanes=0'} title=${b.name}></iframe>`}
  </div>`;
}

function phFor(b) {
  return { p: '输入 / 插入块，[[ 链接页面', h1: '标题 1', h2: '标题 2', h3: '标题 3', bullet: '列表', number: '列表', todo: '待办', toggle: '折叠标题', quote: '引用', callout: '标注', image: '图片说明', code: '代码' }[b.type] || '';
}

/* ---------- 给块编辑器之外的 contenteditable 用的浮动格式条（画布文字等） ----------
   选中 within 里可编辑区域的文字就出现：粗体 / 斜体 / 下划线 / 删除线 / 荧光标记 / 清除格式 */
export function SelToolbar({ within, onChange }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const h = () => {
      const s = sel(); const root = within && within.current;
      if (!root || !s.rangeCount || s.isCollapsed) { setPos((x) => (x ? null : x)); return; }
      const r = s.getRangeAt(0); let el = r.commonAncestorContainer; if (el.nodeType !== 1) el = el.parentElement;
      const ce = el && el.closest('[contenteditable="true"]');
      if (!ce || !root.contains(ce) || document.activeElement !== ce) { setPos((x) => (x ? null : x)); return; }
      const rect = r.getBoundingClientRect(); if (!rect.width && !rect.height) { setPos((x) => (x ? null : x)); return; }
      const nx = Math.round(rect.left + rect.width / 2), ny = Math.round(rect.top);
      setPos((x) => (x && x.x === nx && x.y === ny ? x : { x: nx, y: ny }));
    };
    const later = () => setTimeout(h, 0);
    document.addEventListener('selectionchange', h); window.addEventListener('scroll', h, true); document.addEventListener('focusout', later); document.addEventListener('focusin', later);
    return () => { document.removeEventListener('selectionchange', h); window.removeEventListener('scroll', h, true); document.removeEventListener('focusout', later); document.removeEventListener('focusin', later); };
  }, []);
  if (!pos) return null;
  const btn = (title, fn, child, cls = '') => html`<button title=${title} class=${cls} onMouseDown=${(e) => e.preventDefault()} onClick=${() => { fn(); onChange && onChange(); }}>${child}</button>`;
  return createPortal(html`<div class="sel-tb fixed" style=${`left:${pos.x}px;top:${pos.y}px`} onMouseDown=${(e) => e.preventDefault()}>
    ${btn('粗体 ⌘B', () => exec('bold'), html`<b>B</b>`)}
    ${btn('斜体 ⌘I', () => exec('italic'), html`<i>I</i>`)}
    ${btn('下划线 ⌘U', () => exec('underline'), html`<u>U</u>`)}
    ${btn('删除线', () => exec('strikeThrough'), html`<s>S</s>`)}
    ${hlPicker(btn, () => onChange && onChange())}
    ${btn('清除格式', () => { exec('removeFormat'); applyMark(null); }, html`<${Icon} name="x" size=${13} />`)}
  </div>`, document.body);
}
// 快捷键：在任何可编辑区域里按 ⌘B / I / U / ⇧H
export function inlineShortcut(e) {
  const mod = e.metaKey || e.ctrlKey; if (!mod) return false;
  const k = e.key.toLowerCase();
  if (!e.shiftKey && k === 'b') { exec('bold'); return true; }
  if (!e.shiftKey && k === 'i') { exec('italic'); return true; }
  if (!e.shiftKey && k === 'u') { exec('underline'); return true; }
  if (e.shiftKey && k === 'h') { applyMark('y'); return true; }
  return false;
}
