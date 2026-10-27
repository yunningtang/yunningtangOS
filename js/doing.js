// 主战场：全局只有一件「正在做」的事（settings.doing），专注页和大脑页的「正在做」看的是同一件。
// 每件事可以有一个「本次目标」（todo.goal）：这一轮做到什么就算完成；步骤是达成它的条件。
import { get, update, upsert } from './store.js';

export const doingOf = (s) => { const id = s.settings.doing; const t = id && s.todos.find((x) => x.id === id && !x.done); return t || null; };
export const setDoing = (id) => update((d) => { d.settings.doing = id || ''; });
export const setGoal = (id, goal) => upsert('todos', { id, goal: String(goal || '').trim().slice(0, 120) });
// 从别处「做这件」：设成主战场，跳到专注页
export function doThis(t) { setDoing(t.id); import('./nav.js').then(({ go }) => go('focus')); }
export const doingId = () => get().settings.doing || '';
