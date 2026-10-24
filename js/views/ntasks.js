// 行动: every "待办" block across all pages in one list. Ticking one writes back into its page.
import { html, useState, useMemo } from '../../vendor/preact.js';
import { update, upsert } from '../store.js';
import { Icon, Empty, Seg, Btn } from '../ui.js';
import { textOf, blocksToMd } from '../blocks.js';
import { uid, todayStr } from '../util.js';
import { go, toast } from '../nav.js';
import { ctxMenu } from '../ctx.js';
import { NotesBack } from './notes.js';

export function noteTasks(notes, { done = false } = {}) {
  const out = [];
  for (const n of notes) { if (n.ref && n.ref.startsWith('todo:')) continue; for (const b of n.blocks || []) if (b.type === 'todo' && !!b.checked === done) { const text = textOf(b.html || '').trim(); if (text) out.push({ note: n, block: b, text }); } }
  return out;
}

export function toggleNoteTask(noteId, blockId) {
  update((d) => {
    const n = d.notes.find((x) => x.id === noteId); if (!n) return;
    const b = (n.blocks || []).find((x) => x.id === blockId); if (!b) return;
    b.checked = !b.checked; n.body = blocksToMd(n.blocks); n.updated = new Date().toISOString();
  });
}

function taskMenu(e, t) {
  ctxMenu(e, [
    { label: '打开页面', icon: 'note', onClick: () => go('notes/' + t.note.id) },
    { label: t.block.checked ? '标为未完成' : '标为完成', icon: 'check', onClick: () => toggleNoteTask(t.note.id, t.block.id) },
    'sep',
    { label: '加入待办清单', icon: 'checksq', onClick: () => { upsert('todos', { id: uid(), title: t.text, done: false, priority: 2, due: '', time: '', tags: [], area: '', note: '来自页面「' + (t.note.title || '无标题') + '」', created: todayStr() }); toast('已加入待办清单'); } },
  ], t.text);
}

// grouped by page; `limit` caps the number of rows (dashboard / todos page), the rest links to the full view
export function NoteTasks({ notes, done = false, limit = 0, notebooks = [] }) {
  const tasks = useMemo(() => noteTasks(notes, { done }), [notes, done]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of [...tasks].sort((a, b) => (a.note.updated < b.note.updated ? 1 : a.note.updated > b.note.updated ? -1 : 0))) { if (!m.has(t.note.id)) m.set(t.note.id, []); m.get(t.note.id).push(t); }
    return [...m.values()];
  }, [tasks]);
  if (!tasks.length) return null;
  let shown = 0;
  return html`<div class="ntasks">
    ${groups.map((g) => { if (limit && shown >= limit) return null; const rows = limit ? g.slice(0, limit - shown) : g; shown += rows.length; const n = g[0].note; const nb = notebooks.find((b) => b.id === n.nb); return html`<div class="nt-group" key=${n.id}>
      <a class="nt-h" href=${'#/notes/' + n.id}>${nb && html`<i class="nb-dot" style=${`background:${nb.color}`}></i>`}<span>${n.title || '无标题'}</span><small>${g.length}</small></a>
      ${rows.map((t) => html`<div class=${'nt-row ' + (t.block.checked ? 'done' : '')} key=${t.block.id} onContextMenu=${(e) => taskMenu(e, t)}>
        <button class="cb" onClick=${() => toggleNoteTask(t.note.id, t.block.id)} aria-label="完成"><${Icon} name="check" size=${12} /></button>
        <span class="nt-t" onClick=${() => go('notes/' + t.note.id)}>${t.text}</span>
        <a class="nt-go" href=${'#/notes/' + t.note.id} title=${'打开「' + (t.note.title || '无标题') + '」'}><${Icon} name="external" size=${12} /></a>
      </div>`)}
    </div>`; })}
    ${limit && tasks.length > limit ? html`<a class="more" href="#/notes/tasks">查看全部 ${tasks.length} 项<${Icon} name="right" size=${12} /></a>` : null}
  </div>`;
}

export function NoteTasksView({ notes, notebooks }) {
  const [view, setView] = useState(() => (new URLSearchParams((location.hash.split('?')[1] || '')).get('v') === 'done' ? 'done' : 'open'));
  const open = noteTasks(notes).length, done = noteTasks(notes, { done: true }).length;
  return html`<div class="page"><div class="crumbs"><${NotesBack} /><span>/</span><b>行动</b><span class="flex1"></span><${Seg} options=${[{ v: 'open', label: `未完成 ${open}` }, { v: 'done', label: `已完成 ${done}` }]} value=${view} onChange=${setView} /></div>
    <div class="page-body">
      <p class="small muted" style="margin-bottom:16px">页面里所有的待办块都汇总在这里，勾选会直接写回原来的页面。在页面里输入 <code>[] </code> 或 <code>/待办</code> 就能创建一条。</p>
      ${(view === 'open' ? open : done) === 0 ? html`<${Empty} icon="checksq" text=${view === 'open' ? '页面里没有未完成的待办。' : '还没有完成过页面里的待办。'} />` : html`<${NoteTasks} notes=${notes} notebooks=${notebooks} done=${view === 'done'} />`}
    </div></div>`;
}
