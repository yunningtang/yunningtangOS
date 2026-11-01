// 今日焦点：今天（和明天）最重要的 1–3 件事。焦点就是待办，打个标记 todo.focus = 'YYYY-MM-DD'，
// 打勾 = 完成那条待办，所以不会有两份清单。总览上的卡片在这里；待办的右键菜单也能设焦点。
import { html, useState } from '../../vendor/preact.js';
import { upsert, toggleTodo } from '../store.js';
import { Icon, Card } from '../ui.js';
import { uid, todayStr, addDays, sortBy, weekKey, fmtShort } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { go, toast } from '../nav.js';
import { doThis } from '../doing.js';
import { mainFirst, isMain } from '../quest.js';

export const MAX_FOCUS = 3;
export const focusOn = (s, date) => sortBy(s.todos.filter((t) => t.focus === date), 'focusAt');
// 设成某天的焦点：截止日期比那天晚（或没有）就提前到那天；date 为空 = 移出焦点
export function setFocus(t, date) {
  if (!date) { upsert('todos', { id: t.id, focus: '', focusAt: '' }); return; }
  upsert('todos', { id: t.id, focus: date, focusAt: new Date().toISOString(), ...(!t.due || t.due > date ? { due: date } : {}) });
}
export function addFocus(title, date) { const id = uid(); upsert('todos', { id, title: title.trim(), done: false, priority: 1, due: date, time: '', tags: [], area: '', note: '', created: todayStr(), focus: date, focusAt: new Date().toISOString() }); return id; }
// 待办右键菜单里的那一项
export function focusMenuItem(s, t) {
  if (t.done) return null; const today = todayStr(), tmr = addDays(today, 1);
  if (t.focus === today || t.focus === tmr) return { label: t.focus === today ? '移出今天的焦点' : '移出明天的焦点', icon: 'flag', onClick: () => setFocus(t, '') };
  const full = (d) => focusOn(s, d).length >= MAX_FOCUS;
  return { label: '设为焦点', icon: 'flag', sub: [{ label: '今天的焦点', icon: 'sun', disabled: full(today), hint: full(today) ? '已经 3 件了' : '', onClick: () => setFocus(t, today) }, { label: '明天的焦点', icon: 'calendar', disabled: full(tmr), hint: full(tmr) ? '已经 3 件了' : '', onClick: () => setFocus(t, tmr) }] };
}

