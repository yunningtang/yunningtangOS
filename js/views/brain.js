// 「大脑」页：左边一张侧面的大脑看全局（点哪块看哪块），右边是这块的工作区——看、加、做都在这里
import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, get, toggleTodo } from '../store.js';
import { Icon, Card, Seg } from '../ui.js';
import { todayStr, addDays, PRIORITY } from '../util.js';
import { TodoModal, QuickAdd, StepList, todoMenu, nestProps } from './todos.js';
import { dropProps, dragProps } from '../dnd.js';
import { ctxMenu } from '../ctx.js';
import { go, toast } from '../nav.js';
import { aiEnabled } from '../ai.js';
import { openStuck } from './stuck.js';
import { nextStep, clampMin, stepsProgress } from '../steps.js';
import * as pomo from '../pomo.js';
import { loginState } from '../sync.js';
import { REGIONS, THALAMUS, regionOf, brainOf, alsoOf, moveTo, regionItems, aiSort, progress, MOODS, saveReview, pushOpenTo } from '../brain.js';

// 脑图：一颗软乎乎的卡通大脑（额头朝左），跟汤圆一个画风：云朵一样鼓鼓的轮廓、几道粗粗的软褶、一张会眨眼的小脸。
// 每块脑区是一条路径，用轮廓裁出来；小脑是后面的一个小圆包
const CX = 122, CY = 80, RX = 100, RY = 64;
// 云朵轮廓：沿椭圆取点，相邻两点之间往外鼓一个小包；下半边压扁一点
const OUT = (() => {
  const N = 15, pt = (t, k = 1) => [CX + RX * k * Math.cos(t), CY + RY * k * Math.sin(t) * (Math.sin(t) > 0 ? 0.92 : 1)];
  let d = ''; for (let i = 0; i <= N; i++) { const t = (i / N) * Math.PI * 2 + 0.2; const [x, y] = pt(t); if (!i) { d = `M${x.toFixed(1)} ${y.toFixed(1)}`; continue; } const [qx, qy] = pt(t - Math.PI / N, 1.12); d += ` Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`; }
  return d + ' Z';
})();
const CEREB = 'M162 124 C166 108 204 106 212 122 C218 136 204 148 186 147 C170 146 160 137 162 124 Z';
const STEM = 'M146 130 C148 146 147 156 144 166 Q152 172 160 166 C158 156 159 144 164 130 Z';
const OTHER = 'M128 0 L240 0 L240 74 C214 86 198 93 175 97 C155 100 135 101 113 103 C132 70 112 35 128 0 Z'; // 顶叶、枕叶：不放事，只是粉色的脑子
const SHAPES = {
  plan: { d: 'M0 0 L100 0 C84 35 104 70 90 106 L86 128 L86 160 L0 160 Z', at: [52, 58] },
  move: { d: 'M100 0 L128 0 C112 35 132 70 113 103 L90 106 C104 70 84 35 100 0 Z', at: [107, 44] },
  talk: { d: 'M90 106 C120 101 150 101 175 97 C198 93 214 86 240 74 L240 100 C214 106 198 110 175 114 C150 119 115 120 86 128 Z', at: [172, 105] },
  memory: { d: 'M86 128 C115 120 150 119 175 114 C198 110 214 106 240 100 L240 200 L86 200 Z', at: [140, 128] },
  habit: { d: CEREB, at: [190, 128], own: true },
  alarm: { d: 'M95 132 C93 124 101 119 108 121 C115 123 116 130 112 135 C108 140 98 140 95 132 Z', at: [104, 129], own: true },
};
// 软褶：几道粗粗的白色弯线，像毛绒玩具上的缝线
const FOLDS = ['M36 70 C44 58 58 62 62 52', 'M30 100 C40 92 52 100 64 90', 'M58 30 C66 40 80 36 86 28', 'M140 30 C150 42 164 30 176 42', 'M150 64 C164 54 176 70 192 60', 'M196 36 C204 48 214 46 216 60', 'M200 82 C210 78 214 86 222 84', 'M122 136 C134 130 146 138 160 132'];
const FOLIA = ['M170 120 C182 114 198 114 208 122', 'M168 132 C182 127 198 128 210 134'];

