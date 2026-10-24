// 汤圆：住在角落里的 3D 小海豹助手。按住可以拖到任意位置（松手吸到最近的屏幕边），点一下打开对话。
// 对话里说一句话，汤圆把它拆成 待办 / 时间块 / 笔记，先给你预览，确认后才写入。
// 有 AI（Vercel 上配置了 ANTHROPIC_API_KEY 且已登录）时走 /api/agent；没有就退回随手记的本地语法。
import { html, useState, useEffect, useRef } from '../vendor/preact.js';
import { useStore, upsert, get } from './store.js';
import { Icon } from './ui.js';
import { uid, todayStr, WEEKDAY_SUN, timeToMin, minToTime, allKinds, pad } from './util.js';
import { loginState } from './sync.js';
import { detect, plan } from './capture.js';
import { newNote } from './views/notes.js';
import { mdToBlocks } from './blocks.js';
import { go, toast } from './nav.js';

const S = 88, M = 18; // fab size / margin
const KIND_LABEL = { todo: '待办', block: '时间块', note: '笔记' };

/* ---------------- three.js (vendored) ---------------- */
let threeP;
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  threeP = threeP || new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = new URL('../vendor/three.min.js', import.meta.url).href;
    sc.onload = () => res(window.THREE); sc.onerror = () => rej(new Error('three failed'));
    document.head.appendChild(sc);
  });
  return threeP;
}

