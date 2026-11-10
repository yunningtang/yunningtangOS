// 便签：两种模式
//  · 今天：今日 / 明日焦点（就是待办）+ 今天接下来的时间块和检查点（就是计划）
//  · 便利贴：贴在便签上的笔记。便利贴本身就是一页笔记（note.sticky = 颜色），存在同一个数据库里、跟着账号同步，
//    默认放在「便利贴」本子里，也可以放进任何一个本子；反过来任何一页笔记也能「贴到便签」。
// 用在三个地方：侧栏的「便签」页（#/stickies）、网页弹出的小窗口和桌面版的便签窗口（都是 #/sticky，没有侧栏）。
import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact.js';
import { useStore, upsert, update, get } from '../store.js';
import { Icon } from '../ui.js';
import { todayStr, addDays, sortBy, timeToMin, fmtShort, nowISO } from '../util.js';
import { mdToBlocks } from '../blocks.js';
import { ctxMenu } from '../ctx.js';
import { toast } from '../nav.js';
import { FocusCol, focusOn } from './daily.js';
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
export function TodayPane({ s, now }) {
  const today = todayStr(), nowMin = hm(now);
  const [day, setDay] = useState('today');
  const date = day === 'today' ? today : addDays(today, 1);
  const [blk, setBlk] = useState(null);
  // 今天：还没结束的时间块 + 没打勾的检查点（过了点没打勾的也留着，提醒你点一下）；明天：全部
  const items = useMemo(() => sortBy(s.blocks.filter((b) => b.date === date && !b.pomo), 'start').filter((b) => {
    if (date !== today) return true;
    if (isCheck(b)) return !b.status || timeToMin(b.start) >= nowMin - 60;
    return timeToMin(b.end || b.start) > nowMin;
  }), [s.blocks, date, today, nowMin]);
  const focus = focusOn(s, date); const doneN = focus.filter((t) => t.done).length;
  const openTodos = s.todos.filter((t) => !t.done && t.due && t.due <= today && t.focus !== today).length;
  const edit = (x) => setBlk({ block: x });
  return html`<div class="sk-pane today">
    <div class="sk-sub">
      <div class="sk-seg sm">
        <button type="button" class=${day === 'today' ? 'on' : ''} onClick=${() => setDay('today')}>今天</button>
        <button type="button" class=${day === 'tmr' ? 'on' : ''} onClick=${() => setDay('tmr')}>明天</button>
      </div>
      <span class="sk-date">${fmtShort(date)} 周${wd(date)}</span>
    </div>
    <section class="sk-sec">
      <h4><span>焦点</span>${focus.length > 0 && html`<span class="sk-n">${doneN}/${focus.length}</span>`}</h4>
      <${FocusCol} key=${date} s=${s} date=${date} label=${day === 'today' ? '今天' : '明天'} sub="" main=${day === 'today'} bare />
    </section>
    <section class="sk-sec">
      <h4><span>${day === 'today' ? '接下来' : '明天的安排'}</span><button type="button" class="sk-add" title=${day === 'today' ? '加时间块' : '给明天加时间块'} onClick=${() => setBlk({ block: null, start: day === 'today' ? `${pad(Math.min(23, now.getHours() + 1))}:00` : '09:00' })}><${Icon} name="plus" size=${12} /></button></h4>
      ${items.length === 0 ? html`<p class="sk-empty">${day === 'today' ? '今天剩下的时间没有安排' : '明天还没排时间块'}</p>` : html`<ul class="sk-list">
        ${items.map((b) => { const ck = isCheck(b); const st = ck ? checkState(b, date, nowMin) : ''; const cur = !ck && date === today && timeToMin(b.start) <= nowMin && timeToMin(b.end) > nowMin;
          const act = (e) => (ck ? checkMenu(e, b, edit) : edit(b));
          return html`<li key=${b.id} class=${(ck ? 'ck-row ' + st : '') + (cur ? ' cur' : '')} onClick=${act} onContextMenu=${(e) => { e.preventDefault(); act(e); }}>
            <span class="sk-tm">${b.start}${!ck && b.end ? html`<small>${b.end}</small>` : ''}</span>
            ${ck ? html`<i class="sk-dia">${st === 'ok' ? html`<${Icon} name="check" size=${8} />` : st === 'miss' ? html`<${Icon} name="x" size=${8} />` : ''}</i>` : html`<i class="sk-bar-c" style=${b.color ? `background:${b.color}` : ''}></i>`}
            <span class="sk-tt"><b>${b.title || '（未命名）'}</b>${ck && b.note ? html`<em>没达成：${b.note}</em>` : cur ? html`<em>进行中 · 还剩 ${timeToMin(b.end) - nowMin} 分钟</em>` : ''}</span>
          </li>`; })}
      </ul>`}
    </section>
    ${day === 'today' && openTodos > 0 && html`<button type="button" class="sk-more" onClick=${() => openMain('todos')}><${Icon} name="checksq" size=${12} />还有 ${openTodos} 件今天到期 / 过期的待办<${Icon} name="right" size=${11} /></button>`}
    <${BlockModal} open=${!!blk} block=${blk && blk.block} start=${(blk && blk.start) || '09:00'} date=${date} onClose=${() => setBlk(null)} />
  </div>`;
}

