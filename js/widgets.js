// 总览上的卡片：名字、默认顺序、默认宽度。总览页和设置里的「总览」共用
export const WIDGETS = [['profile', '问候'], ['now', '此刻'], ['ai', '汤圆的建议'], ['calendar', '月历'], ['focus', '专注'], ['timeline', '今天'], ['todos', '待办'], ['notes', '笔记'], ['pages', '最近页面'], ['links', '收藏'], ['goals', '本月目标'], ['week', '本周'], ['focusweek', '本周焦点'], ['photo', '图片'], ['brain', '今天的大脑']];
export const SPAN = { profile: 3, now: 1, ai: 1, calendar: 1, focus: 1, timeline: 1, todos: 1, notes: 1, pages: 2, links: 1, goals: 2, week: 1, focusweek: 3, photo: 1, brain: 1 };
export const ORDER = WIDGETS.map(([id]) => id);
const DEFAULT_HIDDEN = ['photo', 'brain']; // 默认不显示，在设置或自定义里打开
const OLD_ORDER = ['profile', 'now', 'timeline', 'todos', 'focus', 'calendar', 'notes', 'pages', 'links', 'goals', 'week', 'focusweek'];
export const DEFAULT_LAYOUT = { v: 3, order: ORDER.filter((id) => !DEFAULT_HIDDEN.includes(id)), hidden: [...DEFAULT_HIDDEN], sizes: {} };

// 存下来的布局 → 现在能用的 { order, hidden, sizes }：认不得的卡去掉，新加的卡补上
export function normLayout(saved) {
  // 旧默认布局（没自己改过顺序的）直接换成新的分组；自己排过的保留
  const isOldDefault = saved && saved.v === 2 && Array.isArray(saved.order) && saved.order.join() === OLD_ORDER.join() && !(saved.hidden || []).length;
  const l = saved && saved.v >= 2 && !isOldDefault ? saved : DEFAULT_LAYOUT; const known = new Set(ORDER);
  const base = l.order || [...(l.main || []), ...(l.side || [])]; // older two-column layouts fold into one list
  const hidden = (l.hidden || []).filter((id) => known.has(id));
  const used = new Set([...base, ...hidden]);
  DEFAULT_HIDDEN.forEach((id) => { if (!used.has(id)) { hidden.push(id); used.add(id); } });
  let order = base.filter((id) => known.has(id)).concat(ORDER.filter((id) => !used.has(id) && id !== 'now' && id !== 'ai'));
  if (!used.has('now')) order.splice(Math.min(1, order.length), 0, 'now'); // new widget lands right under the profile card
  if (!used.has('ai')) order.splice(Math.min(order.indexOf('now') + 1 || 1, order.length), 0, 'ai'); // 汤圆的建议：放在「此刻」后面
  return { order, hidden, sizes: l.sizes || {} };
}
// 显示 / 隐藏一张卡，返回新的布局（存进 settings.dash）
export function toggleWidget(saved, id, show) {
  const l = normLayout(saved);
  if (show) return { ...l, v: 3, order: l.order.includes(id) ? l.order : [...l.order, id], hidden: l.hidden.filter((x) => x !== id) };
  return { ...l, v: 3, order: l.order.filter((x) => x !== id), hidden: l.hidden.includes(id) ? l.hidden : [...l.hidden, id] };
}
