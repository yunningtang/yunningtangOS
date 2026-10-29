// 讲解面板里的「图」：AI 给一个小小的 JSON 说明画什么，这里自己画成 SVG（不让 AI 直接写网页代码）。
// kind：numberline 数轴 / bars 柱状图 / normal 正态分布 / line 折线 / flow 流程；都不合适时 svg（消毒后显示）
import { html } from '../vendor/preact.js';

const W = 340, H = 170, PAD = 28;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const fmt = (v) => { const a = Math.abs(v); return a >= 1000 || a === 0 ? String(Math.round(v)) : String(+v.toPrecision(3)); };
const ticks = (min, max, n = 5) => { const step = (max - min) / n; const p = 10 ** Math.floor(Math.log10(step)); const s = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= step) || step; const out = []; for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) out.push(+v.toFixed(10)); return out; };
const lbl = (s) => String(s == null ? '' : s).slice(0, 24);

function NumberLine({ f }) {
  let min = num(f.min, 0), max = num(f.max, 1); if (max <= min) max = min + 1;
  const x = (v) => PAD + ((v - min) / (max - min)) * (W - PAD * 2); const y = 96;
  const ivs = (f.intervals || []).slice(0, 3), pts = (f.points || []).slice(0, 5), marks = (f.marks || []).slice(0, 4);
  return html`<svg viewBox=${`0 0 ${W} ${H - 30}`} class="fig">
    <line x1=${PAD - 8} y1=${y} x2=${W - PAD + 8} y2=${y} class="fig-axis" marker-end="url(#fig-arr)" />
    ${ticks(min, max).map((t) => html`<g><line x1=${x(t)} y1=${y - 4} x2=${x(t)} y2=${y + 4} class="fig-axis" /><text x=${x(t)} y=${y + 18} class="fig-tick">${fmt(t)}</text></g>`)}
    ${ivs.map((iv, i) => { const a = x(num(iv.from)), b = x(num(iv.to)); const yy = y - 22 - i * 22; return html`<g><line x1=${a} y1=${yy} x2=${b} y2=${yy} class="fig-iv" /><line x1=${a} y1=${yy - 6} x2=${a} y2=${yy + 6} class="fig-iv" /><line x1=${b} y1=${yy - 6} x2=${b} y2=${yy + 6} class="fig-iv" /><text x=${(a + b) / 2} y=${yy - 9} class="fig-lbl acc">${lbl(iv.label)}</text></g>`; })}
    ${marks.map((m) => html`<g><line x1=${x(num(m.x))} y1=${y - 70} x2=${x(num(m.x))} y2=${y + 4} class="fig-mark" /><text x=${x(num(m.x))} y=${y - 74} class="fig-lbl hot">${lbl(m.label)}</text></g>`)}
    ${pts.map((p) => html`<g><circle cx=${x(num(p.x))} cy=${y} r="5" class="fig-pt" /><text x=${x(num(p.x))} y=${y + 34} class="fig-lbl">${lbl(p.label)}</text></g>`)}
  </svg>`;
}
function Bars({ f }) {
  const vals = (f.values || []).map((v) => num(v)).slice(0, 8); const labels = (f.labels || []).slice(0, vals.length);
  const max = Math.max(...vals.map(Math.abs), 1e-9); const bw = Math.min(54, (W - PAD * 2) / Math.max(1, vals.length) - 14); const base = H - 34;
  return html`<svg viewBox=${`0 0 ${W} ${H}`} class="fig">
    <line x1=${PAD} y1=${base} x2=${W - PAD} y2=${base} class="fig-axis" />
    ${vals.map((v, i) => { const cx = PAD + ((i + 0.5) * (W - PAD * 2)) / vals.length; const h = (Math.abs(v) / max) * (base - 34); return html`<g><rect x=${cx - bw / 2} y=${base - h} width=${bw} height=${h} rx="4" class=${'fig-bar b' + (i % 4)} /><text x=${cx} y=${base - h - 6} class="fig-lbl">${fmt(v)}${f.unit || ''}</text><text x=${cx} y=${base + 16} class="fig-tick">${lbl(labels[i])}</text></g>`; })}
  </svg>`;
}
function Normal({ f }) {
  const mu = num(f.mean, 0), sd = Math.max(1e-6, num(f.sd, 1)); const min = mu - 4 * sd, max = mu + 4 * sd;
  const x = (v) => PAD + ((v - min) / (max - min)) * (W - PAD * 2); const base = H - 36; const pdf = (v) => Math.exp(-0.5 * ((v - mu) / sd) ** 2); const y = (v) => base - pdf(v) * (base - 22);
  const path = (a, b) => { let d = `M${x(a)},${base}`; for (let i = 0; i <= 60; i++) { const v = a + ((b - a) * i) / 60; d += ` L${x(v).toFixed(1)},${y(v).toFixed(1)}`; } return d + ` L${x(b)},${base} Z`; };
  const sh = f.shade || null; const lo = sh ? Math.max(min, num(sh.from, min)) : null, hi = sh ? Math.min(max, num(sh.to, max)) : null;
  const shaded = sh ? (f.tails ? [path(min, lo), path(hi, max)] : [path(lo, hi)]) : [];
  let curve = ''; for (let i = 0; i <= 100; i++) { const v = min + ((max - min) * i) / 100; curve += `${i ? 'L' : 'M'}${x(v).toFixed(1)},${y(v).toFixed(1)} `; }
  return html`<svg viewBox=${`0 0 ${W} ${H}`} class="fig">
    ${shaded.map((d) => html`<path d=${d} class="fig-shade" />`)}
    <path d=${curve} class="fig-curve" />
    <line x1=${PAD - 6} y1=${base} x2=${W - PAD + 6} y2=${base} class="fig-axis" />
    ${[-3, -2, -1, 0, 1, 2, 3].map((k) => html`<text x=${x(mu + k * sd)} y=${base + 15} class="fig-tick">${fmt(mu + k * sd)}</text>`)}
    ${sh && [lo, hi].map((v) => html`<line x1=${x(v)} y1=${base} x2=${x(v)} y2=${y(v) - 4} class="fig-mark soft" />`)}
    ${(f.marks || []).slice(0, 3).map((m) => { const v = Math.max(min, Math.min(max, num(m.x))); return html`<g><line x1=${x(v)} y1=${base} x2=${x(v)} y2="20" class="fig-mark" /><text x=${x(v)} y="14" class="fig-lbl hot">${lbl(m.label)}</text></g>`; })}
  </svg>`;
}
function Line({ f }) {
  const series = (f.series || []).slice(0, 3).map((s) => ({ name: s.name, pts: (s.points || []).map((p) => [num(p[0]), num(p[1])]).slice(0, 200) })).filter((s) => s.pts.length > 1);
  if (!series.length) return null;
  const all = series.flatMap((s) => s.pts); let [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))]; let [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  if (x1 === x0) x1 = x0 + 1; if (y1 === y0) y1 = y0 + 1; const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const L = PAD + 10, B = H - 30; const x = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - PAD / 2); const y = (v) => B - ((v - y0) / (y1 - y0)) * (B - 14);
  return html`<svg viewBox=${`0 0 ${W} ${H}`} class="fig">
    <line x1=${L} y1=${B} x2=${W - PAD / 2} y2=${B} class="fig-axis" /><line x1=${L} y1=${B} x2=${L} y2="10" class="fig-axis" />
    ${ticks(x0, x1, 4).map((t) => html`<text x=${x(t)} y=${B + 14} class="fig-tick">${fmt(t)}</text>`)}
    ${ticks(y0, y1, 3).map((t) => html`<text x=${L - 5} y=${y(t) + 3} class="fig-tick end">${fmt(t)}</text>`)}
    ${series.map((s, i) => html`<g><polyline points=${s.pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')} class=${'fig-line s' + i} />${series.length > 1 && s.name && html`<text x=${W - PAD} y=${14 + i * 14} class=${'fig-lbl end s' + i}>${lbl(s.name)}</text>`}</g>`)}
    ${f.xlabel && html`<text x=${W - PAD / 2} y=${H - 6} class="fig-tick end">${lbl(f.xlabel)}</text>`}${f.ylabel && html`<text x=${L + 4} y="10" class="fig-tick start">${lbl(f.ylabel)}</text>`}
  </svg>`;
}
function Flow({ f }) {
  const nodes = (f.nodes || []).map((n) => lbl(typeof n === 'string' ? n : n && n.label)).slice(0, 6); if (!nodes.length) return null;
  const n = nodes.length; const cols = n <= 3 ? n : Math.ceil(n / 2); const rows = Math.ceil(n / cols); const bw = (W - 16) / cols - 18, bh = 40, gy = 34;
  const hh = rows * bh + (rows - 1) * gy + 16;
  const pos = nodes.map((_, i) => { const r = Math.floor(i / cols), c = r % 2 ? cols - 1 - (i % cols) : i % cols; return [8 + c * ((W - 16) / cols) + 9, 8 + r * (bh + gy)]; });
  const edges = (f.edges || []).filter((e) => Array.isArray(e) && pos[e[0]] && pos[e[1]]).slice(0, 10);
  return html`<svg viewBox=${`0 0 ${W} ${hh}`} class="fig">
    ${edges.map((e) => { const [ax, ay] = pos[e[0]], [bx, by] = pos[e[1]]; const sameRow = ay === by; const x1 = sameRow ? (bx > ax ? ax + bw : ax) : ax + bw / 2, y1 = sameRow ? ay + bh / 2 : ay + bh, x2 = sameRow ? (bx > ax ? bx : bx + bw) : bx + bw / 2, y2 = sameRow ? by + bh / 2 : by; return html`<g><line x1=${x1} y1=${y1} x2=${x2} y2=${y2} class="fig-axis" marker-end="url(#fig-arr)" />${e[2] && html`<text x=${(x1 + x2) / 2} y=${(y1 + y2) / 2 - 4} class="fig-lbl small">${lbl(e[2])}</text>`}</g>`; })}
    ${nodes.map((t, i) => html`<g><rect x=${pos[i][0]} y=${pos[i][1]} width=${bw} height=${bh} rx="9" class="fig-box" /><text x=${pos[i][0] + bw / 2} y=${pos[i][1] + bh / 2 + 4} class="fig-lbl">${t}</text></g>`)}
  </svg>`;
}
// AI 直接给的 SVG：只留画图用的元素和属性，去掉脚本、事件、链接、外部引用
const OK_TAGS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'defs', 'marker', 'title']);
const OK_ATTR = /^(viewBox|width|height|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|d|points|fill|stroke|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|transform|font-size|font-weight|text-anchor|dominant-baseline|dx|dy|id|refX|refY|markerWidth|markerHeight|orient|marker-end|marker-start)$/;
export function cleanSvg(src) {
  try {
    const doc = new DOMParser().parseFromString(String(src || ''), 'image/svg+xml'); const root = doc.documentElement;
    if (!root || root.nodeName !== 'svg' || doc.querySelector('parsererror')) return '';
    const walk = (el) => { for (const c of [...el.children]) { if (!OK_TAGS.has(c.nodeName)) { c.remove(); continue; } for (const a of [...c.attributes]) { if (!OK_ATTR.test(a.name) || /url\((?!#)|javascript:|expression/i.test(a.value)) c.removeAttribute(a.name); } walk(c); } };
    for (const a of [...root.attributes]) if (!OK_ATTR.test(a.name) && a.name !== 'xmlns') root.removeAttribute(a.name);
    walk(root); root.removeAttribute('width'); root.removeAttribute('height'); root.setAttribute('class', 'fig fig-raw');
    return new XMLSerializer().serializeToString(root);
  } catch { return ''; }
}
export function Figure({ spec }) {
  let f = null; try { f = typeof spec === 'string' ? JSON.parse(spec) : spec; } catch {}
  if (!f || typeof f !== 'object') return null;
  const body = f.kind === 'numberline' ? html`<${NumberLine} f=${f} />` : f.kind === 'bars' ? html`<${Bars} f=${f} />` : f.kind === 'normal' ? html`<${Normal} f=${f} />` : f.kind === 'line' ? html`<${Line} f=${f} />` : f.kind === 'flow' ? html`<${Flow} f=${f} />`
    : f.kind === 'svg' ? (() => { const s = cleanSvg(f.svg); return s ? html`<div dangerouslySetInnerHTML=${{ __html: s }}></div>` : null; })() : null;
  if (!body) return html`<div class="lr-msg">这张图画不出来</div>`;
  return html`<div class="lr-fig"><svg width="0" height="0" style="position:absolute"><defs><marker id="fig-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker></defs></svg>${body}</div>`;
}
