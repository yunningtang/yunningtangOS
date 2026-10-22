import { html, useState, useEffect, useMemo } from '../../vendor/preact.js';
import { useStore } from '../store.js';
import { Icon, Card, Btn, Seg, Empty, Tag } from '../ui.js';
import { todayStr, sortBy, timeToMin, kindColor } from '../util.js';
import * as pomo from '../pomo.js';
import { go } from '../nav.js';

export function usePomo() {
  const [st, set] = useState(pomo.get());
  useEffect(() => pomo.subscribe((s) => set({ ...s })), []);
  return st;
}

export default function Focus({ route }) {
  const s = useStore();
  const st = usePomo();
  const rem = pomo.remaining();
  const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60;
  const pct = st.phase === 'idle' ? 0 : 1 - rem / total;
  const today = todayStr();
  const todos = sortBy(s.todos.filter((t) => !t.done && (t.due === today || !t.due)), 'priority');
  const sessions = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today && b.kind === 'focus'), '-start'), [s.blocks]);
  const mins = sessions.reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0);
  const [label, setLabel] = useState(st.label || '');
  const [todoId, setTodoId] = useState(st.todoId || '');
  useEffect(() => { if (route.query && route.query.todo) { const t = s.todos.find((x) => x.id === route.query.todo); if (t) { setTodoId(t.id); setLabel(t.title); } } }, [route.query && route.query.todo]);
  useEffect(() => { document.title = st.phase === 'idle' ? '专注 · yunningtang OS' : `${pomo.fmt(rem)} · ${st.phase === 'break' ? '休息' : st.label || '专注'}`; return () => { document.title = 'yunningtang OS'; }; }, [rem, st.phase]);
  const r = 88, c = 2 * Math.PI * r;
  const begin = () => pomo.start({ label: label.trim(), todoId });

  return html`<div>
    <div class="page-h"><div><h1>专注</h1><div class="desc">番茄钟。完成的专注会自动记到今天的时间线里。</div></div></div>
    <div class="focus-layout">
      <${Card} class="pomo-card">
        <div class=${'pomo-ring ' + st.phase}>
          <svg viewBox="0 0 200 200"><circle cx="100" cy="100" r=${r} class="pr-bg" /><circle cx="100" cy="100" r=${r} class="pr-fg" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - pct)} /></svg>
          <div class="pomo-t"><div class="pomo-time">${pomo.fmt(rem)}</div><div class="pomo-sub">${st.phase === 'idle' ? '准备开始' : st.phase === 'break' ? '休息中' : st.paused ? '已暂停' : (st.label || '专注中')}</div></div>
        </div>
        ${st.phase === 'idle' ? html`
          <div class="pomo-form">
            <input type="text" value=${label} placeholder="这一轮要做什么？" onInput=${(e) => setLabel(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && begin()} />
            <select value=${todoId} onChange=${(e) => { setTodoId(e.target.value); const t = s.todos.find((x) => x.id === e.target.value); if (t && !label) setLabel(t.title); }}><option value="">不关联待办</option>${todos.map((t) => html`<option value=${t.id}>${t.title}</option>`)}</select>
            <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
              <span class="small muted">时长</span>
              <${Seg} options=${[[25, 5], [45, 10], [50, 10], [90, 15]].map(([w, b]) => ({ v: w, label: `${w} 分` }))} value=${st.workLen} onChange=${(w) => pomo.setLens(w, { 25: 5, 45: 10, 50: 10, 90: 15 }[w] || 5)} />
              <span class="small muted">休息 ${st.breakLen} 分</span>
            </div>
            <${Btn} kind="primary" icon="play" onClick=${begin}>开始专注<//>
          </div>`
        : html`<div class="pomo-ctl">
            ${st.paused ? html`<${Btn} kind="primary" icon="play" onClick=${() => pomo.resume()}>继续<//>` : html`<${Btn} icon="pause" onClick=${() => pomo.pause()}>暂停<//>`}
            ${st.phase === 'work' ? html`<${Btn} icon="check" onClick=${() => pomo.stop(true)}>提前完成<//>` : html`<${Btn} icon="right" onClick=${() => pomo.skip()}>跳过休息<//>`}
            <${Btn} kind="ghost danger" icon="x" onClick=${() => pomo.stop(false)}>放弃<//>
          </div>`}
        <div class="pomo-stats"><span>今天 <b>${sessions.length}</b> 轮</span><span>专注 <b>${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m</b></span><span>累计 <b>${st.count}</b> 轮</span></div>
      <//>
      <div class="stack">
        <${Card} title="今天的专注" sub=${sessions.length ? `${sessions.length} 段` : ''} action=${html`<a class="btn ghost sm" href="#/plan/day">时间线 →</a>`}>
          ${sessions.length === 0 ? html`<${Empty} icon="clock" text="还没有专注记录。开始第一轮。" />` : html`<div class="day-sum">${sessions.map((b) => html`<div class="r" key=${b.id}><i style=${`background:${kindColor(b.kind)}`}></i><span class="mono muted" style="width:92px">${b.start}–${b.end}</span><span class="flex1">${b.title}</span>${b.pomo && html`<${Tag} plain>番茄<//>`}</div>`)}</div>`}
        <//>
        <${Card} title="快速开始" sub="从今天的待办里选一项">
          ${todos.length === 0 ? html`<p class="small muted">今天没有待办。</p>` : html`<div class="tlist">${todos.slice(0, 8).map((t) => html`<button class="tl-i" key=${t.id} onClick=${() => { setTodoId(t.id); setLabel(t.title); pomo.start({ label: t.title, todoId: t.id }); }}><${Icon} name="play" size=${12} class="muted" /><span class="flex1">${t.title}</span>${t.time && html`<small>${t.time}</small>`}</button>`)}</div>`}
        <//>
      </div>
    </div>
  </div>`;
}

export function MiniPomo() {
  const st = usePomo();
  if (st.phase === 'idle') return null;
  const rem = pomo.remaining();
  return html`<a class=${'mini-pomo ' + st.phase + (st.paused ? ' paused' : '')} href="#/focus" title="打开专注">
    <span class="mp-time">${pomo.fmt(rem)}</span>
    <span class="mp-label nl">${st.phase === 'break' ? '休息中' : st.label || '专注中'}</span>
    <button class="ibtn nl" onClick=${(e) => { e.preventDefault(); st.paused ? pomo.resume() : pomo.pause(); }} title=${st.paused ? '继续' : '暂停'}><${Icon} name=${st.paused ? 'play' : 'pause'} size=${13} /></button>
  </a>`;
}
