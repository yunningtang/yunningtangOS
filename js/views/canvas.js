// 画布: an infinite board for thinking with pages, text, freehand strokes and arrows between them.
// { id, title, nodes: [{ id, type: 'text'|'note'|'src'|'learn', x, y, w, h, text?, note?, color? }], edges: [{ id, from, to, label }], strokes: [{ id, color, width, pts: [[x,y]] }] }
// src / learn 是学习画布用的：材料（PDF / 图片 / 文字）和汤圆的讲解面板，见 learn.js
import { html, useState, useEffect, useRef, useMemo } from '../../vendor/preact.js';
import { useStore, upsert, update, get } from '../store.js';
import { Icon, IconBtn, Btn, Empty, Modal, Seg } from '../ui.js';
import { uid, todayStr, sortBy, escapeHtml as esc, nowISO } from '../util.js';
import { go, toast } from '../nav.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt, askConfirm } from '../confirm.js';
import { dropProps } from '../dnd.js';
import { snippetOf, newNote } from './notes.js';
import { mdToBlocks, sanitize } from '../blocks.js';
import { openPalette, customColors } from '../palette.js';
import { SelToolbar, inlineShortcut } from '../editor.js';
import { SrcNode, LearnNode, askLearn, panelText } from '../learn.js';
import { saveFile, isPdf, fmtSize } from '../files.js';
import { pickFile } from '../util.js';

const NODE_COLORS = [['', '默认'], ['#4f7cf5', '蓝'], ['#2d8f88', '青'], ['#4a9a6a', '绿'], ['#c7873a', '琥珀'], ['#c9588a', '玫红'], ['#7461c9', '紫'], ['#d2524f', '红']];
const PEN_COLORS = ['#1b1d21', '#4f7cf5', '#d2524f', '#4a9a6a', '#c7873a', '#7461c9'];
// 右键菜单里的一排色块：预设色 + 最近自定义过的几个（和笔记共用），当前的那个打勾
function colorSwatches(cur, list, set) {
  const pre = list.map(([c, l]) => ({ color: c, label: l, none: !c, on: (cur || '') === c, onClick: () => set(c) }));
  const mine = customColors().filter((c) => !list.some(([x]) => x === c)).slice(0, 5).map((c) => ({ color: c, label: c + '（自定义）', on: cur === c, onClick: () => set(c) }));
  return [...pre, ...mine];
}
const now = () => nowISO();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function newCanvas(title = '') { const c = { id: uid(), title, nodes: [], edges: [], strokes: [], created: todayStr(), updated: now() }; upsert('canvases', c); return c; }
export function canvasesOf(s, noteId) { return (s.canvases || []).filter((c) => (c.nodes || []).some((n) => n.note === noteId)); }
export function canvasMenu(c, extra = {}) {
  return [
    { label: '打开', icon: 'frame', onClick: () => go('notes/canvas/' + c.id) },
    { label: '重命名', icon: 'edit', onClick: async () => { const v = await askPrompt('画布名称', c.title, { title: '重命名画布' }); if (v != null) upsert('canvases', { id: c.id, title: v.trim(), updated: now() }); } },
    'sep',
    { label: '删除画布', icon: 'trash', danger: true, onClick: async () => { if (await askConfirm(`「${c.title || '未命名画布'}」会被删除，页面本身不受影响。`, { title: '删除画布？' })) { update((d) => { d.canvases = d.canvases.filter((x) => x.id !== c.id); }); extra.onDelete && extra.onDelete(); } } },
  ];
}