function BrainMap({ count, sel, pick, fx, hover, setHover, focus }) {
  const max = Math.max(1, ...REGIONS.map((r) => count[r.id]));
  const drop = (id) => dropProps('todo', (d) => { const t = get().todos.find((x) => x.id === d.id); if (t) moveTo(t, id); });
  const inFocus = (id) => !focus || focus.primary === id || focus.also.includes(id);
  const region = (r) => { const sh = SHAPES[r.id]; const n = count[r.id]; const k = n ? 18 + Math.round((n / max) * 30) : 9;
    const cls = 'brs-r ' + (n ? '' : 'nil ') + (hover === r.id || sel === r.id ? 'hi ' : '') + (fx[r.id] ? 'fx-' + fx[r.id].split(':')[0] + ' ' : '') + (focus ? (focus.primary === r.id ? 'fp ' : focus.also.includes(r.id) ? 'fa ' : 'dim ') : '');
    return html`<path key=${r.id} d=${sh.d} class=${cls} style=${`--c:${r.color};--k:${k}%`}
      onClick=${() => pick(r.id)} onMouseEnter=${() => setHover(r.id)} onMouseLeave=${() => setHover('')} ...${drop(r.id)}><title>${r.label} · ${r.name}${n ? ' · ' + n + ' 件' : ''}</title></path>`; };
  // 通路：主脑区到每个「也涉及」的脑区，一条往上拱的虚点线，上面有个小点在跑
  const links = focus && focus.also.length ? focus.also.map((id) => { const [x1, y1] = SHAPES[focus.primary].at; const [x2, y2] = SHAPES[id].at; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1; const bend = 18 + L * 0.25; const mx = (x1 + x2) / 2 + (dy / L) * bend * (dx >= 0 ? 1 : -1) * 0.4, my = (y1 + y2) / 2 - bend; const d = `M${x1} ${y1} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2} ${y2}`;
    return html`<g key=${id} class="brs-link" style=${`--c:${regionOf(focus.primary).color}`}><path d=${d} /><circle r="3.2"><animateMotion dur="2.8s" repeatCount="indefinite" path=${d} /></circle></g>`; }) : null;
  return html`<svg class=${'brs cute ' + (focus ? 'focusing' : '')} viewBox="0 0 240 185" role="img" aria-label="大脑脑区图">
    <defs><clipPath id="brs-out"><path d=${OUT} /></clipPath><clipPath id="brs-cb"><path d=${CEREB} /></clipPath></defs>
    <ellipse cx="128" cy="172" rx="84" ry="6" class="brs-shadow" />
    <g class="brs-body">
      <path d=${STEM} class="brs-stem" />
      ${region(REGIONS.find((r) => r.id === 'habit'))}
      <path d=${CEREB} class="brs-edge" />
      <g clip-path="url(#brs-cb)" class="brs-lines">${FOLIA.map((d) => html`<path d=${d} />`)}</g>
      <g clip-path="url(#brs-out)">
        <path d=${OTHER} class="brs-other" />
        ${REGIONS.filter((r) => !SHAPES[r.id].own).map(region)}
        <g class="brs-lines">${FOLDS.map((d) => html`<path d=${d} />`)}</g>
        <ellipse cx="78" cy="30" rx="34" ry="9" transform="rotate(-14 78 30)" class="brs-gloss" />
      </g>
      <path d=${OUT} class="brs-edge" />
      ${region(REGIONS.find((r) => r.id === 'alarm'))}
      <g class="brs-face">
        <ellipse cx="48" cy="106" rx="6" ry="3.6" class="brs-blush" /><ellipse cx="86" cy="106" rx="6" ry="3.6" class="brs-blush" />
        <g class="brs-eyes"><ellipse cx="57" cy="98" rx="2.8" ry="3.4" /><ellipse cx="77" cy="98" rx="2.8" ry="3.4" /><circle cx="58" cy="97" r="0.9" class="hl" /><circle cx="78" cy="97" r="0.9" class="hl" /></g>
        <path d="M63 104 Q67 108 67 104 Q67 108 71 104" class="brs-mouth" />
      </g>
      ${links}
      ${REGIONS.map((r) => { const n = count[r.id]; const [x, y] = SHAPES[r.id].at; const show = n || (focus && inFocus(r.id)); return show ? html`<g key=${'b' + r.id} class=${'brs-badge ' + (sel === r.id ? 'on ' : '') + (focus && !inFocus(r.id) ? 'dim' : '')} style=${`--c:${r.color}`} onClick=${() => pick(r.id)}><circle cx=${x} cy=${y} r=${r.id === 'alarm' ? 7 : 8.5} /><text x=${x} y=${y + 3.6} text-anchor="middle">${n}</text></g>` : ''; })}
    </g>
  </svg>`;
}

