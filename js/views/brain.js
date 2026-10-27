// 「大脑」页：左边一张侧面的大脑看全局（点哪块看哪块），右边是这块的工作区——看、加、做都在这里
import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, get } from '../store.js';
import { Icon, Card, Seg } from '../ui.js';
import { todayStr, addDays } from '../util.js';
import { TodoItem, TodoModal, QuickAdd } from './todos.js';
import { dropProps } from '../dnd.js';
import { ctxMenu } from '../ctx.js';
import { go, toast } from '../nav.js';
import { aiEnabled } from '../ai.js';
import { loginState } from '../sync.js';
import { createBrain3D } from '../brain3d.js';
import { REGIONS, THALAMUS, regionOf, brainOf, alsoOf, flowOf, moveTo, regionItems, aiSort, progress, MOODS, saveReview, pushOpenTo } from '../brain.js';

// 脑图：一个侧面的大脑（额头朝左）。每块脑区是一条路径，大脑轮廓裁出来；小脑和杏仁核单独画
const OUT = 'M30 100 C18 70 30 30 70 20 C100 8 150 8 180 22 C210 35 225 60 220 88 C217 105 205 115 190 118 L175 120 C168 140 150 150 128 148 C110 147 98 140 90 130 C75 130 60 128 48 122 C38 117 33 110 30 100 Z';
const CEREB = 'M165 124 C178 114 208 114 215 128 C220 144 204 158 184 157 C167 156 156 146 160 132 Z';
const STEM = 'M138 138 C141 154 139 168 134 184 L152 184 C152 168 155 152 160 140 Z';
const OTHER = 'M128 0 L240 0 L240 74 C214 86 198 93 175 97 C155 100 135 101 113 103 C117 72 122 40 128 0 Z'; // 顶叶、枕叶：不放事，只是灰色
const SHAPES = {
  plan: { d: 'M0 0 L102 0 C97 40 93 72 90 106 L86 128 L86 150 L0 150 Z', at: [56, 62] },
  move: { d: 'M102 0 L128 0 C122 40 117 72 113 103 L90 106 C93 72 97 40 102 0 Z', at: [108, 42] },
  talk: { d: 'M90 106 C120 101 150 101 175 97 C198 93 214 86 240 74 L240 100 C214 106 198 110 175 114 C150 119 115 120 86 128 Z', at: [170, 107] },
  memory: { d: 'M86 128 C115 120 150 119 175 114 C198 110 214 106 240 100 L240 200 L86 200 Z', at: [142, 133] },
  habit: { d: CEREB, at: [190, 140], own: true },
  alarm: { d: 'M92 131 C91 124 99 120 107 121 C115 122 117 128 113 133 C109 138 95 138 92 131 Z', at: [103, 129], own: true },
};
const SULCI = ['M45 45 C55 40 62 50 72 44', 'M36 76 C50 70 58 82 74 76', 'M58 100 C68 92 76 98 84 92', 'M138 30 C150 40 160 28 174 40', 'M148 62 C162 52 172 68 188 58', 'M190 38 C198 50 206 44 212 58', 'M120 135 C135 130 148 138 165 128'];
const FOLIA = ['M166 130 C182 123 200 123 213 131', 'M164 140 C182 134 200 136 214 142', 'M170 150 C184 146 198 148 207 152'];

