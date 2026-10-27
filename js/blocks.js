// Block model for pages: [{ id, type, html, checked, indent, lang, url }]
// html holds inline content limited to a small whitelist. Markdown is kept as a mirror (note.body)
// so search, backlinks, previews and export keep working on plain text.
import { uid, escapeHtml } from './util.js';
import { FONTS, FONT_IDS } from './fonts.js';

export const TYPES = {
  p: { label: '文本', hint: '普通段落' },
  h1: { label: '标题 1', hint: '大标题' },
  h2: { label: '标题 2', hint: '中标题' },
  h3: { label: '标题 3', hint: '小标题' },
  bullet: { label: '无序列表', hint: '项目符号' },
  number: { label: '有序列表', hint: '编号' },
  todo: { label: '待办', hint: '可勾选' },
  toggle: { label: '折叠', hint: '可展开的标题' },
  quote: { label: '引用', hint: '引述一段话' },
  callout: { label: '标注', hint: '💡 高亮提示' },
  code: { label: '代码', hint: '等宽代码块' },
  divider: { label: '分割线', hint: '水平线' },
  image: { label: '图片', hint: '粘贴图片链接' },
  table: { label: '表格', hint: '3 × 3，可增删行列' },
  file: { label: '文件 / PDF', hint: '附件，PDF 可直接预览' },
  md: { label: 'Markdown', hint: '原始 Markdown' },
  pending: { label: '让汤圆写', hint: '先占个位，汤圆写好了再替换' },
};
export const LIST_TYPES = ['bullet', 'number', 'todo', 'toggle'];
export const TEXT_TYPES = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout'];

export const block = (type = 'p', html = '', extra = {}) => ({ id: uid(), type, html, indent: 0, ...extra });
export const emptyTable = (r = 3, c = 3) => Array.from({ length: r }, () => Array.from({ length: c }, () => ''));
export const cellMd = (h) => inlineHtmlToMd(h).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim();
export function tableToMd(rows, header = true) {
  const w = Math.max(1, ...rows.map((r) => r.length));
  const line = (r) => '| ' + Array.from({ length: w }, (_, i) => cellMd(r[i] || '')).join(' | ') + ' |';
  const body = rows.map(line);
  return header ? [body[0] || line([]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...body.slice(1)].join('\n') : [line(Array(w).fill('')), '| ' + Array(w).fill('---').join(' | ') + ' |', ...body].join('\n');
}
export function mdTable(lines) {
  const split = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  const rows = lines.map(split); let header = false;
  if (rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c))) { rows.splice(1, 1); header = true; }
  const w = Math.max(1, ...rows.map((r) => r.length));
  return block('table', '', { rows: rows.map((r) => Array.from({ length: w }, (_, i) => inlineMdToHtml(r[i] || ''))), header });
}