/* ---------- 便利贴 ---------- */
export const STICKY_COLORS = [['yellow', '黄', '#f5d76e'], ['pink', '粉', '#f4a7c0'], ['blue', '蓝', '#9cc3f5'], ['green', '绿', '#a8dbb0'], ['purple', '紫', '#c7b3f0'], ['gray', '灰', '#d3d5da']];
const SIMPLE = new Set(['p', 'bullet', 'number', 'todo', 'quote', 'h']);
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

function StickyCard({ n, s, autoFocus, onDone }) {
  const can = editable(n);
  const [text, setText] = useState(n.body || '');
  const ta = useRef(); const focused = useRef(false); const timer = useRef();
  // 别的窗口 / 云端改了：没在打字时跟上
  useEffect(() => { if (!focused.current) setText(n.body || ''); }, [n.body]);
  const fit = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(320, el.scrollHeight + 2) + 'px'; };
  useEffect(fit, [text]);
  useEffect(() => { if (autoFocus && ta.current) { ta.current.focus(); onDone && onDone(); } }, [autoFocus]);
  const save = (v) => { clearTimeout(timer.current); timer.current = setTimeout(() => { const cur = get().notes.find((x) => x.id === n.id); if (!cur || cur.body === v) return; upsert('notes', { id: n.id, body: v, blocks: mdToBlocks(v), title: firstLine(v).slice(0, 40), updated: nowISO() }); }, 400); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const menu = (e) => ctxMenu(e, [
    { label: '换颜色', icon: 'tag', sub: STICKY_COLORS.map(([c, name, hex]) => ({ label: name, color: hex, icon: c === n.sticky ? 'check' : '', onClick: () => upsert('notes', { id: n.id, sticky: c }) })) },
    { label: '放进本子', icon: 'book', sub: sortBy(s.notebooks, 'order').map((b) => ({ label: b.name, icon: b.id === n.nb ? 'check' : 'book', onClick: () => { update((d) => { const x = d.notes.find((y) => y.id === n.id); if (x) { x.nb = b.id; x.parent = null; x.updated = nowISO(); } }); toast(`已放进「${b.name}」，便签上还在`); } })) },
    { label: '在笔记里打开', icon: 'external', onClick: () => openMain('notes/' + n.id) },
    'sep',
    { label: '从便签上取下', icon: 'tack', hint: '页面还在本子里', onClick: () => upsert('notes', { id: n.id, sticky: '', stickyAt: '' }) },
    { label: '删除', icon: 'trash', danger: true, onClick: () => trashPages([n.id], noteTitle(n)) },
  ], noteTitle(n) || '便利贴');
  const nb = s.notebooks.find((b) => b.id === n.nb);
  return html`<div class=${'stk stk-' + (n.sticky || 'yellow')} onContextMenu=${menu}>
    <div class="stk-h"><span class="stk-nb" title="所在的本子">${nb ? nb.name : ''}</span><button type="button" class="stk-b" title="更多" onClick=${menu}><${Icon} name="dots" size=${13} /></button></div>
    ${can ? html`<textarea ref=${ta} class="stk-ta" rows="2" value=${text} placeholder="写点什么…" onFocus=${() => { focused.current = true; }} onBlur=${() => { focused.current = false; }} onInput=${(e) => { setText(e.target.value); save(e.target.value); }}></textarea>`
      : html`<button type="button" class="stk-pre" title="内容有表格 / 图片，点开在笔记里编辑" onClick=${() => openMain('notes/' + n.id)}>${n.title && html`<b>${n.title}</b>`}<span>${excerpt(n) || '（打开查看）'}</span></button>`}
  </div>`;
}

