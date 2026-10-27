// 笔记里的评论线程：锚在某一块上，可以回复、解决，也可以整条线程发给汤圆——汤圆回答问题，或者按要求改写那一块。
// 数据在 note.comments 里：[{ id, bid, quote, body, by, at, replies: [{ id, body, by, at, ai }], resolved }]，跟着页面一起同步。
import { html, useState, useEffect, useRef } from '../vendor/preact.js';
import { get, upsert } from './store.js';
import { Icon } from './ui.js';
import { uid, nowISO } from './util.js';
import { docAsk } from './docai.js';
import { mdToBlocks, blocksToMd } from './blocks.js';
import { toast } from './nav.js';
import { ctxMenu } from './ctx.js';
import { askConfirm } from './confirm.js';

export const openCounts = (note) => { const m = {}; (note.comments || []).forEach((c) => { if (!c.resolved) m[c.bid] = (m[c.bid] || 0) + 1; }); return m; };
const me = () => (get().profile && get().profile.name) || '我';
const now = () => nowISO();
function patch(noteId, fn) { const n = get().notes.find((x) => x.id === noteId); if (!n) return; const list = (n.comments || []).map((c) => ({ ...c, replies: [...(c.replies || [])] })); fn(list); upsert('notes', { id: noteId, comments: list, updated: now() }); }
export function addThread(noteId, bid, quote, body) { const t = { id: uid(), bid, quote: String(quote || '').slice(0, 160), body, by: me(), at: now(), replies: [], resolved: false }; patch(noteId, (l) => l.push(t)); return t.id; }
export function replyTo(noteId, tid, body, by = me(), ai = false) { patch(noteId, (l) => { const t = l.find((x) => x.id === tid); if (t) t.replies.push({ id: uid(), body, by, at: now(), ai }); }); }
export function setResolved(noteId, tid, v) { patch(noteId, (l) => { const t = l.find((x) => x.id === tid); if (t) { t.resolved = !!v; t.resolvedAt = v ? now() : ''; } }); }
export function removeThread(noteId, tid) { patch(noteId, (l) => { const i = l.findIndex((x) => x.id === tid); if (i >= 0) l.splice(i, 1); }); }
export function jumpTo(bid) {
  const row = document.querySelector(`.b-row[data-id="${bid}"]`); if (!row) { toast('这一块已经不在页面里了'); return false; }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('cm-flash'); setTimeout(() => row.classList.remove('cm-flash'), 1400); return true;
}
const fmtAt = (s) => { const d = new Date(s); if (isNaN(d)) return ''; const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; const today = new Date(); return d.toDateString() === today.toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`; };

// 发给汤圆：线程里最后一句是问题就回答，是要求就改写那一块（改完回复一句）
export async function askSeal(note, t) {
  const n = get().notes.find((x) => x.id === note.id) || note;
  const blocks = Array.isArray(n.blocks) ? n.blocks : [];
  const thread = [{ by: t.by, body: t.body }, ...(t.replies || []).map((r) => ({ by: r.by, body: r.body }))];
  const last = thread[thread.length - 1];
  const r = await docAsk({ task: 'answer', text: last.body, note: n, blocks, blockId: t.bid, thread });
  if (r.markdown) {
    const out = mdToBlocks(r.markdown); if (out.length) out[0] = { ...out[0], id: t.bid }; // 线程还锚在原来的位置
    const ev = new CustomEvent('doc:apply', { detail: { noteId: n.id, blockId: t.bid, replacement: out, handled: false } }); window.dispatchEvent(ev);
    if (!ev.detail.handled) { const i = blocks.findIndex((b) => b.id === t.bid); if (i >= 0) { const next = [...blocks]; next.splice(i, 1, ...out); upsert('notes', { id: n.id, blocks: next, body: blocksToMd(next), updated: now() }); } }
  }
  replyTo(n.id, t.id, r.reply || (r.markdown ? '改好了，看看这一段。' : '我想不出来…'), '汤圆', true);
  return r;
}

function Thread({ note, t, focus }) {
  const [txt, setTxt] = useState(''); const [busy, setBusy] = useState(false); const ref = useRef();
  useEffect(() => { if (focus && ref.current) ref.current.scrollIntoView({ block: 'nearest' }); }, [focus]);
  const send = () => { const v = txt.trim(); if (!v) return; replyTo(note.id, t.id, v); setTxt(''); };
  const ask = async () => { if (busy) return; setBusy(true); try { await askSeal(note, t); } catch (e) { toast(e.message || '连不上汤圆'); } setBusy(false); };
  const more = (e) => ctxMenu(e, [
    { label: t.resolved ? '重新打开' : '标为已解决', icon: 'check', onClick: () => setResolved(note.id, t.id, !t.resolved) },
    { label: '定位到那一块', icon: 'cursor', onClick: () => jumpTo(t.bid) },
    'sep',
    { label: '删除线程', icon: 'trash', danger: true, onClick: async () => { if (await askConfirm('这条评论和它的回复都会删掉。', { title: '删除线程？', ok: '删除' })) removeThread(note.id, t.id); } },
  ], '评论');
  return html`<div class=${'cmt-th ' + (t.resolved ? 'resolved' : '') + (focus ? ' focus' : '')} ref=${ref}>
    <button class="cmt-q" title="定位到那一块" onClick=${() => jumpTo(t.bid)}>${t.quote || '（整块）'}</button>
    <div class="cmt-m"><div class="cmt-h"><b>${t.by}</b><small>${fmtAt(t.at)}</small></div><p>${t.body}</p></div>
    ${(t.replies || []).map((r) => html`<div class=${'cmt-m reply ' + (r.ai ? 'ai' : '')} key=${r.id}><div class="cmt-h">${r.ai && html`<${Icon} name="sparkle" size=${11} />`}<b>${r.by}</b><small>${fmtAt(r.at)}</small></div><p>${r.body}</p></div>`)}
    ${t.resolved ? html`<div class="cmt-foot"><span class="muted small">已解决</span><button class="btn sm ghost" onClick=${() => setResolved(note.id, t.id, false)}>重新打开</button></div>`
    : html`<div class="cmt-reply"><input value=${txt} placeholder="回复…" onInput=${(e) => setTxt(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }} /></div>
      <div class="cmt-foot">
        <button class=${'btn sm ' + (busy ? 'busy' : '')} disabled=${busy} title="汤圆会回答问题；线程里是改动要求的话就直接改那一块" onClick=${ask}><${Icon} name="sparkle" size=${12} /> ${busy ? '汤圆在想…' : '发给汤圆'}</button>
        <span class="flex1"></span>
        <button class="btn sm ghost" title="标为已解决" onClick=${() => setResolved(note.id, t.id, true)}><${Icon} name="check" size=${12} /> 解决</button>
        <button class="ibtn" title="更多" onClick=${more}><${Icon} name="dots" size=${13} /></button>
      </div>`}
  </div>`;
}

// 面板：右侧浮层。draft = { bid, quote } 时顶部是新评论的输入框；focusBid 时滚到那一块的线程。
export function CommentsPanel({ note, open, draft, focusBid, onClose, onDraftDone }) {
  const [showDone, setShowDone] = useState(false);
  const [txt, setTxt] = useState('');
  const inRef = useRef();
  useEffect(() => { if (draft && inRef.current) inRef.current.focus(); setTxt(''); }, [draft && draft.bid, draft && draft.quote]);
  useEffect(() => { if (!open) return; const k = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-bg, .ctx')) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  if (!open) return null;
  const all = note.comments || []; const openN = all.filter((c) => !c.resolved).length; const doneN = all.length - openN;
  const list = all.filter((c) => showDone || !c.resolved);
  const post = () => { const v = txt.trim(); if (!v || !draft) return; addThread(note.id, draft.bid, draft.quote, v); setTxt(''); onDraftDone(); };
  return html`<aside class="cmt-panel" onMouseDown=${(e) => e.stopPropagation()}>
    <div class="cmt-top"><b>评论</b><span class="muted small">${openN} 条未解决${doneN ? ` · ${doneN} 已解决` : ''}</span><span class="flex1"></span>
      ${doneN > 0 && html`<button class=${'btn sm ghost ' + (showDone ? 'on' : '')} onClick=${() => setShowDone(!showDone)}>${showDone ? '隐藏已解决' : '显示已解决'}</button>`}
      <button class="ibtn" title="关闭（Esc）" onClick=${onClose}><${Icon} name="x" size=${14} /></button></div>
    <div class="cmt-body">
      ${draft && html`<div class="cmt-th draft"><button class="cmt-q" onClick=${() => jumpTo(draft.bid)}>${draft.quote || '（整块）'}</button>
        <textarea ref=${inRef} value=${txt} rows="3" placeholder="写评论…（Enter 发表，Shift+Enter 换行）。问汤圆的话，发表后点「发给汤圆」" onInput=${(e) => setTxt(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); post(); } }}></textarea>
        <div class="cmt-foot"><button class="btn sm primary" disabled=${!txt.trim()} onClick=${post}>发表</button><button class="btn sm ghost" onClick=${onDraftDone}>取消</button></div></div>`}
      ${list.length === 0 && !draft && html`<div class="cmt-empty"><${Icon} name="chat" size=${22} /><p>还没有评论。选中一段文字，或右键任何块 → 「评论…」。</p><p class="muted">评论可以发给汤圆：问它问题，或者让它改那一段。</p></div>`}
      ${list.map((t) => html`<${Thread} key=${t.id} note=${note} t=${t} focus=${focusBid === t.bid} />`)}
    </div>
  </aside>`;
}
