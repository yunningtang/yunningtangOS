// 子任务：一条待办拆出来的步骤就挂在它自己身上（t.steps），列表、看板、总览都能看到进度。
// 时间线上的块和番茄钟可以指向某一步（todoId + stepId），做完顺手把那一步勾掉。
import { get, upsert, update } from './store.js';
import { uid } from './util.js';

export const stepsOf = (t) => (t && Array.isArray(t.steps) ? t.steps : []);
export function stepsProgress(t) { const st = stepsOf(t); return { done: st.filter((x) => x.done).length, total: st.length }; }
// 一件事的「下一步」只有一个来源：第一个没做完的步骤
export const nextStep = (t) => stepsOf(t).find((x) => !x.done) || null;
// 插到第一个没做完的步骤前面（专注结束时写的「下一步」就这样变成一步）；已经有同名的没做完的步骤就不重复加
export function insertNext(todoId, title, minutes = 25) {
  const v = String(title || '').trim(); if (!v) return;
  update((d) => {
    const t = d.todos.find((x) => x.id === todoId); if (!t) return;
    const st = Array.isArray(t.steps) ? t.steps : [];
    if (st.some((x) => !x.done && x.title === v)) return;
    const i = st.findIndex((x) => !x.done); st.splice(i < 0 ? st.length : i, 0, { id: uid(), title: v, minutes: clampMin(minutes), kind: '', done: false }); t.steps = st;
  });
}
export const clampMin = (m) => Math.max(5, Math.min(180, Math.round(+m || 25)));

const norm = (x) => ({ id: x.id || uid(), title: String(x.title || '').trim(), minutes: clampMin(x.minutes), kind: x.kind || '', done: !!x.done });

// 追加几步（去掉标题重复的）；返回实际加进去的步骤
export function addSteps(todoId, steps) {
  const t = get().todos.find((x) => x.id === todoId); if (!t) return [];
  const have = new Set(stepsOf(t).map((x) => x.title));
  const add = steps.map(norm).filter((x) => x.title && !have.has(x.title));
  upsert('todos', { id: todoId, steps: [...stepsOf(t), ...add] });
  return add;
}
export function setStep(todoId, stepId, patch) {
  update((d) => { const t = d.todos.find((x) => x.id === todoId); if (!t || !t.steps) return; const s = t.steps.find((x) => x.id === stepId); if (s) Object.assign(s, patch); });
}
export const toggleStep = (todoId, stepId) => update((d) => { const t = d.todos.find((x) => x.id === todoId); const s = t && t.steps && t.steps.find((x) => x.id === stepId); if (s) s.done = !s.done; });
export const markStepDone = (todoId, stepId) => setStep(todoId, stepId, { done: true });
export const removeStep = (todoId, stepId) => update((d) => { const t = d.todos.find((x) => x.id === todoId); if (t && t.steps) t.steps = t.steps.filter((x) => x.id !== stepId); });
export function moveStep(todoId, stepId, targetId, after) {
  update((d) => {
    const t = d.todos.find((x) => x.id === todoId); if (!t || !t.steps) return;
    const from = t.steps.findIndex((x) => x.id === stepId); if (from < 0) return;
    const [s] = t.steps.splice(from, 1);
    let to = t.steps.findIndex((x) => x.id === targetId); if (to < 0) { t.steps.push(s); return; }
    if (after) to += 1; t.steps.splice(to, 0, s);
  });
}
// 从页面里的「（15 分）」后缀解析分钟
export function parseStepText(text) { const m = String(text).match(/^(.*?)\s*[（(]\s*(\d{1,3})\s*分(?:钟)?\s*[)）]\s*$/); return m ? { title: m[1].trim(), minutes: +m[2] } : { title: String(text).trim(), minutes: 25 }; }
