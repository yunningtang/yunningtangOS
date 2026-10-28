// Pomodoro state machine, persisted so it survives reloads. Views subscribe for ticks.
import { upsert } from './store.js';
import { markStepDone, insertNext } from './steps.js';
import { todayStr, minToTime, nowISO } from './util.js';

const KEY = 'ytos.pomo';
const subs = new Set();
let st = load();
let timer = null;

function load() { try { return { phase: 'idle', workLen: 25, breakLen: 5, count: 0, label: '', todoId: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { phase: 'idle', workLen: 25, breakLen: 5, count: 0, label: '', todoId: '' }; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }
function emit() { subs.forEach((f) => f(st)); }
export function get() { return st; }
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
export function remaining() {
  if (st.phase === 'idle') return st.workLen * 60;
  if (st.paused) return st.remain;
  return Math.max(0, Math.round((st.endsAt - Date.now()) / 1000));
}
export function fmt(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16); });
  } catch {}
}
function notify(title, body) { try { if (Notification.permission === 'granted') new Notification(title, { body }); } catch {} }

function finish() {
  // 另一个标签页可能已经结束了这一轮：以存着的为准，别重复记、别把别人的状态盖掉
  const cur = load(); if (cur.phase !== st.phase || cur.startedAt !== st.startedAt) { st = cur; emit(); schedule(); return; }
  if (st.phase === 'work') {
    // 电脑睡着了 / 页面关着时到点：结束时间按预计结束算，不按重新打开的那一刻
    const endMs = st.paused || !st.endsAt ? Date.now() : Math.min(Date.now(), st.endsAt);
    const end = new Date(endMs), start = new Date(st.startedAt);
    const mins = Math.max(1, Math.round((end - start) / 60000));
    const pad = (n) => String(n).padStart(2, '0');
    const sid = 'p' + Number(st.startedAt).toString(36); // 同一轮只会有一条记录，两个标签页同时结束也不会记两次
    upsert('sessions', { id: sid, goal: st.goal || '', date: todayStr(start), start: `${pad(start.getHours())}:${pad(start.getMinutes())}`, end: minToTime(start.getHours() * 60 + start.getMinutes() + mins), mins, title: st.label || '专注', todo: st.todoId || '', note: '', updated: nowISO() });
    // 等一个检查点：做到哪了、下一步。时间到了不等于做完了——这一轮是某一步的话，也只在检查点里由人来勾
    st.review = { sid, todoId: st.todoId || '', stepId: st.stepId || '', label: st.label || '', goal: st.goal || '', mins };
    if (st.restoreLen) { st.workLen = st.restoreLen; st.restoreLen = 0; }
    st.count += 1; st.stepId = '';
    if (Date.now() - endMs < 90000) { beep(); notify('专注完成', `${st.label || '专注'} · ${mins} 分钟。休息一下。`); }
    st = { ...st, phase: 'break', startedAt: endMs, endsAt: endMs + st.breakLen * 60000, paused: false };
  } else {
    beep(); notify('休息结束', '准备开始下一轮。');
    st = { ...st, phase: 'idle', paused: false };
  }
  save(); emit(); schedule();
}
function schedule() {
  clearInterval(timer); timer = null;
  if (st.phase === 'idle' || st.paused) return;
  timer = setInterval(() => { if (remaining() <= 0) finish(); else emit(); }, 1000);
}
export function start({ label, todoId, stepId, workLen, breakLen, goal, once } = {}) {
  if (once) { st.restoreLen = st.restoreLen || st.workLen; st.workLen = once; } else if (workLen) st.workLen = workLen; if (breakLen) st.breakLen = breakLen;
  if (goal !== undefined) st.goal = goal;
  st.review = null;
  st = { ...st, phase: 'work', label: label ?? st.label, todoId: todoId ?? st.todoId, stepId: stepId || '', startedAt: Date.now(), endsAt: Date.now() + st.workLen * 60000, paused: false };
  try { if (Notification.permission === 'default') Notification.requestPermission(); } catch {}
  save(); emit(); schedule();
}
export function pause() { if (st.phase === 'idle' || st.paused) return; st = { ...st, paused: true, remain: remaining() }; save(); emit(); schedule(); }
export function resume() { if (!st.paused) return; st = { ...st, paused: false, endsAt: Date.now() + st.remain * 1000 }; save(); emit(); schedule(); }
export function stop(log = false) { if (log && st.phase === 'work') { finish(); return; } st = { ...st, phase: 'idle', paused: false, ...(st.restoreLen ? { workLen: st.restoreLen, restoreLen: 0 } : {}) }; save(); emit(); schedule(); }
export function skip() { if (st.phase === 'break') { st = { ...st, phase: 'idle', paused: false }; save(); emit(); schedule(); } else if (st.phase === 'work') finish(); }
export function setLens(w, b) { st = { ...st, workLen: w, breakLen: b }; save(); emit(); }
export function setLabel(label, todoId) { st = { ...st, label, todoId: todoId ?? st.todoId }; save(); emit(); }
export function setGoal(goal) { st = { ...st, goal }; save(); emit(); }
// 检查点：这一轮做到哪了、下一步是什么。写进这段专注和对应的待办，下次选同一件事时会带出来
export function checkpoint({ note = '', next = '', done = false, stepDone = false } = {}) {
  const r = st.review; if (!r) return;
  if (stepDone && r.todoId && r.stepId) markStepDone(r.todoId, r.stepId);
  if (note || next) upsert('sessions', { id: r.sid, note: note.trim(), next: next.trim(), updated: nowISO() });
  // 写的「下一步」变成这件事的一个步骤（插在下一个没做完的前面），不再单独存一份
  if (r.todoId && next.trim() && !done) insertNext(r.todoId, next.trim());
  if (r.todoId) upsert('todos', { id: r.todoId, next: '', ...(note.trim() ? { lastNote: note.trim() } : {}), ...(done ? { done: true, completedAt: todayStr() } : {}) });
  st = { ...st, review: null, goal: next.trim() || '' }; save(); emit();
}
export function dismissReview() { st = { ...st, review: null }; save(); emit(); }
// 多个标签页共用一个计时器：别的标签页改了就跟上，不然这边旧的状态会把那边正在跑的一轮盖掉
try { addEventListener('storage', (e) => { if (e.key === KEY) { st = load(); emit(); schedule(); } }); } catch {}
schedule();
