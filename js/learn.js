// 学习画布：把要学的东西（PDF / 图片 / 一段文字）放上画布，在下面的框里问汤圆，
// 汤圆回一块「讲解面板」（讲解 / 公式 / 分步 / 小测验），哪一步不懂就从那一步再分叉出去讲。全部存在画布里，会同步。
// 节点：{ type: 'src', kind: 'pdf'|'image'|'text', fid?, name, text? }  { type: 'learn', q, title, reply, cards, src, mode, picks, pending, error }
import { html, useState, useEffect, useRef } from '../vendor/preact.js';
import { marked } from '../vendor/marked.js';
import { sanitizeDoc } from './blocks.js';
import { getFile, fileUrl, kvGet, kvSet } from './files.js';
import { fetchAttachment, loginState } from './sync.js';
import { aiEnabled, aiHeaders, recordUsage, aiConfig } from './ai.js';
import { todayStr, escapeHtml as esc } from './util.js';
import { Icon } from './ui.js';
import { canSpeak, speak, speakable, stopSpeak } from './voice.js';
import { Figure } from './figure.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;

/* ---------- 公式：KaTeX 用到时才加载 ---------- */
let katexP = null;
export function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexP) return katexP;
  katexP = new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = VENDOR + 'katex/katex.min.css'; document.head.appendChild(l);
    const sc = document.createElement('script'); sc.src = VENDOR + 'katex/katex.min.js'; sc.onload = () => res(window.katex); sc.onerror = () => { katexP = null; rej(new Error('公式组件加载失败')); }; document.head.appendChild(sc);
  });
  return katexP;
}
const tex = (s, display) => {
  const k = window.katex; if (!k) return `<code>${esc(s)}</code>`;
  try { return k.renderToString(s, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' }); } catch { return `<code>${esc(s)}</code>`; }
};
// Markdown + 公式：先把 $...$ / $$...$$ 换成占位符（私用区字符，Markdown 和消毒都不会动它），Markdown 渲染并消毒后再换回 KaTeX 的结果（KaTeX 自己会转义）
export function richHtml(md, inline = false) {
  const maths = [];
  const src = String(md || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => { maths.push([m, true]); return `\uE000${maths.length - 1}\uE001`; })
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => { maths.push([m, true]); return `\uE000${maths.length - 1}\uE001`; })
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => { maths.push([m, false]); return `\uE000${maths.length - 1}\uE001`; })
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, m) => { maths.push([m, false]); return `${pre}\uE000${maths.length - 1}\uE001`; })
    // ==重点== 圈出来：先换成占位符，消毒之后再变成带红圈的 span
    .replace(/==([^=\n]{1,60})==/g, (_, m) => `\uE002${encodeURIComponent(m)}\uE003`);
  let out = sanitizeDoc(inline ? marked.parseInline(src) : marked.parse(src));
  out = out.replace(/\uE002([^\uE003]*)\uE003/g, (_, m) => `<span class="lr-circ">${esc(decodeURIComponent(m))}</span>`);
  out = out.replace(/\uE000(\d+)\uE001/g, (_, i) => tex(maths[i][0], maths[i][1]));
  return out;
}
export function useKatex() { const [, set] = useState(!!window.katex); useEffect(() => { if (!window.katex) loadKatex().then(() => set(true)).catch(() => {}); }, []); }
export const Rich = ({ md, inline, class: cls = '' }) => (inline ? html`<span class=${'lr-md ' + cls} dangerouslySetInnerHTML=${{ __html: richHtml(md, true) }}></span>` : html`<div class=${'lr-md ' + cls} dangerouslySetInnerHTML=${{ __html: richHtml(md) }}></div>`);

