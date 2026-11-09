// 桌面便签：#/sticky —— 没有侧栏的小窗口，只放今天最要紧的东西：今日焦点 + 今天接下来的时间块和检查点。
// 网页里从顶栏「便签」弹出一个小窗口；桌面版（desktop/）把它放进一个无边框、可置顶的窗口里。
// 数据和主窗口是同一份（同一个浏览器存储 + 同一个账号的云同步），在哪边改都会同步过来。
import { html, useState, useEffect, useMemo } from '../../vendor/preact.js';
import { useStore } from '../store.js';
import { Icon } from '../ui.js';
import { todayStr, addDays, sortBy, timeToMin, fmtShort } from '../util.js';
import { FocusCol, focusOn } from './daily.js';
import { isCheck, checkState, checkMenu, BlockModal } from './planner.js';

// 桌面版里 preload 会挂上 window.sealonote；网页弹窗里用 opener
export const inApp = () => typeof window !== 'undefined' && !!window.sealonote;
export function openMain(path) {
  const hash = '#/' + String(path || 'home').replace(/^#?\/?/, '');
  if (window.sealonote) { window.sealonote.openMain(hash); return; }
  try { if (window.opener && !window.opener.closed) { window.opener.location.hash = hash; window.opener.focus(); return; } } catch {}
  window.open(location.pathname + hash, '_blank');
}
// 网页版：开一个小窗口当便签（桌面版里这个请求会被拦下来，换成真正的桌面便签）
export function popSticky() {
  const w = window.open(location.pathname + '#/sticky', 'sealonote-sticky', 'popup=yes,width=340,height=520');
  if (w) try { w.focus(); } catch {}
}

const hm = (d) => d.getHours() * 60 + d.getMinutes();
const wd = (d) => '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];

export default function Sticky() {
  const s = useStore();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const today = todayStr(), nowMin = hm(now);
  const [day, setDay] = useState('today');
  const date = day === 'today' ? today : addDays(today, 1);
  const [blk, setBlk] = useState(null);
  const [pin, setPin] = useState(null);
  useEffect(() => { if (window.sealonote && window.sealonote.getPin) window.sealonote.getPin().then(setPin).catch(() => {}); }, []);
  const togglePin = () => { if (!window.sealonote) return; window.sealonote.setPin(!pin).then(setPin).catch(() => {}); };

  // 今天：还没结束的时间块 + 没打勾的检查点（过了点没打勾的也留着，提醒你点一下）；明天：全部
  const items = useMemo(() => sortBy(s.blocks.filter((b) => b.date === date && !b.pomo), 'start').filter((b) => {
    if (date !== today) return true;
    if (isCheck(b)) return !b.status || timeToMin(b.start) >= nowMin - 60;
    return timeToMin(b.end || b.start) > nowMin;
  }), [s.blocks, date, today, nowMin]);
  const focus = focusOn(s, date); const doneN = focus.filter((t) => t.done).length;
  const openTodos = s.todos.filter((t) => !t.done && t.due && t.due <= today && t.focus !== today).length;

  return html`<div class="sticky">
    <div class="sk-bar">
      <div class="sk-tabs">
        <button type="button" class=${day === 'today' ? 'on' : ''} onClick=${() => setDay('today')}>今天</button>
        <button type="button" class=${day === 'tmr' ? 'on' : ''} onClick=${() => setDay('tmr')}>明天</button>
      </div>
      <span class="sk-clock" title=${fmtShort(date)}>${fmtShort(date)} 周${wd(date)} · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</span>
      ${inApp() && html`<button type="button" class=${'sk-ib ' + (pin ? 'on' : '')} title=${pin ? '取消置顶' : '置顶（总在最前面）'} onClick=${togglePin}><${Icon} name="tack" size=${13} /></button>`}
      <button type="button" class="sk-ib" title="打开主窗口" onClick=${() => openMain(day === 'today' ? 'home' : 'plan/day')}><${Icon} name="external" size=${13} /></button>
      ${inApp() && html`<button type="button" class="sk-ib" title="收起便签（托盘里可以再打开）" onClick=${() => window.sealonote.hideSticky()}><${Icon} name="x" size=${13} /></button>`}
    </div>
    <div class="sk-body">
      <section class="sk-sec">
        <h4>焦点 ${focus.length > 0 && html`<span class="muted">${doneN}/${focus.length}</span>`}</h4>
        <${FocusCol} key=${date} s=${s} date=${date} label=${day === 'today' ? '今天' : '明天'} sub="" main=${day === 'today'} bare />
      </section>
      <section class="sk-sec">
        <h4>${day === 'today' ? '接下来' : '明天的安排'} <button type="button" class="sk-add" title=${day === 'today' ? '加时间块' : '给明天加时间块'} onClick=${() => setBlk({ block: null, start: day === 'today' ? `${String(Math.min(23, now.getHours() + 1)).padStart(2, '0')}:00` : '09:00' })}><${Icon} name="plus" size=${12} /></button></h4>
        ${items.length === 0 ? html`<p class="sk-empty">${day === 'today' ? '今天剩下的时间没有安排' : '明天还没排时间块'}</p>` : html`<ul class="sk-list">
          ${items.map((b) => { const ck = isCheck(b); const st = ck ? checkState(b, date, nowMin) : ''; const cur = !ck && date === today && timeToMin(b.start) <= nowMin && timeToMin(b.end) > nowMin;
            return html`<li key=${b.id} class=${(ck ? 'ck-row ' + st : '') + (cur ? ' cur' : '')} onClick=${(e) => (ck ? checkMenu(e, b, (x) => setBlk({ block: x })) : setBlk({ block: b }))} onContextMenu=${(e) => { e.preventDefault(); ck ? checkMenu(e, b, (x) => setBlk({ block: x })) : setBlk({ block: b }); }}>
              <span class="sk-tm">${b.start}${!ck && b.end ? html`<small>${b.end}</small>` : ''}</span>
              ${ck ? html`<i class="sk-dia">${st === 'ok' ? html`<${Icon} name="check" size=${8} />` : st === 'miss' ? html`<${Icon} name="x" size=${8} />` : ''}</i>` : html`<i class="sk-bar-c" style=${b.color ? `background:${b.color}` : ''}></i>`}
              <span class="sk-tt"><b>${b.title || '（未命名）'}</b>${ck && b.note ? html`<em>没达成：${b.note}</em>` : cur ? html`<em>进行中 · 还剩 ${timeToMin(b.end) - nowMin} 分钟</em>` : ''}</span>
            </li>`; })}
        </ul>`}
      </section>
      ${day === 'today' && openTodos > 0 && html`<button type="button" class="sk-more" onClick=${() => openMain('todos')}><${Icon} name="checksq" size=${12} />还有 ${openTodos} 件今天到期 / 过期的待办<${Icon} name="right" size=${11} /></button>`}
    </div>
    <${BlockModal} open=${!!blk} block=${blk && blk.block} start=${(blk && blk.start) || '09:00'} date=${date} onClose=${() => setBlk(null)} />
  </div>`;
}

// 便签窗口里点到别的页面（比如「现在就做」会跳到专注）：交给主窗口打开，便签自己留在原地
export function keepSticky() {
  window.addEventListener('hashchange', () => {
    const h = location.hash;
    if (/^#\/sticky/.test(h)) return;
    history.replaceState(null, '', location.pathname + location.search + '#/sticky');
    openMain(h);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
