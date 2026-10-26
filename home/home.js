// 官网：3D 汤圆 + 首屏对话演示 + 各区块的小动画。只用 App 的 seal3d.js，不读写任何数据。
import { loadThree, buildSeal } from '/js/seal3d.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const seen = (el, cb, threshold = 0.15) => {
  const io = new IntersectionObserver((es) => es.forEach((e) => cb(e.isIntersecting, e)), { threshold });
  io.observe(el); return io;
};

/* ---------- 活的汤圆：看鼠标、眨眼、呼吸，点一下会跳 ---------- */
function liveSeal(stage, size = 210) {
  const cv = $('canvas', stage);
  let model = null, raf = 0, visible = false, t0 = performance.now(), T = 0;
  let lookX = 0, lookY = 0, hop = 0, hopV = 0, flap = 0, happy = 0, blinkT = 1.5, blink = 0, spin = 0;
  let cost = 0, n = 0; // 渲染一帧要多久；显卡慢（软件渲染）时就隔几帧才画一次
  const lerp = (a, b, k) => a + (b - a) * k;
  const frame = (now) => {
    raf = 0; if (!model || !visible) return;
    n++; const skip = cost > 24 ? 6 : cost > 12 ? 2 : 1;
    if (n % skip) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, (now - t0) / 1000); t0 = now; T += dt;
    const { seal, eyes, flips, tailPiv, headPiv, shadowMesh, renderer, scene, camera } = model;
    hopV -= 0.012; hop += hopV; if (hop < 0) { hop = 0; hopV = Math.abs(hopV) > 0.02 ? -hopV * 0.35 : 0; }
    flap = Math.max(0, flap - dt * 1.2); happy = Math.max(0, happy - dt * 0.7); spin = Math.max(0, spin - dt * 1.6);
    const breathe = still ? 0 : Math.sin(T * 2.2) * 0.018;
    seal.scale.set(1 - breathe * 0.4, 1 + breathe, 1);
    const k = 1 - Math.min(0.5, hop * 4); shadowMesh.scale.set(1.15 * k, 0.62 * k, 1); shadowMesh.material.opacity = k;
    seal.position.y = hop * 1.7 + (still ? 0 : Math.sin(T * 1.6) * 0.03);
    seal.rotation.y = lerp(seal.rotation.y, lookX * 0.32 + Math.sin(spin * Math.PI) * 0.6, 0.1);
    seal.rotation.x = lerp(seal.rotation.x, lookY * 0.12, 0.1);
    headPiv.rotation.x = lerp(headPiv.rotation.x, lookY * 0.2 - 0.04 + (still ? 0 : Math.sin(T * 1.3) * 0.03), 0.1);
    headPiv.rotation.y = lerp(headPiv.rotation.y, lookX * 0.3, 0.1);
    tailPiv.rotation.y = still ? 0 : Math.sin(T * 2) * 0.14;
    flips.forEach(({ piv, sx }) => { piv.rotation.z = sx * flap * Math.sin(T * 22) * 0.6; });
    blinkT -= dt; if (blinkT < 0) { blink = 1; blinkT = 2.6 + Math.random() * 2.6; }
    blink = Math.max(0, blink - dt * 7);
    const ey = Math.max(0.08, Math.min(1 - Math.sin(blink * Math.PI), 1 - Math.min(1, happy) * 0.8));
    eyes.forEach((g) => { g.scale.y = lerp(g.scale.y, ey, 0.5); });
    const r0 = performance.now(); renderer.render(scene, camera); cost = cost * 0.9 + (performance.now() - r0) * 0.1;
    raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf && model && visible) { t0 = performance.now(); raf = requestAnimationFrame(frame); } };
  seen(stage, (v) => { visible = v && !document.hidden; kick(); }, 0);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden && stage.getBoundingClientRect().bottom > 0; kick(); });
  addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    lookX = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 420));
    lookY = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 420));
  }, { passive: true });
  loadThree().then((THREE) => { model = buildSeal(THREE, cv, size); kick(); }).catch(() => stage.classList.add('nogl'));
  const api = {
    hop() { hopV = 0.09; flap = 1; },
    happy(v = 1.3) { happy = v; },
    spin() { spin = 1; },
  };
  const poke = () => { api.hop(); api.happy(); api.spin(); };
  stage.addEventListener('click', poke);
  stage.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poke(); } });
  return api;
}