// 其他的事：一行就够——勾选框、标题、几步做完了几步。点标题把它换成「正在做」；类别标签悬停才出现
function Line({ t, words, onPick, onEdit, setFocus }) {
  const p = brainOf(t, words); const r = regionOf(p); const sp = stepsProgress(t);
  return html`<div class="bwl" onMouseEnter=${() => setFocus({ id: t.id, primary: p, also: alsoOf(t, words) })} onMouseLeave=${() => setFocus(null)} onContextMenu=${(e) => ctxMenu(e, todoMenu(t, onEdit), t.title)} ...${dragProps('todo', { id: t.id })} ...${nestProps(t)}>
    <button type="button" class="cb" style=${`--pc:${(PRIORITY[t.priority] || PRIORITY[2]).color}`} aria-label="完成" onClick=${() => toggleTodo(t.id)}><${Icon} name="check" size=${11} /></button>
    <span class="bwl-t" title="点一下，现在做这件" onClick=${() => onPick(t)}>${t.title}</span>
    ${sp.total > 0 && html`<span class="bwl-n">${sp.done}/${sp.total} 步</span>`}
    <button type="button" class="br-chip" title="换类别" onClick=${(e) => ctxMenu(e, regionItems(t), '换类别')}><${Icon} name=${r.icon} size=${12} />${r.label}<${Icon} name="down" size=${10} /></button>
  </div>`;
}

// 正在做：一次只摊开一件事——它的步骤全部列出来、能直接勾；没拆过就让汤圆拆
function Now({ t, onEdit }) {
  const sp = stepsProgress(t); const ns = nextStep(t); const allDone = sp.total > 0 && !ns;
  const startStep = () => { pomo.start({ label: ns.title, todoId: t.id, stepId: ns.id, workLen: clampMin(ns.minutes) }); toast(`开始：${ns.title}`, { label: '去专注', onClick: () => go('focus') }); };
  return html`<div class="bwn">
    <div class="bwn-h">
      <span class="bwn-k">正在做</span>
      <b class="bwn-t" title="编辑" onClick=${() => onEdit(t)}>${t.title}</b>
      ${sp.total > 0 && html`<span class="bwn-n">${sp.done}/${sp.total}</span>`}
      <button type="button" class="bw-text" onClick=${() => openStuck(t)} title="不知道怎么推进？问问汤圆">卡住了</button>
    </div>
    ${sp.total > 0 ? html`<${StepList} t=${t} key=${t.id} />` : html`<div class="bwn-empty"><span>还没拆成小步。大一点的事拆开会好开始很多。</span><button type="button" class="bw-text strong" onClick=${() => window.dispatchEvent(new CustomEvent('seal:breakdown', { detail: t }))}><${Icon} name="sparkle" size=${12} />让汤圆拆一下</button></div>`}
    <div class="bwn-f">
      ${allDone ? html`<button type="button" class="bw-cta" onClick=${() => toggleTodo(t.id)}><${Icon} name="check" size=${12} />步骤都做完了，完成这件事</button>`
        : ns ? html`<button type="button" class="bw-cta" onClick=${startStep}><${Icon} name="play" size=${11} />开始：${ns.title} · ${clampMin(ns.minutes)} 分</button>`
        : html`<button type="button" class="bw-cta" onClick=${() => go('focus?todo=' + t.id)}><${Icon} name="play" size=${11} />直接开始</button><button type="button" class="bw-text" onClick=${() => toggleTodo(t.id)}>做完了</button>`}
    </div>
  </div>`;
}

