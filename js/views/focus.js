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
  const sessions = useMemo(() => sortBy(s.blocks.filter((b) => b.date === today && b.kind === 'focus'), 'start'), [s.blocks]);
  const mins = sessions.reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0);
  const streak = useMemo(() => { let n = 0; const d = new Date(); for (;;) { const k = todayStr(d); if (s.blocks.some((b) => b.date === k && b.kind === 'focus')) { n++; d.setDate(d.getDate() - 1); } else break; if (n > 365) break; } return n; }, [s.blocks]);
  const [label, setLabel] = useState(st.label || '');
  const [todoId, setTodoId] = useState(st.todoId || '');
  const [customLen, setCustomLen] = useState(false);
  useEffect(() => { if (route.query && route.query.todo) { const t = s.todos.find((x) => x.id === route.query.todo); if (t) { setTodoId(t.id); setLabel(t.title); } } }, [route.query && route.query.todo]);
  useEffect(() => { document.title = st.phase === 'idle' ? '专注 · yunningtang OS' : `${pomo.fmt(rem)} · ${st.phase === 'break' ? '休息' : st.label || '专注'}`; return () => { document.title = 'yunningtang OS'; }; }, [rem, st.phase]);
  const r = 118, c = 2 * Math.PI * r;
  const begin = () => pomo.start({ label: label.trim(), todoId });
  const presets = [[25, 5], [45, 10], [50, 10], [90, 15]];
  const dayFrom = 6, dayTo = 24;
  const posOf = (t) => Math.max(0, Math.min(100, ((timeToMin(t) - dayFrom * 60) / ((dayTo - dayFrom) * 60)) * 100));

  return html`<div class=${'focus-page ' + st.phase + (st.paused ? ' paused' : '')}>
    <div class="focus-hero">
      <div class="fh-top">
        <div><div class="fh-k">${st.phase === 'idle' ? '准备开始' : st.phase === 'break' ? '休息一下' : st.paused ? '已暂停' : '专注中'}</div><h1 class="fh-title">${st.phase === 'idle' ? '专注' : (st.label || '专注')}</h1></div>
        <div class="fh-stats"><span><b>${sessions.length}</b>轮</span><span><b>${Math.floor(mins / 60)}<i>h</i>${String(mins % 60).padStart(2, '0')}<i>m</i></b>今天</span><span><b>${streak}</b>天连续</span></div>
      </div>
      <div class="fh-body">
        <div class="pomo-ring">
          <svg viewBox="0 0 280 280">
            <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pg1)" /><stop offset="1" stop-color="var(--pg2)" /></linearGradient></defs>
            <g class="ticks">${Array.from({ length: 60 }, (_, k) => html`<line key=${k} x1="140" y1="12" x2="140" y2=${k % 5 ? 16 : 20} transform=${`rotate(${k * 6} 140 140)`} class=${k / 60 <= pct && st.phase !== 'idle' ? 'on' : ''} />`)}</g>
            <circle cx="140" cy="140" r=${r} class="pr-bg" />
            <circle cx="140" cy="140" r=${r} class="pr-fg" stroke=${'url(#pg)'} stroke-dasharray=${c} stroke-dashoffset=${c * (1 - pct)} />
            ${st.phase !== 'idle' && html`<circle class="pr-dot" cx=${140 + r * Math.cos((pct * 360 - 90) * Math.PI / 180)} cy=${140 + r * Math.sin((pct * 360 - 90) * Math.PI / 180)} r="6" />`}
          </svg>
          <div class="pomo-t">
            <div class="pomo-time">${pomo.fmt(rem)}</div>
            <div class="pomo-sub">${st.phase === 'idle' ? `${st.workLen} 分钟 · 休息 ${st.breakLen} 分钟` : st.phase === 'break' ? `休息 ${st.breakLen} 分钟` : `第 ${sessions.length + 1} 轮 · 休息 ${st.breakLen} 分钟`}</div>
          </div>
        </div>
        ${st.phase === 'idle' ? html`
          <div class="pomo-form">
            <input class="pf-label" type="text" value=${label} placeholder="这一轮要做什么？" onInput=${(e) => setLabel(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && begin()} />
            <div class="pf-row">
              <div class="chips">${presets.map(([w, b]) => html`<button key=${w} class=${'chip ' + (st.workLen === w && !customLen ? 'on' : '')} onClick=${() => { setCustomLen(false); pomo.setLens(w, b); }}>${w}<i>分</i></button>`)}
                ${customLen ? html`<input class="chip-in" type="number" min="5" max="180" value=${st.workLen} autofocus onInput=${(e) => { const w = Math.max(5, Math.min(180, +e.target.value || 25)); pomo.setLens(w, Math.max(3, Math.round(w / 5))); }} />` : html`<button class=${'chip ' + (presets.every(([w]) => w !== st.workLen) ? 'on' : '')} onClick=${() => setCustomLen(true)}>自定义</button>`}
              </div>
              ${todos.length > 0 && html`<select class="pf-todo" value=${todoId} onChange=${(e) => { setTodoId(e.target.value); const t = s.todos.find((x) => x.id === e.target.value); if (t) setLabel(t.title); }}><option value="">关联待办…</option>${todos.map((t) => html`<option value=${t.id}>${t.title}</option>`)}</select>`}
            </div>
            <button class="pf-start" onClick=${begin}><${Icon} name="play" size=${16} /> 开始专注</button>
          </div>`
        : html`<div class="pomo-ctl">
            ${st.paused ? html`<button class="pf-start" onClick=${() => pomo.resume()}><${Icon} name="play" size=${16} /> 继续</button>` : html`<button class="pf-start ghost" onClick=${() => pomo.pause()}><${Icon} name="pause" size=${16} /> 暂停</button>`}
            ${st.phase === 'work' ? html`<button class="pf-btn" onClick=${() => pomo.stop(true)}><${Icon} name="check" size=${14} /> 提前完成</button>` : html`<button class="pf-btn" onClick=${() => pomo.skip()}><${Icon} name="right" size=${14} /> 跳过休息</button>`}
            <button class="pf-btn danger" onClick=${() => pomo.stop(false)}><${Icon} name="x" size=${14} /> 放弃</button>
          </div>`}
      </div>
    </div>
    <div class="focus-side">
      <${Card} title="今天的专注" sub=${sessions.length ? `${sessions.length} 段 · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '还没有记录'} action=${html`<a class="btn ghost sm" href="#/plan/day">时间线 →</a>`}>
        <div class="day-strip">
          ${[6, 9, 12, 15, 18, 21, 24].map((h) => html`<span class="ds-h" key=${h} style=${`left:${posOf(String(h).padStart(2, '0') + ':00')}%`}>${h}</span>`)}
          ${sessions.map((b) => html`<i key=${b.id} class="ds-b" style=${`left:${posOf(b.start)}%;width:${Math.max(1.2, posOf(b.end) - posOf(b.start))}%`} title=${`${b.title} ${b.start}–${b.end}`}></i>`)}
          ${st.phase === 'work' && html`<i class="ds-b live" style=${`left:${posOf(new Date(st.startedAt).toTimeString().slice(0, 5))}%;width:${Math.max(1.2, ((st.workLen - rem / 60) / ((dayTo - dayFrom) * 60)) * 100)}%`}></i>`}
        </div>
        ${sessions.length > 0 && html`<div class="day-sum" style="margin-top:12px">${[...sessions].reverse().map((b) => html`<div class="r" key=${b.id}><i style=${`background:${kindColor(b.kind)}`}></i><span class="mono muted" style="width:92px">${b.start}–${b.end}</span><span class="flex1">${b.title}</span><span class="muted small">${timeToMin(b.end) - timeToMin(b.start)} 分</span></div>`)}</div>`}
      <//>
      <${Card} title="快速开始" sub="点一下就进入这一项的专注">
        ${todos.length === 0 ? html`<${Empty} icon="checksq" text="今天没有待办。" />` : html`<div class="tlist">${todos.slice(0, 8).map((t) => html`<button class="tl-i" key=${t.id} onClick=${() => { setTodoId(t.id); setLabel(t.title); pomo.start({ label: t.title, todoId: t.id }); }}><${Icon} name="play" size=${12} class="muted" /><span class="flex1">${t.title}</span>${t.time && html`<small>${t.time}</small>`}</button>`)}</div>`}
      <//>
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