/* ---------- geometry ---------- */
function anchor(a, b) { // point on a's border toward b's center
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay; if (!dx && !dy) return [ax, ay];
  const t = Math.min(dx ? (a.w / 2) / Math.abs(dx) : 1e9, dy ? (a.h / 2) / Math.abs(dy) : 1e9);
  return [ax + dx * t, ay + dy * t];
}
function edgePath(a, b) {
  const [x1, y1] = anchor(a, b), [x2, y2] = anchor(b, a);
  const horiz = Math.abs(x2 - x1) >= Math.abs(y2 - y1); const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const d = horiz ? `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  return { d, mx, my };
}
function strokePath(pts) { if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]} l0.1,0` : ''; let d = `M${pts[0][0]},${pts[0][1]}`; for (let i = 1; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; d += ` Q${x0},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2}`; } const l = pts[pts.length - 1]; d += ` L${l[0]},${l[1]}`; return d; }
function simplify(pts, tol = 1.2) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const p = out[out.length - 1]; if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) >= tol || i === pts.length - 1) out.push(pts[i]); } return out; }
function bbox(b) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of b.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  for (const s of b.strokes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ---------- board ---------- */
function Board({ board, notes, notebooks }) {
  const [b, setBState] = useState(board);
  const bRef = useRef(b); const setB = (v) => { const next = typeof v === 'function' ? v(bRef.current) : v; bRef.current = next; setBState(next); };
  const dragRef = useRef(null);
  useEffect(() => { if (!dragRef.current && board !== bRef.current) setB(board); }, [board]);
  const commit = (next) => { setB(next); upsert('canvases', { ...next, updated: now() }); };
  const [view, setViewState] = useState(() => lsGet('ytos.cv.' + board.id) || { x: 80, y: 80, z: 1 });
  const viewRef = useRef(view); const setView = (v) => { const next = typeof v === 'function' ? v(viewRef.current) : v; viewRef.current = next; setViewState(next); };
  useEffect(() => { const t = setTimeout(() => lsSet('ytos.cv.' + board.id, view), 300); return () => clearTimeout(t); }, [view]);
  const [tool, setTool] = useState('select');
  const [pen, setPen] = useState({ color: '#4f7cf5', width: 3 });
  const [sel, setSel] = useState(null); // { kind: 'node'|'edge'|'stroke', id }
  const [editing, setEditing] = useState(null);
  const [temp, setTemp] = useState(null);
  const [guides, setGuides] = useState([]); // alignment guides while dragging a node
  const [picker, setPicker] = useState(false);
  const [textModal, setTextModal] = useState(false);
  const vp = useRef();
  const node = (id) => bRef.current.nodes.find((n) => n.id === id);
  const toWorld = (e) => { const r = vp.current.getBoundingClientRect(); const v = viewRef.current; return [(e.clientX - r.left - v.x) / v.z, (e.clientY - r.top - v.y) / v.z]; };
  const center = () => { const r = vp.current.getBoundingClientRect(); const v = viewRef.current; return [(r.width / 2 - v.x) / v.z, (r.height / 2 - v.y) / v.z]; };
  const zoomAt = (cx, cy, f) => setView((v) => { const z = clamp(v.z * f, 0.2, 3); return { x: cx - (cx - v.x) * z / v.z, y: cy - (cy - v.y) * z / v.z, z }; });
  const zoomBy = (f) => { const r = vp.current.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); };
  const fit = () => { const bb = bbox(bRef.current); const r = vp.current.getBoundingClientRect(); if (!bb) { setView({ x: r.width / 2, y: r.height / 2, z: 1 }); return; } const z = clamp(Math.min((r.width - 80) / bb.w, (r.height - 80) / bb.h, 1.5), 0.2, 1.5); setView({ x: (r.width - bb.w * z) / 2 - bb.x * z, y: (r.height - bb.h * z) / 2 - bb.y * z, z }); };

  const addText = (x, y, text = '') => { const n = { id: uid(), type: 'text', x: Math.round(x), y: Math.round(y), w: 220, h: 64, text, color: '' }; commit({ ...bRef.current, nodes: [...bRef.current.nodes, n] }); setSel({ kind: 'node', id: n.id }); setEditing(n.id); return n; };
  const addNote = (noteId, x, y) => { if (bRef.current.nodes.some((n) => n.note === noteId)) { toast('这一页已经在画布上了'); return; } const n = { id: uid(), type: 'note', note: noteId, x: Math.round(x), y: Math.round(y), w: 240, h: 110, color: '' }; commit({ ...bRef.current, nodes: [...bRef.current.nodes, n] }); setSel({ kind: 'node', id: n.id }); };
  // mind-map style: Tab = child to the right (connected), Enter = sibling below (connected to the same parent)
  const spawn = (pid, child) => {
    if (editing === pid && document.activeElement) document.activeElement.blur();
    const p = node(pid); if (!p) return;
    const nn = { id: uid(), type: 'text', x: child ? p.x + p.w + 70 : p.x, y: child ? p.y : p.y + p.h + 28, w: Math.max(180, Math.min(260, p.w)), h: 56, text: '', color: p.color || '' };
    const others = bRef.current.nodes; let guard = 0;
    while (guard++ < 30 && others.some((o) => nn.x < o.x + o.w + 12 && nn.x + nn.w + 12 > o.x && nn.y < o.y + o.h + 12 && nn.y + nn.h + 12 > o.y)) nn.y += 40;
    let edges = bRef.current.edges;
    if (child) edges = [...edges, { id: uid(), from: p.id, to: nn.id, label: '' }];
    else { const pe = edges.find((x) => x.to === p.id); if (pe) edges = [...edges, { id: uid(), from: pe.from, to: nn.id, label: '' }]; }
    commit({ ...bRef.current, nodes: [...others, nn], edges }); setSel({ kind: 'node', id: nn.id }); setEditing(nn.id);
  };
  const removeSel = (s = sel) => {
    if (!s) return; const prev = bRef.current; let next;
    if (s.kind === 'node') next = { ...prev, nodes: prev.nodes.filter((n) => n.id !== s.id), edges: prev.edges.filter((e) => e.from !== s.id && e.to !== s.id) };
    else if (s.kind === 'edge') next = { ...prev, edges: prev.edges.filter((e) => e.id !== s.id) };
    else next = { ...prev, strokes: prev.strokes.filter((x) => x.id !== s.id) };
    commit(next); setSel(null); setEditing(null);
    toast('已删除', { label: '撤销', onClick: () => commit(prev) });
  };
  const delStroke = (id) => { if (!bRef.current.strokes.some((s) => s.id === id)) return; setB({ ...bRef.current, strokes: bRef.current.strokes.filter((s) => s.id !== id) }); };
  const patchNode = (id, patch, save = true) => { const next = { ...bRef.current, nodes: bRef.current.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }; if (save) commit(next); else setB(next); };

  /* ---- 学习：材料 + 问汤圆 ---- */
  // 放一个新节点：从 (x, y) 开始往下找一个不和别人重叠的位置
  const freeSpot = (x, y, w, h) => { let guard = 0; const others = bRef.current.nodes; while (guard++ < 60 && others.some((o) => x < o.x + o.w + 16 && x + w + 16 > o.x && y < o.y + o.h + 16 && y + h + 16 > o.y)) y += 48; return [Math.round(x), Math.round(y)]; };
  const showNode = (n) => { const r = vp.current.getBoundingClientRect(); const v = viewRef.current; const sx = n.x * v.z + v.x, sy = n.y * v.z + v.y; if (sx > 20 && sx + n.w * v.z < r.width - 20 && sy > 20 && sy < r.height - 160) return; setView({ ...v, x: r.width / 2 - (n.x + n.w / 2) * v.z, y: 70 - n.y * v.z }); };
  const addFiles = async (files, at) => {
    let [x, y] = at || (() => { const [cx, cy] = center(); return [cx - 220, cy - 260]; })(); let last = null;
    for (const f of files) {
      const pdf = isPdf(f), img = /^image\//.test(f.type || '');
      if (!pdf && !img) { toast('只能放 PDF 或图片'); continue; }
      if (f.size > 4 * 1048576) toast(`「${f.name}」${fmtSize(f.size)}，超过 4 MB 的文件只在这台设备上，不会同步到别的设备`);
      const rec = await saveFile(f);
      const w = pdf ? 460 : 420, h = pdf ? 620 : 380; const [nx, ny] = freeSpot(x, y, w, h);
      const n = { id: uid(), type: 'src', kind: pdf ? 'pdf' : 'image', fid: rec.id, name: f.name || (img ? '图片' : '文件'), x: nx, y: ny, w, h, color: '' };
      commit({ ...bRef.current, nodes: [...bRef.current.nodes, n] }); last = n; x = nx + w + 40;
    }
    if (last) { setSel({ kind: 'node', id: last.id }); showNode(last); }
  };
  const addTextSrc = (text, name) => { const [cx, cy] = center(); const [x, y] = freeSpot(cx - 220, cy - 200, 440, 360); const n = { id: uid(), type: 'src', kind: 'text', name: name || (text.split('\n')[0].trim().slice(0, 24) || '一段文字'), text: text.slice(0, 60000), x, y, w: 440, h: 360, color: '' }; commit({ ...bRef.current, nodes: [...bRef.current.nodes, n] }); setSel({ kind: 'node', id: n.id }); showNode(n); return n; };
  const lastOf = (type) => [...bRef.current.nodes].reverse().find((n) => n.type === type && !n.pending);
  // 问汤圆：锚点是选中的节点（材料 / 讲解面板 / 文字），没选就接着最近的一块讲解或最近的材料
  const ask = async (q, opt = {}) => {
    q = String(q || '').trim(); if (!q) return;
    let anchor = opt.anchorId ? node(opt.anchorId) : sel && sel.kind === 'node' ? node(sel.id) : null;
    if (!anchor) anchor = lastOf('learn') || lastOf('src') || null;
    const src = anchor && anchor.type === 'src' ? anchor : anchor && anchor.type === 'learn' ? node(anchor.src) || lastOf('src') : lastOf('src');
    const prior = anchor && anchor.type === 'learn' ? panelText(anchor) : '';
    const focus = opt.focus || (anchor && anchor.type === 'text' ? anchor.text || '' : anchor && anchor.type === 'note' ? (notes.find((x) => x.id === anchor.note) || {}).body || '' : '');
    const w = 420; const [cx, cy] = center();
    const [x, y] = anchor ? freeSpot(anchor.x + anchor.w + 90, anchor.y + (opt.dy || 0), w, 220) : freeSpot(cx - w / 2, cy - 160, w, 220);
    const pn = { id: uid(), type: 'learn', q, x, y, w, h: 220, src: src ? src.id : '', from: anchor ? anchor.id : '', focus: (opt.focus || '').slice(0, 1500), pending: true, at: now() };
    const edges = anchor ? [...bRef.current.edges, { id: uid(), from: anchor.id, to: pn.id, label: opt.label || '' }] : bRef.current.edges;
    commit({ ...bRef.current, nodes: [...bRef.current.nodes, pn], edges }); setSel({ kind: 'node', id: pn.id }); showNode(pn);
    runAsk(pn.id, { q, src, prior, focus });
  };
  const runAsk = async (id, args) => {
    try { const r = await askLearn(args); patchNode(id, { pending: false, error: '', title: r.title, reply: r.reply, cards: r.cards, mode: 'hint' }); }
    catch (e) { patchNode(id, { pending: false, error: e.message || '出错了' }); }
  };
  const retry = (n) => { patchNode(n.id, { pending: true, error: '' }); const from = node(n.from); runAsk(n.id, { q: n.q, src: node(n.src), prior: from && from.type === 'learn' ? panelText(from) : '', focus: n.focus || '' }); };
  const stuckOn = (n, focus, label) => ask(`「${String(label).slice(0, 40)}」这里没看懂，用更基础、更具体的方式再讲一遍`, { anchorId: n.id, focus, label: '这步不懂' });
  // 讲解面板存成一页笔记（Markdown）
  const panelToNote = (n) => {
    const md = [`> 问：${n.q}`, ...(n.cards || []).map((c) => [c.title ? `## ${c.title}` : '', c.latex ? `$$${c.latex}$$` : '', c.body || '', c.steps ? c.steps.map((x, i) => `${i + 1}. **${x.title}**${x.detail ? '\n   ' + x.detail.replace(/\n/g, '\n   ') : ''}`).join('\n') : '', c.question ? `**小测验**：${c.question}\n${(c.options || []).map((o, i) => `- ${'ABCDE'[i]}. ${o}`).join('\n')}\n\n答案：${'ABCDE'[c.answer] || ''}　${c.explain || ''}` : ''].filter(Boolean).join('\n\n'))].join('\n\n');
    const p = newNote({ title: n.title || '讲解', body: md, blocks: mdToBlocks(md) }); toast('已存成笔记', { label: '打开', onClick: () => go('notes/' + p.id) });
  };
  // 拖文件进来 / 粘贴图片或长文字 → 变成材料
  useEffect(() => {
    const el = vp.current; if (!el) return;
    const over = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('file-over'); } };
    const leave = (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('file-over'); };
    const drop = (e) => { el.classList.remove('file-over'); const fs = e.dataTransfer && [...e.dataTransfer.files]; if (!fs || !fs.length) return; e.preventDefault(); e.stopPropagation(); addFiles(fs, toWorld(e)); };
    el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', drop, true);
    const paste = (e) => {
      if (e.target.closest && e.target.closest('input,textarea,[contenteditable="true"]')) return;
      const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter((f) => /^image\//.test(f.type) || isPdf(f));
      if (fs.length) { e.preventDefault(); addFiles(fs); return; }
      const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (t && t.trim().length > 80) { e.preventDefault(); addTextSrc(t.trim()); }
    };
    window.addEventListener('paste', paste);
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop, true); window.removeEventListener('paste', paste); };
  }, []);
  // 讲解面板 / 材料的真实高度回写到节点里（连线和对齐要用）
  const measure = (n) => (el) => { if (!el || el._ro) return; el._ro = new ResizeObserver(() => { const cur = node(n.id); const h = Math.round(el.offsetHeight); if (cur && Math.abs(cur.h - h) > 2) patchNode(n.id, { h }, false); }); el._ro.observe(el); };

  // wheel: pan; with ⌘/ctrl (or a pinch gesture) zoom around the cursor
  useEffect(() => {
    const el = vp.current; if (!el) return;
    const h = (e) => { const sc = !e.ctrlKey && !e.metaKey && e.target.closest && e.target.closest('.cv-scroll'); if (sc && sc.scrollHeight > sc.clientHeight + 1) return; e.preventDefault(); const r = el.getBoundingClientRect(); if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.003)); else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })); };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);
  useEffect(() => {
    const h = (e) => {
      if (e.target.closest('input,textarea,.modal') || (e.target.closest('[contenteditable]') && e.key !== 'Tab' && !(e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey)))) return;
      if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && (sel && sel.kind === 'node' || editing)) { e.preventDefault(); spawn(editing || sel.id, e.key === 'Tab'); return; }
      if (editing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
      else if (e.key === 'Escape') { setSel(null); setTool('select'); }
      else if (e.key === 'v') setTool('select'); else if (e.key === 't') setTool('text'); else if (e.key === 'p') setTool('pen'); else if (e.key === 'e') setTool('erase');
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [sel, editing]);

  const pointers = useRef(new Map());
  const down = (e) => {
    const t = e.target;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { const pts = [...pointers.current.values()]; dragRef.current = { kind: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, z0: viewRef.current.z, v0: viewRef.current, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 }; setTemp(null); return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (t.closest('.cv-tb,.cv-hint,.modal-bg,.cv-ask,.cv-outline')) return;
    const nodeEl = t.closest('.cv-node'); const nodeId = nodeEl && nodeEl.dataset.id;
    if (editing && nodeId === editing) return;
    const [wx, wy] = toWorld(e);
    try { vp.current.setPointerCapture(e.pointerId); } catch {}
    if (tool === 'pen') { dragRef.current = { kind: 'pen', pts: [[Math.round(wx), Math.round(wy)]] }; setTemp({ pts: dragRef.current.pts }); setSel(null); setEditing(null); return; }
    if (tool === 'erase') { const st = t.closest('.cv-stroke'); if (st) delStroke(st.dataset.id); dragRef.current = { kind: 'erase', hit: !!st }; return; }
    if (t.closest('.cv-handle')) { dragRef.current = { kind: 'connect', from: nodeId }; setTemp({ from: nodeId, x: wx, y: wy }); return; }
    if (t.closest('.cv-rz')) { const n = node(nodeId); dragRef.current = { kind: 'resize', id: nodeId, w: n.w, h: n.h, x: wx, y: wy }; return; }
    if (nodeId) { if (t.closest('a,button')) { try { vp.current.releasePointerCapture(e.pointerId); } catch {} return; } const n = node(nodeId); dragRef.current = { kind: 'node', id: nodeId, x0: n.x, y0: n.y, wx, wy, moved: false }; setSel({ kind: 'node', id: nodeId }); if (editing !== nodeId) setEditing(null); return; }
    const edgeEl = t.closest('.cv-edge'); if (edgeEl) { setSel({ kind: 'edge', id: edgeEl.dataset.id }); setEditing(null); dragRef.current = null; return; }
    const strokeEl = t.closest('.cv-stroke'); if (strokeEl) { setSel({ kind: 'stroke', id: strokeEl.dataset.id }); setEditing(null); dragRef.current = null; return; }
    if (tool === 'text') { addText(wx - 20, wy - 16); setTool('select'); return; }
    dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false }; setSel(null); setEditing(null);
  };
  const move = (e) => {
    const d = dragRef.current; if (!d) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.kind === 'pinch') { const pts = [...pointers.current.values()]; if (pts.length < 2) return; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const r = vp.current.getBoundingClientRect(); const cx = (pts[0].x + pts[1].x) / 2 - r.left, cy = (pts[0].y + pts[1].y) / 2 - r.top; const z = clamp(d.z0 * dist / d.d0, 0.2, 3); const ocx = d.cx - r.left, ocy = d.cy - r.top; setView({ x: cx - (ocx - d.v0.x) * z / d.z0, y: cy - (ocy - d.v0.y) * z / d.z0, z }); return; }
    const [wx, wy] = toWorld(e);
    if (d.kind === 'pan') { if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 2) d.moved = true; setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy })); }
    else if (d.kind === 'node') {
      if (Math.abs(wx - d.wx) + Math.abs(wy - d.wy) > 1) d.moved = true;
      let nx = Math.round(d.x0 + wx - d.wx), ny = Math.round(d.y0 + wy - d.wy); const me = node(d.id); const gs = [];
      if (me && !e.shiftKey) {
        const tol = 6 / viewRef.current.z; let bx = null, by = null;
        for (const o of bRef.current.nodes) { if (o.id === d.id) continue;
          for (const [mine, theirs] of [[0, o.x], [me.w / 2, o.x + o.w / 2], [me.w, o.x + o.w], [0, o.x + o.w + 24], [me.w, o.x - 24]]) { const dx = theirs - (nx + mine); if (Math.abs(dx) <= tol && (bx == null || Math.abs(dx) < Math.abs(bx.d))) bx = { d: dx, at: theirs }; }
          for (const [mine, theirs] of [[0, o.y], [me.h / 2, o.y + o.h / 2], [me.h, o.y + o.h], [0, o.y + o.h + 24], [me.h, o.y - 24]]) { const dy = theirs - (ny + mine); if (Math.abs(dy) <= tol && (by == null || Math.abs(dy) < Math.abs(by.d))) by = { d: dy, at: theirs }; }
        }
        if (bx) { nx += bx.d; gs.push({ v: bx.at }); } if (by) { ny += by.d; gs.push({ h: by.at }); }
      }
      setGuides(gs); patchNode(d.id, { x: nx, y: ny }, false);
    }
    else if (d.kind === 'resize') patchNode(d.id, { w: Math.round(clamp(d.w + wx - d.x, 120, 900)), h: Math.round(clamp(d.h + wy - d.y, 40, 900)) }, false);
    else if (d.kind === 'pen') { d.pts.push([Math.round(wx), Math.round(wy)]); setTemp({ pts: d.pts.slice() }); }
    else if (d.kind === 'connect') setTemp({ from: d.from, x: wx, y: wy });
    else if (d.kind === 'erase') { const el = document.elementFromPoint(e.clientX, e.clientY); const st = el && el.closest && el.closest('.cv-stroke'); if (st) { d.hit = true; delStroke(st.dataset.id); } }
  };
  const up = (e) => {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current; if (!d) return;
    if (d.kind === 'pinch') { if (pointers.current.size < 2) dragRef.current = null; return; }
    dragRef.current = null;
    setGuides([]);
    if (d.kind === 'node' || d.kind === 'resize') { if (d.kind === 'resize' || d.moved) commit(bRef.current); }
    else if (d.kind === 'pen') { setTemp(null); if (d.pts.length > 1) commit({ ...bRef.current, strokes: [...bRef.current.strokes, { id: uid(), color: pen.color, width: pen.width, pts: simplify(d.pts) }] }); }
    else if (d.kind === 'erase') { if (d.hit) commit(bRef.current); }
    else if (d.kind === 'connect') { setTemp(null); const el = document.elementFromPoint(e.clientX, e.clientY); const to = el && el.closest && el.closest('.cv-node'); if (to && to.dataset.id !== d.from && !bRef.current.edges.some((x) => (x.from === d.from && x.to === to.dataset.id) || (x.from === to.dataset.id && x.to === d.from))) { const ed = { id: uid(), from: d.from, to: to.dataset.id, label: '' }; commit({ ...bRef.current, edges: [...bRef.current.edges, ed] }); setSel({ kind: 'edge', id: ed.id }); } }
  };
  const dbl = (e) => {
    const t = e.target; if (t.closest('.cv-tb,.cv-hint,a,button,.cv-ask,.cv-outline,.lr-panel,.lr-src')) return;
    const nodeEl = t.closest('.cv-node'); if (nodeEl) { const n = node(nodeEl.dataset.id); if (n && n.type === 'text') { setEditing(n.id); setSel({ kind: 'node', id: n.id }); } else if (n && n.type === 'note') go('notes/' + n.note); return; }
    const edgeEl = t.closest('.cv-edge'); if (edgeEl) { editLabel(edgeEl.dataset.id); return; }
    if (t.closest('.cv-stroke')) return;
    const [wx, wy] = toWorld(e); addText(wx - 20, wy - 16);
  };
  const editLabel = async (id) => { const ed = bRef.current.edges.find((x) => x.id === id); const v = await askPrompt('连线上的文字', ed.label || '', { title: '连线', placeholder: '比如：导致 / 属于' }); if (v != null) commit({ ...bRef.current, edges: bRef.current.edges.map((x) => (x.id === id ? { ...x, label: v.trim() } : x)) }); };
  const ctx = (e) => {
    const t = e.target; if (t.closest('.cv-tb,.cv-ask,.cv-outline')) return;
    const nodeEl = t.closest('.cv-node');
    if (nodeEl) {
      const n = node(nodeEl.dataset.id); setSel({ kind: 'node', id: n.id });
      if (n.type === 'src' || n.type === 'learn') {
        ctxMenu(e, [
          n.type === 'src' && { label: '问汤圆讲讲这份材料', icon: 'chat', onClick: () => ask('先帮我整体讲一下这份材料讲了什么、重点是什么', { anchorId: n.id }) },
          n.type === 'learn' && !n.pending && { label: '存成笔记', icon: 'note', onClick: () => panelToNote(n) },
          n.type === 'learn' && !n.pending && { label: '重新讲一遍', icon: 'refresh', onClick: () => retry(n) },
          'sep',
          { label: '从画布移除', icon: 'trash', danger: true, onClick: () => removeSel({ kind: 'node', id: n.id }) },
        ].filter(Boolean), n.type === 'src' ? n.name || '材料' : n.title || '讲解');
        return;
      }
      ctxMenu(e, [
        n.type === 'note' ? { label: '打开页面', icon: 'note', onClick: () => go('notes/' + n.note) } : { label: '编辑文字', icon: 'edit', onClick: () => setEditing(n.id) },
        n.type === 'text' && { label: '转为页面', icon: 'note', hint: '新建一页并链接', onClick: () => { const lines = (n.text || '').split('\n'); const title = lines[0].trim() || '无标题'; const body = lines.slice(1).join('\n').trim(); const p = newNote({ title, body, blocks: mdToBlocks(body) }); patchNode(n.id, { type: 'note', note: p.id, text: '', h: Math.max(n.h, 110) }); toast('已创建页面', { label: '打开', onClick: () => go('notes/' + p.id) }); } },
        'sep',
        { head: '颜色' },
        { swatches: colorSwatches(n.color || '', NODE_COLORS, (c) => patchNode(n.id, { color: c })) },
        { label: '更多颜色…', icon: 'sparkle', hint: '自定义', onClick: () => openPalette(e, { kind: 'fill', cur: n.color || '', resetLabel: '默认颜色', presets: NODE_COLORS.filter(([c]) => c).map(([c, l]) => ({ v: c, color: c, title: l })), onPick: (v) => patchNode(n.id, { color: v || '' }) }) },
        'sep',
        { label: '从画布移除', icon: 'trash', danger: true, onClick: () => removeSel({ kind: 'node', id: n.id }) },
      ], n.type === 'note' ? (notes.find((x) => x.id === n.note) || {}).title || '页面' : '文字');
      return;
    }
    const edgeEl = t.closest('.cv-edge'); if (edgeEl) { const id = edgeEl.dataset.id; setSel({ kind: 'edge', id }); ctxMenu(e, [{ label: '写上文字…', icon: 'edit', onClick: () => editLabel(id) }, { label: '反转方向', icon: 'refresh', onClick: () => commit({ ...bRef.current, edges: bRef.current.edges.map((x) => (x.id === id ? { ...x, from: x.to, to: x.from } : x)) }) }, 'sep', { label: '删除连线', icon: 'trash', danger: true, onClick: () => removeSel({ kind: 'edge', id }) }], '连线'); return; }
    const strokeEl = t.closest('.cv-stroke'); if (strokeEl) {
      const id = strokeEl.dataset.id; setSel({ kind: 'stroke', id }); const st0 = bRef.current.strokes.find((x) => x.id === id) || {};
      const patchStroke = (p) => commit({ ...bRef.current, strokes: bRef.current.strokes.map((x) => (x.id === id ? { ...x, ...p } : x)) });
      ctxMenu(e, [
        { head: '颜色' },
        { swatches: colorSwatches(st0.color, PEN_COLORS.map((c) => [c, c]), (c) => patchStroke({ color: c })) },
        { label: '更多颜色…', icon: 'sparkle', hint: '自定义', onClick: () => openPalette(e, { kind: 'fill', cur: st0.color, resetLabel: '默认（黑）', presets: PEN_COLORS.map((c) => ({ v: c, color: c, title: c })), onPick: (v) => patchStroke({ color: v || PEN_COLORS[0] }) }) },
        { head: '粗细' },
        ...[[2, '细'], [3, '中'], [6, '粗']].map(([w, l]) => ({ label: l, icon: st0.width === w ? 'check' : '', onClick: () => patchStroke({ width: w }) })),
        'sep',
        { label: '删除这一笔', icon: 'trash', danger: true, onClick: () => removeSel({ kind: 'stroke', id }) },
      ], '笔迹'); return;
    }
    const [wx, wy] = toWorld(e);
    ctxMenu(e, [
      { label: '添加文字', icon: 'type', onClick: () => addText(wx, wy) },
      { label: '添加页面…', icon: 'note', onClick: () => setPicker({ x: wx, y: wy }) },
      'sep',
      { label: '适应内容', icon: 'maximize', onClick: fit },
      { label: '100%', icon: 'target', onClick: () => setView((v) => ({ ...v, z: 1 })) },
      'sep',
      ...canvasMenu(b, { onDelete: () => go('notes/canvas') }).filter((it) => !(it && it.label === '打开')),
    ], b.title || '画布');
  };
  // 文字节点存两份：html（带粗体 / 荧光等格式）和 text（纯文字，给导出和搜索用）
  const onTextBlur = (n, el) => { const text = el.innerText.replace(/\n$/, ''); const h = Math.max(40, Math.round(el.parentElement.offsetHeight)); const hh = sanitize(el.innerHTML).replace(/(<br>)+$/, ''); if (text !== (n.text || '') || hh !== (n.html || '') || h !== n.h) patchNode(n.id, { text, html: hh, h }); setEditing((x) => (x === n.id ? null : x)); };
  const textHtml = (n) => (n.html != null && n.html !== '' ? n.html : esc(n.text || '').replace(/\n/g, '<br>'));
  const wrapRef = useRef();

  const byId = useMemo(() => new Map(b.nodes.map((n) => [n.id, n])), [b.nodes]);
  const tr = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  const nb = (id) => notebooks.find((x) => x.id === id);
  return html`<div class=${'cv-wrap tool-' + tool} ref=${wrapRef}>
    <${SelToolbar} within=${wrapRef} />
    <div class="cv-tb">
      <div class="cv-tools" data-liquid="button"><span class="liq"></span>
        ${[['select', '选择', 'cursor', 'V'], ['text', '文字', 'type', 'T'], ['pen', '画笔', 'pen', 'P'], ['erase', '橡皮', 'eraser', 'E']].map(([v, l, ic, k]) => html`<button type="button" key=${v} class=${tool === v ? 'on' : ''} title=${`${l}（${k}）`} onClick=${() => setTool(v)}><${Icon} name=${ic} size=${14} /><span>${l}</span></button>`)}
      </div>
      ${tool === 'pen' && html`<div class="cv-pens">${PEN_COLORS.map((c) => html`<button key=${c} class=${'cv-pen ' + (pen.color === c ? 'on' : '')} style=${`--c:${c}`} onClick=${() => setPen({ ...pen, color: c })}></button>`)}<span class="cv-sep"></span>${[[2, '细'], [3, '中'], [6, '粗']].map(([w, l]) => html`<button key=${w} class=${'cv-w ' + (pen.width === w ? 'on' : '')} onClick=${() => setPen({ ...pen, width: w })}>${l}</button>`)}</div>`}
      <button class="btn ghost sm cv-add" title="添加页面" onClick=${() => setPicker({})}><${Icon} name="note" size=${13} /><span class="t">添加页面</span></button>
      <span class="flex1"></span>
      <div class="cv-zoom"><button class="ibtn" title="缩小" onClick=${() => zoomBy(1 / 1.25)}><${Icon} name="minus" size=${13} /></button><button class="cv-z" title="适应内容" onClick=${fit}>${Math.round(view.z * 100)}%</button><button class="ibtn" title="放大" onClick=${() => zoomBy(1.25)}><${Icon} name="plus" size=${13} /></button></div>
      <${IconBtn} icon="dots" title="更多…" onClick=${(e) => ctxMenu(e, [{ label: '适应内容', icon: 'maximize', onClick: fit }, { label: '100%', icon: 'target', onClick: () => setView((v) => ({ ...v, z: 1 })) }, 'sep', ...canvasMenu(b, { onDelete: () => go('notes/canvas') }).filter((it) => !(it && it.label === '打开'))], b.title || '画布')} />
    </div>
    <div class="cv-vp" ref=${vp} style=${`background-position:${view.x}px ${view.y}px;background-size:${24 * view.z}px ${24 * view.z}px`} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onDblClick=${dbl} onContextMenu=${ctx} ...${dropProps('page', (d, { event }) => { const [x, y] = toWorld(event); addNote(d.id, x - 120, y - 40); })}>
      <svg class="cv-svg"><defs><marker id="cv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
        <g transform=${`translate(${view.x},${view.y}) scale(${view.z})`}>
          ${b.strokes.map((s) => html`<path key=${s.id} class=${'cv-stroke ' + (sel && sel.kind === 'stroke' && sel.id === s.id ? 'sel' : '')} data-id=${s.id} d=${strokePath(s.pts)} stroke=${s.color} stroke-width=${s.width} />`)}
          ${temp && temp.pts && html`<path class="cv-stroke tmp" d=${strokePath(temp.pts)} stroke=${pen.color} stroke-width=${pen.width} />`}
          ${b.edges.map((ed) => { const a = byId.get(ed.from), c = byId.get(ed.to); if (!a || !c) return null; const { d, mx, my } = edgePath(a, c); const on = sel && sel.kind === 'edge' && sel.id === ed.id; return html`<g key=${ed.id} class=${'cv-edge ' + (on ? 'sel' : '')} data-id=${ed.id}><path class="hit" d=${d} /><path class="line" d=${d} marker-end="url(#cv-arrow)" />${ed.label && html`<text x=${mx} y=${my} text-anchor="middle" dominant-baseline="middle">${ed.label}</text>`}</g>`; })}
          ${temp && temp.from && byId.get(temp.from) && html`<path class="cv-tmpline" d=${`M${byId.get(temp.from).x + byId.get(temp.from).w},${byId.get(temp.from).y + byId.get(temp.from).h / 2} L${temp.x},${temp.y}`} />`}
        </g>
      </svg>
      <div class="cv-layer" style=${`transform:${tr}`}>
        ${guides.map((g, i) => g.v != null ? html`<i key=${i} class="cv-guide v" style=${`left:${g.v}px`}></i>` : html`<i key=${i} class="cv-guide h" style=${`top:${g.h}px`}></i>`)}
        ${b.nodes.map((n) => { const on = sel && sel.kind === 'node' && sel.id === n.id; const page = n.type === 'note' ? notes.find((x) => x.id === n.note) : null; const nbk = page && nb(page.nb); const fixedH = n.type === 'note' || n.type === 'src'; return html`<div key=${n.id} ref=${n.type === 'learn' ? measure(n) : null} class=${`cv-node ${n.type} ${on ? 'sel' : ''} ${editing === n.id ? 'editing' : ''} ${n.color ? 'tinted' : ''}`} data-id=${n.id} style=${`left:${n.x}px;top:${n.y}px;width:${n.w}px;${fixedH ? 'height' : 'min-height'}:${n.type === 'learn' ? 120 : n.h}px;${n.color ? '--nc:' + n.color : ''}`}>
          ${n.type === 'src' ? html`<${SrcNode} n=${n} />`
          : n.type === 'learn' ? html`<${LearnNode} n=${n} onPatch=${(p) => patchNode(n.id, p)} onStuck=${(focus, label) => stuckOn(n, focus, label)} onRetry=${() => retry(n)} />`
          : n.type === 'text' ? html`<div class="cv-text" contenteditable=${editing === n.id ? 'true' : 'false'} spellcheck="false" ref=${(el) => { if (!el) return; if (editing !== n.id && el.innerHTML !== textHtml(n)) el.innerHTML = textHtml(n); if (editing === n.id && document.activeElement !== el && !el.dataset.f) { el.dataset.f = 1; setTimeout(() => { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, 0); } if (editing !== n.id) delete el.dataset.f; }} onBlur=${(e) => onTextBlur(n, e.target)} onPaste=${(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} onKeyDown=${(e) => { if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); spawn(n.id, e.key === 'Tab'); return; } else if (inlineShortcut(e)) { e.preventDefault(); } e.stopPropagation(); }} data-ph="输入文字…"></div>`
          : page ? html`<div class="cv-nt">${nbk && html`<i class="nb-dot" style=${`background:${nbk.color}`}></i>`}<b>${page.title || '无标题'}</b><a class="cv-open" href=${'#/notes/' + page.id} title="打开页面"><${Icon} name="external" size=${12} /></a></div><p class="cv-snip">${snippetOf(page) || '空白页'}</p>`
          : html`<div class="cv-nt muted"><${Icon} name="note" size=${13} /><b>页面已删除</b></div>`}
          <span class="cv-handle" title="拖到另一个节点来连线"></span>
          <span class="cv-rz"></span>
        </div>`; })}
      </div>
      ${b.nodes.length === 0 && b.strokes.length === 0 && html`<div class="cv-empty"><${Icon} name="frame" size=${22} /><p>双击空白处写字，或从左边把页面拖进来。</p><p class="cv-empty-learn">想学东西：把 PDF / 图片拖进来（或粘贴一段文字），再在下面问汤圆。</p></div>`}
      ${b.nodes.length < 3 && html`<div class="cv-hint">双击写字 · 选中节点后 Tab 加子节点、Enter 加同级（Shift+Enter 换行） · 从圆点拖出连线 · 拖动时自动对齐（按住 Shift 取消） · ⌘+滚轮缩放</div>`}
    </div>
    <${AskBar} target=${sel && sel.kind === 'node' ? node(sel.id) : null} notes=${notes} hasSrc=${b.nodes.some((n) => n.type === 'src')} onAsk=${(q) => ask(q)} onClear=${() => setSel(null)} onUpload=${async () => { const f = await pickFile('application/pdf,image/*'); if (f) addFiles([f]); }} onText=${() => setTextModal(true)} />
    <${Outline} nodes=${b.nodes} onGo=${(id) => { const n = node(id); if (!n) return; const r = vp.current.getBoundingClientRect(); const v = viewRef.current; setView({ ...v, x: r.width / 2 - (n.x + n.w / 2) * v.z, y: 70 - n.y * v.z }); setSel({ kind: 'node', id }); }} />
    ${textModal && html`<${TextModal} onClose=${() => setTextModal(false)} onSave=${(t, name) => { setTextModal(false); addTextSrc(t, name); }} />`}
    ${picker && html`<${PagePicker} notes=${notes} notebooks=${notebooks} onClose=${() => setPicker(false)} onPick=${(id) => { const [cx, cy] = picker.x != null ? [picker.x, picker.y] : center(); addNote(id, cx - 120, cy - 55); setPicker(false); }} />`}
  </div>`;
}