const hero = liveSeal($('#sealHero'));
liveSeal($('#sealJoin'));

const bubble = $('#bubble');
let bubT = 0;
const say = (t) => { bubble.textContent = t; bubble.classList.add('on'); clearTimeout(bubT); bubT = setTimeout(() => bubble.classList.remove('on'), 2200); };
const hellos = ['嗨，我是汤圆', '今天想做点什么？', '说一句话就行', '我先写草稿，你来定'];
let hi = 0;
$('#sealHero').addEventListener('click', () => say(hellos[hi++ % hellos.length]));
setTimeout(() => say(hellos[hi++]), 1400);

/* ---------- 标题逐字出现 ---------- */
const h1 = $('#h1');
if (!still) h1.innerHTML = [...h1.textContent].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join('');

/* ---------- 首屏对话演示 ---------- */
const MODES = {
  record: { p: '周四下午和导师过一遍论文进度，之前要把这周读的三篇笔记整理好，顺便约个跑步。', k: '一条笔记', s: '好，我记下来' },
  split: { p: '帮我把「准备周四的论文讨论」拆成几步，每步小到马上能开始。', k: '5 个步骤', s: '拆好了，看看' },
  plan: { p: '把这些排进这周，晚上和周三上午我比较有空。', k: '4 个时段', s: '排进空档里了' },
  resume: { p: '我回来了，上次做到哪了？', k: '上次的进度', s: '欢迎回来' },
};
const ORDER = Object.keys(MODES);
const typed = $('#typed'), kind = $('#kind');
let mode = 'split', typeT = 0, autoT = 0, auto = true, heroOn = true;
function setSaved(v) { $('#saved').hidden = !v; $('#unsaved').hidden = v; $('#confirm').hidden = v; $('#undo').hidden = !v; }
function show(m, fromUser) {
  mode = m; clearInterval(typeT); clearTimeout(autoT); setSaved(false);
  $$('[data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $$('.pane').forEach((d) => { d.hidden = true; });
  $('#thinking').hidden = false;
  kind.textContent = MODES[m].k;
  const full = MODES[m].p;
  if (fromUser) { hero.hop(); say(MODES[m].s); }
  const reveal = () => { $('#thinking').hidden = true; $(`.pane[data-show="${m}"]`).hidden = false; scheduleNext(); };
  if (still) { typed.textContent = full; reveal(); return; }
  let n = 0; typed.textContent = '';
  typeT = setInterval(() => { typed.textContent = full.slice(0, ++n); if (n >= full.length) { clearInterval(typeT); setTimeout(reveal, 250); } }, 34);
}
function scheduleNext() {
  clearTimeout(autoT); if (!auto) return;
  autoT = setTimeout(() => { if (auto && heroOn && !document.hidden) show(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]); else scheduleNext(); }, 5200);
}
const stopAuto = () => { auto = false; clearTimeout(autoT); };
$$('[data-mode]').forEach((b) => b.addEventListener('click', () => { stopAuto(); show(b.dataset.mode, true); }));
$('#replay').addEventListener('click', () => { stopAuto(); show(mode, true); });
$('#confirm').addEventListener('click', () => { stopAuto(); setSaved(true); hero.hop(); hero.happy(1.6); say('存好啦'); });
$('#undo').addEventListener('click', () => setSaved(false));
seen($('.composer-w'), (v) => { heroOn = v; }, 0);
show('split');

/* ---------- 跑马灯 ---------- */
const IC = {
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  split: '<path d="M6 4v6a4 4 0 0 0 4 4h8M14 10l4 4-4 4"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
};
const LINES = [
  ['pen', '记一下：周五前交报销单'], ['split', '把「搬家」拆成几步'], ['cal', '今天下午还有空吗？'], ['book', '这本书两周读完，帮我排一下'],
  ['clock', '先做 2 分钟'], ['star', '写一句这个月的愿景'], ['split', '准备组会要做什么'], ['cal', '把跑步排进这周'],
  ['pen', '这个链接存到收藏'], ['clock', '我上次做到哪了'], ['book', '总结一下这篇笔记'], ['star', '这周最重要的三件事'],
];
const chip = ([i, t]) => `<span class="mq"><svg viewBox="0 0 24 24" width="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[i]}</svg>${t}</span>`;
const half = (arr) => arr.map(chip).join('');
$('#belt1').innerHTML = half(LINES.slice(0, 6)).repeat(4);
$('#belt2').innerHTML = half(LINES.slice(6)).repeat(4);