export function NotesPane({ s, page }) {
  const list = stickyList(s);
  const [fresh, setFresh] = useState('');
  const recent = useMemo(() => sortBy(s.notes.filter((n) => !n.sticky && (n.title || n.body)), '-updated').slice(0, page ? 8 : 5), [s.notes]);
  const pinned = s.notes.filter((n) => n.pinned && !n.sticky).slice(0, 6);
  const add = () => setFresh(addSticky().id);
  return html`<div class="sk-pane">
    <section class="sk-sec">
      <h4><span>便利贴</span>${list.length > 0 && html`<span class="sk-n">${list.length}</span>`}<button type="button" class="sk-add" title="新便利贴" onClick=${add}><${Icon} name="plus" size=${12} /></button></h4>
      ${list.length === 0 ? html`<button type="button" class="stk-empty" onClick=${add}><${Icon} name="plus" size=${14} />贴一张便利贴<small>写下的内容会存成一页笔记，可以放进任何本子</small></button>`
        : html`<div class=${'stk-grid ' + (page ? 'wide' : '')}>${list.map((n) => html`<${StickyCard} key=${n.id} n=${n} s=${s} autoFocus=${fresh === n.id} onDone=${() => setFresh('')} />`)}</div>`}
    </section>
    ${pinned.length > 0 && html`<section class="sk-sec"><h4><span>收藏的笔记</span></h4><ul class="sk-notes">${pinned.map((n) => html`<li key=${n.id}><button type="button" onClick=${() => openMain('notes/' + n.id)}><${Icon} name="star" size=${12} /><span>${noteTitle(n) || '无标题'}</span></button></li>`)}</ul></section>`}
    <section class="sk-sec"><h4><span>最近的笔记</span></h4><ul class="sk-notes">${recent.map((n) => html`<li key=${n.id}><button type="button" onClick=${() => openMain('notes/' + n.id)} onContextMenu=${(e) => ctxMenu(e, [stickyMenuItem(n), { label: '打开', icon: 'external', onClick: () => openMain('notes/' + n.id) }], noteTitle(n))}><${Icon} name="note" size=${12} /><span>${noteTitle(n) || '无标题'}</span><small>${(n.updated || '').slice(5, 10).replace('-', '/')}</small></button></li>`)}</ul></section>
  </div>`;
}