/* ---------- inline html sanitiser ---------- */
// Keeps a small inline whitelist. Styled spans from Google Docs / Word / web pages are mapped to the
// nearest semantic tag (font-weight:700 → <b>, underline → <u>, background → <mark>) so pasted text
// keeps its formatting without carrying any CSS along.
const ALLOWED = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a', BR: 'br', MARK: 'mark' };
const HL = ['y', 'g', 'b', 'p', 'r'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD']);
function styleWraps(el) {
  const st = el.getAttribute && el.getAttribute('style'); if (!st) return [];
  const cs = el.style; const out = [];
  const fw = cs.fontWeight; if (fw === 'bold' || fw === 'bolder' || (+fw >= 600)) out.push('b');
  if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') out.push('i');
  const td = (cs.textDecorationLine || cs.textDecoration || '') + '';
  if (td.includes('underline')) out.push('u');
  if (td.includes('line-through')) out.push('s');
  const bg = (cs.backgroundColor || '').replace(/\s/g, '');
  if (bg && !/^(transparent|rgba\(0,0,0,0\)|#fff(fff)?|white|rgb\(255,255,255\)|initial|inherit)$/i.test(bg)) out.push('mark');
  return out;
}
function unwrapGoogleUrl(href) {
  const m = href.match(/^https?:\/\/www\.google\.com\/url\?(?:.*&)?q=([^&]+)/i);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return href; } }
  return href;
}
export const TEXT_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
export const TEXT_COLOR_NAMES = { gray: '灰', red: '红', orange: '橙', yellow: '黄', green: '绿', blue: '蓝', purple: '紫', pink: '粉' };
// 荧光笔的九种颜色（y 黄是默认，不带 class）
export const HL_COLORS = ['y', 'o', 'r', 'k', 'p', 'b', 'g', 'n', 'a'];
export const HL_NAMES = { y: '黄', o: '橙', r: '红', k: '粉', p: '紫', b: '蓝', g: '绿', n: '棕', a: '灰' };
export const TEXT_SIZES = [['s', '小'], ['', '标准'], ['l', '大'], ['xl', '特大']];
export const TEXT_FONTS = FONTS.map((f) => [f.id === 'default' ? '' : f.id, f.n]);
const INLINE_RE = /^(tc-(gray|red|orange|yellow|green|blue|purple|pink)|fs-(s|l|xl|[89]|[1-6]\d|7[0-2]))$/;
const INLINE_CLASS = { test: (k) => INLINE_RE.test(k) || (k.startsWith('ff-') && k !== 'ff-default' && FONT_IDS.includes(k.slice(3))) };
const HEX_RE = /^#[0-9a-f]{6}$/i;
export const isSize = (v) => ['s', 'l', 'xl'].includes(v) || /^([89]|[1-6]\d|7[0-2])$/.test(String(v));
export function sanitize(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  const walk = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += escapeHtml(c.nodeValue);
      else if (c.nodeType === 1) {
        if (SKIP.has(c.tagName)) continue;
        let tag = ALLOWED[c.tagName];
        // Google Docs wraps the whole clipboard in <b style="font-weight:normal">
        if (tag === 'b' && /font-weight:\s*(normal|400)/i.test(c.getAttribute('style') || '')) tag = null;
        if (!tag) {
          // 我们自己的行内样式 span：只保留白名单里的 class（文字颜色 tc-*、字号 fs-*、字体 ff-*）
          // 自定义文字颜色：class tcx + data-c="#rrggbb"（只认六位十六进制）
          if (c.tagName === 'SPAN') { const hex = HEX_RE.test(c.dataset.c || '') && c.classList.contains('tcx') ? c.dataset.c.toLowerCase() : ''; const cls = [...c.classList].filter((k) => INLINE_CLASS.test(k) && !(hex && k.startsWith('tc-'))); if (hex) cls.push('tcx'); if (cls.length) { out += `<span class="${cls.join(' ')}"${hex ? ` data-c="${hex}" style="color:${hex}"` : ''}>${walk(c)}</span>`; continue; } }
          // styled span / font: map styles to semantic tags
          const wraps = c.tagName === 'SPAN' || c.tagName === 'FONT' || c.tagName === 'DIV' || c.tagName === 'P' ? styleWraps(c) : [];
          let inner = walk(c);
          for (const w of wraps.reverse()) inner = `<${w}>${inner}</${w}>`;
          out += inner; continue;
        }
        if (tag === 'br') { out += '<br>'; continue; }
        if (tag === 'a') {
          if (c.classList.contains('ref')) { const kind = (c.dataset.kind || '').replace(/[^a-z]/g, ''), id = (c.dataset.id || '').replace(/[^\w-]/g, ''); if (kind && id) { out += `<a class="ref" data-kind="${kind}" data-id="${id}" contenteditable="false">${escapeHtml(c.textContent)}</a>`; continue; } }
          if (c.classList.contains('wiki')) { const title = c.dataset.title || c.textContent; out += `<a class="wiki" data-title="${escapeHtml(title)}" contenteditable="false">${escapeHtml(c.textContent)}</a>`; continue; }
          const href = unwrapGoogleUrl((c.getAttribute('href') || '').trim());
          if (!/^(https?:|mailto:|#)/i.test(href)) { out += walk(c); continue; }
          out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${walk(c)}</a>`; continue;
        }
        if (tag === 'mark') {
          const hex = HEX_RE.test(c.dataset.c || '') ? c.dataset.c.toLowerCase() : '';
          if (hex) { out += `<mark class="hlx${c.classList.contains('hlx-d') ? ' hlx-d' : ''}" data-c="${hex}" style="background-color:${hex}">${walk(c)}</mark>`; continue; }
          const m = (c.className || '').match(/\bhl-([ygbprokna])\b/); out += `<mark${m ? ` class="hl-${m[1]}"` : ''}>${walk(c)}</mark>`; continue;
        }
        if (tag === 'code') { out += `<code>${escapeHtml(c.textContent)}</code>`; continue; }
        out += `<${tag}>${walk(c)}</${tag}>`;
      }
    }
    return out;
  };
  return walk(t.content).replace(/(<br>\s*)+$/, '').replace(/<(b|i|u|s|mark)><\/\1>/g, '');
}

/* ---------- rich html (clipboard / web page) -> blocks ---------- */
// 块级消毒：给 marked 渲染出来的整段 HTML 用（最近删除预览、md 块）。白名单之外的标签只保留文字；属性除了少数几个全丢。
const DOC_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'MARK', 'A', 'IMG', 'INPUT', 'DIV', 'SPAN']);
export function sanitizeDoc(html) {
  const t = document.createElement('template'); t.innerHTML = html || '';
  const walk = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out += escapeHtml(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      if (SKIP.has(c.tagName) || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
      if (!DOC_TAGS.has(c.tagName)) { out += walk(c); continue; }
      const tag = c.tagName.toLowerCase();
      if (tag === 'br' || tag === 'hr') { out += `<${tag}>`; continue; }
      if (tag === 'img') { const src = (c.getAttribute('src') || '').trim(); if (/^(https?:|data:image\/)/i.test(src)) out += `<img src="${escapeHtml(src)}" alt="${escapeHtml(c.getAttribute('alt') || '')}" loading="lazy" referrerpolicy="no-referrer">`; continue; }
      if (tag === 'input') { if ((c.getAttribute('type') || '').toLowerCase() === 'checkbox') out += `<input type="checkbox" disabled${c.hasAttribute('checked') ? ' checked' : ''}>`; continue; }
      if (tag === 'a') { const href = unwrapGoogleUrl((c.getAttribute('href') || '').trim()); const cls = (c.getAttribute('class') || '').match(/\b(ref|wiki)\b/); const attrs = [];
        if (/^(https?:|mailto:|#)/i.test(href)) attrs.push(`href="${escapeHtml(href)}"`); if (cls) attrs.push(`class="${cls[1]}"`); if (/^https?:/i.test(href)) attrs.push('target="_blank" rel="noopener"');
        out += attrs.length ? `<a ${attrs.join(' ')}>${walk(c)}</a>` : walk(c); continue; }
      if (tag === 'code' || tag === 'pre') { out += `<${tag}>${escapeHtml(c.textContent)}</${tag}>`; continue; }
      if (tag === 'mark') { const m = (c.className || '').match(/\bhl-([ygbprokna])\b/); out += `<mark${m ? ` class="hl-${m[1]}"` : ''}>${walk(c)}</mark>`; continue; }
      out += `<${tag}>${walk(c)}</${tag}>`;
    }
    return out;
  };
  return walk(t.content);
}
// 存起来的块在载入 / 导入 / 同步回来时再过一遍消毒，不信任任何来源（编辑器只在写出时消毒，不够）
export function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((b) => b && typeof b === 'object').map((b) => {
    const x = { ...b };
    if (x.type === 'table') { x.rows = Array.isArray(x.rows) ? x.rows.map((r) => (Array.isArray(r) ? r.map((c) => sanitize(String(c ?? ''))) : [])) : []; x.html = ''; if (x.bg && typeof x.bg === 'object') { const ok = {}; Object.entries(x.bg).forEach(([k, v]) => { if (/^\d+,\d+$/.test(k) && ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'].includes(v)) ok[k] = v; }); x.bg = ok; } else delete x.bg; }
    else if (x.type === 'code') { x.html = escapeHtml(textOf(String(x.html ?? ''))).replace(/\n/g, '<br>'); }
    else if (typeof x.html === 'string' && x.html && /[<&]/.test(x.html)) x.html = sanitize(x.html);
    if (typeof x.url === 'string' && x.url && !/^(https?:|data:image\/)/i.test(x.url.trim())) x.url = '';
    if (x.size != null) { x.size = String(x.size); if (!isSize(x.size)) delete x.size; } if (x.color && !TEXT_COLORS.includes(x.color) && !HEX_RE.test(x.color)) delete x.color; if (x.font && (x.font === 'default' || !FONT_IDS.includes(x.font))) delete x.font;
    if (x.type === 'pending') { x.intent = textOf(String(x.intent ?? '')).slice(0, 500); x.error = textOf(String(x.error ?? '')).slice(0, 300); x.html = ''; if (x.status === 'writing') x.status = 'idle'; }
    return x;
  });
}

// 一段解析结果里有多少「结构」：标题、列表、待办、表格（按行算）、代码、引用、分割线。粘贴时用来挑更好的那条解析路径。
export function structureScore(blocks) {
  return (blocks || []).reduce((n, b) => n + (b.type === 'table' ? 2 + (b.rows || []).length : ['h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'code', 'divider', 'toggle', 'callout'].includes(b.type) ? 1 : 0), 0);
}
// 一段只是普通段落、但开头带着 Markdown 记号（- [ ] / - / 1. / # / >）：按记号转成对应的块。
// 从别的编辑器（Claude Docs、聊天窗口）复制出来的 HTML 常常是一堆 div，列表和待办只剩文字记号，这一步把它们找回来。
function promote(h) {
  if (!h || /^\s*</.test(h)) return { type: 'p', html: h };
  let m;
  if ((m = h.match(/^(?:\s|&nbsp;)*(?:[-*+]\s+)?\[( |x|X)\](?:\s|&nbsp;)+/))) return { type: 'todo', html: h.slice(m[0].length), checked: m[1] !== ' ' };
  if ((m = h.match(/^(?:\s|&nbsp;)*[-*•·]\s+/))) return { type: 'bullet', html: h.slice(m[0].length) };
  if ((m = h.match(/^(?:\s|&nbsp;)*\d{1,3}[.)]\s+/))) return { type: 'number', html: h.slice(m[0].length) };
  if ((m = h.match(/^(?:\s|&nbsp;)*(#{1,3})\s+/))) return { type: 'h' + m[1].length, html: h.slice(m[0].length) };
  if ((m = h.match(/^(?:\s|&nbsp;)*&gt;\s+/))) return { type: 'quote', html: h.slice(m[0].length) };
  return { type: 'p', html: h };
}
const checkedOf = (el) => { const a = el.getAttribute && (el.getAttribute('aria-checked') || el.getAttribute('data-checked')); if (a != null) return a === 'true' || a === '1'; const rc = el.querySelector && el.querySelector('[role=checkbox]'); if (rc) { const v = rc.getAttribute('aria-checked') || rc.getAttribute('data-checked'); if (v != null) return v === 'true' || v === '1'; } const cb = el.querySelector && el.querySelector('input[type=checkbox]'); if (cb) return !!cb.checked; return /\b(checked|done|completed)\b/.test(el.className || ''); };
const looksTask = (el) => !!(el.querySelector && el.querySelector(':scope > input[type=checkbox], :scope > * > input[type=checkbox], :scope > [role=checkbox], :scope > * > [role=checkbox]')) || /\b(task|todo|checkbox|check-list|checklist)\b/i.test((el.className || '') + ' ' + (el.getAttribute && el.getAttribute('data-type') || '')) || el.getAttribute && el.getAttribute('aria-checked') != null;
export function htmlToBlocks(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  const out = []; let buf = [];
  const flush = () => { if (!buf.length) return; const h = sanitize(buf.join('')).replace(/^(<br>)+|(<br>)+$/g, '').trim(); buf = []; if (textOf(h).trim() || /<img/.test(h)) { const pr = promote(h); out.push(block(pr.type, pr.html, pr.checked != null ? { checked: pr.checked } : {})); } };
  const inlineOf = (el, skip = (n) => false) => { let h = ''; for (const c of el.childNodes) { if (c.nodeType === 1 && skip(c)) continue; h += c.nodeType === 1 ? c.outerHTML : escapeHtml(c.nodeValue); } return sanitize(h).replace(/^(<br>)+|(<br>)+$/g, '').trim(); };
  const isList = (n) => n.tagName === 'UL' || n.tagName === 'OL';
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'TR', 'BODY', 'HTML', 'IMG', 'FORM', 'CENTER']);
  const hasBlockKids = (el) => [...el.children].some((c) => BLOCK.has(c.tagName));
  const list = (el, indent) => {
    const ordered = el.tagName === 'OL';
    for (const li of el.children) {
      if (li.tagName !== 'LI') { if (isList(li)) list(li, indent + 1); continue; }
      const task = looksTask(li);
      let h = inlineOf(li, (n) => isList(n) || n.tagName === 'INPUT' || (n.getAttribute && n.getAttribute('role') === 'checkbox'));
      let type = task ? 'todo' : ordered ? 'number' : 'bullet'; let checked = task && checkedOf(li);
      const m = h.match(/^(?:\s|&nbsp;)*\[( |x|X)\](?:\s|&nbsp;)+/); if (m) { type = 'todo'; checked = m[1] !== ' '; h = h.slice(m[0].length); }
      if (h || !li.querySelector('ul,ol')) out.push(block(type, h, { indent: Math.min(3, indent), checked }));
      for (const sub of li.children) if (isList(sub)) list(sub, indent + 1);
    }
  };
  const table = (el) => {
    const trs = [...el.querySelectorAll('tr')].filter((tr) => tr.closest('table') === el);
    const rows = trs.map((tr) => [...tr.children].map((td) => sanitize(td.innerHTML).replace(/^(<br>)+|(<br>)+$/g, '').trim()));
    if (!rows.length) return;
    const w = Math.max(...rows.map((r) => r.length));
    const header = !!(trs[0] && [...trs[0].children].every((c) => c.tagName === 'TH'));
    out.push(block('table', '', { rows: rows.map((r) => Array.from({ length: w }, (_, i) => r[i] || '')), header }));
  };
  // div 搭的表格 / 列表（role="table" / "row" / "cell"，role="list" / "listitem"）
  const roleTable = (el) => {
    const rows = [...el.querySelectorAll('[role=row]')].filter((r) => r.closest('[role=table],[role=grid]') === el).map((r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]')].filter((x) => x.closest('[role=row]') === r).map((x) => inlineOf(x)));
    if (!rows.length) return; const w = Math.max(...rows.map((r) => r.length));
    const header = !!el.querySelector('[role=columnheader]');
    out.push(block('table', '', { rows: rows.map((r) => Array.from({ length: w }, (_, i) => r[i] || '')), header }));
  };
  const roleList = (el, indent) => {
    for (const li of el.children) {
      if (li.getAttribute('role') !== 'listitem') { if (li.getAttribute('role') === 'list') roleList(li, indent + 1); continue; }
      const task = looksTask(li); let h = inlineOf(li, (n) => (n.getAttribute && (n.getAttribute('role') === 'list' || n.getAttribute('role') === 'checkbox')) || n.tagName === 'INPUT');
      const pr = task ? { type: 'todo', html: h, checked: checkedOf(li) } : promote(h); if (pr.type === 'p') pr.type = 'bullet';
      out.push(block(pr.type, pr.html, { indent: Math.min(3, indent), checked: !!pr.checked }));
      for (const sub of li.children) if (sub.getAttribute && sub.getAttribute('role') === 'list') roleList(sub, indent + 1);
    }
  };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if (c.nodeValue.trim() || buf.length) buf.push(escapeHtml(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName;
      if (SKIP.has(tag)) continue;
      if (!BLOCK.has(tag) && tag !== 'BR') { if (hasBlockKids(c)) { flush(); walk(c); } else buf.push(c.outerHTML); continue; }
      if (tag === 'BR') { buf.push('<br>'); continue; }
      flush();
      if (/^H[1-6]$/.test(tag)) { const lvl = Math.min(3, +tag[1]); const h = inlineOf(c); if (h) out.push(block('h' + lvl, h)); }
      else if (isList(c)) list(c, 0);
      else if (tag === 'BLOCKQUOTE') { const ps = [...c.children].filter((x) => BLOCK.has(x.tagName)); const h = ps.length ? ps.map((x) => inlineOf(x)).filter(Boolean).join('<br>') : inlineOf(c); if (h) out.push(block('quote', h)); }
      else if (tag === 'PRE') { out.push(block('code', escapeHtml(c.textContent.replace(/\n$/, '')), { lang: ((c.querySelector('code') || c).className.match(/language-([\w+-]+)/) || [])[1] || '' })); }
      else if (tag === 'HR') out.push(block('divider'));
      else if (tag === 'IMG') { const src = c.getAttribute('src') || ''; if (/^(https?:|data:image\/)/.test(src)) out.push(block('image', escapeHtml(c.getAttribute('alt') || ''), { url: src })); }
      else if (tag === 'TABLE') table(c);
      else if (c.getAttribute('role') === 'table' || c.getAttribute('role') === 'grid') roleTable(c);
      else if (c.getAttribute('role') === 'list') roleList(c, 0);
      else if (tag === 'FIGURE') { const img = c.querySelector('img'); if (img) { const src = img.getAttribute('src') || ''; if (/^(https?:|data:image\/)/.test(src)) out.push(block('image', escapeHtml((c.querySelector('figcaption') || {}).textContent || img.getAttribute('alt') || ''), { url: src })); } else walk(c); }
      else if (c.getAttribute('role') === 'listitem' || looksTask(c)) { const task = looksTask(c); const h = inlineOf(c, (n) => n.tagName === 'INPUT' || (n.getAttribute && n.getAttribute('role') === 'checkbox')); const pr = task ? { type: 'todo', html: h, checked: checkedOf(c) } : promote(h); if (pr.type === 'p') pr.type = 'bullet'; if (h) out.push(block(pr.type, pr.html, { checked: !!pr.checked })); }
      else if (hasBlockKids(c)) walk(c);
      else { const h = inlineOf(c); if (h) { const pr = promote(h); out.push(block(pr.type, pr.html, pr.checked != null ? { checked: pr.checked } : {})); } }
    }
  };
  walk(t.content); flush();
  return out;
}

export function textOf(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  return t.content.textContent || '';
}

/* ---------- inline conversions ---------- */
export function inlineMdToHtml(md) {
  // 反斜杠转义的字符先藏起来（\* \_ \` \[ \# \\），最后原样放回
  const esc = []; md = String(md).replace(/\\([\\`*_{}\[\]()#+\-.!~=|>])/g, (_, c) => { esc.push(c); return `\u0000${esc.length - 1}\u0000`; });
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');
  s = s.replace(/\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g, (_, t, a) => `<a class="wiki" data-title="${t.trim()}" contenteditable="false">${a || t.trim()}</a>`);
  s = s.replace(/@\[(todo|book|trip|goal|link):([\w-]+)\|([^\]]+)\]/g, (_, k, id, t) => `<a class="ref" data-kind="${k}" data-id="${id}" contenteditable="false">${t}</a>`);
  s = s.replace(/==(?:\{([ygbprokna])\})?([^=\n]+)==/g, (_, c, t) => `<mark${c ? ` class="hl-${c}"` : ''}>${t}</mark>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^\w*])__([^_\n]+)__(?!\w)/g, '$1<b>$2</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => escapeHtml(esc[+i]));
  return s;
}

export function inlineHtmlToMd(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  const walk = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1) {
        const tag = c.tagName;
        if (tag === 'BR') out += '\n';
        else if (tag === 'B' || tag === 'STRONG') out += `**${walk(c)}**`;
        else if (tag === 'I' || tag === 'EM') out += `*${walk(c)}*`;
        else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') out += `~~${walk(c)}~~`;
        else if (tag === 'CODE') out += `\`${c.textContent}\``;
        else if (tag === 'A' && c.classList.contains('ref')) out += `@[${c.dataset.kind}:${c.dataset.id}|${c.textContent}]`;
        else if (tag === 'MARK') { const m = (c.className || '').match(/\bhl-([ygbprokna])\b/); out += `==${m ? `{${m[1]}}` : ''}${walk(c)}==`; }
        else if (tag === 'U') out += `<u>${walk(c)}</u>`;
        else if (tag === 'A' && c.classList.contains('wiki')) out += `[[${c.dataset.title || c.textContent}]]`;
        else if (tag === 'A') out += `[${walk(c)}](${c.getAttribute('href')})`;
        else out += walk(c);
      }
    }
    return out;
  };
  return walk(t.content);
}

/* ---------- blocks <-> markdown ---------- */
const CALLOUT_ICON = { NOTE: '📝', TIP: '💡', IMPORTANT: '📌', WARNING: '⚠️', CAUTION: '❗' };
export function mdToBlocks(md) {
  const lines = (md || '').replace(/\r/g, '').replace(/^\s*<br\s*\/?>\s*$/gim, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const indent = Math.min(3, Math.floor((raw.match(/^\s*/)[0].length) / 2));
    const line = raw.trim();
    let m;
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const fence = line.slice(0, 3); const lang = line.slice(3).trim().replace(/[{}].*$/, ''); const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++; out.push(block('code', escapeHtml(buf.join('\n')), { lang })); continue;
    }
    if (line.startsWith('|')) {
      const buf = []; while (i < lines.length && lines[i].trim().startsWith('|')) buf.push(lines[i++].trim());
      out.push(mdTable(buf)); continue;
    }
    // 没有首尾竖线的表格：第二行是 --- | --- 这种分隔
    if (line.includes('|') && i + 1 < lines.length && /^\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(lines[i + 1])) {
      const buf = []; while (i < lines.length && lines[i].includes('|')) { const t = lines[i++].trim(); buf.push('| ' + t.replace(/^\|/, '').replace(/\|$/, '') + ' |'); }
      out.push(mdTable(buf)); continue;
    }
    if (!line) { i++; continue; }
    // Setext 标题：下一行是 === 或 ---
    if (i + 1 < lines.length && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(line) && /^(=+|-{3,})\s*$/.test(lines[i + 1].trim())) {
      out.push(block(lines[i + 1].trim().startsWith('=') ? 'h1' : 'h2', inlineMdToHtml(line))); i += 2; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { out.push(block('divider')); i++; continue; }
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)$/))) { out.push(block('image', escapeHtml(m[1]), { url: /^(https?:|data:image\/)/i.test(m[2]) ? m[2] : '' })); i++; continue; }
    if ((m = line.match(/^\[([^\]]*)\]\(ytos-file:\/\/([\w-]+)(?:\|([^)]*))?\)$/))) { const [mime, size] = (m[3] || '').split(','); out.push(block('file', '', { fid: m[2], name: m[1], mime: mime || '', size: +size || 0 })); i++; continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*$/))) { out.push(block('h' + Math.min(3, m[1].length), inlineMdToHtml(m[2]), { indent })); i++; continue; }
    if ((m = line.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/))) { out.push(block('todo', inlineMdToHtml(m[2]), { checked: m[1] !== ' ', indent })); i++; continue; }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) { out.push(block('bullet', inlineMdToHtml(m[1]), { indent })); i++; continue; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { out.push(block('number', inlineMdToHtml(m[1]), { indent })); i++; continue; }
    if ((m = line.match(/^>\s?⏳\s*汤圆待写：(.*)$/))) { out.push(block('pending', '', { intent: m[1].trim(), status: 'idle' })); i++; continue; }
    if ((m = line.match(/^>\s?(💡|⚠️|✅|📌|❗|🔥|📝)\s*(.*)$/))) { out.push(block('callout', inlineMdToHtml(m[2]), { icon: m[1] })); i++; continue; }
    // GitHub 式提示框 > [!NOTE] → 标注块
    if ((m = line.match(/^>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i))) {
      const buf = m[2] ? [m[2]] : []; i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(block('callout', buf.map(inlineMdToHtml).join('<br>'), { icon: CALLOUT_ICON[m[1].toUpperCase()] || '💡' })); continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      const buf = [m[1]]; i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(block('quote', buf.map(inlineMdToHtml).join('<br>'))); continue;
    }
    // paragraph: merge following plain lines until blank / structural
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||!\[|-{3,}$|={3,}$)/.test(lines[i].trim()) && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+/.test(lines[i + 1]))) buf.push(lines[i++].trim());
    out.push(block('p', buf.map(inlineMdToHtml).join('<br>')));
  }
  return out.length ? out : [block('p')];
}

