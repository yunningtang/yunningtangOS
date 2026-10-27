// 汤圆写进笔记：占位块（write）、改写一段（rewrite）、回答评论（answer）。
// 请求走 /api/agent 的 doc 模式；结果先交给打开着的编辑器（它知道光标和未保存的改动），编辑器不在就直接写回 store。
import { get, upsert } from './store.js';
import { aiHeaders, recordUsage } from './ai.js';
import { blocksToMd, mdToBlocks, textOf } from './blocks.js';
import { todayStr, nowISO } from './util.js';

const running = new Map(); // blockId -> true，防止重复点

export const blockMd = (b) => blocksToMd([b]);
// 某一块前后的上下文：前面最多 1500 字、后面 800 字（纯文本）
export function contextAround(blocks, id) {
  const i = blocks.findIndex((b) => b.id === id);
  const md = (list) => blocksToMd(list.filter((b) => b.type !== 'pending'));
  return { before: i > 0 ? md(blocks.slice(Math.max(0, i - 12), i)).slice(-1500) : '', after: i >= 0 && i < blocks.length - 1 ? md(blocks.slice(i + 1, i + 8)).slice(0, 800) : '' };
}

export async function docAsk({ task, text, note, blocks, blockId, thread }) {
  const st = get();
  const nb = note && st.notebooks.find((b) => b.id === note.nb);
  const ctx = { task, today: todayStr(), who: (st.profile && st.profile.name) || '', title: note ? note.title : '', notebook: nb ? nb.name : '', ...(blocks && blockId ? contextAround(blocks, blockId) : {}) };
  if (task !== 'write' && blocks && blockId) { const b = blocks.find((x) => x.id === blockId); if (b) ctx.section = blockMd(b); }
  if (thread && thread.length) ctx.thread = thread.map((m) => ({ by: m.by, body: m.body }));
  const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(90000), body: JSON.stringify({ mode: 'doc', text, context: ctx }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `出错了（${r.status}）`);
  recordUsage(j);
  return { reply: String(j.reply || ''), markdown: typeof j.markdown === 'string' && j.markdown.trim() ? j.markdown : null };
}

// 占位块：让汤圆写。先把块标成 writing，写完后用解析出的块替换它；失败标成 error，块留着可以重试。
export function fillPending(noteId, pending, blocks) {
  if (running.has(pending.id)) return; running.set(pending.id, true);
  const apply = (patch, replacement) => {
    const ev = new CustomEvent('doc:apply', { detail: { noteId, blockId: pending.id, patch, replacement, handled: false } });
    window.dispatchEvent(ev);
    if (ev.detail.handled) return;
    // 编辑器没开着：直接改 store 里的这一页
    const n = get().notes.find((x) => x.id === noteId); if (!n || !Array.isArray(n.blocks)) return;
    const i = n.blocks.findIndex((b) => b.id === pending.id); if (i < 0) return;
    const next = [...n.blocks]; if (replacement) next.splice(i, 1, ...replacement); else next[i] = { ...next[i], ...patch };
    upsert('notes', { id: noteId, blocks: next, body: blocksToMd(next), updated: nowISO() });
  };
  apply({ status: 'writing', error: '' });
  const note = get().notes.find((x) => x.id === noteId);
  docAsk({ task: 'write', text: pending.intent, note, blocks, blockId: pending.id })
    .then((r) => { const out = r.markdown ? mdToBlocks(r.markdown) : null; if (out && out.length && out.some((b) => textOf(b.html) || b.type === 'table')) apply(null, out); else apply({ status: 'error', error: r.reply || '汤圆这次没写出内容' }); })
    .catch((e) => apply({ status: 'error', error: e.message || '连不上汤圆' }))
    .finally(() => running.delete(pending.id));
}
export const isRunning = (id) => running.has(id);
