// 「正在做」：全局只有一件「正在做」的事（settings.doing），专注页和大脑页的「正在做」看的是同一件。
// 每件事可以有一个「本次目标」（todo.goal）：这一轮做到什么就算完成；步骤是达成它的条件。
import { get, update, upsert } from './store.js';

export const doingOf = (s) => { const id = s.settings.doing; const t = id && s.todos.find((x) => x.id === id && !x.done); return t || null; };
export const setDoing = (id) => update((d) => { d.settings.doing = id || ''; });
export const setGoal = (id, goal) => upsert('todos', { id, goal: String(goal || '').trim().slice(0, 120) });
// 从别处「做这件」：设成「正在做」，跳到专注页
export function doThis(t) { setDoing(t.id); import('./nav.js').then(({ go }) => go('focus')); }
export const doingId = () => get().settings.doing || '';

// 「开始这一步」：设成正在做，开始（或接着）计时。正在计时别的事就问一句，不直接打断
export async function startWork(opts, { toFocus = true } = {}) {
  const pomo = await import('./pomo.js'); const { toast, go } = await import('./nav.js');
  if (opts.todoId) setDoing(opts.todoId);
  const r = pomo.begin(opts); const cur = pomo.get();
  if (r === 'busy') { toast(`正在计时「${cur.label || '专注'}」，没有打断`, { label: '换成这件', onClick: () => { pomo.stop(true); pomo.start(opts); } }); return r; }
  toast(r === 'continued' ? `接着计时：${opts.label}` : `开始：${opts.label} · ${opts.workLen || cur.workLen} 分钟`, toFocus ? { label: '去专注', onClick: () => go('focus') } : undefined);
  return r;
}
