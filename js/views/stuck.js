// 「汤圆，我卡住了」：在一件事上停住时，先说卡在哪，汤圆给一个 5–15 分钟就能开始的小动作。
// 有 AI 时问 /api/agent 的 stuck 模式；没有就用本地的几条简单规则，照样能用。
// 每次求助都记在这件事的 stuckLog 里（卡点、建议来自哪、有没有用），以后能看出哪种帮法真的有效。
import { html, useState, useEffect } from '../../vendor/preact.js';
import { get, update } from '../store.js';
import { Icon, Modal } from '../ui.js';
import { uid, todayStr, pad, WEEKDAY_SUN } from '../util.js';
import { go, toast } from '../nav.js';
import { aiEnabled, aiHeaders, recordUsage } from '../ai.js';
import { loginState } from '../sync.js';
import { stepsOf } from '../steps.js';
import { brainOf, moveTo } from '../brain.js';

export const REASONS = [
  { id: 'start', label: '不知道怎么开始', icon: 'play' },
  { id: 'understand', label: '有些内容看不懂', icon: 'search' },
  { id: 'next', label: '不知道下一步做什么', icon: 'right' },
  { id: 'stress', label: '感觉压力很大', icon: 'heart' },
];
export const openStuck = (t) => window.dispatchEvent(new CustomEvent('stuck:open', { detail: t.id }));

// 没有 AI 时的本地建议
function localHelp(t, reason) {
  const short = String(t.title || '').slice(0, 16); const next = stepsOf(t).find((x) => !x.done);
  if (reason === 'understand') return { reply: '看不懂很正常，先把它变成一个具体的问题。', first: { title: '把看不懂的地方写成一个问题', minutes: 5 }, tip: '写成「X 是什么」或「为什么会 Y」，再去查或者问人，会容易很多。', next: [] };
  if (reason === 'next') return next ? { reply: '按之前拆好的，接着是这一步。', first: { title: next.title, minutes: 15, fromStep: true }, tip: '', next: [] } : { reply: '先想清楚「做完」长什么样，下一步就好找了。', first: { title: `写下「${short}」做完是什么样子`, minutes: 5 }, tip: '', next: [] };
  if (reason === 'stress') return { reply: '压力大的时候，先别想做完，只想开个头。', first: { title: next ? `只做 5 分钟：${next.title}` : `只做 5 分钟「${short}」，到点就停`, minutes: 5, fromStep: !!next }, tip: '可以先把标准降一点：先做一个能交差的版本，再慢慢改。', next: [] };
  return { reply: '先找一个最小的入口。', first: { title: next ? `只做第一点点：${next.title}` : `打开和「${short}」有关的东西，写下第一句`, minutes: 5, fromStep: !!next }, tip: '', next: [] };
}

const logStuck = (id, patch, at) => update((d) => {
  const t = d.todos.find((x) => x.id === id); if (!t) return;
  const log = Array.isArray(t.stuckLog) ? t.stuckLog : [];
  const i = log.findIndex((x) => x.at === at);
  if (i >= 0) log[i] = { ...log[i], ...patch }; else log.push({ at, ...patch });
  t.stuckLog = log.slice(-12);
});