function BrainMap({ count, sel, pick, fx, hover, setHover, focus }) {
  const max = Math.max(1, ...REGIONS.map((r) => count[r.id]));
  const drop = (id) => dropProps('todo', (d) => { const t = get().todos.find((x) => x.id === d.id); if (t) moveTo(t, id); });
  // focus：悬停的那件事涉及哪些脑区（主 + 也涉及）。其余脑区淡下去，涉及的之间连一条线
  const inFocus = (id) => !focus || focus.primary === id || focus.also.includes(id);
  const region = (r) => { const sh = SHAPES[r.id]; const n = count[r.id]; const k = n ? 22 + Math.round((n / max) * 30) : 0;
    const cls = 'brs-r ' + (n ? '' : 'empty ') + (hover === r.id || sel === r.id ? 'hi ' : '') + (fx[r.id] ? 'fx-' + fx[r.id].split(':')[0] + ' ' : '') + (focus ? (focus.primary === r.id ? 'fp ' : focus.also.includes(r.id) ? 'fa ' : 'dim ') : '');
    return html`<path key=${r.id} d=${sh.d} class=${cls} style=${`--c:${r.color};--bg:${r.bg};--k:${k}%`}
      onClick=${() => pick(r.id)} onMouseEnter=${() => setHover(r.id)} onMouseLeave=${() => setHover('')} ...${drop(r.id)}><title>${r.label} · ${r.name}${n ? ' · ' + n + ' 件' : ''}</title></path>`; };
  const links = focus && focus.also.length ? focus.also.map((id) => { const [x1, y1] = SHAPES[focus.primary].at; const [x2, y2] = SHAPES[id].at; const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 22; return html`<path key=${id} d=${`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} class="brs-link" style=${`--c:${regionOf(focus.primary).color}`} />`; }) : null;
  return html`<svg class=${'brs ' + (focus ? 'focusing' : '')} viewBox="0 0 240 190" role="img" aria-label="大脑脑区图">
    <defs><clipPath id="brs-out"><path d=${OUT} /></clipPath><clipPath id="brs-cb"><path d=${CEREB} /></clipPath></defs>
    <path d=${STEM} class="brs-stem" />
    ${region(REGIONS.find((r) => r.id === 'habit'))}
    <g clip-path="url(#brs-cb)" class="brs-lines">${FOLIA.map((d) => html`<path d=${d} />`)}</g>
    <g clip-path="url(#brs-out)">
      <path d=${OTHER} class="brs-other" />
      ${REGIONS.filter((r) => !SHAPES[r.id].own).map(region)}
      <g class="brs-lines">${SULCI.map((d) => html`<path d=${d} />`)}</g>
    </g>
    <path d=${OUT} class="brs-outline" />
    ${region(REGIONS.find((r) => r.id === 'alarm'))}
    ${links}
    ${REGIONS.map((r) => { const n = count[r.id]; const [x, y] = SHAPES[r.id].at; const show = n || (focus && inFocus(r.id)); return show ? html`<g key=${'b' + r.id} class=${'brs-badge ' + (sel === r.id ? 'on ' : '') + (focus && !inFocus(r.id) ? 'dim' : '')} style=${`--c:${r.color}`} onClick=${() => pick(r.id)}><circle cx=${x} cy=${y} r=${r.id === 'alarm' ? 6.5 : 8.5} /><text x=${x} y=${y + 3.6} text-anchor="middle">${n}</text></g>` : ''; })}
  </svg>`;
}

// 3D 脑模型；建不起来（没有 WebGL、three.js 加载失败）就退回上面的平面图
function Brain3D(props) {
  const { count, sel, pick, hover, setHover, focus, fx } = props;
  const host = useRef(null); const eng = useRef(null); const [fail, setFail] = useState(false);
  const cb = useRef({}); cb.current = { pick, setHover };
  useEffect(() => {
    let dead = false;
    createBrain3D(host.current, {
      onPick: (id) => cb.current.pick(id), onHover: (id) => cb.current.setHover(id),
    }).then((e) => { if (dead) { e.destroy(); return; } eng.current = e; e.update({ count, sel, hover, focus, colors: Object.fromEntries(REGIONS.map((r) => [r.id, r.color])) }); })
      .catch(() => { if (!dead) setFail(true); });
    return () => { dead = true; eng.current && eng.current.destroy(); eng.current = null; };
  }, []);
  useEffect(() => { eng.current && eng.current.update({ count, sel, hover, focus }); }, [JSON.stringify(count), sel, hover, focus && focus.id]);
  useEffect(() => { if (eng.current) Object.entries(fx).forEach(([id]) => eng.current.flash(id)); }, [fx]);
  if (fail) return html`<${BrainMap} ...${props} />`;
  // 把待办拖到 3D 脑上：dropProps 收到后，用鼠标位置去问引擎落在哪个脑区
  return html`<div class="b3" ref=${host} ...${dropProps('todo', (d, { event }) => { const id = eng.current && eng.current.regionAt(event.clientX, event.clientY); const t = get().todos.find((x) => x.id === d.id); if (id && t) moveTo(t, id); })}><span class="b3-hint">拖动可以转</span></div>`;
}

// 一行待办：左边原来的待办行，右边一个脑区标签（点开就能换主脑区、勾「也涉及」——拖拽之外的明确入口）；有流转的下面画一条小路线
function Row({ t, words, sel, onEdit, setFocus }) {
  const p = brainOf(t, words); const also = alsoOf(t, words); const f = flowOf(t); const r = regionOf(p);
  const enter = () => setFocus({ id: t.id, primary: p, also });
  return html`<div class="br-row" onMouseEnter=${enter} onMouseLeave=${() => setFocus(null)}>
    <div class="br-row-main">
      <div class="flex1"><${TodoItem} t=${t} compact onEdit=${onEdit} /></div>
      <button type="button" class="br-chip" style=${`--c:${r.color};--bg:${r.bg}`} title="换脑区 / 也涉及" onClick=${(e) => ctxMenu(e, regionItems(t), t.title)}>
        <i></i>${p === sel ? '' : r.label}${also.length ? html`<span class="br-chip-more">${also.map((id) => html`<i key=${id} style=${`background:${regionOf(id).color}`}></i>`)}</span>` : ''}<${Icon} name="down" size=${10} />
      </button>
    </div>
    ${f && html`<div class="br-flow">${f.seq.map((x, i) => { const rr = regionOf(x.id); return html`${i ? html`<span class="br-flow-ar">→</span>` : ''}<span key=${i} class=${'br-flow-s ' + (i === f.at ? 'now ' : x.done >= x.n ? 'done' : '')} style=${`--c:${rr.color}`}>${rr.label}</span>`; })}</div>`}
  </div>`;
}

export default function Brain() {
  const s = useStore();
  const today = todayStr();
  const [scope, setScope] = useState('today');
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('ytos.brain.sel') || 'plan'; } catch { return 'plan'; } });
  const [editing, setEditing] = useState(null);
  const [hover, setHover] = useState('');
  const [focus, setFocus] = useState(null);
  const [aiBusy, setAiBusy] = useState(''); const [aiOn, setAiOn] = useState(() => aiEnabled(loginState()));
  useEffect(() => { const h = () => setAiOn(aiEnabled(loginState())); addEventListener('ytos:login', h); return () => removeEventListener('ytos:login', h); }, []);
  const runAi = async (onlyUnsorted) => {
    if (aiBusy) return; setAiBusy(onlyUnsorted ? 'inbox' : 'all');
    try { const r = await aiSort(get(), { onlyUnsorted }); toast(r.n ? `汤圆分好了 ${r.n} 件${r.reply ? '：' + r.reply : ''}` : r.reply || '汤圆没分出来，再试一次？'); }
    catch (e) { toast('汤圆没分成：' + e.message); }
    setAiBusy('');
  };
  // 点脑区只会选中，不会取消；手机上脑图和工作区上下排，点了顺手滚过去
  const pick = (id) => { setSel(id); try { localStorage.setItem('ytos.brain.sel', id); } catch {} if (innerWidth <= 900) setTimeout(() => document.querySelector('.br-work')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const words = s.settings.brainWords || {};
  const open = useMemo(() => s.todos.filter((t) => !t.done && (scope === 'all' || !t.due || t.due <= today)), [s.todos, scope, today]);
  // 主脑区里的事 + 「也涉及」这块的事（同一件事，不重复计数）
  const { by, also } = useMemo(() => {
    const by = { '': [] }, also = {}; REGIONS.forEach((r) => { by[r.id] = []; also[r.id] = []; });
    open.forEach((t) => { const id = brainOf(t, words); (by[id] || by['']).push(t); alsoOf(t, words).forEach((a) => also[a] && also[a].push(t)); });
    return { by, also };
  }, [open, words]);
  const count = Object.fromEntries(REGIONS.map((r) => [r.id, by[r.id].length]));
  const prog = useMemo(() => progress(s, today), [s.todos, words, today]);
  // 流转：哪一区多了事 → 那块亮一下；哪一区刚做完一件 → 冒一个 ✓
  const prev = useRef(null); const [fx, setFx] = useState({});
  useEffect(() => {
    const cur = {}; REGIONS.forEach((r) => { cur[r.id] = [by[r.id].length, prog.by[r.id] || 0]; });
    const p = prev.current; prev.current = cur; if (!p) return;
    const next = {}; REGIONS.forEach((r) => { if (cur[r.id][1] > p[r.id][1]) next[r.id] = 'done'; else if (cur[r.id][0] > p[r.id][0]) next[r.id] = 'in'; });
    if (!Object.keys(next).length) return;
    const k = Date.now(); setFx(Object.fromEntries(Object.entries(next).map(([id, v]) => [id, v + ':' + k])));
    const tm = setTimeout(() => setFx({}), 1100); return () => clearTimeout(tm);
  }, [by, prog]);
  const inbox = useMemo(() => s.todos.filter((t) => !t.done && !brainOf(t, words)), [s.todos, words]);

  const cur = regionOf(sel); const list = by[sel] || []; const alsoList = (also[sel] || []).filter((t) => !list.includes(t));
  const doneHere = prog.by[sel] || 0;
  // 下一步：先挑这一区里有日期的、最早的；没有就第一件
  const next = [...list].sort((a, b) => (a.due || '9') .localeCompare(b.due || '9') || a.priority - b.priority)[0];
  // 顶上一句话，只说数量，不下「过载」之类的判断
  const tip = (() => {
    if (by.alarm.length) return `「压力」里有 ${by.alarm.length} 件，挑一件拆出最小的第一步？`;
    const counts = REGIONS.map((r) => [r, by[r.id].length]).filter(([, n]) => n);
    if (!counts.length) return inbox.length ? '还有事没分到脑区，在下面分一分。' : '这里很清爽。';
    const [top, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
    return counts.length === 1 ? `今天的事都在「${top.label}」。` : `今天「${top.label}」的事最多（${n} 件）${n >= 4 ? '，中间穿插点别的类型会轻松一些' : ''}。`;
  })();

  return html`<div class="brain">
    <div class="br-head">
      <div><h1>大脑</h1><p>按「怎么做」来看你的事 · 好玩的比喻，不是神经科学</p></div>
      <div class="br-head-r">
        <div class="br-prog" title="今天做完的 / 今天要做的（含逾期）"><span>今天</span><span class="br-prog-bar"><i style=${`width:${prog.pct}%`}></i></span><b>${prog.done}/${prog.total}</b></div>
        <${Seg} options=${[{ v: 'today', label: '今天' }, { v: 'all', label: '全部' }]} value=${scope} onChange=${setScope} />
      </div>
    </div>
    <div class="br-grid">
      <${Card} class="br-map-card" pad=${false}>
        <div class="br-map"><${Brain3D} count=${count} sel=${sel} pick=${pick} fx=${fx} hover=${hover} setHover=${setHover} focus=${focus} /></div>
        <div class="br-keys">${REGIONS.map((r) => { const n = count[r.id]; const d = prog.by[r.id] || 0; const lit = focus && (focus.primary === r.id || focus.also.includes(r.id)); return html`<button type="button" key=${r.id} class=${'br-key ' + (sel === r.id ? 'on ' : '') + (hover === r.id || lit ? 'hi ' : '') + (n ? '' : 'empty ') + (fx[r.id] ? 'fx-' + fx[r.id].split(':')[0] : '')} style=${`--c:${r.color};--bg:${r.bg}`}
          onClick=${() => pick(r.id)} onMouseEnter=${() => setHover(r.id)} onMouseLeave=${() => setHover('')} ...${dropProps('todo', (x) => { const t = get().todos.find((y) => y.id === x.id); if (t) moveTo(t, r.id); })}>
          <i></i><span class="bk-t"><b>${r.label}</b><small>${r.name}</small></span>${d ? html`<em title="今天做完的">✓${d}</em>` : ''}<span class="bk-n">${n || ''}</span>
          ${fx[r.id] && fx[r.id].startsWith('done') && html`<span class="br-plus" key=${fx[r.id]}>✓</span>`}
        </button>`; })}</div>
        <div class="br-tip"><span>${tip}</span>${aiOn && html`<button type="button" class="br-ai" disabled=${!!aiBusy} onClick=${() => runAi(false)} title="没手动指定过的待办，让汤圆按意思重新分一遍（自己改过的不动）"><${Icon} name="sparkle" size=${12} />${aiBusy === 'all' ? '汤圆在分…' : '让汤圆分一遍'}</button>`}</div>
      <//>
      <${Card} class="br-work" style=${`--c:${cur.color};--bg:${cur.bg}`}>
        <div class="bw-head">
          <i class="bw-ic"></i>
          <div class="flex1"><h2>${cur.label}<small>${cur.name}</small></h2><p>${cur.desc}</p></div>
          <div class="bw-stat"><b>${list.length}</b><span>件${doneHere ? ` · 今天做完 ${doneHere}` : ''}</span></div>
        </div>
        ${next && html`<div class="bw-next"><span class="bw-next-k">下一步</span><span class="bw-next-t" onClick=${() => setEditing(next)}>${next.title}</span><button type="button" class="btn sm" onClick=${() => go('focus?todo=' + next.id)}><${Icon} name="clock" size=${13} />开始专注</button></div>`}
        ${list.length ? html`<div class="br-rows">${list.map((t) => html`<${Row} key=${t.id} t=${t} words=${words} sel=${sel} onEdit=${setEditing} setFocus=${setFocus} />`)}</div>`
          : html`<div class="bw-empty"><b>${scope === 'today' ? '今天' : ''}这里还没有事</b><span>在下面直接写，会自动放进「${cur.label}」。比如：${cur.example}</span></div>`}
        ${alsoList.length > 0 && html`<div class="bw-also"><div class="bw-sub">也涉及${cur.label}</div><div class="br-rows">${alsoList.map((t) => html`<${Row} key=${t.id} t=${t} words=${words} sel=${sel} onEdit=${setEditing} setFocus=${setFocus} />`)}</div></div>`}
        <${QuickAdd} defaults=${{ due: today, brain: sel }} placeholder=${`加到「${cur.label}」… 比如：${cur.example}`} />
      <//>
    </div>
    ${inbox.length > 0 && html`<${Card} class="br-inbox">
      <div class="card-h"><h3><i class="br-dot" style=${`background:${THALAMUS.color}`}></i>还没分 <span class="muted small">${inbox.length}</span></h3>${aiOn && html`<button type="button" class="br-ai" disabled=${!!aiBusy} onClick=${() => runAi(true)}><${Icon} name="sparkle" size=${12} />${aiBusy === 'inbox' ? '汤圆在分…' : `让汤圆分这 ${inbox.length} 件`}</button>`}</div>
      <div class="br-in-list">${inbox.map((t) => html`<div class="br-in" key=${t.id}>
        <span class="br-in-t">${t.title}</span>
        <span class="br-in-acts">${REGIONS.map((r) => html`<button type="button" key=${r.id} title=${`${r.label} · ${r.name}`} style=${`--c:${r.color};--bg:${r.bg}`} onClick=${() => moveTo(t, r.id)}>${r.label}</button>`)}</span>
      </div>`)}</div>
    <//>`}
    <${Review} s=${s} today=${today} prog=${prog} by=${by} />
    <${TodoModal} open=${!!editing} todo=${editing} onClose=${() => setEditing(null)} />
  </div>`;
}

// 复盘：平时只是一行「今天感觉怎么样？」+ 心情，点「写两句」才展开完整的；晚上 6 点后这一行会提醒一下
function Review({ s, today, prog, by }) {
  const saved = (s.settings.brainReview || {})[today] || {};
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(saved.note || '');
  const [moved, setMoved] = useState(0);
  const evening = new Date().getHours() >= 18;
  const left = s.todos.filter((t) => !t.done && t.due && t.due <= today).length; // 跟 pushOpenTo 挪的是同一批
  const m = MOODS.find((x) => x.v === saved.mood);
  if (saved.done && !open) return html`<div class="br-rv-bar done"><${Icon} name="check" size=${14} /><span class="flex1">今天复盘过了${m ? ' · ' + m.label : ''}${saved.note ? html` · <i>${saved.note}</i>` : ''}</span><button type="button" class="btn ghost sm" onClick=${() => setOpen(true)}>改一下</button></div>`;
  const moods = html`<div class="br-moods">${MOODS.map((x) => html`<button type="button" key=${x.v} class=${saved.mood === x.v ? 'on' : ''} onClick=${() => saveReview(today, { mood: x.v })}>${x.label}</button>`)}</div>`;
  if (!open) return html`<div class=${'br-rv-bar ' + (evening ? 'eve' : '')}><${Icon} name="moon" size=${14} /><span class="br-rv-q">今天感觉怎么样？</span>${moods}<button type="button" class="btn ghost sm" onClick=${() => setOpen(true)}>${evening ? '复盘一下' : '写两句'}</button></div>`;
  const top = REGIONS.map((r) => [r, prog.by[r.id] || 0]).sort((a, b) => b[1] - a[1])[0];
  const line = !prog.done ? '今天还没勾掉什么事，没关系，明天挑一件最小的开头。'
    : [`今天做完 ${prog.done} 件，`, top[1] ? `「${top[0].label}」的最多。` : '', prog.by.alarm ? '「压力」里的事也动了，这个最难，值得记一笔。' : by.alarm.length ? `「压力」里还剩 ${by.alarm.length} 件，明天先拆它？` : ''].join('');
  return html`<${Card} class="br-review">
    <div class="card-h"><h3><${Icon} name="moon" size=${15} />今天的复盘</h3><button type="button" class="ibtn" title="收起" onClick=${() => setOpen(false)}><${Icon} name="x" size=${14} /></button></div>
    <p class="br-rv-line">${line}</p>
    <div class="br-rv-bars">${REGIONS.map((r) => { const d = prog.by[r.id] || 0; const l = by[r.id].length; return html`<div class="br-rv-b" key=${r.id} style=${`--c:${r.color};--bg:${r.bg}`} title=${`${r.label}：做完 ${d}，还剩 ${l}`}>
      <span class="br-rv-n">${r.label}</span><span class="br-rv-track"><i class="d" style=${`flex:${d}`}></i><i class="l" style=${`flex:${l}`}></i>${!d && !l ? html`<i class="z"></i>` : ''}</span><small>${d}/${d + l}</small></div>`; })}</div>
    <div class="br-rv-row"><span class="br-rv-k">感觉</span>${moods}</div>
    <div class="br-rv-row"><span class="br-rv-k">一句话</span><input class="flex1" type="text" value=${note} placeholder="今天最想记住的一件事…" onInput=${(e) => setNote(e.target.value)} onBlur=${() => saveReview(today, { note: note.trim() })} /></div>
    <div class="br-rv-acts">
      ${(left > 0 || moved) && html`<button type="button" class="btn ghost sm" disabled=${!!moved} onClick=${() => setMoved(pushOpenTo(s, today, addDays(today, 1)) || -1)}>${moved > 0 ? `已挪 ${moved} 件到明天` : moved < 0 ? '没有要挪的' : `没做完的 ${left} 件挪到明天`}</button>`}
      <button type="button" class="btn sm" onClick=${() => { saveReview(today, { note: note.trim(), done: true }); setOpen(false); }}>完成复盘</button>
    </div>
  <//>`;
}

// 总览上的「今天的大脑」小卡
export function BrainCard({ s }) {
  const today = todayStr(); const words = s.settings.brainWords || {};
  const prog = progress(s, today);
  const by = {}; REGIONS.forEach((r) => { by[r.id] = 0; });
  s.todos.forEach((t) => { if (!t.done && (!t.due || t.due <= today)) { const id = brainOf(t, words); if (id in by) by[id]++; } });
  return html`<${Card} class="brain-card">
    <div class="card-h"><h3>今天的大脑</h3><div class="card-act"><a class="ibtn" href="#/brain" title="打开大脑"><${Icon} name="brain" size=${15} /></a></div></div>
    <div class="bc-grid">${REGIONS.map((r) => html`<a key=${r.id} href="#/brain" class=${'bc-r ' + (by[r.id] ? '' : 'empty')} style=${`--c:${r.color};--bg:${r.bg}`} onClick=${() => { try { localStorage.setItem('ytos.brain.sel', r.id); } catch {} }}>
      <b>${r.label}</b><span>${by[r.id] || ''}${prog.by[r.id] ? html`<small>✓${prog.by[r.id]}</small>` : ''}</span></a>`)}</div>
    <div class="br-prog sm"><span>今天</span><span class="br-prog-bar"><i style=${`width:${prog.pct}%`}></i></span><b>${prog.done}/${prog.total}</b></div>
  <//>`;
}
