// 页面的历史版本：存在本机 IndexedDB（不进同步数据），每页最多 40 个快照。
// 连续编辑 5 分钟内算同一个版本（滚动覆盖），隔开 5 分钟再改就留一个新快照；恢复前会先把当前内容存一份。
import { kvGet, kvSet } from './files.js';
import { upsert } from './store.js';

const KEY = (id) => 'hist:' + id; const MAX = 40; const GAP = 5 * 60e3;
const chain = new Map(); // 同一页的写入排队，免得并发读写互相覆盖
const queue = (id, fn) => { const p = (chain.get(id) || Promise.resolve()).then(fn, fn); chain.set(id, p); return p; };

export function snapshot(note, force = false) {
  return queue(note.id, async () => {
    const list = (await kvGet(KEY(note.id))) || [];
    const last = list[list.length - 1]; const body = note.body || '';
    if (last && last.body === body) return list;
    const entry = { at: Date.now(), title: note.title || '', body, blocks: Array.isArray(note.blocks) ? note.blocks : null };
    if (!force && last && Date.now() - last.at < GAP) list[list.length - 1] = entry; else list.push(entry);
    while (list.length > MAX) list.shift();
    await kvSet(KEY(note.id), list); return list;
  });
}
export function listHistory(id) { return queue(id, async () => (await kvGet(KEY(id))) || []); }
export async function restoreSnapshot(note, snap) {
  await snapshot(note, true);
  upsert('notes', { id: note.id, body: snap.body, blocks: snap.blocks || [], updated: new Date().toISOString() });
}
export const fmtSnapTime = (at) => { const d = new Date(at); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
