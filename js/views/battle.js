// 「正在做」卡片：一次只摊开一件事——本次目标（这一轮做到什么算完成）、完成条件（步骤，能直接勾）、一个主按钮。
// 专注页和大脑页共用；全部条件勾完时有一个小小的庆祝，然后选「完成这件事」或「定下一个目标」
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { toggleTodo, update } from '../store.js';
import { Icon } from '../ui.js';
import { go, toast } from '../nav.js';
import * as pomo from '../pomo.js';
import { nextStep, clampMin, stepsProgress } from '../steps.js';
import { StepList } from './todos.js';
import { openStuck } from './stuck.js';
import { setGoal, setDoing } from '../doing.js';
import { brainOf } from '../brain.js';

export function BattleCard({ t, label = '正在做', onEdit, onPick = null, big = false }) {
  const sp = stepsProgress(t); const ns = nextStep(t); const allDone = sp.total > 0 && !ns;
  const [editing, setEditing] = useState(false); const [v, setV] = useState(t.goal || '');
  useEffect(() => { setV(t.goal || ''); }, [t.id, t.goal]);
  // 刚刚勾完最后一个条件 → 庆祝一下
  const was = useRef(allDone); const [party, setParty] = useState(false);
  useEffect(() => { if (allDone && !was.current) { setParty(true); const tm = setTimeout(() => setParty(false), 1600); was.current = allDone; return () => clearTimeout(tm); } was.current = allDone; }, [allDone]);
  const saveGoal = () => { setEditing(false); if ((v || '').trim() !== (t.goal || '')) setGoal(t.id, v); };
  const startStep = () => { pomo.start({ label: ns.title, todoId: t.id, stepId: ns.id, workLen: clampMin(ns.minutes) }); toast(`开始：${ns.title}`, { label: '去专注', onClick: () => go('focus') }); };
  const finish = () => { toggleTodo(t.id); setDoing(''); toast(`「${t.title.slice(0, 16)}」完成了`); };
  const nextGoal = () => { setGoal(t.id, ''); setV(''); setEditing(true); };
  const breakdown = () => window.dispatchEvent(new CustomEvent('seal:breakdown', { detail: t }));
  return html`<div class=${'bwn ' + (big ? 'big ' : '') + (allDone ? 'won ' : '') + (party ? 'party' : '')}>
    <div class="bwn-h">
      <span class="bwn-k">${label}</span>
      <b class="bwn-t" title="编辑" onClick=${() => onEdit && onEdit(t)}>${t.title}</b>
      <button type="button" class="bw-text" onClick=${() => openStuck(t)} title="不知道怎么推进？问问汤圆">卡住了</button>
    </div>
    <div class="bwn-goal">
      <span class="bwn-gk">本次目标</span>
      ${editing ? html`<input class="bwn-gi" type="text" value=${v} placeholder="这一轮做到什么就算完成？" ref=${(el) => { if (el && !el.dataset.f) { el.dataset.f = 1; el.focus(); } }} onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') saveGoal(); if (e.key === 'Escape') { setV(t.goal || ''); setEditing(false); } }} onBlur=${saveGoal} />`
        : t.goal ? html`<span class="bwn-gt" title="点一下改" onClick=${() => setEditing(true)}>${t.goal}</span>`
        : html`<button type="button" class="bwn-gadd" onClick=${() => setEditing(true)}>写一句：这一轮做到什么就算完成？</button>`}
    </div>
    ${sp.total > 0 ? html`<div class="bwn-ck"><span>完成条件</span><b>${sp.done}/${sp.total}</b><i class="bwn-bar"><i style=${`width:${Math.round((sp.done / sp.total) * 100)}%`}></i></i></div><${StepList} t=${t} key=${t.id} hideCat=${brainOf(t)} />`
      : html`<div class="bwn-empty"><span>还没有完成条件。拆成几个能勾的小步，会好开始很多。</span><button type="button" class="bw-text strong" onClick=${breakdown}><${Icon} name="sparkle" size=${12} />让汤圆拆一下</button></div>`}
    <div class="bwn-f">
      ${allDone ? html`<span class="bwn-won"><${Icon} name="sparkle" size=${14} />${t.goal ? '本次目标达成' : '条件都完成了'}</span><span class="flex1"></span><button type="button" class="bw-text" onClick=${nextGoal}>定下一个目标</button><button type="button" class="bw-cta" onClick=${finish}><${Icon} name="check" size=${12} />完成这件事</button>`
        : ns ? html`${onPick && html`<button type="button" class="bw-text" onClick=${onPick}>做这件</button>`}<button type="button" class="bw-cta" onClick=${startStep}><${Icon} name="play" size=${11} />开始：${ns.title} · ${clampMin(ns.minutes)} 分</button>`
        : html`${onPick && html`<button type="button" class="bw-text" onClick=${onPick}>做这件</button>`}<button type="button" class="bw-text" onClick=${finish}>做完了</button><button type="button" class="bw-cta" onClick=${() => { pomo.start({ label: t.title, todoId: t.id, workLen: t.focusLen || 25 }); toast(`开始：${t.title}`); }}><${Icon} name="play" size=${11} />直接开始</button>`}
    </div>
    ${party && html`<div class="bwn-confetti" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => html`<i key=${i} style=${`--i:${i}`}></i>`)}</div>`}
  </div>`;
}
