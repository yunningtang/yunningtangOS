// 汤圆的「上下文」：看你在哪一页、在看什么，生成一键可发的提示词；首页的「汤圆今天的建议」也从这里算。
// 全部是本地计算，不调模型。发出去时才把当前页的摘要随请求带给 /api/agent。
import { get } from './store.js';
import { todayStr, addDays, monthKey, weekKey, weekStart, timeToMin, relDay, uid } from './util.js';
import { blocksToText } from './blocks.js';

export function parseRoute(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [h, q] = raw.split('?');
  const [path, ...rest] = h.split('/');
  return { path: path || 'home', sub: rest.join('/') || '', query: Object.fromEntries(new URLSearchParams(q || '')) };
}

const clip = (s, n) => { s = String(s || '').replace(/\s+\n/g, '\n').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const openTodos = (s) => s.todos.filter((t) => !t.done);
const overdue = (s) => openTodos(s).filter((t) => t.due && t.due < todayStr());
const dueToday = (s) => openTodos(s).filter((t) => t.due === todayStr());
const blocksOn = (s, d) => s.blocks.filter((b) => b.date === d && !b.pomo).sort((a, b) => (a.start < b.start ? -1 : 1));
const todoLine = (t) => [t.title, t.due && (t.due === todayStr() ? '今天' : t.due), t.time, 'P' + (t.priority ?? 2), (t.steps || []).length ? `${t.steps.filter((x) => x.done).length}/${t.steps.length} 步` : ''].filter(Boolean).join(' · ');
const blockLine = (b) => `${b.start}–${b.end} ${b.title || ''}${b.done ? '（已完成）' : ''}`;
const bookPct = (b) => { const max = b.total > 0 ? b.total : 100; return Math.round((b.progress || 0) / max * 100); };
const lastRead = (b) => { const l = (b.log || []).filter((x) => x.p > 0); return l.length ? l[l.length - 1].d : b.started || ''; };
const daysSince = (d) => (d ? Math.round((Date.parse(todayStr()) - Date.parse(d)) / 864e5) : 99);

// 今天还空着的时间段（8:00–22:00 里，避开已有时间块，≥ 45 分钟）
export function freeSlots(s, d = todayStr(), minLen = 45) {
  const from = d === todayStr() ? Math.max(8 * 60, Math.ceil((nowMin() + 5) / 15) * 15) : 8 * 60, to = 22 * 60;
  const busy = blocksOn(s, d).map((b) => [timeToMin(b.start), timeToMin(b.end)]);
  const out = []; let cur = from;
  for (const [a, b] of busy) { if (a - cur >= minLen) out.push([cur, a]); cur = Math.max(cur, b); }
  if (to - cur >= minLen) out.push([cur, to]);
  return out;
}
const fmtMin = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/* ---------- 当前页面 → 上下文 ---------- */
// 返回 { key, kind, label, title, text } 或 null。text 是发给模型的摘要（截断过）
export function pageContext(route = parseRoute(), s = get()) {
  const q = route.query || {};
  if (route.path === 'notes' && route.sub && !route.sub.startsWith('canvas')) {
    const n = s.notes.find((x) => x.id === route.sub); if (!n) return null;
    const nb = s.notebooks.find((b) => b.id === n.nb);
    const body = blocksToText(n.blocks || []);
    return { key: 'note:' + n.id, kind: 'note', id: n.id, label: '笔记：' + (n.title || '无标题'), title: n.title || '无标题', text: `笔记「${n.title || '无标题'}」${nb ? `（本子：${nb.name}）` : ''}${(n.tags || []).length ? ' 标签：' + n.tags.join('、') : ''}\n${clip(body, 3500) || '（空白页）'}` };
  }
  if (route.path === 'todos' && q.open) {
    const t = s.todos.find((x) => x.id === q.open); if (!t) return null;
    return { key: 'todo:' + t.id, kind: 'todo', id: t.id, label: '待办：' + t.title, title: t.title, text: `待办「${t.title}」${t.done ? '（已完成）' : ''} ${todoLine(t)}${t.note ? '\n备注：' + clip(t.note, 400) : ''}${(t.steps || []).length ? '\n步骤：' + t.steps.map((x) => (x.done ? '✓ ' : '· ') + x.title).join('；') : ''}` };
  }
  if (route.path === 'todos') {
    const list = openTodos(s).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1).slice(0, 25);
    return { key: 'todos', kind: 'todos', label: '待办列表', title: '待办', text: `未完成的待办 ${openTodos(s).length} 条（逾期 ${overdue(s).length}，今天到期 ${dueToday(s).length}）：\n${list.map(todoLine).join('\n')}` };
  }
  if (route.path === 'reading' && q.open) {
    const b = s.books.find((x) => x.id === q.open); if (!b) return null;
    return { key: 'book:' + b.id, kind: 'book', id: b.id, label: '书：' + b.title, title: b.title, text: `书《${b.title}》${b.author ? ' ' + b.author : ''}，状态 ${b.status}，进度 ${b.progress || 0}${b.total ? '/' + b.total + ' 页' : '%'}（${bookPct(b)}%）${b.note ? '\n笔记：' + clip(b.note, 600) : ''}` };
  }
  if (route.path === 'reading') {
    const rd = s.books.filter((b) => b.status === 'reading');
    return { key: 'reading', kind: 'reading', label: '阅读', title: '阅读', text: `在读 ${rd.length} 本：${rd.map((b) => `《${b.title}》${bookPct(b)}%，上次读 ${lastRead(b) || '未知'}`).join('；') || '无'}\n想读：${s.books.filter((b) => b.status === 'want').slice(0, 10).map((b) => '《' + b.title + '》').join('、') || '无'}` };
  }
  if (route.path === 'plan') {
    const sub = route.sub || 'week';
    if (sub === 'day') {
      const d = q.d || todayStr();
      return { key: 'day:' + d, kind: 'day', date: d, label: (d === todayStr() ? '今天' : relDay(d)) + '的时间线', title: d, text: `${d} 的时间线：\n${blocksOn(s, d).map(blockLine).join('\n') || '（空）'}\n空档：${freeSlots(s, d).map(([a, b]) => fmtMin(a) + '–' + fmtMin(b)).join('、') || '没有'}` };
    }
    if (sub === 'month') {
      const gs = s.goals[monthKey()] || [];
      return { key: 'month', kind: 'goals', label: '本月目标', title: '本月目标', text: `本月目标：\n${gs.map((g) => `${g.title}（${g.progress || 0}%）${(g.krs || []).length ? '：' + g.krs.map((k) => (k.done ? '✓' : '·') + k.text).join('；') : ''}`).join('\n') || '（还没有）'}` };
    }
    const ws = weekStart(); const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    return { key: 'week', kind: 'week', label: '本周计划', title: '本周', text: `本周（${weekKey()}）焦点：${(s.weeks[weekKey()] || {}).focus || '未写'}\n${days.map((d) => `${d}：${blocksOn(s, d).map((b) => b.start + ' ' + b.title).join('，') || '空'}`).join('\n')}` };
  }
  if (route.path === 'vision') {
    const v = s.vision || {};
    return { key: 'vision', kind: 'vision', label: '愿景', title: '愿景', text: `肯定句：${(v.statements || []).map((x) => x.text).join('；') || '无'}\n长期目标：${(v.longterm || []).map((x) => x.title).join('；') || '无'}\n本月目标：${(s.goals[monthKey()] || []).map((g) => g.title).join('；') || '无'}` };
  }
  if (route.path === 'links') return { key: 'links', kind: 'links', label: '收藏', title: '收藏', text: `最近收藏：${s.links.slice(-12).map((l) => l.title || l.url).join('；') || '无'}` };
  return null;
}

