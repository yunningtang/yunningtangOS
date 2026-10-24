// Quick capture: one box, anywhere (⌘⇧K / the + button). The text decides what it becomes:
//   "写论文 @明天 14:00 !1 #研究"      -> todo (same grammar as the todo quick-add)
//   "9:00-10:30 组会"                 -> time block today (or @明天)
//   several lines, or starts with # / > -> note (a #本子 tag files it into that notebook)
import { html, useState, useEffect, useRef, useMemo } from '../vendor/preact.js';
import { useStore, upsert, get } from './store.js';
import { Icon } from './ui.js';
import { uid, todayStr, addDays, timeToMin, minToTime } from './util.js';
import { quickParse } from './views/todos.js';
import { newNote } from './views/notes.js';
import { mdToBlocks } from './blocks.js';
import { go, toast } from './nav.js';

const BLOCK_RE = /^\s*(\d{1,2}:\d{2})\s*[-–~到]\s*(\d{1,2}:\d{2})\s+(.+)$/;
export function detect(text) {
  const t = text.trim();
  if (!t) return 'todo';
  if (BLOCK_RE.test(t.replace(/@(今天|明天|后天)\s*/g, ''))) return 'block';
  if (t.includes('\n') || /^[#>]/.test(t) || t.length > 80) return 'note';
  return 'todo';
}

export function plan(text, kind, notebooks) {
  const t = text.trim();
  if (kind === 'block') {
    const day = /@明天/.test(t) ? addDays(todayStr(), 1) : /@后天/.test(t) ? addDays(todayStr(), 2) : todayStr();
    const m = t.replace(/@(今天|明天|后天)\s*/g, '').match(BLOCK_RE);
    if (!m) return { kind, invalid: true, summary: '格式：9:00-10:30 做什么' };
    const [h1, m1] = m[1].split(':'), [h2, m2] = m[2].split(':');
    const start = `${String(h1).padStart(2, '0')}:${m1}`; let end = `${String(h2).padStart(2, '0')}:${m2}`;
    if (timeToMin(end) <= timeToMin(start)) end = minToTime(timeToMin(start) + 60);
    return { kind, block: { id: uid(), date: day, start, end, title: m[3].trim(), kind: 'focus', note: '' }, summary: `时间块 · ${day === todayStr() ? '今天' : day} ${start}–${end} · ${m[3].trim()}` };
  }
  if (kind === 'note') {
    const tags = []; let body = t.replace(/(^|\s)#([^\s#]+)/g, (_, sp, tg) => { tags.push(tg); return sp; }).trim();
    const nb = notebooks.find((b) => tags.includes(b.name));
    const lines = body.split('\n'); let title = lines[0].replace(/^#+\s*/, '').trim(); let rest = lines.slice(1).join('\n').trim();
    if (!rest && title.length > 40) { rest = title; title = title.slice(0, 24) + '…'; }
    const tagList = tags.filter((x) => !nb || x !== nb.name);
    return { kind, note: { title, body: rest, tags: tagList, nb: nb ? nb.id : null }, summary: `笔记 · ${nb ? nb.name : '收件箱'}${tagList.length ? ' · ' + tagList.map((x) => '#' + x).join(' ') : ''} · ${title || '无标题'}` };
  }
  const q = quickParse(t);
  const when = q.due ? (q.due === todayStr() ? '今天' : q.due === addDays(todayStr(), 1) ? '明天' : q.due) + (q.time ? ' ' + q.time : '') : '无日期';
  return { kind, todo: { id: uid(), title: q.title, done: false, priority: q.priority, due: q.due, time: q.time, tags: q.tags, area: '', note: '', created: todayStr() }, summary: `待办 · ${when} · P${q.priority}${q.tags.length ? ' · ' + q.tags.map((x) => '#' + x).join(' ') : ''}` };
}

export function Capture({ open, onClose }) {
  const s = useStore();
  const [text, setText] = useState('');
  const [kind, setKind] = useState(null); // null = auto
  const ref = useRef();
  useEffect(() => { if (open) { setText(''); setKind(null); const f = () => ref.current && ref.current.focus(); f(); setTimeout(f, 30); } }, [open]);
  useEffect(() => { if (!open) return; const h = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open]);
  if (!open) return null;
  const k = kind || detect(text);
  const p = useMemo(() => plan(text, k, s.notebooks), [text, k, s.notebooks]);
  const save = () => {
    if (!text.trim() || p.invalid) return;
    if (p.kind === 'todo') { upsert('todos', p.todo); toast('已添加待办', { label: '打开', onClick: () => go('todos?open=' + p.todo.id) }); }
    else if (p.kind === 'block') { upsert('blocks', p.block); toast('已添加时间块', { label: '打开', onClick: () => go('plan/day?d=' + p.block.date) }); }
    else { const n = newNote({ title: p.note.title, body: p.note.body, tags: p.note.tags, nb: p.note.nb || 'nb-inbox', blocks: mdToBlocks(p.note.body) }); toast('已创建笔记', { label: '打开', onClick: () => go('notes/' + n.id) }); }
    onClose();
  };
  return html`<div class="cap-bg" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="cap">
      <textarea ref=${ref} class="cap-in" rows="2" autofocus value=${text} placeholder="随手记：写论文 @明天 14:00 !1 #研究 · 9:00-10:30 组会 · 多行就是笔记" onInput=${(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(220, e.target.scrollHeight) + 'px'; }} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } }}></textarea>
      <div class="cap-f">
        <div class="seg mini cap-seg">${[['todo', '待办'], ['note', '笔记'], ['block', '时间块']].map(([v, l]) => html`<button type="button" key=${v} class=${k === v ? 'on' : ''} onClick=${() => setKind(v)}>${l}</button>`)}${kind && html`<button type="button" class="cap-auto" onClick=${() => setKind(null)}>自动</button>`}</div>
        <span class=${'cap-sum ' + (p.invalid ? 'bad' : '')}>${text.trim() ? p.summary : 'Enter 保存 · Shift+Enter 换行 · Esc 关闭'}</span>
        <button class="cap-ai" type="button" disabled=${!text.trim()} title="让汤圆把这句话拆成几条，预览后再保存" onClick=${() => { const t = text; onClose(); window.dispatchEvent(new CustomEvent('seal:ask', { detail: t })); }}><${Icon} name="sparkle" size=${13} /> 问汤圆</button>
        <button class="btn primary sm" disabled=${!text.trim() || p.invalid} onClick=${save}><${Icon} name="check" size=${13} /> 保存</button>
      </div>
    </div>
  </div>`;
}