/* ---------- PDF：pdf.js 用到时才加载 ---------- */
let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import(VENDOR + 'pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs'; return m; }).catch((e) => { pdfjsP = null; throw e; });
  return pdfjsP;
}
// 这台设备没有这个附件（别的设备传的）就先从云端取
export async function fileBlob(fid, meta = {}) {
  let r = await getFile(fid); if (!r) r = await fetchAttachment(fid, meta);
  return r ? r.blob : null;
}
const docs = new Map();
export function pdfDoc(fid, name) {
  if (!docs.has(fid)) docs.set(fid, (async () => { const blob = await fileBlob(fid, { name, mime: 'application/pdf' }); if (!blob) throw new Error('这台设备上还没有这个文件'); const pdfjs = await loadPdfjs(); return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise; })().catch((e) => { docs.delete(fid); throw e; }));
  return docs.get(fid);
}
// 每页的文字，抽一次存在本机（不进同步数据，PDF 文字可能很长）
export async function pdfPages(fid, name) {
  const key = 'pdftext:' + fid; const cached = await kvGet(key); if (Array.isArray(cached)) return cached;
  const doc = await pdfDoc(fid, name); const pages = [];
  for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); const tc = await p.getTextContent(); pages.push(tc.items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join('').replace(/[ \t]+/g, ' ').trim()); }
  await kvSet(key, pages); return pages;
}
// 材料太长时挑和问题最相关的几页（按字词重叠打分，「第 N 页」直接带上），总长不超过 limit
export function pickPages(pages, q, limit = 15000) {
  const all = pages.map((t, i) => `【第 ${i + 1} 页】\n${t}`);
  if (all.join('\n\n').length <= limit) return all.join('\n\n');
  const want = new Set(); for (const m of String(q).matchAll(/第\s*(\d+)\s*页|p(?:age)?\.?\s*(\d+)/gi)) want.add(+(m[1] || m[2]) - 1);
  const terms = [...new Set((String(q).toLowerCase().match(/[a-z][a-z0-9-]{2,}|[一-鿿]{2}/g) || []))];
  const score = pages.map((t, i) => { const low = t.toLowerCase(); let s = want.has(i) ? 1e6 : 0; for (const w of terms) { const n = low.split(w).length - 1; s += Math.min(n, 8); } return [s - i * 0.01, i]; });
  score.sort((a, b) => b[0] - a[0]);
  const keep = []; let len = 0; for (const [, i] of [[0, 0], ...score]) { if (keep.includes(i)) continue; if (len + all[i].length > limit && keep.length) continue; keep.push(i); len += all[i].length; if (len > limit * 0.95) break; }
  return keep.sort((a, b) => a - b).map((i) => all[i]).join('\n\n') + `\n\n（材料共 ${pages.length} 页，这里只选了和问题相关的几页）`;
}