/* ---------- 当前页面 → 一键提示词 ---------- */
// 每条 { i 图标, h 短标题, t 发出去的话, k 会落到的模块, mode? 'breakdown'|'plan' }
export function contextPrompts(route = parseRoute(), s = get()) {
  const ctx = pageContext(route, s); const out = [];
  const add = (i, h, t, k, mode) => out.push({ i, h, t, k: [].concat(k || []), mode });
  const od = overdue(s), td = dueToday(s), free = freeSlots(s);
  if (ctx && ctx.kind === 'note') {
    add('note', '总结这页', '用几句话总结我正在看的这页笔记，列出要点', '回答');
    add('checksq', '把这页的待办变成真正的待办', '把我正在看的这页笔记里提到要做的事，整理成待办（带日期的就填上日期）', '待办');
    add('calendar', '按这页排时间', '根据这页笔记里要做的事，帮我排进接下来几天的时间线', '时间块', 'plan');
    add('sparkle', '下一步做什么', '看这页笔记，告诉我接下来最该做的三件事', '回答');
  } else if (ctx && ctx.kind === 'todo') {
    add('layers', '拆成步骤', '拆解：' + ctx.title, '子任务', 'breakdown');
    add('clock', '排进时间线', '帮我把「' + ctx.title + '」排进最近的空档', '时间块', 'plan');
    add('sparkle', '怎么开始', '「' + ctx.title + '」我不知道从哪下手，给我第一个 15 分钟能做的动作', '回答');
  } else if (ctx && ctx.kind === 'book') {
    add('book', '记一条读书笔记', '帮我给《' + ctx.title + '》建一页读书笔记，放到读书相关的本子里', '笔记');
    add('calendar', '排阅读计划', '帮我安排读完《' + ctx.title + '》：每天固定一段时间，排进接下来几天', '时间块', 'plan');
  } else if (ctx && ctx.kind === 'day') {
    if (free.length && ctx.date === todayStr()) add('clock', '填满今天的空档', `今天还空着 ${free.map(([a, b]) => fmtMin(a) + '–' + fmtMin(b)).join('、')}，从我的待办里挑合适的排进去`, '时间块', 'plan');
    add('sparkle', '复盘这一天', '看这一天的时间线，帮我简单复盘：完成了什么、哪里超时了、明天怎么调', '回答');
  } else if (ctx && ctx.kind === 'week') {
    add('target', '按本周焦点排一排', '按本周焦点和我的待办，帮我把这周剩下几天排一下', '时间块', 'plan');
    add('sparkle', '本周还剩什么', '这周还剩哪些重要的事没做？按优先级列出来', '回答');
  } else if (ctx && ctx.kind === 'goals') {
    const g = (s.goals[monthKey()] || []).find((x) => (x.progress || 0) < 100);
    if (g) add('layers', '把目标拆成本周的事', '拆解：' + g.title + '（拆成这周能做完的几件事）', '待办', 'breakdown');
    add('sparkle', '目标进度怎么样', '看本月目标的进度，告诉我哪个落后了、这周该补什么', '回答');
  } else if (ctx && ctx.kind === 'reading') {
    const rd = s.books.filter((b) => b.status === 'reading').sort((a, b) => daysSince(lastRead(b)) - daysSince(lastRead(a)))[0] || null;
    const stale = s.books.filter((b) => b.status === 'reading').sort((a, b) => daysSince(lastRead(b)) - daysSince(lastRead(a)));
    if (stale[0]) add('book', '继续读《' + stale[0].title + '》', `《${stale[0].title}》${daysSince(lastRead(stale[0]))} 天没读了，帮我在今天或明天排 30 分钟`, '时间块', 'plan');
    add('sparkle', '下一本读什么', '从我想读的书里挑一本下一本读，说说理由', '回答');
  } else if (ctx && ctx.kind === 'vision') {
    add('star', '把愿景落到这周', '看我的愿景和长期目标，给我这周能做的一件小事，加成待办', '待办');
  } else if (ctx && ctx.kind === 'todos') {
    if (od.length) add('refresh', `处理 ${od.length} 件过期的`, `这些过期的待办：${od.slice(0, 8).map((t) => t.title).join('、')}，帮我重新排日期（能今天做的放今天，其他往后排）`, '待办');
    const big = openTodos(s).find((t) => !(t.steps || []).length && (t.priority ?? 2) <= 1);
    if (big) add('layers', '拆「' + clip(big.title, 12) + '」', '拆解：' + big.title, '子任务', 'breakdown');
  }
  // 跟页面无关、但看数据有意义的
  if (td.length && out.length < 5) add('clock', `今天还有 ${td.length} 件没做`, `今天到期还没做的：${td.slice(0, 8).map((t) => t.title).join('、')}，帮我排进今天剩下的空档`, '时间块', 'plan');
  if (od.length && out.length < 5 && !(ctx && ctx.kind === 'todos')) add('refresh', `${od.length} 件过期了`, `这些待办过期了：${od.slice(0, 8).map((t) => t.title).join('、')}，帮我把日期重新排一下`, '待办');
  return out.slice(0, 6);
}

