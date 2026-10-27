import { html, useState, useMemo, useEffect, useRef } from '../vendor/preact.js';
import { useStore } from './store.js';
import { Modal, Icon } from './ui.js';
import { go } from './nav.js';
// 页面列表由 app.js 交过来（不要 import app.js：入口带 ?v= 版本号，再 import 一次会把整个 app 跑两遍）
let ROUTES = [];
export const setSearchRoutes = (r) => { ROUTES = r; };

export function SearchPalette({ open, onClose }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef();
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => ref.current && ref.current.focus(), 50); } }, [open]);
  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    const out = [];
    const add = (kind, title, sub, to) => out.push({ kind, title, sub, to });
    if (!k) {
      ROUTES.filter((r) => r.path).forEach((r) => add('页面', r.name, '', r.path));
      return out;
    }
    const m = (...xs) => xs.join(' ').toLowerCase().includes(k);
    ROUTES.filter((r) => r.path && m(r.name, r.path)).forEach((r) => add('页面', r.name, '', r.path));
    s.todos.filter((t) => m(t.title, t.note, t.tags.join(' '))).slice(0, 6).forEach((t) => add('待办', t.title, t.due || '', 'todos'));
    (s.canvases || []).filter((c) => m(c.title)).slice(0, 3).forEach((c) => add('画布', c.title || '未命名画布', `${c.nodes.length} 个节点`, 'notes/canvas/' + c.id));
    s.notes.filter((n) => m(n.title, n.body, n.tags.join(' '))).slice(0, 6).forEach((n) => add('笔记', n.title || '无标题', n.tags.join(' '), 'notes/' + n.id));
    s.books.filter((b) => m(b.title, b.author, b.note)).slice(0, 5).forEach((b) => add('阅读', b.title, b.author, 'reading'));
    s.links.filter((l) => m(l.title, l.url, l.note, l.tags.join(' '))).slice(0, 5).forEach((l) => add('收藏', l.title, l.host, l.url));
    s.trips.filter((t) => m(t.place, t.country, t.note)).slice(0, 4).forEach((t) => add('足迹', t.place, t.country, 'explore'));
    Object.entries(s.goals).forEach(([mon, gs]) => gs.filter((g) => m(g.title)).forEach((g) => add('目标', g.title, mon, 'plan/month')));
    return out.slice(0, 20);
  }, [q, s]);
  const pick = (r) => { if (!r) return; if (r.to.startsWith('http')) window.open(r.to, '_blank', 'noopener'); else go(r.to); onClose(); };
  return html`<${Modal} open=${open} onClose=${onClose} title="搜索">
    <div class="pal" style="margin:0;width:auto">
      <input ref=${ref} type="text" value=${q} placeholder="输入关键字…" onInput=${(e) => { setQ(e.target.value); setI(0); }} onKeyDown=${(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, results.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
        if (e.key === 'Enter') pick(results[i]);
      }} />
      <div class="res">${results.length === 0 ? html`<div class="small muted" style="padding:12px 10px">没有结果。</div>` : results.map((r, idx) => html`<div class=${'ri ' + (idx === i ? 'on' : '')} onMouseEnter=${() => setI(idx)} onClick=${() => pick(r)}><span class="k">${r.kind}</span><b>${r.title}</b><small>${r.sub}</small></div>`)}</div>
    </div>
  <//>`;
}
