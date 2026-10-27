// 主线 / 支线：跟优先级无关。挂在某个月度目标上的事是「主线」（t.src = { kind: 'goal', mk, id, title }，
// 汤圆从目标拆出来的事自动带着），其他都是「支线」。不另外加字段，只多一个「归到目标…」
import { get, update } from './store.js';
import { monthKey, shiftMonth } from './util.js';

export function questOf(s, t) {
  if (!t || !t.src || t.src.kind !== 'goal') return null;
  const list = (s.goals && s.goals[t.src.mk]) || [];
  const g = list.find((x) => x.id === t.src.id) || Object.values(s.goals || {}).flat().find((x) => x && x.id === t.src.id);
  if (!g) return null;
  const linked = s.todos.filter((x) => x.src && x.src.kind === 'goal' && x.src.id === g.id);
  return { goal: g, mk: t.src.mk, done: linked.filter((x) => x.done).length, total: linked.length };
}
export const isMain = (s, t) => !!questOf(s, t);
// 主线排在前面，其余保持原来的顺序
export const mainFirst = (s, list) => [...list.filter((t) => isMain(s, t)), ...list.filter((t) => !isMain(s, t))];

// 右键「归到目标…」：本月和上个月还没完成的目标
export function goalMenu(t) {
  const s = get(); const cur = monthKey(); const prev = shiftMonth(cur, -1);
  const goals = [[cur, s.goals[cur] || []], [prev, (s.goals[prev] || []).filter((g) => (g.progress || 0) < 100)]].flatMap(([mk, gs]) => gs.map((g) => ({ mk, g })));
  const on = t.src && t.src.kind === 'goal' ? t.src.id : '';
  const set = (src) => update((d) => { const x = d.todos.find((y) => y.id === t.id); if (x) x.src = src; });
  return {
    label: on ? '换目标…' : '归到目标…', icon: 'target', hint: on ? '主线' : '',
    sub: goals.length ? [...goals.map(({ mk, g }) => ({ label: g.title, icon: on === g.id ? 'check' : '', hint: mk === cur ? '' : '上个月', onClick: () => set({ kind: 'goal', mk, id: g.id, title: g.title }) })), on && 'sep', on && { label: '不归到目标（支线）', icon: 'x', onClick: () => set(null) }]
      : [{ label: '这个月还没有目标，去「计划 → 月度目标」加一个', icon: 'target', onClick: () => import('./nav.js').then(({ go }) => go('plan/month')) }],
  };
}