/* ---------- 滚动出现 ---------- */
$$('[data-reveal]').forEach((el) => { const io = seen(el, (v) => { if (v) { el.classList.add('in'); io.disconnect(); } }); });
const trans = $('#trans');
const tio = seen(trans, (v) => { if (v) { trans.classList.add('in'); tio.disconnect(); } }, 0.25);

/* ---------- 顶栏、点阵视差、卡片跟手光 ---------- */
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 8), { passive: true });
const dots = $('#heroDots');
if (!still) addEventListener('pointermove', (e) => {
  const dx = e.clientX / innerWidth - 0.5, dy = e.clientY / innerHeight - 0.5;
  dots.style.transform = `translate(${(-dx * 14).toFixed(1)}px, ${(-dy * 14).toFixed(1)}px)`;
}, { passive: true });
$$('.tile').forEach((t) => t.addEventListener('pointermove', (e) => {
  const r = t.getBoundingClientRect();
  t.style.setProperty('--mx', `${e.clientX - r.left}px`); t.style.setProperty('--my', `${e.clientY - r.top}px`);
}));

/* ---------- 只在看得见时跑的循环 ---------- */
function loop(el, ms, fn) {
  let id = 0;
  seen(el, (v) => { clearInterval(id); if (v) { fn(); id = setInterval(fn, ms); } }, 0.2);
}
const pad = (n) => String(n).padStart(2, '0');

// 时间线：当前时间那条红线慢慢往下走，走过的块变淡
const tl = $('#tl'), now = $('#now'), nowT = $('#nowT'), rows = $$('.r', tl);
const STARTS = [9 * 60, 11 * 60 + 30, 14 * 60, 16 * 60 + 30];
let clock = 9 * 60;
loop(tl, 1000, () => {
  clock += 20; if (clock > 18 * 60) clock = 9 * 60;
  let y = 0;
  for (let i = 0; i < STARTS.length; i++) {
    const a = STARTS[i], b = STARTS[i + 1] ?? 18 * 60;
    if (clock >= a && clock < b) { y = 22 + i * 44 + ((clock - a) / (b - a)) * 44; break; }
    if (clock >= b) y = 22 + (i + 1) * 44;
  }
  now.style.transition = clock === 9 * 60 + 20 ? 'none' : '';
  now.style.top = `${Math.min(y, rows.length * 44 - 2)}px`;
  nowT.textContent = `${pad(Math.floor(clock / 60))}:${pad(clock % 60)}`;
  rows.forEach((r, i) => { $('.bb', r).classList.toggle('done', clock >= (STARTS[i + 1] ?? 99999)); $('.h', r).classList.toggle('under', Math.abs(22 + i * 44 - y) < 16); });
});

// 专注：剩余时间的扇形一点点变小
const ticks = $('#ticks');
for (let i = 0; i < 60; i++) {
  const a = (i / 60) * Math.PI * 2, r1 = i % 5 ? 51 : 48;
  const x1 = 60 + Math.sin(a) * 53, y1 = 60 - Math.cos(a) * 53, x2 = 60 + Math.sin(a) * r1, y2 = 60 - Math.cos(a) * r1;
  ticks.insertAdjacentHTML('beforeend', `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"${i % 5 ? '' : ' stroke="#9B9A97"'} />`);
}
const sector = $('#sector'), tm = $('#tm');
const arc = (f) => {
  if (f >= 0.999) return 'M60 60 m-44 0 a44 44 0 1 0 88 0 a44 44 0 1 0 -88 0';
  const a = f * Math.PI * 2, x = 60 + Math.sin(a) * 44, y = 60 - Math.cos(a) * 44;
  return `M60 60 L60 16 A44 44 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
};
let left = 25 * 60;
loop($('.timer'), 120, () => {
  left -= 6; if (left <= 0) left = 25 * 60;
  sector.setAttribute('d', arc(left / (25 * 60)));
  tm.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
});

// 待办：一条条勾掉，全勾完再重来
const todos = $$('.r', $('#todo'));
let tdi = 0;
loop($('#todo'), 1500, () => {
  if (tdi >= todos.length + 1) { todos.forEach((r) => r.classList.remove('done')); tdi = 0; return; }
  if (tdi < todos.length) todos[tdi].classList.add('done');
  tdi++;
});
