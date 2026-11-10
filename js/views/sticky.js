// 便签：两种模式
//  · 今天：今日 / 明日焦点（就是待办）+ 今天接下来的时间块和检查点（就是计划）
//  · 便利贴：贴在便签上的笔记。便利贴本身就是一页笔记（note.sticky = 颜色），存在同一个数据库里、跟着账号同步，
//    默认放在「便利贴」本子里，也可以放进任何一个本子；反过来任何一页笔记也能「贴到便签」。
// 用在三个地方：侧栏的「便签」页（#/stickies）、网页弹出的小窗口和桌面版的便签窗口（都是 #/sticky，没有侧栏）。
import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact.js';
import { useStore, upsert, update, get } from '../store.js';
import { Icon } from '../ui.js';
import { todayStr, addDays, sortBy, timeToMin, fmtShort, nowISO, kindColor } from '../util.js';
import { mdToBlocks } from '../blocks.js';
import { ctxMenu } from '../ctx.js';
import { toast, go } from '../nav.js';
import { focusOn, addFocus, MAX_FOCUS, FocusCol } from './daily.js';
import { TodoItem } from './todos.js';
import * as pomo from '../pomo.js';
import { isCheck, checkState, checkMenu, BlockModal } from './planner.js';
import { newNote, ensureNotebook, trashPages, noteTitle } from './notes.js';