/* ---------- 便签窗口（#/sticky）---------- */
export default function Sticky() {
  const s = useStore(); const now = useNow();
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  const [mode, setModeS] = useState(() => q.get('mode') || lsGet('ytos.stickyMode', 'today'));
  const setMode = (m) => { setModeS(m); lsSet('ytos.stickyMode', m); };
  const [pin, setPin] = useState(null);
  const [op, setOp] = useState(1); const [opOpen, setOpOpen] = useState(false);
  useEffect(() => {
    if (!window.sealonote) return;
    window.sealonote.getPin && window.sealonote.getPin().then(setPin).catch(() => {});
    window.sealonote.getOpacity && window.sealonote.getOpacity().then(setOp).catch(() => {});
  }, []);
  const togglePin = () => window.sealonote && window.sealonote.setPin(!pin).then(setPin).catch(() => {});
  const setOpacity = (v) => { setOp(v); if (window.sealonote && window.sealonote.setOpacity) window.sealonote.setOpacity(v); };
  const desk = inApp() && !!(window.sealonote && window.sealonote.setOpacity);
  return html`<div class="sticky">
    <div class="sk-bar">
      <div class="sk-seg">
        <button type="button" class=${mode === 'today' ? 'on' : ''} onClick=${() => setMode('today')} title="待办和计划"><${Icon} name="sun" size=${13} />今天</button>
        <button type="button" class=${mode === 'notes' ? 'on' : ''} onClick=${() => setMode('notes')} title="笔记和便利贴"><${Icon} name="note" size=${13} />便利贴</button>
      </div>
      <span class="sk-clock">${pad(now.getHours())}:${pad(now.getMinutes())}</span>
      ${desk && html`<button type="button" class=${'sk-ib ' + (opOpen ? 'on' : '')} title="透明度" onClick=${() => setOpOpen(!opOpen)}><${Icon} name="eye" size=${14} /></button>`}
      ${inApp() && html`<button type="button" class=${'sk-ib ' + (pin ? 'on' : '')} title=${pin ? '取消置顶' : '置顶（总在最前面）'} onClick=${togglePin}><${Icon} name="tack" size=${14} /></button>`}
      <button type="button" class="sk-ib" title="打开主窗口" onClick=${() => openMain(mode === 'today' ? 'home' : 'notes')}><${Icon} name="external" size=${14} /></button>
      ${inApp() && html`<button type="button" class="sk-ib" title="收起便签（托盘里可以再打开）" onClick=${() => window.sealonote.hideSticky()}><${Icon} name="x" size=${14} /></button>`}
    </div>
    ${opOpen && html`<div class="sk-op"><${Icon} name="eye" size=${13} /><input type="range" min="30" max="100" step="5" value=${Math.round(op * 100)} onInput=${(e) => setOpacity(+e.target.value / 100)} /><span>${Math.round(op * 100)}%</span></div>`}
    <div class="sk-body">${mode === 'notes' ? html`<${NotesPane} s=${s} />` : html`<${TodayPane} s=${s} now=${now} />`}</div>
  </div>`;
}

/* ---------- 侧栏里的「便签」页（#/stickies）---------- */
export function StickiesPage({ route }) {
  const s = useStore(); const now = useNow();
  const [mode, setModeS] = useState(() => (route && route.query && route.query.mode) || lsGet('ytos.stickiesMode', 'today'));
  const setMode = (m) => { setModeS(m); lsSet('ytos.stickiesMode', m); };
  const alpha = s.settings.stickyAlpha == null ? 1 : s.settings.stickyAlpha;
  return html`<div class="stp" style=${`--stk-a:${Math.round(alpha * 100)}%`}>
    <div class="stp-h">
      <div class="sk-seg">
        <button type="button" class=${mode === 'today' ? 'on' : ''} onClick=${() => setMode('today')}><${Icon} name="sun" size=${13} />待办和计划</button>
        <button type="button" class=${mode === 'notes' ? 'on' : ''} onClick=${() => setMode('notes')}><${Icon} name="note" size=${13} />笔记和便利贴</button>
      </div>
      <span class="flex1"></span>
      ${mode === 'notes' && html`<label class="stp-op" title="便利贴的透明度"><${Icon} name="eye" size=${13} /><input type="range" min="30" max="100" step="5" value=${Math.round(alpha * 100)} onInput=${(e) => update((d) => { d.settings.stickyAlpha = +e.target.value / 100; })} /><span>${Math.round(alpha * 100)}%</span></label>`}
      <button type="button" class="btn sm" onClick=${() => popSticky(mode)} title="弹出一个小便签窗口，可以放在桌面上"><${Icon} name="tack" size=${13} />${inApp() ? '桌面便签' : '弹出小窗口'}</button>
    </div>
    <div class="stp-body">${mode === 'notes' ? html`<${NotesPane} s=${s} page />` : html`<${TodayPane} s=${s} now=${now} />`}</div>
  </div>`;
}

// 便签窗口里点到别的页面（比如「现在就做」会跳到专注）：交给主窗口打开，便签自己留在原地
export function keepSticky() {
  window.addEventListener('hashchange', () => {
    const h = location.hash;
    if (/^#\/sticky(\?|$)/.test(h)) return;
    history.replaceState(null, '', location.pathname + location.search + '#/sticky');
    if (window.sealonote) window.sealonote.openMain(h);
    else { try { if (window.opener && !window.opener.closed) { window.opener.location.hash = h; window.opener.focus(); return; } } catch {} window.open(location.pathname + h, '_blank'); }
  });
}