// 一页 PDF：进到视野里才画，宽度跟着节点
function PdfPage({ doc, num, width, anns }) {
  const ref = useRef(); const [h, setH] = useState(width * 1.3);
  useEffect(() => {
    let alive = true, task = null, drawn = 0;
    const el = ref.current; if (!el) return;
    const draw = async () => {
      if (drawn === width) return; drawn = width;
      const p = await doc.getPage(num); if (!alive) return;
      const vp1 = p.getViewport({ scale: 1 }); const scale = width / vp1.width; const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = p.getViewport({ scale: scale * dpr }); setH(vp1.height * scale);
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = '100%';
      task = p.render({ canvasContext: c.getContext('2d'), viewport: vp }); await task.promise.catch(() => {}); if (!alive) return;
      el.replaceChildren(c);
    };
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) draw(); }, { rootMargin: '400px' }); io.observe(el);
    return () => { alive = false; io.disconnect(); try { task && task.cancel(); } catch {} };
  }, [doc, num, width]);
  // 圈出来的原文：位置按页面比例存，所以不管画多宽都对得上
  return html`<div class="lr-page" style=${`height:${Math.round(h)}px`} data-page=${num}><div class="lr-page-c" ref=${ref}></div><span class="lr-pn">${num}</span>
    ${(anns || []).map((a) => html`<i key=${a.k} class=${'lr-ann ' + (a.on ? 'on' : '')} data-k=${a.k} style=${`left:${(a.rx * 100).toFixed(2)}%;top:${(a.ry * 100).toFixed(2)}%;width:${(a.rw * 100).toFixed(2)}%;height:${(a.rh * 100).toFixed(2)}%`}>${a.label && html`<b>${a.label}</b>`}</i>`)}
  </div>`;
}
export function PdfView({ fid, name, width, anns }) {
  const [st, setSt] = useState({ doc: null, err: '' });
  useEffect(() => { let alive = true; pdfDoc(fid, name).then((doc) => alive && setSt({ doc, err: '' })).catch((e) => alive && setSt({ doc: null, err: e.message || '打不开这个 PDF' })); return () => { alive = false; }; }, [fid]);
  if (st.err) return html`<div class="lr-msg">${st.err}</div>`;
  if (!st.doc) return html`<div class="lr-msg">正在打开 PDF…</div>`;
  const w = Math.max(160, Math.round(width - 24));
  return html`<div class="lr-pages">${Array.from({ length: st.doc.numPages }, (_, i) => html`<${PdfPage} key=${i} doc=${st.doc} num=${i + 1} width=${w} anns=${(anns || []).filter((a) => a.page === i)} />`)}</div>`;
}
function ImageView({ fid, name }) {
  const [u, setU] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { let alive = true; (async () => { let url = await fileUrl(fid); if (!url) { const r = await fetchAttachment(fid, { name }); if (r) url = await fileUrl(fid); } if (!alive) return; if (url) setU(url); else setErr('这台设备上还没有这张图'); })(); return () => { alive = false; }; }, [fid]);
  return err ? html`<div class="lr-msg">${err}</div>` : u ? html`<img class="lr-img" src=${u} alt=${name || ''} draggable="false" />` : html`<div class="lr-msg">正在加载…</div>`;
}
// 文字材料里圈出来的原文
function TextBody({ text, anns }) {
  const marks = (anns || []).filter((a) => a.text); if (!marks.length) return html`<div class="lr-text">${text || ''}</div>`;
  const parts = []; let rest = String(text || ''), guard = 0;
  while (rest && guard++ < 50) {
    let best = null; for (const a of marks) { const i = rest.indexOf(a.text); if (i >= 0 && (!best || i < best.i)) best = { i, a }; }
    if (!best) { parts.push(rest); break; }
    parts.push(rest.slice(0, best.i)); parts.push(html`<mark class=${'lr-ann-t ' + (best.a.on ? 'on' : '')} data-k=${best.a.k}>${best.a.text}</mark>`); rest = rest.slice(best.i + best.a.text.length);
  }
  return html`<div class="lr-text">${parts}</div>`;
}
// anns：讲解面板圈出来的原文 [{ k, page, rx, ry, rw, rh, label, text, on }]
export function SrcNode({ n, anns }) {
  const body = useRef();
  // 点面板上的「原文」：滚到那一处，圈闪一下
  useEffect(() => {
    const h = (e) => { const el = body.current && body.current.querySelector(`[data-k="${e.detail.k}"]`); if (!el) return; const box = body.current; const r = el.getBoundingClientRect(), br = box.getBoundingClientRect(); box.scrollTo({ top: box.scrollTop + r.top - br.top - box.clientHeight / 3, behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
    const on = (e) => { if (e.detail.src === n.id) h(e); }; window.addEventListener('lr:goto', on); return () => window.removeEventListener('lr:goto', on);
  }, [n.id]);
  const icon = n.kind === 'pdf' ? 'note' : n.kind === 'image' ? 'image' : 'type';
  return html`<div class="lr-src">
    <div class="lr-src-h"><${Icon} name=${icon} size=${13} /><b title=${n.name}>${n.name || (n.kind === 'text' ? '一段文字' : '材料')}</b><span class="lr-k">材料</span></div>
    <div class="lr-src-b cv-scroll" ref=${body}>${n.kind === 'pdf' ? html`<${PdfView} fid=${n.fid} name=${n.name} width=${n.w} anns=${anns} />` : n.kind === 'image' ? html`<${ImageView} fid=${n.fid} name=${n.name} />` : html`<${TextBody} text=${n.text} anns=${anns} />`}</div>
  </div>`;
}
// 汤圆给的原文引用 → 在材料里找到位置（PDF：文字层里的坐标；文字材料：原文本身）
const norm = (t) => String(t || '').toLowerCase().replace(/[\s\u200b]+/g, '').replace(/[“”"']/g, '');
const pageItems = new Map();
async function itemsOf(fid, name, i) {
  const key = fid + ':' + i; if (pageItems.has(key)) return pageItems.get(key);
  const doc = await pdfDoc(fid, name); const p = await doc.getPage(i + 1); const vp = p.getViewport({ scale: 1 }); const tc = await p.getTextContent();
  let str = ''; const owner = [];
  tc.items.forEach((it, j) => { for (const ch of it.str || '') { const c = norm(ch); if (!c) continue; str += c; owner.push(j); } });
  const out = { vp, items: tc.items, str, owner }; pageItems.set(key, out); return out;
}
export async function locateQuotes(src, quotes) {
  if (!src || !Array.isArray(quotes) || !quotes.length) return [];
  if (src.kind === 'text') return quotes.filter((q) => String(src.text || '').includes(q.text)).map((q) => ({ text: q.text, label: q.label || '' }));
  if (src.kind !== 'pdf') return [];
  const out = []; let doc; try { doc = await pdfDoc(src.fid, src.name); } catch { return []; }
  for (const q of quotes) {
    const nq = norm(q.text); if (nq.length < 4) continue;
    let hit = null;
    for (let i = 0; i < doc.numPages && !hit; i++) {
      const P = await itemsOf(src.fid, src.name, i);
      // 先找整句，找不到就找最长的开头（至少 8 个字）
      let at = P.str.indexOf(nq), len = nq.length;
      if (at < 0) for (let L = Math.min(nq.length - 1, 40); L >= 8 && at < 0; L -= 4) { at = P.str.indexOf(nq.slice(0, L)); len = L; }
      if (at < 0) continue;
      const idx = [...new Set(P.owner.slice(at, at + len))]; let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const j of idx) { const it = P.items[j]; const [, , c, d, e, f] = it.transform; const fh = Math.hypot(c, d) || it.height || 10; const r = P.vp.convertToViewportRectangle([e, f - fh * 0.25, e + (it.width || fh), f + fh * 0.85]); x1 = Math.min(x1, r[0], r[2]); x2 = Math.max(x2, r[0], r[2]); y1 = Math.min(y1, r[1], r[3]); y2 = Math.max(y2, r[1], r[3]); }
      const W = P.vp.width, H = P.vp.height, padX = 6, padY = 4;
      hit = { page: i, rx: Math.max(0, (x1 - padX) / W), ry: Math.max(0, (y1 - padY) / H), rw: Math.min(1, (x2 - x1 + padX * 2) / W), rh: Math.min(1, (y2 - y1 + padY * 2) / H), label: q.label || '', text: q.text };
    }
    if (hit) out.push(hit);
  }
  return out;
}
export const gotoQuote = (srcId, k) => window.dispatchEvent(new CustomEvent('lr:goto', { detail: { src: srcId, k } }));

/* ---------- 讲解面板 ---------- */
function StepsCard({ c, mode, onStuck }) {
  const [open, setOpen] = useState({}); // i → 'hint' | 'detail'
  const tog = (i, what) => setOpen((o) => ({ ...o, [i]: o[i] === what ? null : what }));
  return html`<ol class="lr-steps">${c.steps.map((s, i) => { const show = mode === 'answer' ? 'detail' : open[i]; return html`<li key=${i} class=${show ? 'open' : ''}>
    <div class="lr-st-h"><span class="lr-st-n">${i + 1}</span><${Rich} md=${s.title} inline=${true} class="lr-st-t" /></div>
    ${show === 'hint' && s.hint && html`<div class="lr-hint"><${Icon} name="sparkle" size=${11} /><${Rich} md=${s.hint} inline=${true} /></div>`}
    ${show === 'detail' && html`<${Rich} md=${s.detail || s.hint || ''} class="lr-detail" />`}
    <div class="lr-st-a">
      ${mode !== 'answer' && s.hint && html`<button type="button" class=${show === 'hint' ? 'on' : ''} onClick=${() => tog(i, 'hint')}>提示</button>`}
      ${mode !== 'answer' && html`<button type="button" class=${show === 'detail' ? 'on' : ''} onClick=${() => tog(i, 'detail')}>${show === 'detail' ? '收起' : '看这一步'}</button>`}
      <button type="button" class="lr-stuck" onClick=${() => onStuck(`第 ${i + 1} 步：${s.title}\n${s.detail || ''}`, s.title)}>这步不懂</button>
    </div>
  </li>`; })}</ol>`;
}
function CheckCard({ c, picked, onPick }) {
  const done = picked != null;
  return html`<div class="lr-check">
    <div class="lr-ck-k"><${Icon} name=${done ? (picked === c.answer ? 'check' : 'x') : 'target'} size=${12} />${done ? (picked === c.answer ? '答对了' : '再想想') : '小测验'}</div>
    <${Rich} md=${c.question} class="lr-ck-q" />
    <div class="lr-opts">${c.options.map((o, i) => html`<button type="button" key=${i} class=${'lr-opt ' + (done && i === c.answer ? 'right ' : '') + (done && i === picked && i !== c.answer ? 'wrong' : '')} disabled=${done} onClick=${() => onPick(i)}><b>${'ABCDE'[i]}</b><${Rich} md=${o} inline=${true} /></button>`)}</div>
    ${done && c.explain && html`<${Rich} md=${c.explain} class="lr-ck-x" />`}
    ${done && html`<button type="button" class="lr-ck-again" onClick=${() => onPick(null)}>重做</button>`}
  </div>`;
}
// 朗读的内容：提示模式只读每一步做什么和提示，答案模式连做法一起读
function panelSpeech(n, mode) {
  const out = [n.title || ''];
  for (const c of n.cards || []) {
    if (c.title) out.push(c.title + '。');
    if (c.latex) out.push('$$' + c.latex + '$$');
    if (c.body) out.push(c.body);
    if (c.steps) c.steps.forEach((x, i) => out.push(`第 ${i + 1} 步，${x.title}。` + (mode === 'answer' ? (x.detail || '') : x.hint ? '提示：' + x.hint : '')));
    if (c.question) out.push('小测验：' + c.question + ' ' + (c.options || []).map((o, i) => `${'ABCDE'[i]}，${o}`).join('。'));
  }
  return speakable(out.join('\n'));
}
function SpeakBtn({ n, mode }) {
  const [on, setOn] = useState(false); const stopRef = useRef(null);
  useEffect(() => () => { if (stopRef.current) stopSpeak(); }, []);
  if (!canSpeak()) return null;
  const go = () => { if (on) { stopSpeak(); setOn(false); stopRef.current = null; return; } setOn(true); stopRef.current = speak(panelSpeech(n, mode), { onEnd: () => { setOn(false); stopRef.current = null; } }); };
  return html`<button type="button" class=${'lr-say ' + (on ? 'on' : '')} title=${on ? '停止朗读' : '读给我听'} onClick=${go}><${Icon} name=${on ? 'pause' : 'play'} size=${12} /></button>`;
}
export function LearnNode({ n, onPatch, onStuck, onRetry }) {
  useKatex();
  const mode = n.mode || 'hint';
  if (n.pending) return html`<div class="lr-panel"><div class="lr-q"><${Icon} name="chat" size=${12} />${n.q}</div><div class="lr-wait"><i></i><i></i><i></i><span>${n.status || '汤圆在看材料…'}</span></div></div>`;
  if (n.error) return html`<div class="lr-panel"><div class="lr-q"><${Icon} name="chat" size=${12} />${n.q}</div><div class="lr-err">${n.error}</div><button type="button" class="btn sm" onClick=${onRetry}>再问一次</button></div>`;
  const cards = n.cards || [];
  return html`<div class="lr-panel">
    <div class="lr-q"><${Icon} name="chat" size=${12} /><${Rich} md=${n.q} inline=${true} /></div>
    <div class="lr-h"><b>${n.title || '讲解'}</b><${SpeakBtn} n=${n} mode=${mode} />${cards.some((c) => c.type === 'steps') && html`<div class="lr-mode"><button type="button" class=${mode === 'hint' ? 'on' : ''} onClick=${() => onPatch({ mode: 'hint' })}>提示</button><button type="button" class=${mode === 'answer' ? 'on' : ''} onClick=${() => onPatch({ mode: 'answer' })}>答案</button></div>`}</div>
    ${(n.anns || []).length > 0 && html`<div class="lr-quotes">${n.anns.map((a, i) => html`<button type="button" key=${i} class="lr-qchip" title=${a.text} onClick=${() => gotoQuote(n.src, n.id + ':' + i)}><span class="lr-qdot"></span>原文${a.page != null ? ` · 第 ${a.page + 1} 页` : ''}${a.label ? ' · ' + a.label : ''}</button>`)}</div>`}
    ${cards.map((c, i) => html`<div key=${i} class=${'lr-card ' + c.type}>
      ${c.title && c.type !== 'check' && html`<div class="lr-ct">${c.type === 'tip' && html`<${Icon} name="sparkle" size=${12} />`}${c.title}</div>`}
      ${c.type === 'formula' && html`<div class="lr-formula" dangerouslySetInnerHTML=${{ __html: tex(c.latex || '', true) }}></div>`}
      ${c.type === 'figure' && html`<${Figure} spec=${c.figure} />`}
      ${(c.type === 'text' || c.type === 'tip' || c.type === 'formula' || c.type === 'figure') && c.body && html`<${Rich} md=${c.body} />`}
      ${c.type === 'steps' && html`<${StepsCard} c=${c} mode=${mode} onStuck=${onStuck} />`}
      ${c.type === 'check' && html`<${CheckCard} c=${c} picked=${(n.picks || {})[i]} onPick=${(v) => onPatch({ picks: { ...(n.picks || {}), [i]: v } })} />`}
      ${(c.type === 'text' || c.type === 'formula') && html`<button type="button" class="lr-stuck lr-card-stuck" onClick=${() => onStuck((c.title ? c.title + '\n' : '') + (c.latex || '') + '\n' + (c.body || ''), c.title || '这一段')}>这段不懂</button>`}
    </div>`)}
  </div>`;
}

/* ---------- 问汤圆 ---------- */
// 一块面板的纯文字摘要：给下一个问题当「之前讲过的」
export function panelText(n) {
  const parts = [`【${n.title || ''}】问：${n.q || ''}`];
  for (const c of n.cards || []) {
    if (c.title) parts.push(c.title);
    if (c.body) parts.push(c.body.slice(0, 400));
    if (c.latex) parts.push('$$' + c.latex + '$$');
    if (c.steps) parts.push(c.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'));
    if (c.question) parts.push('小测验：' + c.question);
  }
  return parts.join('\n');
}
async function imagePayload(blob) {
  const file = blob instanceof File ? blob : new File([blob], 'image', { type: blob.type || 'image/png' });
  const { imageToDataUrl } = await import('./util.js');
  const url = await imageToDataUrl(file, 1600, 0.85); const m = url.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return m ? { type: m[1], data: m[2] } : null;
}
// 材料：src 节点 → 文字（PDF 抽文字、文字直接用）或图片
// 现在用的 AI 能不能直接看图（Claude 能，DeepSeek 不能）
export function canSeeImages() {
  const c = aiConfig(); const login = loginState() || {};
  return c.provider === 'anthropic' || (c.provider === 'server' && /claude/i.test(login.aiModel || ''));
}
// PDF 第 i 页（0 开始）画成一张够清楚的图，给文字识别用
async function pageCanvas(fid, name, i) {
  const doc = await pdfDoc(fid, name); const p = await doc.getPage(i + 1);
  const vp1 = p.getViewport({ scale: 1 }); const vp = p.getViewport({ scale: Math.min(2.5, 1800 / vp1.width) });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: g, viewport: vp }).promise; return c;
}
const OCR_PAGES = 8;
// 材料：src 节点 → 文字（PDF 抽文字；扫描件和图片在本机识别文字）或图片（AI 能看图时直接给图）
export async function materialOf(src, q, onStatus) {
  if (!src) return {};
  if (src.kind === 'text') return { materialName: src.name || '一段文字', material: String(src.text || '').slice(0, 16000) };
  if (src.kind === 'pdf') {
    const pages = await pdfPages(src.fid, src.name);
    if (pages.join('').trim().length >= 20) return { materialName: src.name, material: pickPages(pages, q) };
    // 扫描件：识别问到的那几页（「第 N 页」），没说就先认前几页；认过的页存着，下次不用再认
    const want = [...String(q).matchAll(/第\s*(\d+)\s*页|p(?:age)?\.?\s*(\d+)/gi)].map((m) => +(m[1] || m[2]) - 1).filter((i) => i >= 0 && i < pages.length);
    const idx = [...new Set([...want, ...Array.from({ length: Math.min(OCR_PAGES, pages.length) }, (_, i) => i)])].slice(0, OCR_PAGES + want.length);
    const { ocrPdfPages } = await import('./ocr.js');
    const got = await ocrPdfPages(src.fid, idx, (i) => pageCanvas(src.fid, src.name, i), onStatus);
    const text = pages.map((_, i) => got[i] || '');
    if (text.join('').trim().length < 10) return { materialName: src.name, material: '', scanned: true };
    const note = pages.length > idx.length ? `\n\n（这是扫描版，只识别了第 ${idx.map((i) => i + 1).join('、')} 页；要问别的页可以说「第几页」）` : '';
    return { materialName: src.name + '（扫描版，文字是自动识别的，可能有错字）', material: pickPages(text.map((t, i) => (got[i] != null ? t : '')), q) + note };
  }
  if (src.kind === 'image') {
    const blob = await fileBlob(src.fid, { name: src.name }); if (!blob) return { materialName: src.name || '图片' };
    if (canSeeImages()) return { materialName: src.name || '图片', image: await imagePayload(blob) };
    const key = 'imgocr:' + src.fid; let text = await kvGet(key);
    if (typeof text !== 'string') {
      onStatus && onStatus('正在识别图片里的文字…');
      const { ocrImage } = await import('./ocr.js');
      text = await ocrImage(blob, (p) => onStatus && onStatus(`正在识别图片里的文字 ${Math.round(p * 100)}%`)); await kvSet(key, text);
    }
    if (!text.trim()) return { materialName: src.name, material: '', scanned: true };
    return { materialName: (src.name || '图片') + '（图片里的文字是自动识别的，公式和符号可能认错）', material: text.slice(0, 16000) };
  }
  return {};
}
export async function askLearn({ q, src, prior, focus, onStatus }) {
  if (!aiEnabled(loginState())) throw new Error('登录并打开 AI 之后，汤圆才能讲解（设置 → 汤圆 → AI）');
  const m = await materialOf(src, q + ' ' + (focus || ''), onStatus);
  if (m.scanned) throw new Error(src && src.kind === 'image' ? '这张图里没认出文字。可以换一张清楚点的，或者把题目打字发给汤圆' : '这份 PDF 里没认出文字（可能太模糊）。可以截一张清楚的图拖进来，或者把题目打字发给汤圆');
  onStatus && onStatus('汤圆在看材料…');
  const now = new Date();
  const resp = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(120000), body: JSON.stringify({ mode: 'learn', text: q, image: m.image || undefined, context: { today: todayStr(), weekday: '', now: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`, materialName: m.materialName || '', material: m.material || '', prior: prior || '', focus: focus || '' } }) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j.error || (resp.status === 413 ? '图片太大了，换一张小一点的' : `出错了（${resp.status}）`));
  recordUsage(j);
  return { title: j.title, reply: j.reply, cards: j.cards || [], quotes: j.quotes || [] };
}