/* ---------------- 3D 海豹模型（软胶公仔风） ---------------- */
function buildSeal(THREE, cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5)); renderer.setSize(150, 150, false);
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .98;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, .1, 50); camera.position.set(0, 1.45, 8.3); camera.lookAt(0, -.05, 0);

  // 柔光棚环境贴图：几块发光板，给材质柔和的反射
  const pm = new THREE.PMREMGenerator(renderer); const studio = new THREE.Scene();
  studio.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0xb9c6d2, side: THREE.BackSide })));
  [[0, 9, 4, 14, 0xffffff, 2.2], [-9, 3, 6, 6, 0xffffff, 1.6], [9, 2, 3, 6, 0xe6f2ff, 1.1], [0, 4, -9, 10, 0xd8ecff, 1.2]].forEach(([x, y, z, s, c, i]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide }));
    p.position.set(x, y, z); p.lookAt(0, 0, 0); studio.add(p);
  });
  scene.environment = pm.fromScene(studio, .04).texture;
  const key = new THREE.DirectionalLight(0xfffaf4, .9); key.position.set(-3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe3f1ff, .45); rim.position.set(2, 3, -5); scene.add(rim);

  const fur = new THREE.MeshPhysicalMaterial({ color: 0xd6dce2, roughness: .95, metalness: 0, clearcoat: .08, clearcoatRoughness: .6, sheen: new THREE.Color(0xffffff), envMapIntensity: .32 });
  const gloss = new THREE.MeshPhysicalMaterial({ color: 0x07080b, roughness: .04, metalness: 0, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: .55 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // 蓬松长毛：多层毛发壳
  const nc = document.createElement('canvas'); nc.width = nc.height = 256; const nx = nc.getContext('2d'); const id = nx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const r = Math.pow(Math.random(), 1.6) * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = r; id.data[i * 4 + 3] = 255; }
  nx.putImageData(id, 0, 0); const furTex = new THREE.CanvasTexture(nc); furTex.wrapS = furTex.wrapT = THREE.RepeatWrapping; furTex.generateMipmaps = false; furTex.minFilter = furTex.magFilter = THREE.NearestFilter;
  const addFur = (mesh, rep, len, N = 18, c0 = 0xb7bfc8, c1 = 0xffffff) => {
    const base = mesh.geometry;
    for (let i = 1; i <= N; i++) {
      const k = i / N, g = base.clone(), p = g.attributes.position, n = g.attributes.normal;
      for (let j = 0; j < p.count; j++) p.setXYZ(j, p.getX(j) + n.getX(j) * len * k, p.getY(j) + n.getY(j) * len * k * .9 - len * k * k * .15, p.getZ(j) + n.getZ(j) * len * k);
      const t = furTex.clone(); t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; t.repeat.set(rep[0], rep[1]);
      const c = new THREE.Color(c0).lerp(new THREE.Color(c1), Math.pow(k, .7));
      const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 1, alphaMap: t, alphaTest: .12 + k * .8, envMapIntensity: .32 });
      mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n\tdiffuseColor.a = 1.0;'); };
      mesh.add(new THREE.Mesh(g, mat));
    }
  };

  const seal = new THREE.Group(); scene.add(seal);
  const rig = new THREE.Group(); seal.add(rig);

  // 身体：一条旋转曲面，从圆胸一路收成尾巴，再整体弯出趴着的弧度
  const prof = [[0, 0], [.05, .42], [.14, .7], [.28, .86], [.42, .84], [.56, .72], [.7, .54], [.82, .38], [.91, .25], [.97, .13], [1, 0]];
  const L = 2.55;
  const curve = new THREE.SplineCurve(prof.map(([t, r]) => new THREE.Vector2(t, r)));
  const pts = curve.getPoints(90).map((v) => new THREE.Vector2(Math.max(v.y, 0) * 1.0, v.x * L));
  const bodyG = new THREE.LatheGeometry(pts, 96, Math.PI);
  bodyG.rotateX(-Math.PI / 2);
  const pos = bodyG.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = -v.z / L;
    v.x *= 1.06;
    if (v.y < 0) v.y *= .62; else v.y *= .9;
    v.y += Math.pow(Math.max(0, t - .45), 2) * 1.1 - t * .12;
    v.z += .55;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  bodyG.computeVertexNormals();
  const body = new THREE.Mesh(bodyG, fur); body.position.y = -.3; rig.add(body); addFur(body, [60, 34], .075);

  // 头
  const headPiv = new THREE.Group(); headPiv.position.set(0, .05, .45); rig.add(headPiv);
  const HR = .84;
  const head = new THREE.Mesh(new THREE.SphereGeometry(HR, 96, 72), fur); head.scale.set(1.04, .97, 1);
  head.position.set(0, .42, .08); headPiv.add(head); addFur(head, [56, 30], .075);
  const hc = head.position;
  const onHead = (x, y, z, lift = 0) => { const n = new THREE.Vector3(x, y, z).normalize(); return { p: hc.clone().add(new THREE.Vector3(n.x * 1.04, n.y * .97, n.z).multiplyScalar(HR + lift)), n }; };
  const stick = (o, s) => { o.position.copy(s.p); o.lookAt(s.p.clone().add(s.n)); headPiv.add(o); return o; };

  // 脸：灰色椭圆嘴巴布 + 黑珠鼻 + 纽扣眼
  const FL = .075;
  const felt = new THREE.MeshPhysicalMaterial({ color: 0x5c6066, roughness: 1, envMapIntensity: .3 });
  const patch = new THREE.Mesh(new THREE.SphereGeometry(.27, 64, 48), felt); patch.scale.set(1.18, .92, .4); stick(patch, onHead(0, -.3, .95, FL * .55)); addFur(patch, [14, 8], .025, 8, 0x4c5055, 0x7a7e84);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.068, 32, 24), gloss); nose.scale.set(1.25, .85, .7); stick(nose, onHead(0, -.2, .98, FL * .55 + .1));
  const eyes = [];
  [-1, 1].forEach((sx) => {
    const g = new THREE.Group(); stick(g, onHead(sx * .46, .0, .88, FL * .75));
    const e = new THREE.Mesh(new THREE.SphereGeometry(.1, 48, 36), gloss); e.scale.set(1, 1.08, .62); g.add(e);
    const h = new THREE.Mesh(new THREE.SphereGeometry(.03, 16, 12), shine); h.position.set(-.035, .042, .055); g.add(h);
    const h2 = new THREE.Mesh(new THREE.SphereGeometry(.013, 8, 8), shine); h2.position.set(.035, -.036, .05); g.add(h2);
    eyes.push(g);
  });

  // 鳍：水滴形，根部圆、末端扁薄
  const finGeo = (r, len, thick) => {
    const g = new THREE.SphereGeometry(r, 48, 32), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const t = (x / r + 1) / 2; p.setXYZ(i, x * len / r * .5 + len * .5, y * thick * (1 - t * .55), z * (1 - t * .15) * (1 + .25 * t)); }
    g.computeVertexNormals(); return g;
  };
  const flips = [];
  const frontFin = finGeo(.32, .8, .42);
  [-1, 1].forEach((sx) => {
    const piv = new THREE.Group(); piv.position.set(sx * .5, -.6, .2);
    const f = new THREE.Mesh(frontFin, fur); if (sx < 0) f.scale.x = -1; addFur(f, [18, 10], .05, 12);
    piv.rotation.set(0, -sx * .25, sx * -.22); piv.add(f); rig.add(piv); flips.push({ piv, sx });
  });
  const tailPiv = new THREE.Group(); tailPiv.position.set(0, .02, -1.85); rig.add(tailPiv);
  const tailFin = finGeo(.26, .62, .28);
  [-1, 1].forEach((sx) => {
    const g = new THREE.Group(); g.rotation.y = sx * (Math.PI / 2 - .55);
    const f = new THREE.Mesh(tailFin, fur); if (sx < 0) f.scale.x = -1; addFur(f, [16, 10], .045, 12); f.rotation.z = sx * .45; g.add(f); tailPiv.add(g);
  });
  const box = new THREE.Box3().setFromObject(rig); const c = box.getCenter(new THREE.Vector3());
  rig.position.x -= c.x; rig.position.z -= c.z; rig.position.y -= box.min.y + .95;

  // 柔和接触阴影
  const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sx = sc.getContext('2d');
  const gr = sx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(20,45,70,.42)'); gr.addColorStop(.55, 'rgba(20,45,70,.14)'); gr.addColorStop(1, 'rgba(20,45,70,0)');
  sx.fillStyle = gr; sx.fillRect(0, 0, 128, 128);
  const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadowMesh.rotation.x = -Math.PI / 2; shadowMesh.position.y = -.97; shadowMesh.scale.set(1.15, .62, 1); scene.add(shadowMesh);

  return { renderer, scene, camera, seal, eyes, flips, tailPiv, headPiv, shadowMesh, dispose() { renderer.dispose(); } };
}