function Col({ s, date, label, sub, main }) {
  const list = focusOn(s, date); const today = todayStr();
  const [text, setText] = useState('');
  const add = () => { const v = text.trim(); if (!v) return; if (list.length >= MAX_FOCUS) { toast('焦点最多 3 件——少一点才是焦点'); return; } addFocus(v, date); setText(''); };
  // 从待办里挑：今天到期 / 过期 / 没日期的，主线在前
  const pick = (e) => {
    const cands = mainFirst(s, s.todos.filter((t) => !t.done && t.focus !== date && (!t.due || t.due <= date))).slice(0, 12);
    ctxMenu(e, cands.length ? cands.map((t) => ({ label: t.title, icon: isMain(s, t) ? 'target' : 'checksq', hint: isMain(s, t) ? '主线' : t.due && t.due < today ? '已过期' : t.due === date ? (date === today ? '今天' : '明天') : '', onClick: () => setFocus(t, date) })) : [{ label: '没有可选的待办', disabled: true }], `挑一件作为${label}的焦点`);
  };
  const menu = (e, t) => ctxMenu(e, [
    !t.done && { label: '现在就做', icon: 'play', hint: '放到专注', onClick: () => doThis(t) },
    !t.done && (date === today ? { label: '挪到明天', icon: 'right', onClick: () => setFocus(t, addDays(today, 1)) } : { label: '挪到今天', icon: 'left', onClick: () => setFocus(t, today) }),
    { label: '移出焦点', icon: 'x', hint: '待办还在', onClick: () => setFocus(t, '') },
    { label: '打开待办', icon: 'external', onClick: () => go('todos?open=' + t.id) },
  ].filter(Boolean), t.title);
  const done = list.filter((t) => t.done).length;
  // 前几天没做完的焦点：今天还有空位时提醒一下，可以一键挪过来
  const left = main ? s.todos.filter((t) => !t.done && t.focus && t.focus < today && t.focus >= addDays(today, -7)) : [];
  return html`<div class=${'fd-col ' + (main ? 'is-today' : '')}>
    <div class="fd-h"><b>${label}</b><small>${sub}</small>${list.length > 0 && html`<span class="fd-n">${done}/${list.length}</span>`}</div>
    <ol class="fd-list">
      ${list.map((t, i) => html`<li key=${t.id} class=${t.done ? 'done' : ''} onContextMenu=${(e) => menu(e, t)}>
        <button type="button" class="fd-cb" title=${t.done ? '标为未完成' : '完成'} onClick=${() => toggleTodo(t.id)}>${t.done ? html`<${Icon} name="check" size=${11} />` : i + 1}</button>
        <span class="fd-t" title=${t.title}>${t.title}${isMain(s, t) && html`<i class="q-tag">主线</i>`}</span>
        ${!t.done && main && html`<button type="button" class="fd-go" title="现在就做（放到专注）" onClick=${() => doThis(t)}><${Icon} name="play" size=${11} /></button>`}
        <button type="button" class="fd-more" title="更多" onClick=${(e) => menu(e, t)}><${Icon} name="dots" size=${13} /></button>
      </li>`)}
    </ol>
    ${list.length > 0 && done === list.length && html`<p class="fd-won"><${Icon} name="sparkle" size=${12} />${main ? '今天的焦点都完成了' : '明天的焦点定好了'}</p>`}
    ${list.length < MAX_FOCUS && html`<div class="fd-add">
      <input type="text" value=${text} placeholder=${list.length ? '再加一件（回车）' : main ? '今天最重要的一件事是…' : '明天先做哪件？'} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) add(); }} />
      <button type="button" class="fd-pick" title="从待办里挑" onClick=${pick}><${Icon} name="list" size=${13} /></button>
    </div>`}
    ${left.length > 0 && list.length < MAX_FOCUS && html`<div class="fd-left"><span>之前没做完：${left[0].title}${left.length > 1 ? ` 等 ${left.length} 件` : ''}</span><button type="button" onClick=${() => left.slice(0, MAX_FOCUS - list.length).forEach((t) => setFocus(t, today))}>挪到今天</button></div>`}
  </div>`;
}

// 总览卡片：宽的时候今天 / 明天并排；窄的时候今天为主，可以切到明天。晚上 8 点以后默认看明天
export function FocusDaysWidget({ s, wide, quote }) {
  const today = todayStr(), tmr = addDays(today, 1);
  const [tab, setTab] = useState(() => (new Date().getHours() >= 20 && focusOn(s, today).every((t) => t.done) ? 'tmr' : 'today'));
  const wk = s.weeks[weekKey()]; const weekLines = wk && wk.focus ? wk.focus.split('\n').map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim()).filter(Boolean) : [];
  const wd = (d) => '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
  return html`<${Card} class=${'fd-card ' + (wide ? 'wide' : '')}>
    <div class="card-h"><h3>今日焦点</h3><div class="card-act">${!wide && html`<div class="fd-tabs"><button type="button" class=${tab === 'today' ? 'on' : ''} onClick=${() => setTab('today')}>今天</button><button type="button" class=${tab === 'tmr' ? 'on' : ''} onClick=${() => setTab('tmr')}>明天</button></div>`}</div></div>
    <div class="fd-cols">
      ${(wide || tab === 'today') && html`<${Col} s=${s} date=${today} label="今天" sub=${`${fmtShort(today)} 周${wd(today)}`} main />`}
      ${(wide || tab === 'tmr') && html`<${Col} s=${s} date=${tmr} label="明天" sub=${`${fmtShort(tmr)} 周${wd(tmr)}`} />`}
    </div>
    ${quote && html`<div class="quote-line"><${Icon} name="sparkle" size=${13} /> ${quote.text}</div>`}
    <a class="fd-week" href="#/plan/week" title="去周计划里改">${weekLines.length ? html`<b>本周</b>${weekLines.join(' · ')}` : html`<b>本周</b><span class="muted">还没写本周焦点</span>`}<${Icon} name="right" size=${12} /></a>
  <//>`;
}