// 下面的「问汤圆」框：选中的节点就是在问的东西；+ 号放材料
function AskBar({ target, notes, hasSrc, onAsk, onClear, onUpload, onText }) {
  const [q, setQ] = useState(''); const ta = useRef();
  const about = target && (target.type === 'src' ? target.name || '材料' : target.type === 'learn' ? target.title || target.q : target.type === 'text' ? (target.text || '').slice(0, 20) : target.type === 'note' ? ((notes.find((x) => x.id === target.note) || {}).title || '页面') : '');
  const send = () => { if (!q.trim()) return; onAsk(q); setQ(''); if (ta.current) ta.current.style.height = ''; };
  return html`<div class="cv-ask" onPointerDown=${(e) => e.stopPropagation()}>
    ${about && html`<div class="cv-ask-ctx"><span>关于：${about}</span><button type="button" title="不针对这个" onClick=${onClear}><${Icon} name="x" size=${11} /></button></div>`}
    <div class="cv-ask-row">
      <button type="button" class="cv-ask-add" title="放材料：PDF / 图片 / 一段文字" onClick=${(e) => ctxMenu(e, [{ label: '上传 PDF / 图片', icon: 'upload', onClick: onUpload }, { label: '粘贴一段文字', icon: 'type', onClick: onText }], '放材料')}><${Icon} name="plus" size=${16} /></button>
      <textarea ref=${ta} rows="1" value=${q} placeholder=${about ? '问汤圆这一块…' : hasSrc ? '问汤圆…' : '问汤圆…（先放一份材料会讲得更准）'} onInput=${(e) => { setQ(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; }} onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}></textarea>
      <button type="button" class="cv-ask-go" title="发送（Enter）" disabled=${!q.trim()} onClick=${send}><${Icon} name="up" size=${16} /></button>
    </div>
  </div>`;
}
// 右边的目录：每块讲解一行，点一下跳过去
function Outline({ nodes, onGo }) {
  const list = nodes.filter((n) => n.type === 'learn').sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const [open, setOpen] = useState(true);
  if (list.length < 2) return null;
  return html`<div class=${'cv-outline ' + (open ? '' : 'closed')} onPointerDown=${(e) => e.stopPropagation()}>
    <button type="button" class="cv-ol-t" onClick=${() => setOpen(!open)}><${Icon} name=${open ? 'down' : 'right'} size=${11} />目录</button>
    ${open && list.map((n) => html`<button type="button" key=${n.id} class="cv-ol-i" onClick=${() => onGo(n.id)}>${n.pending ? '…' : n.title || n.q}</button>`)}
  </div>`;
}
function TextModal({ onClose, onSave }) {
  const [t, setT] = useState(''); const [name, setName] = useState('');
  return html`<${Modal} open=${true} onClose=${onClose} title="粘贴一段文字作为材料" foot=${html`<${Btn} onClick=${onClose}>取消<//><${Btn} kind="primary" disabled=${!t.trim()} onClick=${() => onSave(t.trim(), name.trim())}>放到画布上<//>`}>
    <input type="text" value=${name} placeholder="名字（可选）：比如 第三章 假设检验" onInput=${(e) => setName(e.target.value)} style="margin-bottom:8px" />
    <textarea rows="10" value=${t} autofocus placeholder="把题目、课本段落、论文摘要贴在这里…" onInput=${(e) => setT(e.target.value)}></textarea>
  <//>`;
}