// 桌面版里 preload 会挂上 window.sealonote；网页弹窗里用 opener
export const inApp = () => typeof window !== 'undefined' && !!window.sealonote;
const isStickyWin = () => /^#\/sticky(\?|$)/.test(location.hash);
export function openMain(path) {
  const hash = '#/' + String(path || 'home').replace(/^#?\/?/, '');
  if (!isStickyWin()) { location.hash = hash; return; }
  if (window.sealonote) { window.sealonote.openMain(hash); return; }
  try { if (window.opener && !window.opener.closed) { window.opener.location.hash = hash; window.opener.focus(); return; } } catch {}
  window.open(location.pathname + hash, '_blank');
}
// 网页版：开一个小窗口当便签（桌面版里换成真正的桌面便签窗口）
export function popSticky(mode) {
  if (window.sealonote) { window.sealonote.showSticky(); return; }
  const w = window.open(location.pathname + '#/sticky' + (mode ? '?mode=' + mode : ''), 'sealonote-sticky', 'popup=yes,width=340,height=520');
  if (w) try { w.focus(); } catch {}
}

const hm = (d) => d.getHours() * 60 + d.getMinutes();
const wd = (d) => '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
const pad = (n) => String(n).padStart(2, '0');
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return now;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ---------- 今天：焦点 + 接下来 ---------- */
// 和总览「待办」卡片同一种行（四个优先级的颜色、时间、下一步、步骤），不另起一套样式：
//   焦点（最多 3 件）→ 其余今天到期 / 过期的 → 「接下来」的时间块，收成一行，点开才展开
const kindC = (k) => kindColor(k || 'focus');
export function TodayPane({ s, now }) {
  const today = todayStr(), nowMin = hm(now);
  const [day, setDay] = useState('today');
  const date = day === 'today' ? today : addDays(today, 1);
  const [blk, setBlk] = useState(null);
  const [nextOpen, setNextOpen] = useState(() => lsGet('ytos.sk.next', '0') === '1');
  const toggleNext = () => { setNextOpen(!nextOpen); lsSet('ytos.sk.next', nextOpen ? '0' : '1'); };
  const items = useMemo(() => sortBy(s.blocks.filter((b) => b.date === date && !b.pomo), 'start').filter((b) => {
    if (date !== today) return true;
    if (isCheck(b)) return !b.status || timeToMin(b.start) >= nowMin - 60;
    return timeToMin(b.end || b.start) > nowMin;
  }), [s.blocks, date, today, nowMin]);
  const focus = focusOn(s, date).filter((t) => !t.done || t.completedAt === today);
  const rest = sortBy(s.todos.filter((t) => !t.done && t.focus !== date && (day === 'today' ? t.due && t.due <= today : t.due === date)), 'priority', 'time');
  const [text, setText] = useState('');
  const addF = () => { const v = text.trim(); if (!v) return; if (focusOn(s, date).length >= MAX_FOCUS) { toast('焦点最多 3 件——少一点才是焦点'); return; } addFocus(v, date); setText(''); };
  const edit = (x) => setBlk({ block: x });
  const openTodo = (t) => openMain('todos?open=' + t.id);
  const row = (b) => { const ck = isCheck(b); const st = ck ? checkState(b, date, nowMin) : ''; const cur = !ck && date === today && timeToMin(b.start) <= nowMin && timeToMin(b.end) > nowMin;
    const act = (e) => (ck ? checkMenu(e, b, edit) : edit(b));
    return html`<li key=${b.id} class=${(ck ? 'ck-row ' + st : '') + (cur ? ' cur' : '')} style=${`--bc:${kindC(b.kind)}`} onClick=${act} onContextMenu=${(e) => { e.preventDefault(); act(e); }}>
      <span class="sk-tm">${b.start}</span>
      ${ck ? html`<i class="sk-dia">${st === 'ok' ? html`<${Icon} name="check" size=${8} />` : st === 'miss' ? html`<${Icon} name="x" size=${8} />` : ''}</i>` : html`<i class="sk-dot"></i>`}
      <span class="sk-tt"><b>${b.title || '（未命名）'}</b></span>
      <small class="sk-meta">${ck ? '' : cur ? `还剩 ${timeToMin(b.end) - nowMin} 分` : `${timeToMin(b.end) - timeToMin(b.start)} 分`}</small>
    </li>`; };
  return html`<div class="sk-pane today">
    ${day === 'today' && html`<${NowCard} />`}
    <div class="sk-sub">
      <div class="sk-seg sm">
        <button type="button" class=${day === 'today' ? 'on' : ''} onClick=${() => setDay('today')}>今天</button>
        <button type="button" class=${day === 'tmr' ? 'on' : ''} onClick=${() => setDay('tmr')}>明天</button>
      </div>
      <span class="sk-date">${fmtShort(date)} 周${wd(date)}</span>
    </div>
    <div class="todo-card sk-todos">
      <div class="tg-h today">焦点</div>
      <${FocusCol} key=${date} s=${s} date=${date} label=${day === 'today' ? '今天' : '明天'} sub="" main=${day === 'today'} bare />
      ${rest.length > 0 && html`<div class="tg-h">${day === 'today' ? '今天到期' : '明天到期'}<span>${rest.length}</span></div><div class="tlist">${rest.slice(0, 8).map((t) => html`<${TodoItem} key=${t.id} t=${t} compact onEdit=${openTodo} />`)}</div>`}
      ${rest.length > 8 && html`<button type="button" class="sk-more" onClick=${() => openMain('todos')}>还有 ${rest.length - 8} 件<${Icon} name="right" size=${11} /></button>`}
    </div>
    <div class=${'sk-next ' + (nextOpen ? 'open' : '')}>
      <button type="button" class="sk-next-h" onClick=${toggleNext}>
        <${Icon} name=${nextOpen ? 'down' : 'right'} size=${11} /><span>${day === 'today' ? '接下来' : '明天的安排'}</span>
        ${!nextOpen && items[0] && html`<em style=${`--bc:${kindC(items[0].kind)}`}><i></i>${items[0].start} ${items[0].title}</em>`}
        <small>${items.length || ''}</small>
        <span class="sk-add" title="加时间块" onClick=${(e) => { e.stopPropagation(); setBlk({ block: null, start: day === 'today' ? `${pad(Math.min(23, now.getHours() + 1))}:00` : '09:00' }); }}><${Icon} name="plus" size=${12} /></span>
      </button>
      ${nextOpen && (items.length ? html`<ul class="sk-list">${items.map(row)}</ul>` : html`<p class="sk-empty">${day === 'today' ? '今天剩下的时间没有安排' : '明天还没排时间块'}</p>`)}
    </div>
    <${BlockModal} open=${!!blk} block=${blk && blk.block} start=${(blk && blk.start) || '09:00'} date=${date} onClose=${() => setBlk(null)} />
  </div>`;
}

// 便签里的番茄钟：「今天」里最上面一张「正在做」卡片（不跳去专注页）；在「便利贴」和单张便利贴里只是标题栏上一个小胶囊
function usePomo() {
  const [st, setSt] = useState(pomo.get()); useEffect(() => pomo.subscribe((x) => setSt({ ...x })), []);
  const [, tick] = useState(0); useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return st;
}
export function NowCard() {
  const st = usePomo();
  if (st.phase === 'idle' && !st.review) return null;
  if (st.phase === 'idle') return html`<div class="now-card rv"><div class="nc-k">这一轮结束了</div><div class="nc-t">${st.review.label || '专注'} · ${st.review.mins} 分钟</div><div class="nc-acts"><button type="button" class="nc-main" onClick=${() => openMain('focus')}>记一下做到哪了</button><button type="button" onClick=${() => pomo.dismissReview()}>不记了</button></div></div>`;
  const rem = pomo.remaining(); const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const pct = total ? Math.min(100, Math.max(0, 100 - (rem / total) * 100)) : 0;
  return html`<div class=${'now-card ' + st.phase + (st.paused ? ' paused' : '')}>
    <div class="nc-k">${st.phase === 'break' ? '休息' : st.paused ? '暂停中' : '正在做'}</div>
    <div class="nc-row"><b class="nc-time">${pomo.fmt(rem)}</b><span class="nc-t">${st.phase === 'break' ? '起来走走，喝口水' : st.label || '专注'}</span></div>
    <i class="nc-bar"><i style=${`width:${pct}%`}></i></i>
    <div class="nc-acts">
      ${st.phase === 'work' && html`<button type="button" class="nc-main" onClick=${() => (st.paused ? pomo.resume() : pomo.pause())}><${Icon} name=${st.paused ? 'play' : 'pause'} size=${11} />${st.paused ? '继续' : '暂停'}</button>`}
      ${st.phase === 'work' && html`<button type="button" onClick=${() => pomo.stop(true)}><${Icon} name="check" size=${11} />这轮到这</button>`}
      <button type="button" onClick=${() => (st.phase === 'break' ? pomo.skip() : pomo.stop(false))}>${st.phase === 'break' ? '跳过休息' : '放弃'}</button>
    </div>
  </div>`;
}
export function PomoPill({ onOpen }) {
  const st = usePomo(); if (st.phase === 'idle') return null;
  // 一个小计时环（走了多少就填多少）+ 剩余时间：一看就是番茄钟，不和优先级的小色点混
  const rem = pomo.remaining(); const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const f = total ? Math.min(1, Math.max(0, 1 - rem / total)) : 0; const C = 2 * Math.PI * 5.5;
  return html`<button type="button" class=${'pomo-pill ' + st.phase + (st.paused ? ' paused' : '')} title=${`${st.phase === 'break' ? '休息中' : st.paused ? '暂停中' : '正在专注'}：${st.label || '专注'}（点开看）`} onClick=${onOpen}>
    <svg class="pp-ring" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" class="pp-tr" /><circle cx="7" cy="7" r="5.5" class="pp-fg" style=${`stroke-dasharray:${C};stroke-dashoffset:${C * (1 - f)}`} />${st.paused && html`<path d="M5.6 5v4M8.4 5v4" class="pp-pz" />`}</svg>
    <span>${pomo.fmt(rem)}</span>
  </button>`;
}

/* ---------- 便利贴 ---------- */
export const STICKY_COLORS = [['yellow', '黄', '#f5d76e'], ['pink', '粉', '#f4a7c0'], ['blue', '蓝', '#9cc3f5'], ['green', '绿', '#a8dbb0'], ['purple', '紫', '#c7b3f0'], ['gray', '灰', '#d3d5da']];
const SIMPLE = new Set(['p', 'bullet', 'number', 'todo', 'quote', 'h1', 'h2', 'h3', 'toggle']);
// 只有简单文字的页面才在便利贴里直接改（表格、图片这些在便利贴里改会丢格式，点开去笔记里改）
const editable = (n) => !(n.blocks || []).some((b) => !SIMPLE.has(b.type));
export const stickyList = (s) => s.notes.filter((n) => n.sticky).sort((a, b) => (b.stickyAt || b.updated || '').localeCompare(a.stickyAt || a.updated || ''));
export function addSticky(color = 'yellow') {
  const nb = ensureNotebook('便利贴', '#c7873a');
  return newNote({ nb: nb.id, sticky: color, stickyAt: nowISO(), title: '', body: '', blocks: [] });
}
export function stickyMenuItem(n) {
  return { label: n.sticky ? '从便签上取下' : '贴到便签', icon: 'tack', hint: n.sticky ? '页面还在' : '', onClick: () => { upsert('notes', { id: n.id, sticky: n.sticky ? '' : 'yellow', stickyAt: n.sticky ? '' : nowISO() }); toast(n.sticky ? '已从便签上取下' : '已贴到便签'); } };
}
const firstLine = (t) => (t || '').split('\n').map((l) => l.replace(/^\s*(#+|[-*]|\d+[.)]|>|\[[ x]\])\s*/i, '').trim()).find(Boolean) || '';
const excerpt = (n) => (n.body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*`|]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 240);

// 把一张便利贴 / 一页笔记单独贴到桌面：桌面版开一个独立的小窗口（各自记位置、大小、置顶、透明度）；网页版弹一个小窗口
export function popNote(id, at) {
  if (window.sealonote && window.sealonote.popNote) { window.sealonote.popNote(id, at); return; }
  const w = window.open(location.pathname + '#/sticky?note=' + id, 'sealonote-note-' + id, 'popup=yes,width=300,height=320' + (at ? `,left=${Math.round(at.x)},top=${Math.round(at.y)}` : ''));
  if (w) try { w.focus(); } catch {}
}
const toggleTheme = () => update((d) => { d.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
function ThemeBtn() {
  return html`<button type="button" class="sk-ib" title="切换白天 / 黑夜" onClick=${toggleTheme}><${Icon} name="moon" size=${14} class="is" /><${Icon} name="sun" size=${14} class="im" /></button>`;
}

// 便利贴的文字：自己打字时不被同步回来的旧内容盖掉；停 0.4 秒存一次
function useStickyText(n) {
  const [text, setText] = useState(n.body || '');
  const focused = useRef(false); const timer = useRef();
  useEffect(() => { if (!focused.current) setText(n.body || ''); }, [n.body]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onInput = (e) => { const v = e.target.value; setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => { const cur = get().notes.find((x) => x.id === n.id); if (!cur || cur.body === v) return; upsert('notes', { id: n.id, body: v, blocks: mdToBlocks(v), title: firstLine(v).slice(0, 40), updated: nowISO() }); }, 400); };
  return { text, onInput, onFocus: () => { focused.current = true; }, onBlur: () => { focused.current = false; } };
}
// 新的一张 / 复制一张：桌面单张窗口里直接再弹一个窗口出来
export function newSticky({ from, text = '', pop = false } = {}) {
  const c = addSticky((from && from.sticky) || 'yellow');
  const body = from ? from.body || '' : text;
  if (body) upsert('notes', { id: c.id, body, blocks: mdToBlocks(body), title: firstLine(body).slice(0, 40) });
  if (pop) popNote(c.id); return c;
}
const inSingle = () => /[?&]note=/.test(location.hash);
function noteMenuItems(n, s) {
  return [
    n.sticky && { label: '新的一张', icon: 'plus', hint: 'Ctrl+N', onClick: () => newSticky({ pop: inSingle() }) },
    n.sticky && { label: '复制一张', icon: 'layers', onClick: () => newSticky({ from: n, pop: inSingle() }) },
    n.sticky && { label: '换颜色', icon: 'tag', sub: STICKY_COLORS.map(([c, name, hex]) => ({ label: name, color: hex, icon: c === n.sticky ? 'check' : '', onClick: () => upsert('notes', { id: n.id, sticky: c }) })) },
    { label: '放进本子', icon: 'book', hint: (s.notebooks.find((b) => b.id === n.nb) || {}).name || '', sub: sortBy(s.notebooks, 'order').map((b) => ({ label: b.name, icon: b.id === n.nb ? 'check' : 'book', onClick: () => { update((d) => { const x = d.notes.find((y) => y.id === n.id); if (x) { x.nb = b.id; x.parent = null; x.updated = nowISO(); } }); toast(`已放进「${b.name}」`); } })) },
    { label: '在主窗口的笔记里打开', icon: 'note', onClick: () => openMain('notes/' + n.id) },
    'sep',
    n.sticky ? { label: '从便签上取下', icon: 'tack', hint: '页面还在本子里', onClick: () => upsert('notes', { id: n.id, sticky: '', stickyAt: '' }) } : stickyMenuItem(n),
    n.sticky && { label: '删除', icon: 'trash', danger: true, onClick: () => trashPages([n.id], noteTitle(n)) },
  ].filter(Boolean);
}

function StickyCard({ n, s, autoFocus, onDone, onOpen }) {
  const can = editable(n); const ta = useRef(); const tx = useStickyText(n);
  const fit = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(320, el.scrollHeight + 2) + 'px'; };
  useEffect(fit, [tx.text]);
  useEffect(() => { if (autoFocus && ta.current) { ta.current.focus(); onDone && onDone(); } }, [autoFocus]);
  const menu = (e) => ctxMenu(e, noteMenuItems(n, s), noteTitle(n) || '便利贴');
  // 按住顶上那条往窗口外拖：松手的地方变成一张独立的便利贴；拖进别的软件就是把文字粘过去
  const dragStart = (e) => { try { e.dataTransfer.setData('text/plain', n.body || ''); e.dataTransfer.effectAllowed = 'copy'; } catch {} };
  const dragEnd = (e) => {
    const out = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth || e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
    if (out && e.dataTransfer && e.dataTransfer.dropEffect === 'none') popNote(n.id, { x: e.screenX - 40, y: e.screenY - 12 });
  };
  return html`<div class=${'stk stk-' + (n.sticky || 'yellow')} onContextMenu=${menu}>
    <div class="stk-grip" draggable="true" title="按住拖到窗口外面：变成一张单独的便利贴" onDragStart=${dragStart} onDragEnd=${dragEnd}></div>
    <div class="stk-tools"><button type="button" class="stk-b" title="单独贴到桌面（可以随意拖动、放大缩小）" onClick=${() => popNote(n.id)}><${Icon} name="external" size=${12} /></button><button type="button" class="stk-b" title="更多" onClick=${menu}><${Icon} name="dots" size=${13} /></button></div>
    ${can ? html`<textarea ref=${ta} class="stk-ta" rows="2" value=${tx.text} placeholder="写点什么…" onFocus=${tx.onFocus} onBlur=${tx.onBlur} onInput=${tx.onInput}></textarea>`
      : html`<button type="button" class="stk-pre" title="点开看全文" onClick=${() => onOpen(n.id)}>${n.title && html`<b>${n.title}</b>`}<span>${excerpt(n) || '（打开查看）'}</span></button>`}
  </div>`;
}

export function NotesPane({ s, page, onOpen }) {
  const list = stickyList(s);
  const [fresh, setFresh] = useState('');
  useEffect(() => { const h = (e) => setFresh(e.detail); window.addEventListener('sticky:fresh', h); return () => window.removeEventListener('sticky:fresh', h); }, []);
  // 笔记：收藏的在前，然后是最近改过的
  const notes = useMemo(() => { const pin = s.notes.filter((n) => n.pinned && !n.sticky); const rec = sortBy(s.notes.filter((n) => !n.sticky && !n.pinned && (n.title || n.body)), '-updated'); return [...pin, ...rec].slice(0, page ? 10 : 6); }, [s.notes]);
  const open = onOpen || ((id) => openMain('notes/' + id));
  const add = () => setFresh(addSticky().id);
  return html`<div class="sk-pane">
    <section class="sk-sec">
      <h4><span>便利贴</span>${list.length > 0 && html`<span class="sk-n">${list.length}</span>`}<button type="button" class="sk-add" title="新便利贴" onClick=${add}><${Icon} name="plus" size=${12} /></button></h4>
      ${list.length === 0 ? html`<button type="button" class="stk-empty" onClick=${add}><${Icon} name="plus" size=${14} />贴一张便利贴<small>存成一页笔记，可以放进任何本子</small></button>`
        : html`<div class=${'stk-grid ' + (page ? 'wide' : '')}>${list.map((n) => html`<${StickyCard} key=${n.id} n=${n} s=${s} onOpen=${open} autoFocus=${fresh === n.id} onDone=${() => setFresh('')} />`)}</div>`}
    </section>
    <section class="sk-sec"><h4><span>笔记</span></h4><ul class="sk-notes">${notes.map((n) => html`<li key=${n.id}><button type="button" onClick=${() => open(n.id)} onContextMenu=${(e) => ctxMenu(e, [{ label: '单独贴到桌面', icon: 'external', onClick: () => popNote(n.id) }, ...noteMenuItems(n, s)], noteTitle(n))}><${Icon} name=${n.pinned ? 'star' : 'note'} size=${12} /><span>${noteTitle(n) || '无标题'}</span><small>${(n.updated || '').slice(5, 10).replace('-', '/')}</small></button></li>`)}</ul></section>
  </div>`;
}

/* ---------- 一页笔记 / 一张便利贴：占满窗口 ---------- */
const safeUrl = (u) => (/^(https?:|data:image\/|blob:)/.test(u || '') ? u : '');
function ReadBlocks({ blocks }) {
  let n = 0;
  return html`<div class="nv-read">${(blocks || []).map((b, i) => {
    const h = { dangerouslySetInnerHTML: { __html: b.html || '' } }; const ind = b.indent ? `margin-left:${b.indent * 18}px` : '';
    if (b.type === 'number') n = i > 0 && blocks[i - 1].type === 'number' ? n + 1 : 1;
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': return html`<div key=${b.id} class=${'nv-' + b.type} ...${h}></div>`;
      case 'bullet': case 'toggle': return html`<div key=${b.id} class="nv-li" style=${ind}><i>•</i><span ...${h}></span></div>`;
      case 'number': return html`<div key=${b.id} class="nv-li" style=${ind}><i>${n}.</i><span ...${h}></span></div>`;
      case 'todo': return html`<div key=${b.id} class=${'nv-li nv-todo ' + (b.checked ? 'done' : '')} style=${ind}><i>${b.checked ? '☑' : '☐'}</i><span ...${h}></span></div>`;
      case 'quote': case 'callout': return html`<blockquote key=${b.id} ...${h}></blockquote>`;
      case 'code': return html`<pre key=${b.id} ...${h}></pre>`;
      case 'divider': return html`<hr key=${b.id} />`;
      case 'image': return safeUrl(b.url) ? html`<img key=${b.id} src=${safeUrl(b.url)} alt="" />` : null;
      case 'table': return html`<table key=${b.id}>${(b.rows || []).map((r, ri) => html`<tr key=${ri}>${r.map((c, ci) => html`<td key=${ci} dangerouslySetInnerHTML=${{ __html: c || '' }}></td>`)}</tr>`)}</table>`;
      case 'file': return html`<p key=${b.id} class="nv-file">📎 ${b.name || '附件'}</p>`;
      case 'pending': return null;
      default: return html`<p key=${b.id} ...${h}></p>`;
    }
  })}</div>`;
}
export function NoteView({ s, id, single, onBack }) {
  const n = s.notes.find((x) => x.id === id);
  const [pin, setPin] = useState(null); const [op, setOp] = useState(1); const [opOpen, setOpOpen] = useState(false);
  const desk = single && inApp() && !!window.sealonote.setOpacity;
  useEffect(() => { if (!desk) return; window.sealonote.getPin().then(setPin).catch(() => {}); window.sealonote.getOpacity().then(setOp).catch(() => {}); }, []);
  useEffect(() => { if (single) document.title = (n && (noteTitle(n) || '便利贴')) + ' · Sealonote'; }, [n && n.title]);
  const tx = useStickyText(n || { id: '', body: '' });
  if (!n) return html`<div class="nv"><div class="sk-bar">${!single && html`<button type="button" class="sk-ib" onClick=${onBack}><${Icon} name="left" size=${14} /></button>`}<span class="flex1"></span>${single && html`<button type="button" class="sk-ib" title="关闭" onClick=${() => (window.sealonote && window.sealonote.win ? window.sealonote.win.close() : window.close())}><${Icon} name="x" size=${14} /></button>`}</div><p class="sk-empty" style="padding:16px">这页已经删掉了。</p></div>`;
  // 便利贴直接改；普通笔记在这里只读（排版完整），要改点「在笔记里编辑」
  const can = !!n.sticky && editable(n);
  const menu = (e) => ctxMenu(e, noteMenuItems(n, s), noteTitle(n) || '便利贴');
  const close = () => (window.sealonote && window.sealonote.win ? window.sealonote.win.close() : window.close());
  return html`<div class=${'nv ' + (n.sticky ? 'stk stk-' + n.sticky : '')}>
    <div class="sk-bar nv-bar">
      ${!single && html`<button type="button" class="sk-ib" title="返回" onClick=${onBack}><${Icon} name="left" size=${14} /></button>`}
      <span class="nv-t" title=${noteTitle(n)}>${n.sticky ? '' : noteTitle(n) || '无标题'}</span>
      <${PomoPill} onOpen=${() => openMain('focus')} />
      ${desk && html`<button type="button" class=${'sk-ib ' + (opOpen ? 'on' : '')} title="透明度" onClick=${() => setOpOpen(!opOpen)}><${Icon} name="eye" size=${14} /></button>`}
      ${desk && html`<button type="button" class=${'sk-ib ' + (pin ? 'on' : '')} title=${pin ? '取消置顶' : '置顶'} onClick=${() => window.sealonote.setPin(!pin).then(setPin)}><${Icon} name="tack" size=${14} /></button>`}
      ${!single && html`<button type="button" class="sk-ib" title="单独贴到桌面" onClick=${() => popNote(n.id)}><${Icon} name="external" size=${14} /></button>`}
      ${single && n.sticky && html`<button type="button" class="sk-ib" title="再贴一张（Ctrl+N）" onClick=${() => newSticky({ pop: true })}><${Icon} name="plus" size=${14} /></button>`}
      <button type="button" class="sk-ib" title="更多" onClick=${menu}><${Icon} name="dots" size=${14} /></button>
      ${single && html`<button type="button" class="sk-ib" title="关闭（便利贴还在）" onClick=${close}><${Icon} name="x" size=${14} /></button>`}
    </div>
    ${opOpen && html`<div class="sk-op"><${Icon} name="eye" size=${13} /><input type="range" min="30" max="100" step="5" value=${Math.round(op * 100)} onInput=${(e) => { const v = +e.target.value / 100; setOp(v); window.sealonote.setOpacity(v); }} /><span>${Math.round(op * 100)}%</span></div>`}
    ${can ? html`<textarea class="nv-ta" value=${tx.text} placeholder="写点什么…" onFocus=${tx.onFocus} onBlur=${tx.onBlur} onInput=${tx.onInput}></textarea>`
      : html`<div class="nv-body">${n.title && !n.sticky && html`<h2 class="nv-h">${n.title}</h2>`}<${ReadBlocks} blocks=${n.blocks && n.blocks.length ? n.blocks : mdToBlocks(n.body)} /><button type="button" class="sk-more" onClick=${() => openMain('notes/' + n.id)}><${Icon} name="note" size=${12} />在笔记里编辑</button></div>`}
  </div>`;
}

// 便签窗口的快捷键：Ctrl/⌘+N 新的一张；没在打字时 Ctrl/⌘+V 把剪贴板里的文字贴成一张新便利贴
let keysOn = false;
export function stickyKeys() {
  if (keysOn) return; keysOn = true;
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); const c = newSticky({ pop: inSingle() }); if (!inSingle()) window.dispatchEvent(new CustomEvent('sticky:fresh', { detail: c.id })); } });
  window.addEventListener('paste', (e) => { if (typing(document.activeElement)) return; const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (!t || !t.trim()) return; e.preventDefault(); const c = newSticky({ text: t.trim(), pop: inSingle() }); toast('贴成了一张新便利贴'); if (!inSingle()) window.dispatchEvent(new CustomEvent('sticky:fresh', { detail: c.id })); });
}

/* ---------- 便签窗口（#/sticky）---------- */
export default function Sticky() {
  const s = useStore(); const now = useNow();
  useEffect(stickyKeys, []);
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  const single = q.get('note');
  const [mode, setModeS] = useState(() => q.get('mode') || lsGet('ytos.stickyMode', 'today'));
  const setMode = (m) => { setModeS(m); lsSet('ytos.stickyMode', m); };
  const [view, setView] = useState('');
  const [pin, setPin] = useState(null);
  const [op, setOp] = useState(1); const [opOpen, setOpOpen] = useState(false);
  useEffect(() => {
    if (!window.sealonote || single) return;
    window.sealonote.getPin && window.sealonote.getPin().then(setPin).catch(() => {});
    window.sealonote.getOpacity && window.sealonote.getOpacity().then(setOp).catch(() => {});
  }, []);
  if (single) return html`<${NoteView} s=${s} id=${single} single />`;
  if (view) return html`<${NoteView} s=${s} id=${view} onBack=${() => setView('')} />`;
  const togglePin = () => window.sealonote && window.sealonote.setPin(!pin).then(setPin).catch(() => {});
  const setOpacity = (v) => { setOp(v); if (window.sealonote && window.sealonote.setOpacity) window.sealonote.setOpacity(v); };
  const desk = inApp() && !!(window.sealonote && window.sealonote.setOpacity);
  return html`<div class="sticky">
    <div class="sk-bar">
      <div class="sk-seg">
        <button type="button" class=${mode === 'today' ? 'on' : ''} onClick=${() => setMode('today')} title="待办和计划"><${Icon} name="sun" size=${13} />今天</button>
        <button type="button" class=${mode === 'notes' ? 'on' : ''} onClick=${() => setMode('notes')} title="笔记和便利贴"><${Icon} name="note" size=${13} />便利贴</button>
      </div>
      ${mode === 'notes' ? html`<${PomoPill} onOpen=${() => setMode('today')} />` : ''}
      <span class="sk-clock">${pad(now.getHours())}:${pad(now.getMinutes())}</span>
      <${ThemeBtn} />
      ${desk && html`<button type="button" class=${'sk-ib ' + (opOpen ? 'on' : '')} title="透明度" onClick=${() => setOpOpen(!opOpen)}><${Icon} name="eye" size=${14} /></button>`}
      ${inApp() && html`<button type="button" class=${'sk-ib ' + (pin ? 'on' : '')} title=${pin ? '取消置顶' : '置顶（总在最前面）'} onClick=${togglePin}><${Icon} name="tack" size=${14} /></button>`}
      <button type="button" class="sk-ib" title="打开主窗口" onClick=${() => openMain(mode === 'today' ? 'home' : 'notes')}><${Icon} name="external" size=${14} /></button>
      ${inApp() && html`<button type="button" class="sk-ib" title="收起便签（托盘里可以再打开）" onClick=${() => window.sealonote.hideSticky()}><${Icon} name="x" size=${14} /></button>`}
    </div>
    ${opOpen && html`<div class="sk-op"><${Icon} name="eye" size=${13} /><input type="range" min="30" max="100" step="5" value=${Math.round(op * 100)} onInput=${(e) => setOpacity(+e.target.value / 100)} /><span>${Math.round(op * 100)}%</span></div>`}
    <div class="sk-body">${mode === 'notes' ? html`<${NotesPane} s=${s} onOpen=${setView} />` : html`<${TodayPane} s=${s} now=${now} />`}</div>
  </div>`;
}

/* ---------- 侧栏里的「便签」页（#/stickies）---------- */
export function StickiesPage() {
  const s = useStore();
  // 这一页上没在打字时 Ctrl/⌘+V：剪贴板里的文字贴成一张新便利贴
  useEffect(() => { const h = (e) => { const el = document.activeElement; if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; const x = e.clipboardData && e.clipboardData.getData('text/plain'); if (!x || !x.trim()) return; e.preventDefault(); const c = newSticky({ text: x.trim() }); window.dispatchEvent(new CustomEvent('sticky:fresh', { detail: c.id })); toast('贴成了一张新便利贴'); }; window.addEventListener('paste', h); return () => window.removeEventListener('paste', h); }, []);
  const alpha = s.settings.stickyAlpha == null ? 1 : s.settings.stickyAlpha;
  return html`<div class="stp" style=${`--stk-a:${Math.round(alpha * 100)}%`}>
    <div class="stp-h">
      <b class="stp-title">便利贴</b><small class="muted">每一张都是一页笔记，可以放进本子；Ctrl+V 粘贴文字就是一张新的</small>
      <span class="flex1"></span>
      <label class="stp-op" title="便利贴的透明度"><${Icon} name="eye" size=${13} /><input type="range" min="30" max="100" step="5" value=${Math.round(alpha * 100)} onInput=${(e) => update((d) => { d.settings.stickyAlpha = +e.target.value / 100; })} /><span>${Math.round(alpha * 100)}%</span></label>
      <button type="button" class="btn sm" onClick=${() => popSticky('notes')} title="弹出便签小窗口，可以放在桌面上"><${Icon} name="tack" size=${13} />${inApp() ? '桌面便签' : '弹出小窗口'}</button>
    </div>
    <div class="stp-body"><${NotesPane} s=${s} page onOpen=${(id) => go('notes/' + id)} /></div>
  </div>`;
}

// 小窗口里点到别的页面（比如「现在就做」会跳到专注）：交给主窗口打开，小窗口自己留在原地
export function keepSticky(base = '#/sticky') {
  const own = new RegExp('^' + base.replace(/[/#]/g, '\\$&') + '(\\?|$)');
  window.addEventListener('hashchange', (e) => {
    const h = location.hash;
    if (own.test(h)) return;
    const back = e && e.oldURL && e.oldURL.includes('#') ? e.oldURL.slice(e.oldURL.indexOf('#')) : base;
    history.replaceState(null, '', location.pathname + location.search + (own.test(back) ? back : base));
    if (window.sealonote) window.sealonote.openMain(h);
    else { try { if (window.opener && !window.opener.closed) { window.opener.location.hash = h; window.opener.focus(); return; } } catch {} window.open(location.pathname + h, '_blank'); }
  });
}
