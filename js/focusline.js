// 专注记录放进时间线：不另建时间块，画时间线时合进去，保证同一段时间永远只有一条。
// · 和自己排的时间块重叠的专注 → 算进那个块里（块上显示专注了多久、哪一段），不再单独画一条
// · 没有块的专注 → 自己画一条；同一件事中间只隔了休息（≤15 分钟）的几轮连成一条
// · 正在进行的这一轮也画出来（到预计结束为止），结束后变成专注记录
import { html, useState, useEffect } from '../vendor/preact.js';
import * as pomo from './pomo.js';
import { get, upsert, remove } from './store.js';
import { todayStr, timeToMin, minToTime, uid } from './util.js';
import { ctxMenu } from './ctx.js';
import { go, toast } from './nav.js';

const GAP = 15;
const hm = (d) => d.getHours() * 60 + d.getMinutes();

// 正在专注的这一轮（今天开始的），没有就 null
export function liveRound(st = pomo.get()) {
  if (st.phase !== 'work' || !st.startedAt) return null;
  const s = new Date(st.startedAt); if (todayStr(s) !== todayStr()) return null;
  // 暂停时按「已经做了的 + 还剩的」画到预计结束，不跟着现在的时间一直变长
  const plannedMs = st.paused ? ((st.pausedAt || Date.now()) - st.startedAt - (st.pausedMs || 0)) + (st.remain || 0) * 1000 : st.endsAt - st.startedAt;
  const a = hm(s), plannedEnd = a + Math.max(1, Math.round(plannedMs / 60000));
  return { id: 'live', start: minToTime(a), end: minToTime(Math.min(24 * 60, plannedEnd)), title: st.label || '专注', todo: st.todoId || '', live: true, mins: 0 };
}

// 返回 { extra: [要单独画的专注条], byBlock: Map(块 id → { mins, spans: [[a, e]], live }) }
export function focusFor(date, blocks, sessions, live) {
  const items = (sessions || []).filter((x) => x && x.date === date && x.start && x.end).map((x) => ({ ...x }));
  if (live && date === todayStr()) items.push(live);
  const byBlock = new Map(); const rest = [];
  for (const it of items) {
    const a = timeToMin(it.start), e = Math.max(timeToMin(it.end), a + 1);
    let best = null, bestOv = 0;
    for (const b of blocks || []) {
      const ov = Math.min(e, timeToMin(b.end)) - Math.max(a, timeToMin(b.start));
      const score = ov + (it.todo && b.todoId === it.todo ? 1000 : 0); // 同一件事的块优先
      if (ov > 0 && score > bestOv) { best = b; bestOv = score; }
    }
    if (best) {
      const f = byBlock.get(best.id) || { mins: 0, spans: [], live: false };
      f.mins += it.live ? 0 : (it.mins || e - a); f.spans.push([a, e]); f.live = f.live || !!it.live; byBlock.set(best.id, f);
    } else rest.push({ ...it, a, e });
  }
  rest.sort((x, y) => x.a - y.a);
  const extra = [];
  for (const it of rest) {
    const last = extra[extra.length - 1]; const same = last && ((it.todo && it.todo === last.todo) || (!it.todo && !last.todo && it.title === last.title));
    if (last && same && it.a - last.e <= GAP) { last.e = Math.max(last.e, it.e); last.mins += it.live ? 0 : (it.mins || it.e - it.a); last.live = last.live || !!it.live; last.ids.push(it.id); continue; }
    extra.push({ a: it.a, e: it.e, title: it.title || '专注', todo: it.todo || '', mins: it.live ? 0 : (it.mins || it.e - it.a), live: !!it.live, ids: [it.id] });
  }
  // 画成和时间块一样的形状，时间线代码不用分两套
  return { byBlock, extra: extra.map((x) => ({ id: 'focus:' + x.ids[0], date, start: minToTime(x.a), end: minToTime(x.e), title: x.title, kind: 'focus', focus: x })) };
}

// 时间线用：专注开始 / 结束 / 每分钟刷新一次（不跟着每秒的倒计时重画）
export function usePomoLive() {
  const key = () => { const s = pomo.get(); return s.phase + ':' + (s.startedAt || '') + ':' + (s.paused ? 'p' : '') + ':' + Math.floor(Date.now() / 60000); };
  const [, set] = useState(key());
  useEffect(() => { const f = () => set(key()); const off = pomo.subscribe(f); const t = setInterval(f, 30000); return () => { off(); clearInterval(t); }; }, []);
  return liveRound();
}
export const focusLabel = (f) => (f.live ? '专注中' : `专注 ${f.mins} 分`);

// 块里专注过的那几段：块左边一条竖线标出来
export function FocusBar({ f, a, e }) {
  const len = Math.max(1, e - a);
  return html`<span class=${'fx-bar' + (f.live ? ' live' : '')} aria-hidden="true">${f.spans.map(([sa, se], i) => { const t = Math.max(0, Math.min(1, (sa - a) / len)), b = Math.max(t, Math.min(1, (se - a) / len)); return html`<i key=${i} style=${`top:${t * 100}%;height:${Math.max(4, (b - t) * 100)}%`}></i>`; })}</span>`;
}
// 单独那条专注的右键菜单
export function focusMenu(ev, b) {
  const f = b.focus; const ids = f.ids.filter((id) => id !== 'live');
  ctxMenu(ev, [
    f.live && { label: '去专注页', icon: 'clock', onClick: () => go('focus') },
    { label: '排成时间块', icon: 'calendar', onClick: () => { upsert('blocks', { id: uid(), date: b.date, start: b.start, end: b.end, title: b.title, kind: 'focus', note: '', ...(f.todo ? { todoId: f.todo } : {}) }); toast('已排成时间块，专注记录算在它里面'); } },
    ids.length && 'sep',
    ids.length && { label: '删掉这段专注记录', icon: 'trash', danger: true, onClick: () => { const gone = get().sessions.filter((x) => ids.includes(x.id)); ids.forEach((id) => remove('sessions', id)); toast('已删除专注记录', { label: '撤销', onClick: () => gone.forEach((x) => upsert('sessions', x)) }); } },
  ].filter(Boolean), b.title);
}

// 时间上真的重叠的块并排放（各占一列），不叠在一起；返回 Map(id → [第几列, 共几列])
export function lanesOf(list) {
  const items = list.map((b) => { const a = timeToMin(b.start); return { id: b.id, a, e: Math.max(timeToMin(b.end), a + 1) }; }).sort((x, y) => x.a - y.a || y.e - x.e);
  const out = new Map(); let cluster = [], end = -1;
  const flush = () => { const lanes = []; cluster.forEach((it) => { let l = lanes.findIndex((x) => x <= it.a); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = it.e; it.l = l; }); cluster.forEach((it) => out.set(it.id, [it.l, lanes.length])); cluster = []; end = -1; };
  items.forEach((it) => { if (cluster.length && it.a >= end) flush(); cluster.push(it); end = Math.max(end, it.e); });
  if (cluster.length) flush();
  return out;
}