function PagePicker({ notes, notebooks, onClose, onPick }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => { const k = q.trim().toLowerCase(); return sortBy(notes.filter((n) => !k || (n.title + ' ' + n.tags.join(' ')).toLowerCase().includes(k)), '-updated').slice(0, 40); }, [notes, q]);
  return html`<${Modal} open=${true} onClose=${onClose} title="添加页面到画布">
    <div class="searchin" style="margin-bottom:10px"><${Icon} name="search" size=${13} /><input type="text" autofocus value=${q} placeholder="搜索页面…" onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && list[0]) onPick(list[0].id); }} /></div>
    <div class="move-list">${list.length === 0 ? html`<${Empty} icon="note" text="没有匹配的页面。" />` : list.map((n) => { const nb = notebooks.find((b) => b.id === n.nb); return html`<button key=${n.id} class="move-i" onClick=${() => onPick(n.id)}>${nb && html`<i class="nb-dot" style=${`background:${nb.color}`}></i>`}<span class="flex1" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.title || '无标题'}</span><small class="muted">${n.updated.slice(5, 10).replace('-', '/')}</small></button>`; })}</div>
  <//>`;
}

function CanvasList({ canvases }) {
  const list = sortBy(canvases, '-updated');
  const create = async () => { const v = await askPrompt('画布名称', '', { title: '新画布', placeholder: '比如：论文思路 / 项目地图' }); if (v == null) return; const c = newCanvas(v.trim()); go('notes/canvas/' + c.id); };
  return html`<div class="page"><div class="crumbs"><a class="m-back" href="#/notes" title="返回"><${Icon} name="left" size=${16} /></a><a href="#/notes">笔记</a><span>/</span><b>画布</b><span class="flex1"></span><${Btn} small kind="primary" icon="plus" onClick=${create}>新画布<//></div>
    <div class="page-body">
      <div class="cv-grid"><button class="cv-card new" onClick=${create}><${Icon} name="plus" size=${20} /><span>新画布</span><small>白板 · 脑图 · 拖 PDF 进来问汤圆</small></button>${list.map((c) => html`<a key=${c.id} class="cv-card" href=${'#/notes/canvas/' + c.id} onContextMenu=${(e) => ctxMenu(e, canvasMenu(c), c.title || '未命名画布')}>
        <div class="cv-prev"><svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet">${(() => { const bb = bbox(c); if (!bb) return null; const s = Math.min(180 / Math.max(bb.w, 1), 100 / Math.max(bb.h, 1)); const ox = 100 - (bb.x + bb.w / 2) * s, oy = 60 - (bb.y + bb.h / 2) * s; return html`<g transform=${`translate(${ox},${oy}) scale(${s})`}>${c.edges.map((e) => { const a = c.nodes.find((n) => n.id === e.from), b2 = c.nodes.find((n) => n.id === e.to); return a && b2 ? html`<line key=${e.id} x1=${a.x + a.w / 2} y1=${a.y + a.h / 2} x2=${b2.x + b2.w / 2} y2=${b2.y + b2.h / 2} stroke="currentColor" stroke-width=${2 / s} opacity=".4" />` : null; })}${c.nodes.map((n) => html`<rect key=${n.id} x=${n.x} y=${n.y} width=${n.w} height=${n.h} rx=${8 / s} fill=${n.color || 'currentColor'} opacity=${n.color ? '.8' : '.35'} />`)}${c.strokes.map((st) => html`<path key=${st.id} d=${strokePath(st.pts)} fill="none" stroke=${st.color} stroke-width=${st.width / s} stroke-linecap="round" />`)}</g>`; })()}</svg></div>
        <b>${c.title || '未命名画布'}</b><small>${c.nodes.length} 个节点 · ${c.edges.length} 条连线 · ${c.updated.slice(5, 10).replace('-', '/')}</small>
      </a>`)}</div>
    </div></div>`;
}

export function CanvasView({ id, notes, notebooks }) {
  const s = useStore();
  const canvases = s.canvases || [];
  if (!id) return html`<${CanvasList} canvases=${canvases} />`;
  const board = canvases.find((c) => c.id === id);
  if (!board) return html`<div class="notes-empty"><${Empty} icon="frame" text="这块画布不存在了。"><${Btn} small onClick=${() => go('notes/canvas')}>所有画布<//><//></div>`;
  return html`<${Board} key=${board.id} board=${board} notes=${notes} notebooks=${notebooks} />`;
}
