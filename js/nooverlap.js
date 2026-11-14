// 时间线上同一时间只放一件事：新建或挪动一个时间块时，如果和别的块撞了，就往后挪到第一段放得下的空档；
// 只是把结束时间往后拉（改长度）撞到下一块时，结束时间停在下一块开始的地方。
// 检查点（kind: 'check'）和番茄钟记录（pomo）只是一个点 / 记录，不占时间，不参与。
// 纯函数，不依赖 store：网页（store.js / schedule.js）和服务端（api/mcp.js）共用。

const toMin = (t) => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DAY_END = 24 * 60;

export const takesTime = (b) => b && b.kind !== 'check' && !b.pomo && b.date && b.start && b.end && toMin(b.end) > toMin(b.start);

// 那一天已经占掉的时间段（不含 ignoreId 自己），按开始时间排好
export function busyRanges(blocks, date, ignoreId) {
  return (blocks || []).filter((b) => b.id !== ignoreId && b.date === date && takesTime(b)).map((b) => [toMin(b.start), toMin(b.end), b]).sort((a, b) => a[0] - b[0]);
}

// 从 from 开始，第一段放得下 len 分钟的空档；没有就 -1
export function firstFree(busy, from, len, end = DAY_END) {
  let s = from;
  for (const [a, b] of busy) { if (b <= s) continue; if (a >= s + len) break; s = Math.max(s, b); }
  return s + len <= end ? s : -1;
}

// 给一个要存的块找位置。prev 是改之前的样子（新建时为空）。返回 { block, moved: null | { from, to, past } }
export function fitBlock(block, prev, blocks) {
  if (!takesTime(block)) return { block, moved: null };
  const busy = busyRanges(blocks, block.date, block.id);
  const s = toMin(block.start), e = toMin(block.end), len = e - s;
  const hit = busy.find(([a, b]) => a < e && b > s);
  if (!hit) return { block, moved: null };
  // 只改了结束时间（拉长）：停在下一块开始前
  if (prev && prev.date === block.date && prev.start === block.start && prev.end !== block.end) {
    const next = busy.find(([a]) => a >= s);
    if (next && next[0] - s >= 5) return { block: { ...block, end: toTime(next[0]) }, moved: { from: block.end, to: toTime(next[0]), past: next[2].title || '', kind: 'end' } };
    return { block: { ...block, end: prev.end }, moved: { from: block.end, to: prev.end, past: hit[2].title || '', kind: 'end' } };
  }
  // 只改了开始时间（往上拉长）：停在上一块结束的地方
  if (prev && prev.date === block.date && prev.end === block.end && prev.start !== block.start) {
    const before = busy.filter(([, b]) => b <= e).pop();
    if (before && e - before[1] >= 5) return { block: { ...block, start: toTime(before[1]) }, moved: { from: block.start, to: toTime(before[1]), past: before[2].title || '', kind: 'start-edge' } };
    return { block: { ...block, start: prev.start }, moved: { from: block.start, to: prev.start, past: hit[2].title || '', kind: 'start-edge' } };
  }
  // 新建 / 挪动：往后找空档；后面放不下就往前找
  let at = firstFree(busy, s, len);
  if (at < 0) { for (let t = s - 5; t >= 0; t -= 5) { if (!busy.some(([a, b]) => a < t + len && b > t)) { at = t; break; } } }
  if (at < 0) return { block, moved: null }; // 这一天实在放不下了，就按你给的放
  return { block: { ...block, start: toTime(at), end: toTime(at + len) }, moved: { from: block.start, to: toTime(at), past: hit[2].title || '', kind: 'start' } };
}
