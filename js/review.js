// 回看：给一页设个日期，到了那天它浮上来提醒你看一眼。
// 记得 → 下次间隔翻倍（最长 30 天，再往后就不提醒了）；忘了 → 明天再来。就这么多。
import { upsert } from './store.js';
import { todayStr, addDays, parseDate, relDay } from './util.js';
import { toast } from './nav.js';
import { ctxMenu } from './ctx.js';
import { askDate } from './confirm.js';

const MAX_GAP = 30;
const days = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);

export function reviewState(n) { if (!n.review) return ''; const t = todayStr(); return n.review < t ? 'late' : n.review === t ? 'today' : n.review <= addDays(t, 3) ? 'soon' : ''; }
export const isDue = (n) => { const st = reviewState(n); return st === 'late' || st === 'today'; };
export function reviewLabel(n) {
  if (!n.review) return '';
  const st = reviewState(n);
  if (st === 'late') { const d = days(n.review, todayStr()); return d === 1 ? '昨天该回看' : `${d} 天前该回看`; }
  if (st === 'today') return '今天回看';
  return relDay(n.review) + ' 回看';
}
export const dueCount = (notes) => notes.filter(isDue).length;

export function setReview(n, date) {
  const today = todayStr();
  const undo = { id: n.id, review: n.review || '', reviewedAt: n.reviewedAt || '' };
  upsert('notes', { id: n.id, review: date || '', reviewedAt: date ? today : '' });
  toast(date ? `${relDay(date)} 回看` : '不再提醒', { label: '撤销', onClick: () => upsert('notes', undo) });
}

// 记得：间隔翻倍；忘了：明天
export function reviewDone(n, remembered) {
  const today = todayStr();
  const undo = { id: n.id, review: n.review, reviewedAt: n.reviewedAt || '' };
  if (!remembered) {
    upsert('notes', { id: n.id, review: addDays(today, 1), reviewedAt: today });
    toast('明天再看一眼', { label: '撤销', onClick: () => upsert('notes', undo) });
    return;
  }
  const last = Math.max(1, days(n.reviewedAt || today, today) || 1); // 这一轮隔了多少天
  if (last >= MAX_GAP) {
    upsert('notes', { id: n.id, review: '', reviewedAt: today });
    toast('记牢了，这页不再提醒', { label: '撤销', onClick: () => upsert('notes', undo) });
    return;
  }
  const next = Math.min(MAX_GAP, last * 2);
  upsert('notes', { id: n.id, review: addDays(today, next), reviewedAt: today });
  toast(`记得 · ${next} 天后再看`, { label: '撤销', onClick: () => upsert('notes', undo) });
}

export function reviewMenu(e, n) {
  const t = todayStr();
  const ev = { clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} };
  ctxMenu(ev, [
    ...[['明天', 1], ['3 天后', 3], ['一周后', 7], ['两周后', 14], ['一个月后', 30]].map(([l, d]) => ({ label: l, icon: n.review === addDays(t, d) ? 'check' : 'calendar', onClick: () => setReview(n, addDays(t, d)) })),
    { label: '选择日期…', icon: 'edit', onClick: async () => { const v = await askDate('', n.review || t, { title: '哪天回看' }); if (v) setReview(n, v); } },
    n.review && 'sep',
    n.review && { label: '不再提醒', icon: 'x', onClick: () => setReview(n, '') },
  ], n.review ? `回看 · ${relDay(n.review)}` : '哪天回看这一页');
}
