// "学习小卡": renders a page (or a selection of blocks) to a PNG card on a canvas, no libraries.
import { textOf } from './blocks.js';

const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// greedy wrap: CJK breaks anywhere, latin words stay whole
function wrap(ctx, text, max) {
  const lines = []; let line = '';
  const tokens = text.split(/(\s+|(?<=[　-鿿＀-￯])|(?=[　-鿿＀-￯]))/).filter((t) => t !== '');
  for (const t of tokens) {
    const cand = line + t;
    if (ctx.measureText(cand).width <= max || !line) {
      if (ctx.measureText(cand).width > max && !line) { // a single token wider than the line: break by character
        for (const ch of t) { if (ctx.measureText(line + ch).width > max && line) { lines.push(line); line = ''; } line += ch; }
      } else line = cand;
    } else { lines.push(line.replace(/\s+$/, '')); line = t.replace(/^\s+/, ''); }
  }
  if (line.trim()) lines.push(line);
  return lines;
}

export function blockLines(blocks) {
  const out = []; let num = 0;
  for (const b of blocks) {
    if (b.type !== 'number') num = 0;
    const t = b.type === 'table' ? '' : textOf(b.html || '').replace(/\s+/g, ' ').trim();
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': if (t) out.push({ kind: b.type, text: t }); break;
      case 'bullet': case 'toggle': out.push({ kind: 'li', text: t, prefix: '•', indent: b.indent || 0 }); break;
      case 'number': num++; out.push({ kind: 'li', text: t, prefix: num + '.', indent: b.indent || 0 }); break;
      case 'todo': out.push({ kind: 'li', text: t, prefix: b.checked ? '☑' : '☐', indent: b.indent || 0, done: !!b.checked }); break;
      case 'quote': if (t) out.push({ kind: 'quote', text: t }); break;
      case 'callout': if (t) out.push({ kind: 'callout', text: t }); break;
      case 'code': if (t) (b.html || '').split('\n').forEach((l) => out.push({ kind: 'code', text: textOf(l) })); break;
      case 'divider': out.push({ kind: 'hr' }); break;
      case 'table': (b.rows || []).forEach((r, i) => out.push({ kind: i === 0 && b.header !== false ? 'th' : 'td', text: r.map((c) => textOf(c)).join('  ·  ') })); break;
      case 'image': out.push({ kind: 'note', text: '[图片]' }); break;
      case 'file': out.push({ kind: 'note', text: '[附件] ' + (b.name || '') }); break;
      default: if (t) out.push({ kind: 'p', text: t }); else out.push({ kind: 'gap' });
    }
  }
  return out;
}

