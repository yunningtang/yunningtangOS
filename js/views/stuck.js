// 「汤圆，我卡住了」的逻辑：在一件事上停住时，先说卡在哪，汤圆给一个 5–15 分钟就能开始的小动作。界面在汤圆的对话里（seal.js）。
// 有 AI 时问 /api/agent 的 stuck 模式；没有就用本地的几条简单规则，照样能用。
// 每次求助都记在这件事的 stuckLog 里（卡点、建议来自哪、有没有用），以后能看出哪种帮法真的有效。
import { get, update } from '../store.js';
import { uid, todayStr, pad, WEEKDAY_SUN } from '../util.js';
import { aiEnabled, aiHeaders, recordUsage } from '../ai.js';
import { loginState } from '../sync.js';
import { stepsOf } from '../steps.js';
import { brainOf, moveTo } from '../brain.js';

export const REASONS = [
  { id: 'start', label: '不知道怎么开始', icon: 'play' },
  { id: 'understand', label: '有些内容看不懂', icon: 'search' },
  { id: 'next', label: '不知道下一步做什么', icon: 'right' },
  { id: 'stress', label: '感觉压力很大', icon: 'heart' },
];
export const openStuck = (t) => window.dispatchEvent(new CustomEvent('stuck:open', { detail: t.id }));

// 没有 AI 时的本地建议
function localHelp(t, reason) {
  const short = String(t.title || '').slice(0, 16); const next = stepsOf(t).find((x) => !x.done);
  if (reason === 'understand') return { reply: '看不懂很正常，先把它变成一个具体的问题。', first: { title: '把看不懂的地方写成一个问题', minutes: 5 }, tip: '写成「X 是什么」或「为什么会 Y」，再去查或者问人，会容易很多。', next: [] };
  if (reason === 'next') return next ? { reply: '按之前拆好的，接着是这一步。', first: { title: next.title, minutes: 15, fromStep: true }, tip: '', next: [] } : { reply: '先想清楚「做完」长什么样，下一步就好找了。', first: { title: `写下「${short}」做完是什么样子`, minutes: 5 }, tip: '', next: [] };
  if (reason === 'stress') return { reply: '压力大的时候，先别想做完，只想开个头。', first: { title: next ? `只做 5 分钟：${next.title}` : `只做 5 分钟「${short}」，到点就停`, minutes: 5, fromStep: !!next }, tip: '可以先把标准降一点：先做一个能交差的版本，再慢慢改。', next: [] };
  return { reply: '先找一个最小的入口。', first: { title: next ? `只做第一点点：${next.title}` : `打开和「${short}」有关的东西，写下第一句`, minutes: 5, fromStep: !!next }, tip: '', next: [] };
}

const logStuck = (id, patch, at) => update((d) => {
  const t = d.todos.find((x) => x.id === id); if (!t) return;
  const log = Array.isArray(t.stuckLog) ? t.stuckLog : [];
  const i = log.findIndex((x) => x.at === at);
  if (i >= 0) log[i] = { ...log[i], ...patch }; else log.push({ at, ...patch });
  t.stuckLog = log.slice(-12);
});

// 问一次：有 AI 走 AI，没有就本地规则。返回建议，并在这件事上记一笔
export async function getHelp(t, reason, text = '') {
  const why = reason || 'other'; const at = Date.now();
  let out = null, src = 'local';
  if (aiEnabled(loginState())) {
    try {
      const now = new Date();
      const resp = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ mode: 'stuck', text: text.trim() || (REASONS.find((x) => x.id === why) || {}).label || '卡住了', context: { today: todayStr(), weekday: WEEKDAY_SUN[now.getDay()], now: `${pad(now.getHours())}:${pad(now.getMinutes())}`, title: t.title, note: t.note || '', due: t.due || '', steps: stepsOf(t).map((x) => ({ title: x.title, done: !!x.done })), reason: why } }) });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok && j.first) { recordUsage(j); out = { reply: j.reply, first: j.first, tip: j.tip, next: j.next || [] }; src = 'ai'; }
    } catch {}
  }
  if (!out) out = localHelp(t, why);
  logStuck(t.id, { reason: why, text: text.trim().slice(0, 120) || undefined, src, first: out.first && out.first.title }, at);
  return { ...out, src, at, reason: why };
}
export const feedback = (todoId, at, ok) => logStuck(todoId, { helpful: ok }, at);
// 把建议的动作插到第一个没做完的步骤前面；next 接在后面（去重）
export function addSteps(todoId, first, next = [], at) {
  update((d) => {
    const x = d.todos.find((y) => y.id === todoId); if (!x) return;
    const st = Array.isArray(x.steps) ? x.steps : [];
    if (first && !first.fromStep) { const i = st.findIndex((y) => !y.done); st.splice(i < 0 ? st.length : i, 0, { id: uid(), title: first.title, minutes: first.minutes, kind: '', done: false }); }
    const have = new Set(st.map((y) => y.title)); next.filter((n) => !have.has(n)).forEach((n) => st.push({ id: uid(), title: n, minutes: 25, kind: '', done: false }));
    x.steps = st;
  });
  if (at) logStuck(todoId, { added: true }, at);
}
export const toStress = (t) => { if (brainOf(t) !== 'alarm') moveTo(t, 'alarm'); };