export function StuckPanel() {
  const [id, setId] = useState(null);
  const [phase, setPhase] = useState('pick'); // pick | loading | result
  const [reason, setReason] = useState(''); const [text, setText] = useState('');
  const [res, setRes] = useState(null); const [at, setAt] = useState(0); const [done, setDone] = useState({});
  useEffect(() => { const h = (e) => { setId(e.detail); setPhase('pick'); setReason(''); setText(''); setRes(null); setDone({}); }; addEventListener('stuck:open', h); return () => removeEventListener('stuck:open', h); }, []);
  const t = id ? get().todos.find((x) => x.id === id) : null;
  const close = () => setId(null);
  if (!t) return null;

  const ask = async (r) => {
    const why = r || 'other'; setReason(why); setPhase('loading'); const stamp = Date.now(); setAt(stamp);
    let out = null, src = 'local';
    if (aiEnabled(loginState())) {
      try {
        const now = new Date();
        const resp = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ mode: 'stuck', text: text.trim() || (REASONS.find((x) => x.id === why) || {}).label || '卡住了', context: { today: todayStr(), weekday: WEEKDAY_SUN[now.getDay()], now: `${pad(now.getHours())}:${pad(now.getMinutes())}`, title: t.title, note: t.note || '', due: t.due || '', steps: stepsOf(t).map((x) => ({ title: x.title, done: !!x.done })), reason: why } }) });
        const j = await resp.json().catch(() => ({}));
        if (resp.ok && j.first) { recordUsage(j); out = { reply: j.reply, first: j.first, tip: j.tip, next: j.next || [] }; src = 'ai'; }
      } catch {}
    }
    if (!out) out = localHelp(t, why);
    setRes({ ...out, src }); setPhase('result');
    logStuck(t.id, { reason: why, text: text.trim().slice(0, 120) || undefined, src, first: out.first && out.first.title }, stamp);
  };
  // 把建议的动作插到第一个没做完的步骤前面
  const addFirst = () => {
    if (!res.first) return;
    update((d) => { const x = d.todos.find((y) => y.id === t.id); if (!x) return; const st = Array.isArray(x.steps) ? x.steps : []; const i = st.findIndex((y) => !y.done); const s = { id: uid(), title: res.first.title, minutes: res.first.minutes, kind: '', done: false }; st.splice(i < 0 ? st.length : i, 0, s); x.steps = st; });
    setDone((v) => ({ ...v, first: true })); logStuck(t.id, { added: true }, at);
  };
  const addNext = () => {
    update((d) => { const x = d.todos.find((y) => y.id === t.id); if (!x) return; const st = Array.isArray(x.steps) ? x.steps : []; const have = new Set(st.map((y) => y.title)); res.next.filter((n) => !have.has(n)).forEach((n) => st.push({ id: uid(), title: n, minutes: 25, kind: '', done: false })); x.steps = st; });
    setDone((v) => ({ ...v, next: true }));
  };
  const feedback = (ok) => { logStuck(t.id, { helpful: ok }, at); setDone((v) => ({ ...v, fb: ok ? 'yes' : 'no' })); };
  const start = () => { if (!done.first && !res.first.fromStep) addFirst(); close(); go('focus?todo=' + t.id); };

  return html`<${Modal} open=${true} onClose=${close} title="汤圆，我卡住了">
    <div class="stuck">
      <p class="stuck-t">「${t.title}」</p>
      ${phase === 'pick' && html`
        <p class="stuck-sub">没关系，先看看是什么卡住了。</p>
        <div class="stuck-opts">${REASONS.map((r) => html`<button type="button" key=${r.id} class="stuck-opt" onClick=${() => ask(r.id)}><${Icon} name=${r.icon} size=${15} /><span>${r.label}</span></button>`)}</div>
        <div class="stuck-own"><input type="text" value=${text} placeholder="或者用自己的话说说卡在哪…" onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && text.trim() && ask('')} /><button type="button" class="btn sm" disabled=${!text.trim()} onClick=${() => ask('')}>告诉汤圆</button></div>`}
      ${phase === 'loading' && html`<p class="stuck-wait">汤圆在想…</p>`}
      ${phase === 'result' && res && html`
        <div class="stuck-reply">${res.reply}</div>
        ${res.first && html`<div class="stuck-first"><span class="stuck-k">先做这个</span><b>${res.first.title}</b><small>${res.first.minutes} 分钟</small>
          <div class="stuck-acts"><button type="button" class="btn sm" onClick=${start}><${Icon} name="clock" size=${13} />现在开始 ${res.first.minutes} 分钟</button>${!res.first.fromStep && html`<button type="button" class="btn ghost sm" disabled=${done.first} onClick=${addFirst}>${done.first ? '已加成第一步' : '加成第一步'}</button>`}</div></div>`}
        ${res.tip && html`<p class="stuck-tip">${res.tip}</p>`}
        ${res.next && res.next.length > 0 && html`<div class="stuck-next"><span class="stuck-k">接下来</span><ol>${res.next.map((n) => html`<li>${n}</li>`)}</ol><button type="button" class="btn ghost sm" disabled=${done.next} onClick=${addNext}>${done.next ? '已加进步骤' : '都加进步骤'}</button></div>`}
        ${reason === 'stress' && brainOf(t) !== 'alarm' && html`<button type="button" class="stuck-link" onClick=${() => { moveTo(t, 'alarm'); toast('放进了「压力」，大脑页上会单独标出来'); }}>把它放进「压力」，单独看着它</button>`}
        <div class="stuck-fb">${done.fb ? html`<span>${done.fb === 'yes' ? '记下了，下次还这么帮你' : '记下了，下次换个法子'}</span>` : html`<span>这个建议有用吗？</span><button type="button" onClick=${() => feedback(true)}>有用</button><button type="button" onClick=${() => feedback(false)}>没什么用</button>`}
          <button type="button" class="stuck-again" onClick=${() => { setPhase('pick'); setRes(null); }}>换个说法</button></div>
        ${res.src === 'local' && html`<p class="stuck-note">没接 AI，这是简单版的建议。登录并开着 AI 时，汤圆会看着这件事具体说。</p>`}`}
    </div>
  <//>`;
}