/* ---------- 首页：汤圆今天的建议 ---------- */
// 每条 { id, i, t 一句话, sub 补充, act: { label, ask?, mode?, go?, fn? } }，最多 3 条，按紧急程度
export function dailySuggestions(s = get()) {
  const out = []; const today = todayStr();
  const od = overdue(s), td = dueToday(s), free = freeSlots(s);
  if (od.length) out.push({ id: 'overdue', w: 100, i: 'refresh', t: `${od.length} 件待办过期了`, sub: od.slice(0, 3).map((t) => t.title).join('、'), act: { label: '让汤圆重排', ask: `这些待办过期了：${od.slice(0, 10).map((t) => t.title).join('、')}，帮我把日期重新排一下（能今天做的放今天）` } });
  const unplanned = td.filter((t) => !s.blocks.some((b) => b.todoId === t.id && b.date === today));
  if (unplanned.length && free.length) { const [a, b] = free[0]; out.push({ id: 'today', w: 90, i: 'clock', t: `${fmtMin(a)}–${fmtMin(b)} 空着`, sub: `今天还有 ${unplanned.length} 件没排时间：${unplanned.slice(0, 2).map((t) => t.title).join('、')}`, act: { label: '排进去', mode: 'plan', ask: `今天到期还没排时间的：${unplanned.slice(0, 8).map((t) => t.title).join('、')}，帮我排进今天剩下的空档` } }); }
  const big = openTodos(s).filter((t) => !(t.steps || []).length && (t.priority ?? 2) <= 1 && (!t.due || t.due <= addDays(today, 7)))[0];
  if (big) out.push({ id: 'big:' + big.id, w: 70, i: 'layers', t: `「${clip(big.title, 16)}」还没拆`, sub: big.due ? `${relDay(big.due)}到期，先拆成几步更好开始` : '高优先级，先拆成几步更好开始', act: { label: '拆一下', breakdown: { id: big.id, title: big.title, due: big.due || '', note: big.note || '' } } });
  const stale = s.books.filter((b) => b.status === 'reading' && daysSince(lastRead(b)) >= 4).sort((a, b) => daysSince(lastRead(b)) - daysSince(lastRead(a)))[0];
  if (stale) out.push({ id: 'book:' + stale.id, w: 50, i: 'book', t: `《${clip(stale.title, 14)}》${daysSince(lastRead(stale))} 天没读了`, sub: `读到 ${bookPct(stale)}%`, act: { label: '排 30 分钟', mode: 'plan', ask: `《${stale.title}》好几天没读了，帮我在今天或明天的空档排 30 分钟读书` } });
  const gs = s.goals[monthKey()] || []; const dom = new Date().getDate(); const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const lag = gs.filter((g) => (g.progress || 0) + 15 < Math.round(dom / dim * 100)).sort((a, b) => (a.progress || 0) - (b.progress || 0))[0];
  if (lag) out.push({ id: 'goal:' + lag.id, w: 60, i: 'target', t: `「${clip(lag.title, 14)}」落后了`, sub: `本月过了 ${Math.round(dom / dim * 100)}%，它才 ${lag.progress || 0}%`, act: { label: '拆成本周的事', goal: { mk: monthKey(), id: lag.id } } });
  const fk = (s.weeks[weekKey()] || {}).focus; const dow = new Date().getDay();
  if (!fk && (dow === 1 || dow === 0)) out.push({ id: 'focus', w: 40, i: 'target', t: '这周还没定焦点', sub: '一句话写下这周最重要的事', act: { label: '一起想想', ask: '看我的待办和本月目标，帮我定一句本周焦点' } });
  const rv = s.notes.filter((n) => n.review && n.review <= today && !n.deleted);
  if (rv.length) out.push({ id: 'review', w: 30, i: 'note', t: `${rv.length} 页笔记到了回看日`, sub: rv.slice(0, 2).map((n) => n.title || '无标题').join('、'), act: { label: '去回看', go: 'notes/' + rv[0].id } });
  if (!out.length) {
    if (free.length) { const [a, b] = free[0]; out.push({ id: 'free', w: 10, i: 'sparkle', t: `${fmtMin(a)} 之后都空着`, sub: '要不要挑一件想做的事放进去', act: { label: '帮我挑', mode: 'plan', ask: `今天 ${fmtMin(a)}–${fmtMin(b)} 空着，从我的待办和目标里挑一件放进去` } }); }
    else out.push({ id: 'calm', w: 0, i: 'heart', t: '今天都排好了', sub: '按计划走就行，累了就歇会儿', act: null });
  }
  return out.sort((a, b) => b.w - a.w).slice(0, 3);
}

/* ---------- 自定义提示词：变量替换 ---------- */
export const PROMPT_VARS = [
  ['今天', '今天的日期'], ['明天', '明天的日期'], ['本周', '本周编号，如 2026-W43'], ['本月', '本月，如 2026-10'],
  ['当前页', '正在看的页面标题'], ['选中', '页面上选中的文字'], ['本周焦点', '本周焦点那句话'], ['今天待办', '今天到期的待办'],
];
export function fillVars(text, { route = parseRoute(), s = get(), sel = '' } = {}) {
  const ctx = pageContext(route, s);
  const map = {
    今天: todayStr(), 明天: addDays(todayStr(), 1), 本周: weekKey(), 本月: monthKey(),
    当前页: ctx ? ctx.title : '', 选中: sel, 本周焦点: (s.weeks[weekKey()] || {}).focus || '', 今天待办: dueToday(s).map((t) => t.title).join('、'),
  };
  return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}
export const newPrompt = () => ({ id: uid(), title: '', text: '', mode: '' });