/* ---------------- 把 AI / 本地解析结果统一成一种预览条目 ---------------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fixTime = (t) => { const m = typeof t === 'string' && t.match(/^(\d{1,2}):(\d{2})$/); return m ? `${pad(+m[1])}:${m[2]}` : ''; };
function fromAI(it, s) {
  const kinds = allKinds();
  const kind = kinds.find((k) => k.name === it.block_kind || k.v === it.block_kind);
  const nb = it.notebook ? s.notebooks.find((b) => b.name === it.notebook) : null;
  const item = {
    id: uid(), on: true, kind: it.kind, title: String(it.title || '').trim(),
    date: DATE_RE.test(it.date || '') ? it.date : '', time: fixTime(it.time), start: fixTime(it.start), end: fixTime(it.end),
    priority: Number.isInteger(it.priority) ? Math.max(0, Math.min(3, it.priority)) : 2,
    tags: (Array.isArray(it.tags) ? it.tags : []).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean).slice(0, 6),
    kindV: kind ? kind.v : 'focus', nb: nb ? nb.id : (it.kind === 'note' ? 'nb-inbox' : null), body: typeof it.body === 'string' ? it.body.trim() : '',
  };
  if (item.kind === 'block' && !item.start) { item.kind = 'todo'; } // 没有起止时间就不是时间块
  if (item.kind === 'block') { if (!item.date) item.date = todayStr(); if (!item.end || timeToMin(item.end) <= timeToMin(item.start)) item.end = minToTime(timeToMin(item.start) + 60); }
  return item.title ? item : null;
}
function fromLocal(text, s) {
  const p = plan(text, detect(text), s.notebooks);
  if (p.invalid) return [];
  if (p.kind === 'todo') return [{ id: uid(), on: true, kind: 'todo', title: p.todo.title, date: p.todo.due || '', time: p.todo.time || '', start: '', end: '', priority: p.todo.priority, tags: p.todo.tags, kindV: 'focus', nb: null, body: '' }];
  if (p.kind === 'block') return [{ id: uid(), on: true, kind: 'block', title: p.block.title, date: p.block.date, time: '', start: p.block.start, end: p.block.end, priority: 2, tags: [], kindV: 'focus', nb: null, body: '' }];
  return [{ id: uid(), on: true, kind: 'note', title: p.note.title || '无标题', date: '', time: '', start: '', end: '', priority: 2, tags: p.note.tags, kindV: 'focus', nb: p.note.nb || 'nb-inbox', body: p.note.body }];
}
function metaOf(it, s) {
  const d = it.date ? (it.date === todayStr() ? '今天' : it.date === todayStr(new Date(Date.now() + 864e5)) ? '明天' : it.date.slice(5).replace('-', '/')) : '';
  if (it.kind === 'todo') return [d || '无日期', it.time, 'P' + it.priority, ...it.tags.map((t) => '#' + t)].filter(Boolean).join(' · ');
  if (it.kind === 'block') { const k = allKinds().find((x) => x.v === it.kindV); return [d, `${it.start}–${it.end}`, k && k.name].filter(Boolean).join(' · '); }
  const nb = s.notebooks.find((b) => b.id === it.nb);
  return [nb ? nb.name : '收件箱', ...it.tags.map((t) => '#' + t), it.body && `${it.body.length} 字`].filter(Boolean).join(' · ');
}
function saveItems(items) {
  let n = 0, last = null;
  for (const it of items) {
    if (!it.on) continue;
    if (it.kind === 'todo') { const t = { id: uid(), title: it.title, done: false, priority: it.priority, due: it.date, time: it.time, tags: it.tags, area: '', note: it.body, created: todayStr() }; upsert('todos', t); last = 'todos?open=' + t.id; }
    else if (it.kind === 'block') { const b = { id: uid(), date: it.date, start: it.start, end: it.end, title: it.title, kind: it.kindV, note: it.body }; upsert('blocks', b); last = 'plan/day?d=' + b.date; }
    else { const nn = newNote({ title: it.title, body: it.body, tags: it.tags, nb: it.nb || 'nb-inbox', blocks: mdToBlocks(it.body) }); last = 'notes/' + nn.id; }
    n++;
  }
  if (n) toast(`汤圆帮你记了 ${n} 项`, last && n === 1 ? { label: '打开', onClick: () => go(last) } : undefined);
  return n;
}
function buildContext(s) {
  const now = new Date(), today = todayStr();
  const tagCount = {};
  for (const t of s.todos) for (const g of t.tags || []) tagCount[g] = (tagCount[g] || 0) + 1;
  for (const n of s.notes) for (const g of n.tags || []) tagCount[g] = (tagCount[g] || 0) + 1;
  return {
    today, weekday: WEEKDAY_SUN[now.getDay()], now: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    notebooks: s.notebooks.map((b) => b.name), kinds: allKinds().map((k) => k.name),
    tags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k),
    todos: s.todos.filter((t) => !t.done && (!t.due || t.due <= today)).slice(0, 20).map((t) => t.title),
  };
}

const HINTS = ['明天下午两点开组会，会后把纪要整理到研究本子', '周五前把论文初稿发给导师，很急', '今晚 20:00-21:30 跑步', '今天的一个想法：把复习卡片按遗忘曲线排序'];

/* ---------------- 组件 ---------------- */
export function Seal() {
  const s = useStore();
  const fabRef = useRef(), cvRef = useRef(), panelRef = useRef(), inRef = useRef(), msgsRef = useRef();
  const api = useRef({});           // imperative hooks exposed by the effect: { toggle, happy, flap }
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [txt, setTxt] = useState('');
  const [badge, setBadge] = useState(0);
  const openRef = useRef(false); openRef.current = open;
  const sRef = useRef(s); sRef.current = s;
  const msgsR = useRef(msgs); msgsR.current = msgs;

  // ---- fab: drag / snap / 3D model ----
  useEffect(() => {
    const fab = fabRef.current, cv = cvRef.current; if (!fab) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bottomPad = () => (matchMedia('(max-width:900px)').matches ? 76 : 24);
    let x = innerWidth - S - M, y = innerHeight - S - M - bottomPad(), tx = x, ty = y, vx = 0, vy = 0, svx = 0, svy = 0;
    try { const sp = JSON.parse(localStorage.getItem('ytos.seal')); if (sp) { tx = x = sp.side === 'l' ? M : innerWidth - S - M; ty = y = Math.min(Math.max(M, sp.y * innerHeight), innerHeight - S - M - bottomPad()); } } catch {}
    let dragging = false, moved = false, sx0, sy0, ox, oy, lastX, lastY;
    let lookX = 0, lookY = 0, squash = 0, sqv = 0, hop = 0, hopV = 0, flap = 0, happy = 0;
    const place = () => { fab.style.transform = `translate(${x}px,${y}px)`; };
    place();
    const posPanel = () => {
      const panel = panelRef.current; if (!panel || !openRef.current) return;
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      let px = x + S / 2 < innerWidth / 2 ? x : x + S - pw; px = Math.min(Math.max(M, px), innerWidth - pw - M);
      let py = y - ph - 16, up = true; if (py < M) { py = y + S + 16; up = false; } py = Math.min(Math.max(M, py), innerHeight - ph - M);
      panel.style.left = px + 'px'; panel.style.top = py + 'px';
      panel.style.setProperty('--ox', (x + S / 2 - px) + 'px'); panel.style.setProperty('--oy', up ? '100%' : '0%');
    };
    api.current.posPanel = posPanel;
    api.current.happy = (v = 1.4) => { happy = v; };
    api.current.flap = () => { flap = 1; hopV = .06; };
    const toggle = () => { setOpen((o) => !o); };
    api.current.toggle = toggle;

    const down = (e) => { if (e.button != null && e.button !== 0) return; dragging = true; moved = false; fab.setPointerCapture(e.pointerId); sx0 = e.clientX; sy0 = e.clientY; ox = x; oy = y; lastX = e.clientX; lastY = e.clientY; fab.classList.add('turning'); sqv -= .06; };
    const move = (e) => {
      if (!dragging) return; const dx = e.clientX - sx0, dy = e.clientY - sy0;
      if (!moved && Math.hypot(dx, dy) > 5) moved = true; if (!moved) return;
      x = Math.min(Math.max(0, ox + dx), innerWidth - S); y = Math.min(Math.max(0, oy + dy), innerHeight - S);
      vx = vx * .6 + (e.clientX - lastX) * .4; vy = vy * .6 + (e.clientY - lastY) * .4; lastX = e.clientX; lastY = e.clientY; place(); posPanel();
    };
    const end = () => {
      if (!dragging) return; dragging = false; fab.classList.remove('turning');
      if (moved) {
        tx = (x + S / 2 < innerWidth / 2) ? M : innerWidth - S - M; ty = Math.min(Math.max(M, y), innerHeight - S - M - bottomPad()); svx = vx; svy = vy;
        try { localStorage.setItem('ytos.seal', JSON.stringify({ side: tx === M ? 'l' : 'r', y: ty / innerHeight })); } catch {}
        sqv += .12;
      } else { hopV = .09; flap = 1; toggle(); }
    };
    const key = (e) => { const k = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[e.key]; if (k) { e.preventDefault(); tx = Math.min(Math.max(M, tx + k[0]), innerWidth - S - M); ty = Math.min(Math.max(M, ty + k[1]), innerHeight - S - M - bottomPad()); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hopV = .09; flap = 1; toggle(); } };
    const look = (e) => { const cx = x + S / 2, cy = y + S / 2; lookX = Math.max(-1, Math.min(1, (e.clientX - cx) / 350)); lookY = Math.max(-1, Math.min(1, (e.clientY - cy) / 350)); };
    const resize = () => { tx = (x + S / 2 < innerWidth / 2) ? M : innerWidth - S - M; ty = Math.min(Math.max(M, ty), innerHeight - S - M - bottomPad()); };
    fab.addEventListener('pointerdown', down); fab.addEventListener('pointermove', move); fab.addEventListener('pointerup', end); fab.addEventListener('pointercancel', end); fab.addEventListener('keydown', key);
    window.addEventListener('pointermove', look, { passive: true }); window.addEventListener('resize', resize);

    let model = null, raf = 0, dead = false, blinkT = 2.5, blink = 0, t0 = performance.now(), idleT = 0, frameN = 0;
    const lerp = (a, b, k) => a + (b - a) * k;
    const frame = (now) => {
      if (dead) return;
      const dt = Math.min(.05, (now - t0) / 1000); t0 = now; idleT += dt;
      if (!dragging) {
        if (reduce) { x = tx; y = ty; svx = svy = 0; }
        else { svx = (svx + (tx - x) * .12) * .74; svy = (svy + (ty - y) * .12) * .74; x += svx; y += svy; if (Math.abs(tx - x) < .1 && Math.abs(svx) < .1) x = tx; if (Math.abs(ty - y) < .1 && Math.abs(svy) < .1) y = ty; }
        vx = svx; vy = svy; place(); if (openRef.current) posPanel();
      } else { vx *= .9; vy *= .9; }
      // idle → render at half rate to save battery; anything moving → every frame
      frameN++;
      const calm = !dragging && Math.hypot(vx, vy) < .2 && hop === 0 && flap === 0 && happy === 0 && Math.abs(sqv) < .001;
      if (model && (!calm || frameN % 2 === 0)) {
        const { seal, eyes, flips, tailPiv, headPiv, shadowMesh, renderer, scene, camera } = model;
        sqv = (sqv - squash * .22) * .82; squash += sqv;
        hopV -= .012; hop += hopV; if (hop < 0) { hop = 0; hopV = Math.abs(hopV) > .02 ? -hopV * .35 : 0; }
        flap = Math.max(0, flap - dt * 1.2);
        const speed = Math.hypot(vx, vy);
        const breathe = reduce ? 0 : Math.sin(idleT * 2.2) * .018;
        const stretch = Math.min(.18, speed * .01) + squash;
        seal.scale.set(1 + stretch * .25 - breathe * .4, 1 - stretch * .2 + breathe, 1 + stretch * .2);
        const k = 1 - Math.min(.5, hop * 4); shadowMesh.scale.set(1.15 * k, .62 * k, 1); shadowMesh.material.opacity = k;
        seal.position.y = hop * 3 + (reduce ? 0 : Math.sin(idleT * 1.6) * .03);
        const wantY = dragging || speed > 1 ? Math.max(-.9, Math.min(.9, vx * .06)) : lookX * .22;
        const wantX = dragging || speed > 1 ? Math.max(-.5, Math.min(.5, vy * .04)) : lookY * .35;
        const wantZ = Math.max(-.45, Math.min(.45, -vx * .025));
        seal.rotation.y = lerp(seal.rotation.y, wantY, .12);
        headPiv.rotation.x = lerp(headPiv.rotation.x, lookY * .18 - .04 + (reduce ? 0 : Math.sin(idleT * 1.3) * .03), .1); headPiv.rotation.y = lerp(headPiv.rotation.y, lookX * .25, .1);
        tailPiv.rotation.y = reduce ? 0 : Math.sin(idleT * (dragging ? 9 : 2)) * (dragging ? .35 : .12);
        seal.rotation.x = lerp(seal.rotation.x, wantX, .12); seal.rotation.z = lerp(seal.rotation.z, wantZ, .12);
        flips.forEach(({ piv, sx }) => { const w = dragging ? Math.sin(idleT * 18) * .35 : flap * Math.sin(idleT * 22) * .6; piv.rotation.z = sx * w; });
        blinkT -= dt; if (blinkT < 0) { blink = 1; blinkT = 2.8 + Math.random() * 2.5; }
        blink = Math.max(0, blink - dt * 7); happy = Math.max(0, happy - dt * .8);
        const lid = 1 - Math.sin(blink * Math.PI);
        const ey = Math.max(.08, Math.min(lid, 1 - Math.min(1, happy) * .8)) * (dragging ? .75 : 1);
        eyes.forEach((g) => { g.scale.y = lerp(g.scale.y, ey, .5); });
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    loadThree().then((THREE) => { if (dead) return; try { model = buildSeal(THREE, cv); } catch (err) { console.error(err); fab.classList.add('nogl'); } }).catch(() => fab.classList.add('nogl'));

    return () => {
      dead = true; cancelAnimationFrame(raf); if (model) model.dispose();
      fab.removeEventListener('pointerdown', down); fab.removeEventListener('pointermove', move); fab.removeEventListener('pointerup', end); fab.removeEventListener('pointercancel', end); fab.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', look); window.removeEventListener('resize', resize);
    };
  }, []);

  // ---- panel open / close ----
  useEffect(() => {
    if (!open) return;
    setBadge(0); api.current.happy && api.current.happy(1.4);
    api.current.posPanel && api.current.posPanel();
    const t = setTimeout(() => inRef.current && inRef.current.focus({ preventScroll: true }), 120);
    const h = (e) => { if (e.key === 'Escape') { setOpen(false); fabRef.current && fabRef.current.focus(); } };
    window.addEventListener('keydown', h);
    return () => { clearTimeout(t); window.removeEventListener('keydown', h); };
  }, [open]);
  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; if (open) api.current.posPanel && api.current.posPanel(); }, [msgs, busy, open]);

  const push = (m) => setMsgs((list) => [...list, { id: uid(), ...m }]);
  const ask = async (text) => {
    text = (text || '').trim(); if (!text || busy) return;
    push({ who: 'me', text }); setTxt(''); setBusy(true); api.current.flap && api.current.flap();
    const st = sRef.current, login = loginState();
    const hist = msgsR.current.slice(-6).map((m) => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text })).filter((m) => m.content);
    let reply, items, via = 'ai';
    if (login && login.ai && login.user) {
      try {
        const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, history: hist, context: buildContext(st) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        reply = j.reply; items = (j.items || []).map((it) => fromAI(it, st)).filter(Boolean);
      } catch (e) { via = 'fallback'; items = fromLocal(text, st); reply = `连不上 AI（${e.message}），我先按本地规则理解：`; }
    } else {
      via = 'local'; items = fromLocal(text, st);
      reply = items.length ? (login && login.user ? '还没接上 AI，我按本地语法理解的：' : '登录后我才能用 AI 拆解，现在先按本地语法：') : '我没听懂要记什么。试试「明天 14:00 开会」这样说？';
    }
    setBusy(false);
    push({ who: 'bot', text: reply || (items.length ? '拆好了，确认一下？' : '收到。'), items, via });
    if (!openRef.current) setBadge((b) => b + 1);
    api.current.happy && api.current.happy(1.2);
  };
  useEffect(() => {
    const h = (e) => { setOpen(true); const t = e.detail; if (t) setTimeout(() => ask(t), 60); };
    window.addEventListener('seal:ask', h); return () => window.removeEventListener('seal:ask', h);
  }, []);

  const toggleItem = (mid, iid) => setMsgs((list) => list.map((m) => m.id !== mid ? m : { ...m, items: m.items.map((it) => it.id === iid ? { ...it, on: !it.on } : it) }));
  const save = (m) => { const n = saveItems(m.items); setMsgs((list) => list.map((x) => x.id === m.id ? { ...x, saved: n } : x)); api.current.happy && api.current.happy(1.6); api.current.flap && api.current.flap(); };

  const login = loginState();
  const aiOn = !!(login && login.ai && login.user);
  return html`
    <button class="seal-fab" ref=${fabRef} aria-label="汤圆助手（可拖动）" aria-expanded=${open} title="汤圆：说一句话，帮你拆成待办 / 时间块 / 笔记">
      <canvas ref=${cvRef} width="300" height="300"></canvas>
      ${badge > 0 && !open && html`<span class="seal-badge">${badge}</span>`}
    </button>
    <div class=${'seal-panel ' + (open ? '' : 'closed')} ref=${panelRef} role="dialog" aria-label="汤圆助手对话">
      <div class="seal-h"><div><b>汤圆</b><small>${aiOn ? 'AI 已接入 · 先预览再保存' : login && login.user ? '本地语法模式 · 未配置 AI' : '本地语法模式 · 登录后可用 AI'}</small></div><button class="ibtn" title="关闭" onClick=${() => setOpen(false)}><${Icon} name="x" size=${14} /></button></div>
      <div class="seal-msgs" ref=${msgsRef}>
        ${msgs.length === 0 && html`<div class="sm bot">嗨，我是汤圆。随便说一句，我帮你拆成待办、时间块或笔记，你确认了我才记。</div>
          <div class="seal-hints">${HINTS.map((h) => html`<button key=${h} type="button" onClick=${() => ask(h)}>${h}</button>`)}</div>`}
        ${msgs.map((m) => html`<div key=${m.id} class=${'sm ' + m.who}>
          <div class="sm-t">${m.text}</div>
          ${m.items && m.items.length > 0 && html`<div class="seal-items">
            ${m.items.map((it) => html`<label key=${it.id} class=${'si ' + (it.on ? '' : 'off') + (m.saved != null ? ' done' : '')}>
              <input type="checkbox" checked=${it.on} disabled=${m.saved != null} onChange=${() => toggleItem(m.id, it.id)} />
              <span class=${'si-k k-' + it.kind}>${KIND_LABEL[it.kind]}</span>
              <span class="si-b"><b>${it.title}</b><small>${metaOf(it, s)}</small></span>
            </label>`)}
            ${m.saved != null ? html`<div class="si-saved"><${Icon} name="check" size=${12} /> 已保存 ${m.saved} 项</div>`
              : html`<button class="btn primary sm si-save" disabled=${!m.items.some((it) => it.on)} onClick=${() => save(m)}><${Icon} name="check" size=${13} /> 保存 ${m.items.filter((it) => it.on).length} 项</button>`}
          </div>`}
        </div>`)}
        ${busy && html`<div class="sm bot typing"><i></i><i></i><i></i></div>`}
      </div>
      <form class="seal-form" onSubmit=${(e) => { e.preventDefault(); ask(txt); }}>
        <input ref=${inRef} value=${txt} placeholder="和汤圆说点什么…" autocomplete="off" onInput=${(e) => setTxt(e.target.value)} />
        <button class="btn primary sm" type="submit" disabled=${!txt.trim() || busy}>发送</button>
      </form>
    </div>`;
}
