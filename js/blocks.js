// Block model for pages: [{ id, type, html, checked, indent, lang, url }]
// html holds inline content limited to a small whitelist. Markdown is kept as a mirror (note.body)
// so search, backlinks, previews and export keep working on plain text.
import { uid, escapeHtml } from './util.js';

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
  md: { label: 'Markdown', hint: '原始 Markdown（表格等）' },
};
export const LIST_TYPES = ['bullet', 'number', 'todo', 'toggle'];
export const TEXT_TYPES = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout'];

export const block = (type = 'p', html = '', extra = {}) => ({ id: uid(), type, html, indent: 0, ...extra });

/* ---------- inline html sanitiser ---------- */
const ALLOWED = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a', BR: 'br', MARK: 'mark' };
export function sanitize(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  const walk = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += escapeHtml(c.nodeValue);
      else if (c.nodeType === 1) {
        const tag = ALLOWED[c.tagName];
        if (!tag) { out += walk(c); continue; }
        if (tag === 'br') { out += '<br>'; continue; }
        if (tag === 'a') {
          if (c.classList.contains('ref')) { const kind = (c.dataset.kind || '').replace(/[^a-z]/g, ''), id = (c.dataset.id || '').replace(/[^\w-]/g, ''); if (kind && id) { out += `<a class="ref" data-kind="${kind}" data-id="${id}" contenteditable="false">${escapeHtml(c.textContent)}</a>`; continue; } }
          if (c.classList.contains('wiki')) { const title = c.dataset.title || c.textContent; out += `<a class="wiki" data-title="${escapeHtml(title)}" contenteditable="false">${escapeHtml(c.textContent)}</a>`; continue; }
          const href = (c.getAttribute('href') || '').trim();
          if (!/^(https?:|mailto:|#)/i.test(href)) { out += walk(c); continue; }
          out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${walk(c)}</a>`; continue;
        }
        out += `<${tag}>${walk(c)}</${tag}>`;
      }
    }
    return out;
  };
  return walk(t.content).replace(/(<br>\s*)+$/, '');
}

export function textOf(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  return t.content.textContent || '';
}

/* ---------- inline conversions ---------- */
export function inlineMdToHtml(md) {
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g, (_, t, a) => `<a class="wiki" data-title="${t.trim()}" contenteditable="false">${a || t.trim()}</a>`);
  s = s.replace(/@\[(todo|book|trip|goal|link):([\w-]+)\|([^\]]+)\]/g, (_, k, id, t) => `<a class="ref" data-kind="${k}" data-id="${id}" contenteditable="false">${t}</a>`);
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
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
        else if (tag === 'MARK') out += `==${walk(c)}==`;
        else if (tag === 'U') out += walk(c);
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
export function mdToBlocks(md) {
  const lines = (md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const indent = Math.min(3, Math.floor((raw.match(/^\s*/)[0].length) / 2));
    const line = raw.trim();
    let m;
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim(); const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++; out.push(block('code', escapeHtml(buf.join('\n')), { lang })); continue;
    }
    if (line.startsWith('|')) {
      const buf = []; while (i < lines.length && lines[i].trim().startsWith('|')) buf.push(lines[i++].trim());
      out.push(block('md', escapeHtml(buf.join('\n')))); continue;
    }
    if (!line) { i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { out.push(block('divider')); i++; continue; }
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/))) { out.push(block('image', escapeHtml(m[1]), { url: m[2] })); i++; continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { out.push(block('h' + m[1].length, inlineMdToHtml(m[2]), { indent })); i++; continue; }
    if ((m = line.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/))) { out.push(block('todo', inlineMdToHtml(m[2]), { checked: m[1] !== ' ', indent })); i++; continue; }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) { out.push(block('bullet', inlineMdToHtml(m[1]), { indent })); i++; continue; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { out.push(block('number', inlineMdToHtml(m[1]), { indent })); i++; continue; }
    if ((m = line.match(/^>\s?(💡|⚠️|✅|📌|❗|🔥|📝)\s*(.*)$/))) { out.push(block('callout', inlineMdToHtml(m[2]), { icon: m[1] })); i++; continue; }
    if ((m = line.match(/^>\s?(.*)$/))) {
      const buf = [m[1]]; i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(block('quote', buf.map(inlineMdToHtml).join('<br>'))); continue;
    }
    // paragraph: merge following plain lines until blank / structural
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*+]\s|\d+[.)]\s|>|```|\||!\[|-{3,}$)/.test(lines[i].trim())) buf.push(lines[i++].trim());
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
      default: lines.push(t, '');
    }
    const next = blocks[idx + 1];
    if (LIST_TYPES.includes(b.type) && (!next || !LIST_TYPES.includes(next.type))) lines.push('');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function blocksToText(blocks) {
  return blocks.map((b) => textOf(b.html)).join('\n');
}
