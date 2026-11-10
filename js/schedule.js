// 把一件待办（连同它的步骤）排进某一天的时间线：每一步一个时间块（todoId + stepId），按顺序往后排，避开已有的块。
// 时间块上的勾和步骤是同一个东西：在时间线上勾掉，待办里的那一步也完成。
import { get, update } from './store.js';
import { uid, todayStr, timeToMin, minToTime } from './util.js';
import { stepsOf, clampMin } from './steps.js';

const busyOn = (s, date) => s.blocks.filter((b) => b.date === date && b.kind !== 'check' && !b.pomo && b.start && b.end).map((b) => [timeToMin(b.start), timeToMin(b.end)]).sort((a, b) => a[0] - b[0]);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
// 从 cur 开始，第一段放得下 len 分钟的空档
function place(busy, cur, len, end = 23 * 60 + 45) {
  let s = cur;
  for (const [a, b] of busy) { if (b <= s) continue; if (a >= s + len) break; s = Math.max(s, b); }
  return s + len <= end ? s : -1;
}

// 还没排进 date 的那些部分：没做完的步骤；没有步骤就是这件事本身
export function unscheduledParts(t, date = todayStr(), s = get()) {
  const on = s.blocks.filter((b) => b.date === date && b.todoId === t.id);
  const steps = stepsOf(t).filter((x) => !x.done);
  if (steps.length) return steps.filter((x) => !on.some((b) => b.stepId === x.id)).map((x) => ({ title: x.title, stepId: x.id, len: clampMin(x.minutes) }));
  return on.length ? [] : [{ title: t.title, stepId: '', len: clampMin(t.focusLen || 60) }];
}
export const isScheduled = (t, date = todayStr(), s = get()) => unscheduledParts(t, date, s).length === 0;

export function scheduleTodo(t, date = todayStr()) {
  const s = get(); const parts = unscheduledParts(t, date, s); if (!parts.length) return { n: 0 };
  const today = todayStr();
  const earliest = date === today ? Math.ceil((nowMin() + 5) / 15) * 15 : 9 * 60;
  let cur = t.time && t.due === date ? Math.max(timeToMin(t.time), date === today ? earliest : 0) : earliest;
  const busy = busyOn(s, date); const made = [];
  for (const p of parts) {
    const at = place(busy, cur, p.len); if (at < 0) break;
    made.push({ id: uid(), date, start: minToTime(at), end: minToTime(at + p.len), title: p.stepId ? p.title : t.title, kind: 'focus', note: p.stepId ? `「${t.title}」的一步` : '', todoId: t.id, stepId: p.stepId });
    busy.push([at, at + p.len]); busy.sort((a, b) => a[0] - b[0]); cur = at + p.len;
  }
  if (!made.length) return { n: 0, full: true };
  update((d) => {
    made.forEach((b) => d.blocks.push(b));
    const x = d.todos.find((y) => y.id === t.id); if (x) { x.due = date; x.time = made[0].start; }
  });
  return { n: made.length, first: made[0].start, last: made[made.length - 1].end, left: parts.length - made.length };
}