export function renderCard({ title, sub = '', blocks = [], foot = '', color = '#4f7cf5', dark = false }) {
  const W = 1080, PAD = 72, S = 2; const inner = W - PAD * 2;
  const bg = dark ? '#15171a' : '#f6f4ee', card = dark ? '#1f2228' : '#ffffff', text = dark ? '#ececea' : '#1b1d21', muted = dark ? '#9b9b98' : '#6b7079', line = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const items = blockLines(blocks);
  // ---- measure
  const styles = {
    h1: { size: 40, weight: 700, lh: 1.3, top: 28, bottom: 8 }, h2: { size: 34, weight: 700, lh: 1.3, top: 26, bottom: 6 }, h3: { size: 30, weight: 600, lh: 1.3, top: 20, bottom: 4 },
    p: { size: 27, weight: 400, lh: 1.65, top: 0, bottom: 14 }, li: { size: 27, weight: 400, lh: 1.6, top: 0, bottom: 8 }, quote: { size: 27, weight: 400, lh: 1.6, top: 6, bottom: 16, italic: true },
    callout: { size: 26, weight: 400, lh: 1.6, top: 8, bottom: 18, box: true }, code: { size: 23, weight: 400, lh: 1.55, top: 0, bottom: 2, mono: true }, note: { size: 24, weight: 400, lh: 1.5, top: 0, bottom: 10 },
    th: { size: 25, weight: 600, lh: 1.6, top: 0, bottom: 4 }, td: { size: 25, weight: 400, lh: 1.6, top: 0, bottom: 4 }, hr: { h: 30 }, gap: { h: 14 },
  };
  const font = (st) => `${st.italic ? 'italic ' : ''}${st.weight} ${st.size}px ${st.mono ? MONO : FONT}`;
  const laid = []; let y = 0; let budget = 2600;
  for (const it of items) {
    const st = styles[it.kind] || styles.p;
    if (it.kind === 'hr' || it.kind === 'gap') { laid.push({ it, y, h: st.h }); y += st.h; continue; }
    ctx.font = font(st);
    const indent = (it.indent || 0) * 36 + (it.kind === 'li' ? 40 : it.kind === 'quote' ? 34 : it.kind === 'callout' ? 28 : 0);
    const lines = wrap(ctx, it.text, inner - indent - (it.kind === 'callout' ? 28 : 0));
    const h = lines.length * st.size * st.lh;
    laid.push({ it, st, lines, y: y + st.top, h, indent }); y += st.top + h + st.bottom;
    if (y > budget) { laid.push({ it: { kind: 'more' }, y: y + 6, h: 40 }); y += 46; break; }
  }
  const bodyH = y;
  // ---- title block
  ctx.font = `700 50px ${FONT}`; const tl = wrap(ctx, title || '无标题', inner); const titleH = tl.length * 50 * 1.25;
  const subH = sub ? 34 : 0;
  const H = PAD + 10 + titleH + 14 + subH + 30 + bodyH + 40 + 60 + PAD * 0.8;
  c.width = W * S; c.height = Math.ceil(H * S); ctx.setTransform(S, 0, 0, S, 0, 0);
  // ---- draw
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, color + '33'); g.addColorStop(1, color + '08'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const rr = (x, yy, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, yy); ctx.arcTo(x + w, yy, x + w, yy + h, r); ctx.arcTo(x + w, yy + h, x, yy + h, r); ctx.arcTo(x, yy + h, x, yy, r); ctx.arcTo(x, yy, x + w, yy, r); ctx.closePath(); };
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14; ctx.fillStyle = card; rr(36, 36, W - 72, H - 72, 28); ctx.fill(); ctx.restore();
  ctx.fillStyle = color; rr(36, 36, W - 72, 8, 4); ctx.fill();
  let cy = PAD + 10;
  ctx.fillStyle = text; ctx.textBaseline = 'top'; ctx.font = `700 50px ${FONT}`;
  for (const l of tl) { ctx.fillText(l, PAD, cy); cy += 50 * 1.25; }
  cy += 14;
  if (sub) { ctx.fillStyle = muted; ctx.font = `400 24px ${FONT}`; ctx.fillText(sub, PAD, cy); cy += 34; }
  cy += 30;
  for (const L of laid) {
    const { it, st } = L; const yy = cy + L.y;
    if (it.kind === 'hr') { ctx.fillStyle = line; ctx.fillRect(PAD, yy + 14, inner, 2); continue; }
    if (it.kind === 'gap') continue;
    if (it.kind === 'more') { ctx.fillStyle = muted; ctx.font = `400 24px ${FONT}`; ctx.fillText('…（更多内容见页面）', PAD, yy); continue; }
    const x = PAD + L.indent;
    if (it.kind === 'callout') { ctx.fillStyle = color + '14'; rr(PAD, yy - 10, inner, L.h + 20, 14); ctx.fill(); }
    if (it.kind === 'quote') { ctx.fillStyle = color; ctx.fillRect(PAD + (it.indent || 0) * 36, yy, 4, L.h); }
    if (it.kind === 'code') { ctx.fillStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.045)'; ctx.fillRect(PAD, yy - 1, inner, L.h + 2); }
    ctx.font = font(st); ctx.fillStyle = it.kind === 'quote' || it.kind === 'note' || it.done ? muted : text;
    if (it.kind === 'li') { ctx.fillStyle = it.done ? muted : color; ctx.fillText(it.prefix, x - 40, yy); ctx.fillStyle = it.done ? muted : text; }
    L.lines.forEach((l, i) => ctx.fillText(l, x, yy + i * st.size * st.lh));
    if (it.done) { ctx.strokeStyle = muted; ctx.lineWidth = 2; L.lines.forEach((l, i) => { const w = ctx.measureText(l).width; const ly = yy + i * st.size * st.lh + st.size * 0.55; ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + w, ly); ctx.stroke(); }); }
  }
  ctx.fillStyle = line; ctx.fillRect(PAD, H - PAD * 0.8 - 60, inner, 2);
  ctx.fillStyle = muted; ctx.font = `400 22px ${FONT}`; ctx.fillText(foot, PAD, H - PAD * 0.8 - 36);
  return c;
}

export function exportCardPng(opts, filename = 'card.png') {
  const c = renderCard(opts);
  return new Promise((res) => c.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); res(blob); }, 'image/png'));
}
export async function copyCardPng(opts) {
  const c = renderCard(opts);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
