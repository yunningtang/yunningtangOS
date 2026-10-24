// Pomodoro state machine, persisted so it survives reloads. Views subscribe for ticks.
import { upsert } from './store.js';
import { markStepDone } from './steps.js';
import { uid, todayStr, minToTime } from './util.js';

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
  if (st.phase === 'work') {
    const end = new Date(), start = new Date(st.startedAt);
    const mins = Math.max(1, Math.round((end - start) / 60000));
    const pad = (n) => String(n).padStart(2, '0');
    upsert('sessions', { id: uid(), date: todayStr(start), start: `${pad(start.getHours())}:${pad(start.getMinutes())}`, end: minToTime(start.getHours() * 60 + start.getMinutes() + mins), mins, title: st.label || '专注', todo: st.todoId || '', note: '', updated: new Date().toISOString() });
    st.count += 1;
    if (st.todoId && st.stepId) { markStepDone(st.todoId, st.stepId); st.stepId = ''; } // 这一轮是某一步：做完顺手勾掉
    beep(); notify('专注完成', `${st.label || '专注'} · ${mins} 分钟。休息一下。`);
    st = { ...st, phase: 'break', startedAt: Date.now(), endsAt: Date.now() + st.breakLen * 60000, paused: false };
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
export function start({ label, todoId, stepId, workLen, breakLen } = {}) {
  if (workLen) st.workLen = workLen; if (breakLen) st.breakLen = breakLen;
  st = { ...st, phase: 'work', label: label ?? st.label, todoId: todoId ?? st.todoId, stepId: stepId || '', startedAt: Date.now(), endsAt: Date.now() + st.workLen * 60000, paused: false };
  try { if (Notification.permission === 'default') Notification.requestPermission(); } catch {}
  save(); emit(); schedule();
}
export function pause() { if (st.phase === 'idle' || st.paused) return; st = { ...st, paused: true, remain: remaining() }; save(); emit(); schedule(); }
export function resume() { if (!st.paused) return; st = { ...st, paused: false, endsAt: Date.now() + st.remain * 1000 }; save(); emit(); schedule(); }
export function stop(log = false) { if (log && st.phase === 'work') { finish(); return; } st = { ...st, phase: 'idle', paused: false }; save(); emit(); schedule(); }
export function skip() { if (st.phase === 'break') { st = { ...st, phase: 'idle', paused: false }; save(); emit(); schedule(); } else if (st.phase === 'work') finish(); }
export function setLens(w, b) { st = { ...st, workLen: w, breakLen: b }; save(); emit(); }
export function setLabel(label, todoId) { st = { ...st, label, todoId: todoId ?? st.todoId }; save(); emit(); }
schedule();