export default function Brain() {
  const s = useStore();
  const today = todayStr();
  const [scope, setScope] = useState('today');
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('ytos.brain.sel') || 'plan'; } catch { return 'plan'; } });
  const [editing, setEditing] = useState(null);
  const [hover, setHover] = useState('');
  const [pinned, setPinned] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.brain.doing') || '{}'); } catch { return {}; } });
  const pickTask = (t) => { const n = { ...pinned, [sel]: t.id }; setPinned(n); try { localStorage.setItem('ytos.brain.doing', JSON.stringify(n)); } catch {} };
  const [focus, setFocus] = useState(null);
  const [aiBusy, setAiBusy] = useState(''); const [aiOn, setAiOn] = useState(() => aiEnabled(loginState()));
  useEffect(() => { const h = () => setAiOn(aiEnabled(loginState())); addEventListener('ytos:login', h); return () => removeEventListener('ytos:login', h); }, []);
  const runAi = async (onlyUnsorted) => {
    if (aiBusy) return; setAiBusy(onlyUnsorted ? 'inbox' : 'all');
    try { const r = await aiSort(get(), { onlyUnsorted }); toast(r.reply || (r.n ? `汤圆分好了 ${r.n} 件` : '汤圆没分出来，再试一次？')); }
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
  // 正在做：自己点过的那件（还在这一类、没做完）优先，不然就是最该先做的那件
  const doing = list.find((t) => t.id === pinned[sel]) || next; const rest = list.filter((t) => t !== doing);
  // 顶上一句话，只说数量，不下「过载」之类的判断
  const tip = (() => {
    if (by.alarm.length) return `「压力」里有 ${by.alarm.length} 件，挑一件拆出最小的第一步？`;
    const counts = REGIONS.map((r) => [r, by[r.id].length]).filter(([, n]) => n);
    if (!counts.length) return inbox.length ? '还有事没分到脑区，在下面分一分。' : '这里很清爽。';
    const [top, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
    return counts.length === 1 ? `今天的事都在「${top.label}」。` : `今天「${top.label}」的事最多（${n} 件）${n >= 4 ? '，中间穿插点别的类型会轻松一些' : ''}。`;
  })();

  return html`<div class="brain">
    <div class="page-h">
      <div><div class="desc">今天做完 ${prog.done} / ${prog.total} 件 · 按「怎么做」来看你的事，好玩的比喻，不是神经科学</div></div>
      <div class="acts"><${Seg} options=${[{ v: 'today', label: '今天' }, { v: 'all', label: '全部' }]} value=${scope} onChange=${setScope} /></div>
    </div>
    <div class="br-grid">
      <${Card} class="br-map-card" pad=${false}>
        <div class="br-map"><${BrainMap} count=${count} sel=${sel} pick=${pick} fx=${fx} hover=${hover} setHover=${setHover} focus=${focus} /></div>
        <div class="br-keys">${REGIONS.map((r) => { const n = count[r.id]; const d = prog.by[r.id] || 0; const lit = focus && (focus.primary === r.id || focus.also.includes(r.id)); return html`<button type="button" key=${r.id} class=${'br-key ' + (sel === r.id ? 'on ' : '') + (hover === r.id || lit ? 'hi ' : '') + (n ? '' : 'nil ') + (fx[r.id] ? 'fx-' + fx[r.id].split(':')[0] : '')} style=${`--c:${r.color};--bg:${r.bg}`}
          onClick=${() => pick(r.id)} onMouseEnter=${() => setHover(r.id)} onMouseLeave=${() => setHover('')} ...${dropProps('todo', (x) => { const t = get().todos.find((y) => y.id === x.id); if (t) moveTo(t, r.id); })}>
          <span class="bk-ic"><${Icon} name=${r.icon} size=${14} /></span><span class="bk-t"><b>${r.label}</b><small>${r.name}</small></span>${d ? html`<em title="今天做完的">✓${d}</em>` : ''}<span class="bk-n">${n || ''}</span>
          ${fx[r.id] && fx[r.id].startsWith('done') && html`<span class="br-plus" key=${fx[r.id]}>✓</span>`}
        </button>`; })}</div>
        <div class="br-tip"><span>${tip}</span>${aiOn && html`<button type="button" class="br-ai" disabled=${!!aiBusy} onClick=${() => runAi(false)} title="没手动指定过的待办，让汤圆按意思重新分一遍（自己改过的不动）"><${Icon} name="sparkle" size=${12} />${aiBusy === 'all' ? '汤圆在分…' : '让汤圆分一遍'}</button>`}</div>
      <//>
      <${Card} class="br-work" style=${`--c:${cur.color};--bg:${cur.bg}`}>
        <div class="card-h"><h3><span class="bk-ic" style=${`--c:${cur.color}`}><${Icon} name=${cur.icon} size=${15} /></span>${cur.label} <span class="muted small">${cur.name} · ${list.length} 件${doneHere ? ` · 做完 ${doneHere}` : ''}</span></h3></div>
        <p class="bw-desc">${cur.desc}</p>
        ${doing ? html`<${Now} t=${doing} key=${doing.id} onEdit=${setEditing} />` : html`<div class="bw-empty"><b>${scope === 'today' ? '今天' : ''}这里还没有事</b><span>在下面直接写，会自动放进「${cur.label}」。比如：${cur.example}</span></div>`}
        ${rest.length > 0 && html`<div class="bw-sub">${doing ? '其他' : ''}</div><div class="bwls">${rest.map((t) => html`<${Line} key=${t.id} t=${t} words=${words} onPick=${pickTask} onEdit=${setEditing} setFocus=${setFocus} />`)}</div>`}
        ${alsoList.length > 0 && html`<div class="bw-sub">有步骤在「${cur.label}」</div><div class="bwls">${alsoList.map((t) => html`<${Line} key=${t.id} t=${t} words=${words} onPick=${pickTask} onEdit=${setEditing} setFocus=${setFocus} />`)}</div>`}
        <${QuickAdd} defaults=${{ due: today, brain: sel, brainBy: 'add' }} placeholder=${`加到「${cur.label}」… 比如：${cur.example}`} />
      <//>
    </div>
    ${inbox.length > 0 && html`<${Card} class="br-inbox">
      <div class="card-h"><h3><${Icon} name="dots" size=${15} class="muted" />还没分 <span class="muted small">${inbox.length}</span></h3>${aiOn && html`<button type="button" class="br-ai" disabled=${!!aiBusy} onClick=${() => runAi(true)}><${Icon} name="sparkle" size=${12} />${aiBusy === 'inbox' ? '汤圆在分…' : `让汤圆分这 ${inbox.length} 件`}</button>`}</div>
      <div class="br-in-list">${inbox.map((t) => html`<div class="br-in" key=${t.id}>
        <span class="br-in-t">${t.title}</span>
        <span class="br-in-acts">${REGIONS.map((r) => html`<button type="button" key=${r.id} title=${`${r.label} · ${r.name}`} onClick=${() => moveTo(t, r.id)}><${Icon} name=${r.icon} size=${12} />${r.label}</button>`)}</span>
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
    <div class="bc-grid">${REGIONS.map((r) => html`<a key=${r.id} href="#/brain" class=${'bc-r ' + (by[r.id] ? '' : 'nil')} style=${`--c:${r.color};--bg:${r.bg}`} onClick=${() => { try { localStorage.setItem('ytos.brain.sel', r.id); } catch {} }}>
      <b><${Icon} name=${r.icon} size=${12} />${r.label}</b><span>${by[r.id] || ''}${prog.by[r.id] ? html`<small>✓${prog.by[r.id]}</small>` : ''}</span></a>`)}</div>
    <div class="br-prog sm"><span>今天</span><span class="br-prog-bar"><i style=${`width:${prog.pct}%`}></i></span><b>${prog.done}/${prog.total}</b></div>
  <//>`;
}