export function blocksToMd(blocks) {
  const lines = [];
  let n = 0;
  blocks.forEach((b, idx) => {
    const pad = '  '.repeat(b.indent || 0);
    const t = inlineHtmlToMd(b.html);
    if (b.type === 'number') { n = idx > 0 && blocks[idx - 1].type === 'number' ? n + 1 : 1; } else n = 0;
    switch (b.type) {
      case 'h1': lines.push(`# ${t}`, ''); break;
      case 'h2': lines.push(`## ${t}`, ''); break;
      case 'h3': lines.push(`### ${t}`, ''); break;
      case 'bullet': lines.push(`${pad}- ${t}`); break;
      case 'toggle': lines.push(`${pad}- ${t}`); break;
      case 'number': lines.push(`${pad}${n}. ${t}`); break;
      case 'todo': lines.push(`${pad}- [${b.checked ? 'x' : ' '}] ${t}`); break;
      case 'quote': lines.push(...t.split('\n').map((l) => `> ${l}`), ''); break;
      case 'callout': lines.push(`> 💡 ${t}`, ''); break;
      case 'code': lines.push('```' + (b.lang || ''), textOf(b.html), '```', ''); break;
      case 'divider': lines.push('---', ''); break;
      case 'image': lines.push(`![${textOf(b.html)}](${b.url || ''})`, ''); break;
      case 'md': lines.push(textOf(b.html), ''); break;
      case 'table': lines.push(tableToMd(b.rows || [], b.header !== false), ''); break;
      case 'file': lines.push(`[${(b.name || '附件').replace(/[\[\]]/g, '')}](ytos-file://${b.fid}|${b.mime || ''},${b.size || 0})`, ''); break;
      case 'pending': lines.push(`> ⏳ 汤圆待写：${String(b.intent || '').replace(/\n/g, ' ')}`, ''); break;
      default: lines.push(t, '');
    }
    const next = blocks[idx + 1];
    if (LIST_TYPES.includes(b.type) && (!next || !LIST_TYPES.includes(next.type))) lines.push('');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function blocksToText(blocks) {
  return blocks.map((b) => (b.type === 'table' ? (b.rows || []).map((r) => r.map(textOf).join(' ')).join('\n') : b.type === 'file' ? (b.name || '') : b.type === 'pending' ? ('汤圆待写：' + (b.intent || '')) : textOf(b.html))).join('\n');
}
