// 汤圆：住在角落里的 3D 小海豹助手。按住可以拖到任意位置（松手吸到最近的屏幕边），点一下打开对话。
// 对话里说一句话，汤圆把它拆成 待办 / 时间块 / 笔记，先给你预览，确认后才写入。
// 有 AI（Vercel 上配置了 ANTHROPIC_API_KEY 且已登录）时走 /api/agent；没有就退回随手记的本地语法。
import { html, useState, useEffect, useRef } from '../vendor/preact.js';
import { useStore, upsert, get, update, remove } from './store.js';
import { ctxMenu } from './ctx.js';
import { Icon, DateInput, TimeInput } from './ui.js';
import * as pomo from './pomo.js';
import { uid, todayStr, relDay, WEEKDAY_SUN, timeToMin, minToTime, allKinds, pad, weekKey, monthKey, hostOf, addDays, parseDate } from './util.js';
import { typesOf, autoCover } from './views/reading.js';
import { loginState } from './sync.js';
import { detect, plan } from './capture.js';
import { newNote } from './views/notes.js';
import { mdToBlocks } from './blocks.js';
import { aiHeaders, aiEnabled, aiLabel, recordUsage } from './ai.js';
import { stepsOf, addSteps, clampMin } from './steps.js';
import { go, toast } from './nav.js';

const S = 88, M = 18; // fab size / margin
const KIND_LABEL = { todo: '待办', block: '时间块', note: '笔记', goal: '月度目标', focus: '周焦点', book: '书架', link: '收藏', vision: '愿景' };

/* ---------------- three.js (vendored) ---------------- */
let threeP;
export function loadThree() {
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
export function buildSeal(THREE, cv) {
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

  // 脸（照着汤圆本尊）：奶白色鼓起的嘴部 + 黑鼻子 + 黑色绣线的 ω 嘴 + 纽扣眼；没有眉毛和胡子
  const FL = .075;
  const cream = new THREE.MeshPhysicalMaterial({ color: 0xeef0f3, roughness: .95, envMapIntensity: .3 });
  const patch = new THREE.Mesh(new THREE.SphereGeometry(.27, 64, 48), cream); patch.scale.set(1.18, .92, .4); stick(patch, onHead(0, -.3, .95, FL * .55)); addFur(patch, [14, 8], .025, 8, 0xd8dbe0, 0xffffff);
  const brown = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: .5, clearcoat: .5, clearcoatRoughness: .3, envMapIntensity: .4 });
  const stitch = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: .85 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.07, 32, 24), brown); nose.scale.set(1.3, .9, .6); stick(nose, onHead(0, -.17, .98, FL * .55 + .11));
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const line = (pts, r = .016) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 8, false), stitch);
  // 嘴：从鼻子下来一小竖，再往两边各翘一个弧（ω）
  const mouth = new THREE.Group(); stick(mouth, onHead(0, -.3, .96, FL * .55 + .12)); // ω 贴着鼻子下面一点点
  mouth.add(line([v3(0, .07, 0), v3(0, .0, 0)]));
  [-1, 1].forEach((sx) => mouth.add(line([v3(0, .0, 0), v3(sx * .07, -.055, -.004), v3(sx * .14, -.045, -.012), v3(sx * .19, .01, -.024)])));
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
    id: it.ref || uid(), on: true, kind: it.kind, title: String(it.title || '').trim(),
    date: DATE_RE.test(it.date || '') ? it.date : '', time: fixTime(it.time), start: fixTime(it.start), end: fixTime(it.end),
    priority: Number.isInteger(it.priority) ? Math.max(0, Math.min(3, it.priority)) : 2,
    tags: (Array.isArray(it.tags) ? it.tags : []).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean).slice(0, 6),
    kindV: kind ? kind.v : 'focus', nb: nb ? nb.id : (it.kind === 'note' ? 'nb-inbox' : null), body: typeof it.body === 'string' ? it.body.trim() : '',
    subitems: (Array.isArray(it.subitems) ? it.subitems : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6),
    url: typeof it.url === 'string' ? it.url.trim() : '', author: typeof it.author === 'string' ? it.author.trim() : '',
  };
  // 哪些字段是我们替模型补的默认值（不是对方说的）：预览里会标成「建议值」，改过就算确认
  item.inferred = [];
  if (!Number.isInteger(it.priority) && item.kind === 'todo') item.inferred.push('priority');
  if (item.kind === 'link' && !/^https?:\/\//i.test(item.url)) { const m = (item.title + ' ' + item.body).match(/https?:\/\/\S+/); if (m) item.url = m[0]; else item.kind = 'todo'; }
  if (item.kind === 'block' && !item.start) { item.kind = 'todo'; } // 没有起止时间就不是时间块
  if (item.kind === 'block') { if (!item.date) { item.date = todayStr(); item.inferred.push('date'); } if (!item.end || timeToMin(item.end) <= timeToMin(item.start)) { item.end = minToTime(timeToMin(item.start) + 60); item.inferred.push('end'); } if (!kind) item.inferred.push('kindV'); }
  if (item.kind === 'note' && !nb) item.inferred.push('nb');
  return item.title ? item : null;
}
function fromLocal(text, s) {
  const p = plan(text, detect(text), s.notebooks);
  if (p.invalid) return [];
  if (p.kind === 'todo') return [{ id: uid(), on: true, kind: 'todo', title: p.todo.title, date: p.todo.due || '', time: p.todo.time || '', start: '', end: '', priority: p.todo.priority, tags: p.todo.tags, kindV: 'focus', nb: null, body: '', subitems: [], url: '', author: '', inferred: [] }];
  if (p.kind === 'block') return [{ id: uid(), on: true, kind: 'block', title: p.block.title, date: p.block.date, time: '', start: p.block.start, end: p.block.end, priority: 2, tags: [], kindV: 'focus', nb: null, body: '', subitems: [], url: '', author: '', inferred: [] }];
  return [{ id: uid(), on: true, kind: 'note', title: p.note.title || '无标题', date: '', time: '', start: '', end: '', priority: 2, tags: p.note.tags, kindV: 'focus', nb: p.note.nb || 'nb-inbox', body: p.note.body, subitems: [], url: '', author: '', inferred: [] }];
}
function metaOf(it, s) {
  const d = it.date ? (it.date === todayStr() ? '今天' : it.date === todayStr(new Date(Date.now() + 864e5)) ? '明天' : it.date.slice(5).replace('-', '/')) : '';
  if (it.kind === 'todo') return [d || '无日期', it.time, 'P' + it.priority, ...it.tags.map((t) => '#' + t)].filter(Boolean).join(' · ');
  if (it.kind === 'block') { const k = allKinds().find((x) => x.v === it.kindV); return [d, `${it.start}–${it.end}`, k && k.name].filter(Boolean).join(' · '); }
  if (it.kind === 'goal') { const mk = it.date ? it.date.slice(0, 7) : monthKey(); return [`${+mk.slice(5)} 月`, it.subitems.length ? `${it.subitems.length} 个关键结果：${it.subitems.join('；')}` : '没有关键结果'].join(' · '); }
  if (it.kind === 'focus') return `本周（${weekKey()}）`;
  if (it.kind === 'book') return [it.author || '作者未知', '想读', ...it.tags.map((t) => '#' + t)].filter(Boolean).join(' · ');
  if (it.kind === 'link') return [hostOf(it.url), ...it.tags.map((t) => '#' + t)].filter(Boolean).join(' · ');
  if (it.kind === 'vision') return '显化 · 肯定句';
  const nb = s.notebooks.find((b) => b.id === it.nb);
  return [nb ? nb.name : '收件箱', ...it.tags.map((t) => '#' + t), it.body && `${it.body.length} 字`].filter(Boolean).join(' · ');
}
function saveItems(items) {
  let n = 0, last = null; const undos = [];
  for (const it of items) {
    if (!it.on) continue;
    if (it.kind === 'todo') { const t = { id: uid(), title: it.title, done: false, priority: it.priority, due: it.date, time: it.time, tags: it.tags, area: '', note: it.body, created: todayStr() }; upsert('todos', t); last = 'todos?open=' + t.id; undos.push(() => remove('todos', t.id)); }
    else if (it.kind === 'block') { const b = { id: uid(), date: it.date, start: it.start, end: it.end, title: it.title, kind: it.kindV, note: it.body }; upsert('blocks', b); last = 'plan/day?d=' + b.date; undos.push(() => remove('blocks', b.id)); }
    else if (it.kind === 'goal') { const mk = it.date ? it.date.slice(0, 7) : monthKey(); const g = { id: uid(), title: it.title, area: '', why: it.body || '', krs: it.subitems.map((text) => ({ id: uid(), text, done: false })), progress: 0 }; update((d) => { d.goals[mk] = d.goals[mk] || []; d.goals[mk].push(g); }); last = 'plan/month'; undos.push(() => update((d) => { if (d.goals[mk]) d.goals[mk] = d.goals[mk].filter((x) => x.id !== g.id); })); }
    else if (it.kind === 'focus') { const key = weekKey(); const prev = (get().weeks[key] || {}).focus || ''; update((d) => { d.weeks[key] = d.weeks[key] || { focus: '', items: {}, review: '' }; const lines = (d.weeks[key].focus || '').split('\n').filter((x) => x.trim()); if (lines.length < 3) lines.push(it.title); else lines[2] = it.title; d.weeks[key].focus = lines.join('\n'); }); last = 'plan/week'; undos.push(() => update((d) => { if (d.weeks[key]) d.weeks[key].focus = prev; })); }
    else if (it.kind === 'book') { const st = get(); const b = { id: uid(), title: it.title, author: it.author, type: typesOf(st)[0][0], status: 'want', progress: 0, total: 0, rating: 0, cover: '', link: '', note: it.body, tags: it.tags, color: ['#2d8f88', '#3b6fd6', '#7461c9', '#c9588a', '#c7873a'][st.books.length % 5], started: '', finished: '', created: todayStr() }; upsert('books', b); autoCover(b, true); last = 'reading?open=' + b.id; undos.push(() => remove('books', b.id)); }
    else if (it.kind === 'link') { const l = { id: uid(), url: it.url, host: hostOf(it.url), title: it.title || hostOf(it.url), note: it.body, tags: it.tags, fav: false, read: false, created: todayStr() }; upsert('links', l); last = 'links'; undos.push(() => remove('links', l.id)); }
    else if (it.kind === 'vision') { const v = { id: uid(), text: it.title, created: todayStr() }; update((d) => { d.vision.statements.push(v); }); last = 'vision'; undos.push(() => update((d) => { d.vision.statements = d.vision.statements.filter((x) => x.id !== v.id); })); }
    else { const nn = newNote({ title: it.title, body: it.body, tags: it.tags, nb: it.nb || 'nb-inbox', blocks: mdToBlocks(it.body) }); last = 'notes/' + nn.id; undos.push(() => remove('notes', nn.id)); }
    n++;
  }
  return { n, open: last && n === 1 ? last : '', undo: () => { for (const f of undos.reverse()) f(); } };
}
function buildContext(s, draft) {
  const now = new Date(), today = todayStr();
  const tagCount = {};
  for (const t of s.todos) for (const g of t.tags || []) tagCount[g] = (tagCount[g] || 0) + 1;
  for (const n of s.notes) for (const g of n.tags || []) tagCount[g] = (tagCount[g] || 0) + 1;
  return {
    today, weekday: WEEKDAY_SUN[now.getDay()], now: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    notebooks: s.notebooks.map((b) => b.name), kinds: allKinds().map((k) => k.name),
    tags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k),
    todos: s.todos.filter((t) => !t.done && (!t.due || t.due <= addDays(today, 14))).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1).slice(0, 30).map((t) => ({ id: t.id, title: t.title, due: t.due || '', time: t.time || '' })),
    goals: (s.goals[monthKey()] || []).map((g) => g.title),
    focus: (s.weeks[weekKey()] || {}).focus || '',
    calendar: calendarText(),
    who: s.profile && s.profile.name || '',
    draft: (draft || []).map((it) => ({ id: it.id, kind: it.kind, title: it.title, date: it.date, time: it.time, start: it.start, end: it.end, priority: it.priority, tags: it.tags })),
  };
}

// 给模型一张算好的日历：今天起 35 天每天的日期和星期、本月最后一天、下月第一天。模型查表比心算准得多
function calendarText() {
  const today = todayStr(); const d0 = parseDate(today);
  const lines = [];
  for (let i = 0; i < 35; i++) { const d = addDays(today, i); const dt = parseDate(d); const tag = i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : ''; lines.push(`${d} ${WEEKDAY_SUN[dt.getDay()]}${tag ? ' ' + tag : ''}`); }
  const mEnd = new Date(d0.getFullYear(), d0.getMonth() + 1, 0); const nStart = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
  return `本月：${monthKey(d0)}，本月最后一天 ${todayStr(mEnd)}；下月第一天 ${todayStr(nStart)}\n` + lines.join('\n');
}
// Tiimo 式：把拆出来的步骤从现在起依次排进时间线，避开已有的时间块；只排在清醒时段（08:00–22:00），半夜操作就排到明天早上
const DAY_START = 8 * 60, DAY_END = 22 * 60;
function scheduleSteps(steps, todo) {
  const st = get(); let date = todayStr(); const now = new Date();
  let cur = Math.ceil((now.getHours() * 60 + now.getMinutes() + 5) / 15) * 15;
  if (cur < DAY_START) cur = 9 * 60; else if (cur >= DAY_END) { date = addDays(date, 1); cur = 9 * 60; }
  const busy = (d) => st.blocks.filter((b) => b.date === d && !b.pomo).map((b) => [timeToMin(b.start), timeToMin(b.end)]).sort((a, b) => a[0] - b[0]);
  const made = [];
  for (const sp of steps) {
    const len = Math.max(15, Math.round((sp.minutes || 25) / 15) * 15);
    for (let guard = 0; guard < 60; guard++) {
      if (cur + len > DAY_END) { date = addDays(date, 1); cur = 9 * 60; continue; }
      const hit = busy(date).find(([a, b]) => cur < b && cur + len > a);
      if (hit) { cur = Math.ceil(hit[1] / 15) * 15; continue; }
      break;
    }
    const b = { id: uid(), date, start: minToTime(cur), end: minToTime(cur + len), title: sp.title, kind: 'focus', note: `「${todo.title}」的一步`, todoId: todo.id, stepId: sp.id };
    upsert('blocks', b); made.push(b); cur += len + 10; // 步骤之间留 10 分钟
  }
  return made;
}

// 示例句子，右边标出会落到哪些模块
const HINTS = [
  { t: '明天下午两点开组会，会后把纪要整理到研究本子', k: ['时间块', '待办'] },
  { t: '这个月的目标：考完雅思 G 类，每周两套真题', k: ['月度目标'] },
  { t: '想读《纳瓦尔宝典》，还有把这篇文章收藏 https://example.com', k: ['书架', '收藏'] },
  { t: '我想成为一个每天都在创造的人', k: ['愿景'] },
  { t: '拆解：准备年终汇报', k: ['子任务'] },
];
// 头部的小头像：一只简笔海豹
const AVATAR = html`<svg class="seal-ava" viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="18" rx="12" ry="10" fill="#e9edf3"/><ellipse cx="16" cy="17" rx="9.5" ry="7.5" fill="#f7f8fa"/><circle cx="12" cy="15.5" r="1.5" fill="#2b2f36"/><circle cx="20" cy="15.5" r="1.5" fill="#2b2f36"/><circle cx="12.5" cy="15" r=".5" fill="#fff"/><circle cx="20.5" cy="15" r=".5" fill="#fff"/><ellipse cx="16" cy="19.2" rx="1.6" ry="1.1" fill="#0b0b0d"/><path d="M14.6 20.6q1.4 1.2 2.8 0" stroke="#0b0b0d" stroke-width=".9" fill="none" stroke-linecap="round"/></svg>`;

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
  const [threads, setThreads] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.seal.threads') || '[]'); } catch { return []; } });
  const [tid, setTid] = useState(() => uid());
  const [view, setView] = useState('chat');      // chat | history
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('ytos.seal.mode') || ''; } catch { return ''; } }); // '' 浮窗 | big 展开 | full 最大化
  const big = !!mode;
  const setModeKeep = (m) => { setMode(m); try { localStorage.setItem('ytos.seal.mode', m); } catch {} };
  // 尺寸按模式各记一份：浮窗一份、展开一份
  const [sizes, setSizes] = useState(() => { try { const v = JSON.parse(localStorage.getItem('ytos.seal.size2') || 'null'); if (v) return v; const old = JSON.parse(localStorage.getItem('ytos.seal.size') || 'null'); return old ? { float: old } : {}; } catch { return {}; } });
  const modeKey = mode === 'big' ? 'big' : 'float';
  const size = mode === 'full' ? null : sizes[modeKey] || null;
  const openRef = useRef(false); openRef.current = open;
  const bigRef = useRef(false); bigRef.current = big; api.current.mode = mode;
  const undoRef = useRef({}); // 每条已保存消息的撤销函数
  const [ava, setAva] = useState(() => { try { return sessionStorage.getItem('ytos.seal.ava') || ''; } catch { return ''; } });
  api.current.setAvatar = (u) => { setAva(u); try { sessionStorage.setItem('ytos.seal.ava', u); } catch {} };
  const [pinnedPos, setPinnedPos] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.seal.panelpos') || 'null'); } catch { return null; } });
  api.current.pinnedPos = pinnedPos;
  const savePos = (v) => { setPinnedPos(v); api.current.pinnedPos = v; try { v ? localStorage.setItem('ytos.seal.panelpos', JSON.stringify(v)) : localStorage.removeItem('ytos.seal.panelpos'); } catch {} api.current.posPanel && api.current.posPanel(); };
  // 拖头部移动对话窗
  const moveStart = (e) => {
    if (api.current.mode === 'full' || e.button !== 0 || e.target.closest('button,a,input')) return;
    const panel = panelRef.current; const r = panel.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top; let moved = false;
    const mv = (ev) => { if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return; moved = true; api.current.moving = true; panel.classList.add('moving'); const px = Math.min(Math.max(M, ev.clientX - dx), innerWidth - r.width - M), py = Math.min(Math.max(M, ev.clientY - dy), innerHeight - r.height - M); panel.style.left = px + 'px'; panel.style.top = py + 'px'; };
    const up = (ev) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); panel.classList.remove('moving'); api.current.moving = false; if (moved) { const rr = panel.getBoundingClientRect(); savePos({ x: rr.left / innerWidth, y: rr.top / innerHeight }); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const [editing, setEditing] = useState(null); // 手机上点元信息才展开日期 / 时间编辑
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
    // 闲时贴边：面板关着、鼠标不在附近超过几秒，就缩到屏幕边上只露一截，不压在内容上
    let tucked = false, nearT = performance.now();
    // 趴在卡片上：松手时下面有卡片，就趴到它的上沿，跟着页面一起滚；每个页面分别记住趴在哪
    const PERCH_DY = 34;
    let perch = null; // { el, key, ox, lastLeft, lastTop }
    const routeKey = () => location.hash.split('?')[0] || '#/home';
    const cards = () => [...document.querySelectorAll('.widget'), ...[...document.querySelectorAll('.card')].filter((c) => !c.closest('.widget'))];
    const keyOf = (el) => el.dataset.id ? 'w:' + el.dataset.id : 'c:' + ((el.querySelector('h3') || {}).textContent || '').trim().slice(0, 24) + ':' + cards().indexOf(el);
    const savePerch = () => { try { const all = JSON.parse(localStorage.getItem('ytos.seal.perch') || '{}'); if (perch) all[routeKey()] = { key: perch.key, ox: perch.ox }; else delete all[routeKey()]; localStorage.setItem('ytos.seal.perch', JSON.stringify(all)); } catch {} };
    const restorePerch = () => { perch = null; try { const all = JSON.parse(localStorage.getItem('ytos.seal.perch') || '{}'); const pp = all[routeKey()]; if (!pp) return false; const el = cards().find((e) => keyOf(e) === pp.key); if (el) { const r = el.getBoundingClientRect(); perch = { el, key: pp.key, ox: pp.ox, lastLeft: r.left, lastTop: r.top }; } } catch {} return !!perch; };
    const edgeTarget = () => { tx = (x + S / 2 < innerWidth / 2) ? M : innerWidth - S - M; ty = Math.min(Math.max(M, y), innerHeight - S - M - bottomPad()); };
    let restoreT = 0;
    // 页面渲染有先后，找不到就再等等（最多几次）
    const tryRestore = (n, toEdge) => { clearTimeout(restoreT); if (restorePerch()) return; if (n <= 0) { if (toEdge) edgeTarget(); return; } restoreT = setTimeout(() => tryRestore(n - 1, toEdge), 400); };
    const onRoute = () => { perch = null; edgeTarget(); tryRestore(4, false); };
    window.addEventListener('hashchange', onRoute); restoreT = setTimeout(() => tryRestore(4, false), 300);
    const tuckOn = () => sRef.current.settings.sealTuck === true;
    let lookX = 0, lookY = 0, squash = 0, sqv = 0, hop = 0, hopV = 0, flap = 0, happy = 0;
    let tuckK = 0; // 0 露出 → 1 贴边，缓动
    const place = () => { const want = tucked && !dragging && !openRef.current ? 1 : 0; tuckK += (want - tuckK) * .12; if (Math.abs(want - tuckK) < .005) tuckK = want; const off = (tx === M ? -(S - 34) : (S - 34)) * tuckK; fab.style.transform = `translate(${x + off}px,${y}px)`; fab.style.opacity = String(1 - tuckK * .25); };
    api.current.reset = () => { try { localStorage.removeItem('ytos.seal'); } catch {} perch = null; savePerch(); tx = innerWidth - S - M; ty = innerHeight - S - M - bottomPad(); tucked = false; sqv += .1; };
    place();
    const posPanel = () => {
      const panel = panelRef.current; if (!panel || !openRef.current || api.current.moving || api.current.mode === 'full' || (bigRef.current && !api.current.pinnedPos)) return;
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      // 对话窗被拖到过别处：就待在那儿，不跟着汤圆跑（位置按窗口比例记，换分辨率也不会跑出屏幕）
      const pinned = api.current.pinnedPos;
      if (pinned) { const px = Math.min(Math.max(M, pinned.x * innerWidth), innerWidth - pw - M), py = Math.min(Math.max(M, pinned.y * innerHeight), innerHeight - ph - M); panel.style.left = px + 'px'; panel.style.top = py + 'px'; panel.style.setProperty('--ox', '50%'); panel.style.setProperty('--oy', '50%'); return; }
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
        svx = vx; svy = vy; sqv += .12;
        const under = document.elementsFromPoint(Math.max(0, Math.min(innerWidth - 1, x + S / 2)), Math.max(0, Math.min(innerHeight - 1, y + S - 6))).filter((e) => e !== fab && !fab.contains(e) && !panelRef.current?.contains(e));
        const card = under.map((e) => e.closest && (e.closest('.widget') || e.closest('.card'))).find(Boolean);
        if (card) {
          const r = card.getBoundingClientRect();
          perch = { el: card, key: keyOf(card), ox: Math.max(.08, Math.min(.92, (x + S / 2 - r.left) / r.width)), lastLeft: r.left, lastTop: r.top };
          happy = 1.2;
        } else {
          perch = null; edgeTarget();
          try { localStorage.setItem('ytos.seal', JSON.stringify({ side: tx === M ? 'l' : 'r', y: ty / innerHeight })); } catch {}
        }
        savePerch();
      } else { hopV = .09; flap = 1; toggle(); }
    };
    const key = (e) => { const k = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[e.key]; if (k) { e.preventDefault(); tx = Math.min(Math.max(M, tx + k[0]), innerWidth - S - M); ty = Math.min(Math.max(M, ty + k[1]), innerHeight - S - M - bottomPad()); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hopV = .09; flap = 1; toggle(); } };
    const look = (e) => { const cx = x + S / 2, cy = y + S / 2; lookX = Math.max(-1, Math.min(1, (e.clientX - cx) / 350)); lookY = Math.max(-1, Math.min(1, (e.clientY - cy) / 350)); if (Math.hypot(e.clientX - cx, e.clientY - cy) < 150) { nearT = performance.now(); if (tucked) { tucked = false; sqv += .05; } } };
    const ctx = (e) => {
      const st = sRef.current;
      ctxMenu(e, [
        { label: '新对话', icon: 'plus', onClick: () => { api.current.newThread && api.current.newThread(); setOpen(true); } },
        { label: '历史对话', icon: 'clock', onClick: () => { api.current.showHistory && api.current.showHistory(); setOpen(true); } },
        { label: openRef.current ? '关闭对话' : '打开对话', icon: 'maximize', onClick: () => setOpen((o) => !o) },
        'sep',
        { label: tuckOn() ? '闲时贴边：开' : '闲时贴边：关', icon: 'right', hint: '没人理时缩到屏幕边上', onClick: () => update((d) => { d.settings.sealTuck = !(d.settings.sealTuck !== false); }) },
        { label: '回到右下角', icon: 'refresh', hint: '从卡片上下来', onClick: () => api.current.reset() },
        { label: '设置…', icon: 'settings', onClick: () => go('settings') },
        'sep',
        { label: '隐藏汤圆', icon: 'eye', danger: true, hint: '设置里可再打开', onClick: () => { update((d) => { d.settings.seal = false; }); toast('汤圆藏起来了', { label: '再见到它', onClick: () => update((d) => { d.settings.seal = true; }) }); } },
      ], '汤圆');
    };
    fab.addEventListener('contextmenu', ctx);
    const resize = () => { if (perch) return; tx = (x + S / 2 < innerWidth / 2) ? M : innerWidth - S - M; ty = Math.min(Math.max(M, ty), innerHeight - S - M - bottomPad()); };
    fab.addEventListener('pointerdown', down); fab.addEventListener('pointermove', move); fab.addEventListener('pointerup', end); fab.addEventListener('pointercancel', end); fab.addEventListener('keydown', key);
    window.addEventListener('pointermove', look, { passive: true }); window.addEventListener('resize', resize);

    let model = null, raf = 0, dead = false, blinkT = 2.5, blink = 0, t0 = performance.now(), idleT = 0, frameN = 0;
    const lerp = (a, b, k) => a + (b - a) * k;
    const frame = (now) => {
      if (dead) return;
      const dt = Math.min(.05, (now - t0) / 1000); t0 = now; idleT += dt;
      if (perch) {
        if (!perch.el.isConnected) { if (!restorePerch()) edgeTarget(); }
        if (perch) { const r = perch.el.getBoundingClientRect(); if (!dragging) { x += r.left - perch.lastLeft; y += r.top - perch.lastTop; } perch.lastLeft = r.left; perch.lastTop = r.top; tx = r.left + perch.ox * r.width - S / 2; ty = r.top - S + PERCH_DY; }
      }
      if (!dragging && !perch && !openRef.current && tuckOn() && !tucked && now - nearT > 4000 && Math.abs(tx - x) < 1) { tucked = true; }
      if (tucked && (perch || openRef.current || !tuckOn())) tucked = false;
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
    // 渲染一张静态图：摆好姿势 → 渲染一帧 → 从画布抠出来。头像用脸的中心对齐（不受尾巴 / 鳍的影响），也能导整只
    //   opts: { ry, rx, hx, hy（身体 / 头的转角）, happy（眯眼）, full（整只而不是只要脸）, size（输出边长） }
    const shot = (opts = {}) => {
      if (!model) return ''; const { renderer, scene, camera, seal, headPiv, tailPiv, flips, eyes, shadowMesh } = model;
      const keep = { ry: seal.rotation.y, rx: seal.rotation.x, rz: seal.rotation.z, hx: headPiv.rotation.x, hy: headPiv.rotation.y, sc: seal.scale.clone(), py: seal.position.y, ey: eyes.map((g) => g.scale.y), tail: tailPiv.rotation.y, fl: flips.map(({ piv }) => piv.rotation.z), sh: shadowMesh.visible };
      seal.rotation.set(opts.rx || 0, opts.ry || 0, 0); headPiv.rotation.set(opts.hx ?? -.04, opts.hy || 0, 0); seal.scale.set(1, 1, 1); seal.position.y = 0;
      tailPiv.rotation.y = 0; flips.forEach(({ piv }) => { piv.rotation.z = 0; }); eyes.forEach((g) => { g.scale.y = opts.happy ? .25 : 1; }); shadowMesh.visible = !!opts.full && opts.shadow !== false;
      renderer.render(scene, camera);
      let url = '';
      try {
        const W = cv.width, H = cv.height; const src = document.createElement('canvas'); src.width = W; src.height = H; const g = src.getContext('2d'); g.drawImage(cv, 0, 0);
        const d = g.getImageData(0, 0, W, H).data; const A = (x, y) => d[(y * W + x) * 4 + 3];
        let minX = W, maxX = 0, minY = H, maxY = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 200) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        const size = opts.size || 192; const out = document.createElement('canvas'); out.width = out.height = size; const og = out.getContext('2d');
        if (maxX > minX) {
          if (opts.full) { const bw = maxX - minX, bh = maxY - minY, side = Math.max(bw, bh) * 1.12; og.drawImage(src, (minX + maxX) / 2 - side / 2, (minY + maxY) / 2 - side / 2, side, side, 0, 0, size, size); }
          else {
            // 脸的中心：只看最上面那段（头），不让尾巴和鳍把中心带偏
            const hEnd = minY + (maxY - minY) * .38; let hx0 = W, hx1 = 0;
            for (let y = minY; y < hEnd; y++) for (let x = 0; x < W; x++) if (A(x, y) > 200) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; }
            const w = (hx1 - hx0) * 1.06, cx = (hx0 + hx1) / 2; og.drawImage(src, cx - w / 2, minY - w * .06, w, w, 0, 0, size, size);
          }
          url = out.toDataURL('image/png');
        }
      } catch {}
      seal.rotation.set(keep.rx, keep.ry, keep.rz); headPiv.rotation.set(keep.hx, keep.hy, 0); seal.scale.copy(keep.sc); seal.position.y = keep.py; eyes.forEach((g, i) => { g.scale.y = keep.ey[i]; });
      tailPiv.rotation.y = keep.tail; flips.forEach(({ piv }, i) => { piv.rotation.z = keep.fl[i]; }); shadowMesh.visible = keep.sh;
      return url;
    };
    api.current.shot = shot; window.tangyuanShot = shot; // 控制台 / 脚本可以调：tangyuanShot({ ry: .5, full: true, size: 1024 })
    const snapshot = () => { const u = shot(); if (u) api.current.setAvatar && api.current.setAvatar(u); };
    loadThree().then((THREE) => { if (dead) return; try { model = buildSeal(THREE, cv); setTimeout(snapshot, 250); } catch (err) { console.error(err); fab.classList.add('nogl'); } }).catch(() => fab.classList.add('nogl'));

    return () => {
      dead = true; cancelAnimationFrame(raf); if (model) model.dispose();
      fab.removeEventListener('contextmenu', ctx); fab.removeEventListener('pointerdown', down); fab.removeEventListener('pointermove', move); fab.removeEventListener('pointerup', end); fab.removeEventListener('pointercancel', end); fab.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', look); window.removeEventListener('resize', resize); window.removeEventListener('hashchange', onRoute); clearTimeout(restoreT);
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
  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; if (open) api.current.posPanel && api.current.posPanel(); }, [msgs, busy, open, mode, view]);

  // ---- 历史：每段对话存成一个 thread（只存文字和预览条目，最多 30 段） ----
  useEffect(() => {
    if (!msgs.length) return;
    const first = msgs.find((m) => m.who === 'me');
    const t = { id: tid, title: (first ? first.text : msgs[0].text).slice(0, 30), updated: Date.now(), msgs };
    setThreads((list) => { const next = [t, ...list.filter((x) => x.id !== tid)].slice(0, 30); try { localStorage.setItem('ytos.seal.threads', JSON.stringify(next)); } catch {} return next; });
  }, [msgs]);
  api.current.showHistory = () => setView('history');
  const newThread = api.current.newThread = () => { setMsgs([]); setTid(uid()); setTxt(''); setView('chat'); setTimeout(() => inRef.current && inRef.current.focus(), 50); };
  const openThread = (t) => { setTid(t.id); setMsgs(t.msgs); setView('chat'); };
  const delThread = (id) => setThreads((list) => { const next = list.filter((x) => x.id !== id); try { localStorage.setItem('ytos.seal.threads', JSON.stringify(next)); } catch {} if (id === tid) { setMsgs([]); setTid(uid()); } return next; });
  const relTime = (ts) => { const d = Date.now() - ts; if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + ' 分钟前'; if (d < 864e5) return Math.round(d / 36e5) + ' 小时前'; const dt = new Date(ts); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  // ---- 尺寸：四条边和四个角都能拖，浮窗和展开模式各记一份；一拖就把窗口钉在原地，往拖的方向长 ----
  const resizeStart = (e, dir) => {
    if (api.current.mode === 'full' || e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    const panel = panelRef.current, r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    let cur = { w: r.width, h: r.height }, left = r.left, top = r.top;
    if (!api.current.pinnedPos) { api.current.pinnedPos = { x: r.left / innerWidth, y: r.top / innerHeight }; setPinnedPos(api.current.pinnedPos); }
    panel.classList.add('moving', 'sized'); api.current.moving = true; panel.style.transform = 'none';
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let w = r.width, h = r.height, l = r.left, t = r.top;
      if (dir.includes('e')) w = r.width + dx; if (dir.includes('s')) h = r.height + dy;
      if (dir.includes('w')) { w = r.width - dx; l = r.left + dx; } if (dir.includes('n')) { h = r.height - dy; t = r.top + dy; }
      w = Math.max(320, Math.min(innerWidth - 2 * M, w)); h = Math.max(240, Math.min(innerHeight - 2 * M, h));
      if (dir.includes('w')) l = r.right - w; if (dir.includes('n')) t = r.bottom - h;
      l = Math.max(M, Math.min(innerWidth - w - M, l)); t = Math.max(M, Math.min(innerHeight - h - M, t));
      cur = { w: Math.round(w), h: Math.round(h) }; left = l; top = t;
      panel.style.setProperty('--sw', cur.w + 'px'); panel.style.setProperty('--sh', cur.h + 'px'); panel.style.left = l + 'px'; panel.style.top = t + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      panel.classList.remove('moving'); panel.style.transform = ''; api.current.moving = false;
      const next = { ...sizes, [modeKey]: cur }; setSizes(next); try { localStorage.setItem('ytos.seal.size2', JSON.stringify(next)); } catch {}
      savePos({ x: left / innerWidth, y: top / innerHeight });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const RZ = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
  const push = (m) => setMsgs((list) => [...list, { id: uid(), ...m }]);
  // 前额叶：把一条大待办拆成步骤。拆出来的步骤写进这条待办的关联页面，作为可勾选的待办块
  const breakdown = async (t) => {
    if (busy) return;
    const st = sRef.current, login = loginState();
    push({ who: 'me', text: `拆解：${t.title}` }); setBusy(true); api.current.flap && api.current.flap();
    if (!aiEnabled(login)) { setBusy(false); push({ who: 'bot', text: login && login.user ? '拆解需要接上 AI。去设置里填一个密钥，或者在 Vercel 配置后再来。' : '登录后才能用 AI 拆解。' }); return; }
    const cur = t.id ? st.todos.find((x) => x.id === t.id) : null;
    const existing = stepsOf(cur).map((x) => x.title);
    const now = new Date();
    try {
      const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(90000), body: JSON.stringify({ mode: 'breakdown', text: t.title, context: { today: todayStr(), weekday: WEEKDAY_SUN[now.getDay()], now: `${pad(now.getHours())}:${pad(now.getMinutes())}`, due: t.due || '', note: t.note || '', existing } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      recordUsage(j);
      setBusy(false);
      push({ who: 'bot', text: j.reply || '拆好了，看看这样行不行：', steps: (j.steps || []).map((x) => ({ ...x, id: uid(), on: true })), todo: { id: t.id || '', title: t.title, due: t.due || '' } });
    } catch (e) { setBusy(false); push({ who: 'bot', text: `拆不动（${e.message}）。` }); }
    if (!openRef.current) setBadge((b) => b + 1);
    api.current.happy && api.current.happy(1.2);
  };
  // 把勾选的步骤挂到待办上；拆的是一句话（还没有待办）就先建一条待办
  const ensureTodo = (m) => {
    let t = m.todo.id ? sRef.current.todos.find((x) => x.id === m.todo.id) : null;
    if (!t) { t = { id: uid(), title: m.todo.title, done: false, priority: 2, due: m.todo.due || '', time: '', tags: [], area: '', note: '', created: todayStr(), steps: [] }; upsert('todos', t); setMsgs((list) => list.map((x) => x.id === m.id ? { ...x, todo: { ...x.todo, id: t.id } } : x)); }
    return t;
  };
  const saveSteps = (m) => {
    const steps = m.steps.filter((x) => x.on); if (!steps.length) return;
    const t = ensureTodo(m);
    const added = addSteps(t.id, steps.map((x) => ({ id: x.id, title: x.title, minutes: x.minutes, kind: x.kind })));
    setMsgs((list) => list.map((x) => x.id === m.id ? { ...x, saved: added.length, open: 'todos?open=' + t.id } : x));
    toast(`加了 ${added.length} 步到「${t.title}」`, { label: '去看看', onClick: () => go('todos?open=' + t.id) });
    api.current.happy && api.current.happy(1.6); api.current.flap && api.current.flap();
  };
  const toggleStep = (mid, sid) => setMsgs((list) => list.map((m) => m.id !== mid ? m : { ...m, steps: m.steps.map((x) => x.id === sid ? { ...x, on: !x.on } : x) }));

  const ask = async (text) => {
    text = (text || '').trim(); if (!text || busy) return;
    // 「拆解 X」「把 X 拆成步骤」：直接走拆解，X 是已有待办就挂到它上面，不是就先建一条
    const bm = text.match(/^(?:帮我)?(?:拆解|拆一下|拆分|分解|拆)[:：\s]*(.+?)(?:拆成步骤|拆开)?$/) || text.match(/^(?:把|将)?(.+?)拆(?:成|开|分|解)(?:步骤|几步|一下)?$/);
    if (bm && bm[1] && bm[1].length <= 40) { setTxt(''); const title = bm[1].trim(); const t = sRef.current.todos.find((x) => !x.done && (x.title === title || x.title.includes(title))); return breakdown(t || { title }); }
    push({ who: 'me', text }); setTxt(''); setBusy(true); api.current.flap && api.current.flap();
    const st = sRef.current, login = loginState();
    const hist = msgsR.current.slice(-6).map((m) => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text })).filter((m) => m.content);
    let reply, items, via = 'ai', intent = 'capture';
    if (aiEnabled(login)) {
      try {
        // 上一轮还没保存的草稿一起发过去，对方说「第二个改成后天」时模型能对上号
        const pending = [...msgsR.current].reverse().find((m) => m.who === 'bot' && m.items && m.items.length && m.saved == null && !m.superseded);
        const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(90000), body: JSON.stringify({ text, history: hist, context: buildContext(st, pending ? pending.items : []) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        recordUsage(j);
        reply = j.reply; intent = j.intent || 'capture'; items = (j.items || []).map((it) => fromAI(it, st)).filter(Boolean);
        // 改的是旧草稿：旧卡片退场，新卡片接上；对方已经改过的字段（没标建议值的）保留
        if (pending && items.some((it) => pending.items.some((p) => p.id === it.id))) {
          const FIELD = { end: ['end'], date: ['date'], priority: ['priority'], nb: ['nb'], kindV: ['kindV'] };
          for (const it of items) {
            const old = pending.items.find((p) => p.id === it.id); if (!old) continue;
            it.on = old.on;
            // 模型没给、我们补了默认值的字段，如果对方上一轮已经确认过（不是建议值），就用对方的值
            for (const k of it.inferred || []) if (!(old.inferred || []).includes(k)) for (const f of FIELD[k] || []) it[f] = old[f];
            it.inferred = (it.inferred || []).filter((k) => (old.inferred || []).includes(k));
          }
          setMsgs((list) => list.map((m) => m.id === pending.id ? { ...m, superseded: true } : m));
          intent = 'modify';
        }
      } catch (e) {
        via = 'fallback';
        // 像是在聊天 / 提问的句子不要硬按本地规则变成待办
        const chatty = /[？?]$|^(你|汤圆|谁|为什么|怎么|什么|哪|是不是|有没有)|是谁|吗$|呢$|^(谢谢|哈哈|嗯|好的|哦)/.test(text) || text.length <= 3;
        items = chatty ? [] : fromLocal(text, st);
        reply = items.length ? `AI 这次没答上来（${e.message}），我先按本地规则理解：` : `AI 这次没答上来：${e.message}`;
      }
    } else {
      via = 'local'; items = fromLocal(text, st);
      reply = items.length ? (login && login.user ? '还没接上 AI，我按本地语法理解的：' : '登录后我才能用 AI 拆解，现在先按本地语法：') : '我没听懂要记什么。试试「明天 14:00 开会」这样说？';
    }
    setBusy(false);
    push({ who: 'bot', text: reply || (items.length ? '拆好了，确认一下？' : '收到。'), items, via, intent, ask: via === 'fallback' ? text : '' });
    if (!openRef.current) setBadge((b) => b + 1);
    api.current.happy && api.current.happy(1.2);
  };
  useEffect(() => {
    const h = (e) => { setOpen(true); const t = e.detail; if (t) setTimeout(() => ask(t), 60); };
    const hb = (e) => { setOpen(true); const t = e.detail; if (t) setTimeout(() => breakdown(t), 60); };
    window.addEventListener('seal:ask', h); window.addEventListener('seal:breakdown', hb); return () => { window.removeEventListener('seal:ask', h); window.removeEventListener('seal:breakdown', hb); };
  }, []);

  const toggleItem = (mid, iid) => setMsgs((list) => list.map((m) => m.id !== mid ? m : { ...m, items: m.items.map((it) => it.id === iid ? { ...it, on: !it.on } : it) }));
  const editItem = (mid, iid, patch) => setMsgs((list) => list.map((m) => m.id !== mid ? m : { ...m, items: m.items.map((it) => it.id === iid ? { ...it, ...patch, inferred: (it.inferred || []).filter((k) => !(k in patch) && !(k === 'end' && 'start' in patch)) } : it) }));
  // 步骤：排进时间线 / 开始第一步（番茄钟）
  const scheduleMsg = (m) => {
    const steps = m.steps.filter((x) => x.on); if (!steps.length) return;
    const t = ensureTodo(m); addSteps(t.id, steps.map((x) => ({ id: x.id, title: x.title, minutes: x.minutes, kind: x.kind })));
    const made = scheduleSteps(steps, t);
    setMsgs((list) => list.map((x) => x.id === m.id ? { ...x, saved: steps.length, scheduled: made.length, open: 'plan/day?d=' + made[0].date } : x));
    toast(`排进了 ${made.length} 段，${made[0].date === todayStr() ? '' : relDay(made[0].date) + ' '}${made[0].start} 开始`, { label: '看时间线', onClick: () => go('plan/day?d=' + made[0].date) });
    api.current.happy && api.current.happy(1.6); api.current.flap && api.current.flap();
  };
  const startStep = (m, x) => { const t = ensureTodo(m); addSteps(t.id, [{ id: x.id, title: x.title, minutes: x.minutes, kind: x.kind }]); pomo.start({ label: x.title, todoId: t.id, stepId: x.id, workLen: clampMin(x.minutes) }); toast(`开始：${x.title} · ${x.minutes || 25} 分钟`, { label: '去专注', onClick: () => go('focus') }); };
  const save = (m) => {
    const r = saveItems(m.items); undoRef.current[m.id] = r.undo;
    setMsgs((list) => list.map((x) => x.id === m.id ? { ...x, saved: r.n, open: r.open } : x));
    if (r.n) toast(`记了 ${r.n} 项`, r.open ? { label: '打开', onClick: () => go(r.open) } : undefined);
    api.current.happy && api.current.happy(1.6); api.current.flap && api.current.flap();
  };
  const unsave = (m) => { const f = undoRef.current[m.id]; if (f) f(); delete undoRef.current[m.id]; setMsgs((list) => list.map((x) => x.id === m.id ? { ...x, saved: null, open: '' } : x)); toast('已撤销'); };
  // 输入框：Enter 发送，Shift+Enter 换行，高度跟着内容长
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(txt); } };
  const grow = (el) => { if (!el) return; el.style.height = '0'; const h = Math.min(160, el.scrollHeight); el.style.height = h + 'px'; const form = el.closest('.seal-form'); if (form) form.classList.toggle('multi', h > 44); }; // 多行时发送键贴底，单行时和文字居中对齐
  useEffect(() => { grow(inRef.current); }, [txt]);
  const fmtMin = (t) => (t >= 60 ? `${Math.floor(t / 60)} 小时${t % 60 ? ' ' + (t % 60) + ' 分' : ''}` : `${t} 分钟`);

  const login = loginState();
  const aiOn = aiEnabled(login);
  const status = busy ? { cls: 'busy', text: '正在整理…' } : aiOn ? { cls: 'on', text: aiLabel(login) + ' · 已连接' } : login && login.user ? { cls: 'off', text: '本地规则 · 未接 AI' } : { cls: 'off', text: '未登录 · 本地规则' };
  const metaParts = (it) => {
    // 预览行右侧的元信息：日期 / 时间 / 其他；标出推断的字段
    const d = it.date ? (it.date === todayStr() ? '今天' : it.date === todayStr(new Date(Date.now() + 864e5)) ? '明天' : it.date.slice(5).replace('-', '/')) : '';
    const inf = it.inferred || [];
    if (it.kind === 'todo') return [d && { t: d }, it.time && { t: it.time }, { t: 'P' + it.priority, i: inf.includes('priority') }, ...it.tags.map((t) => ({ t: '#' + t }))].filter(Boolean);
    if (it.kind === 'block') { const k = allKinds().find((x) => x.v === it.kindV); return [{ t: d, i: inf.includes('date') }, { t: `${it.start}–${it.end}`, i: inf.includes('end') }, k && { t: k.name, i: inf.includes('kindV') }].filter(Boolean); }
    if (it.kind === 'note') { const nb = s.notebooks.find((b) => b.id === it.nb); return [{ t: nb ? nb.name : '收件箱', i: inf.includes('nb') }, ...it.tags.map((t) => ({ t: '#' + t })), it.body && { t: `${it.body.length} 字` }].filter(Boolean); }
    return [{ t: metaOf(it, s) }];
  };
  return html`
    <button class="seal-fab" ref=${fabRef} aria-label="汤圆助手（可拖动）" aria-expanded=${open} title="汤圆：说一句话，帮你拆成待办 / 时间块 / 笔记">
      <canvas ref=${cvRef} width="300" height="300"></canvas>
      ${badge > 0 && !open && html`<span class="seal-badge">${badge}</span>`}
    </button>
    <div class=${'seal-panel ' + (open ? '' : 'closed ') + (mode ? 'big ' + mode : '') + (size ? ' sized' : '') + (pinnedPos && mode !== 'full' ? ' pinned' : '')} ref=${panelRef} role="dialog" aria-label="汤圆助手对话" style=${size ? `--sw:${size.w}px;--sh:${size.h}px` : ''}>
      ${mode !== 'full' && RZ.map((d) => html`<div key=${d} class=${'seal-rz rz-' + d} onPointerDown=${(e) => resizeStart(e, d)}></div>`)}
      <div class=${'seal-h ' + (pinnedPos && mode !== 'full' ? 'pinned' : '')} onPointerDown=${moveStart} onDblClick=${() => pinnedPos && savePos(null)} onContextMenu=${(e) => ctxMenu(e, [pinnedPos && mode !== 'full' && { label: big ? '回到屏幕中央' : '吸回汤圆旁边', icon: 'refresh', onClick: () => savePos(null) }, size && { label: '恢复默认大小', icon: 'maximize', onClick: () => { const next = { ...sizes }; delete next[modeKey]; setSizes(next); try { localStorage.setItem('ytos.seal.size2', JSON.stringify(next)); } catch {} } }, !pinnedPos && mode !== 'full' && { label: '拖动顶部可以移动，拖边缘可以改大小', icon: 'cursor', disabled: true }, 'sep', { label: '新对话', icon: 'plus', onClick: newThread }, { label: '历史对话', icon: 'clock', onClick: () => setView('history') }], '对话窗')} title=${mode === 'full' ? '' : pinnedPos ? '拖动移动 · 双击回到默认位置' : '拖动可以把对话窗放到别处'}>
        <div class="seal-col seal-hc">
        ${view === 'history' ? html`<button class="ibtn" title="返回对话" onClick=${() => setView('chat')}><${Icon} name="left" size=${15} /></button><b>历史对话</b><small>${threads.length} 段</small>`
          : html`<span class="seal-id"><span class="seal-avw">${ava ? html`<img class="seal-ava" src=${ava} alt="" />` : AVATAR}<i class=${'dot ' + status.cls}></i></span><b>汤圆</b><small>${status.text}</small></span>`}
        <span class="flex1"></span>
        ${view === 'chat' && html`<button class=${'ibtn ' + (threads.length ? '' : 'dim')} title="历史对话" onClick=${() => setView('history')}><${Icon} name="clock" size=${15} /></button>`}
        ${view === 'chat' && msgs.length > 0 && html`<button class="ibtn" title="新对话" onClick=${newThread}><${Icon} name="plus" size=${15} /></button>`}
        <button class="ibtn seal-big" title=${mode === 'big' ? '恢复浮窗' : '展开'} onClick=${() => setModeKeep(mode === 'big' ? '' : 'big')}><${Icon} name=${mode === 'big' ? 'minus' : 'maximize'} size=${15} /></button>
        <button class="ibtn seal-full" title=${mode === 'full' ? '退出全屏' : '全屏'} onClick=${() => setModeKeep(mode === 'full' ? 'big' : 'full')}><${Icon} name=${mode === 'full' ? 'minus' : 'frame'} size=${15} /></button>
        <button class="ibtn" title="关闭" onClick=${() => setOpen(false)}><${Icon} name="x" size=${15} /></button>
        </div>
      </div>
      ${view === 'history' ? html`<div class="seal-msgs seal-hist"><div class="seal-col">
        ${threads.length === 0 && html`<div class="seal-empty">还没有历史对话</div>`}
        ${threads.map((t) => html`<div key=${t.id} class=${'sh-row ' + (t.id === tid ? 'cur' : '')} onClick=${() => openThread(t)}>
          <span class="sh-t">${t.title}</span><small>${relTime(t.updated)} · ${t.msgs.filter((m) => m.who === 'me').length} 句</small>
          <button class="ibtn sh-del" title="删除" onClick=${(e) => { e.stopPropagation(); delThread(t.id); }}><${Icon} name="x" size=${13} /></button>
        </div>`)}
      </div></div>` : html`<div class="seal-msgs" ref=${msgsRef}><div class="seal-col">
        ${msgs.length === 0 && html`<div class="seal-intro">
            <p>说一句话，我整理成待办、时间块、笔记或目标。你确认了才会写进去。</p>
            <div class="seal-hints">${HINTS.map((h) => html`<button key=${h.t} type="button" onClick=${() => ask(h.t)}><span class="sh-q">${h.t}</span><span class="sh-k">${h.k.map((k) => html`<i key=${k}>${k}</i>`)}</span></button>`)}</div>
          </div>`}
        ${msgs.map((m) => html`<div key=${m.id} class=${'sm ' + m.who}>
          <div class="sm-t">${m.text}</div>
          ${m.via === 'fallback' && html`<div class="sm-warn">${m.items && m.items.length ? '下面是按本地规则识别的，请仔细检查。' : ''}<button class="sm-retry" onClick=${() => { setMsgs((list) => list.filter((x) => x.id !== m.id && !(x.who === 'me' && x.text === m.ask && list.indexOf(x) === list.indexOf(m) - 1))); ask(m.ask); }}><${Icon} name="refresh" size=${11} /> 重试</button></div>`}
          ${m.items && m.items.length > 0 && (() => {
            const on = m.items.filter((it) => it.on).length, saved = m.saved != null;
            const needCheck = !saved && m.items.some((it) => it.on && (it.inferred || []).length);
            if (m.superseded) return html`<div class="ac sup"><div class="ac-h"><span>这版草稿已被下面的新版本替代</span><small>${m.items.length} 项</small></div></div>`;
            return html`<div class=${'ac ' + (saved ? 'saved' : '')}>
            <div class="ac-h"><span>${m.intent === 'plan' ? '建议的安排' : m.intent === 'modify' ? '改好的草稿' : '识别到的安排'}</span><small>${m.items.length} 项</small></div>
            ${m.items.map((it) => html`<label key=${it.id} class=${'ac-row ' + (it.on ? '' : 'off') + (editing === it.id ? ' editing' : '')}>
              <input type="checkbox" checked=${it.on} disabled=${saved} onChange=${() => toggleItem(m.id, it.id)} />
              <span class="ac-b"><span class="ac-t">${it.title}</span><span class="ac-k">${KIND_LABEL[it.kind]}</span></span>
              <span class="ac-m" onClick=${!saved && ['todo', 'block', 'goal'].includes(it.kind) ? (e) => { e.preventDefault(); e.stopPropagation(); setEditing(editing === it.id ? null : it.id); } : undefined}>${metaParts(it).map((x, i) => html`<span key=${i} class=${x.i ? 'inf' : ''} title=${x.i ? '汤圆补的建议值，点下面的日期 / 时间可以改' : ''}>${x.t}</span>`)}</span>
              ${!saved && ['todo', 'block', 'goal'].includes(it.kind) && html`<span class="ac-edit" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <${DateInput} short value=${it.date} placeholder=${it.kind === 'goal' ? '月份' : '日期'} clearable=${it.kind !== 'block'} onChange=${(v) => editItem(m.id, it.id, { date: v })} />
                ${it.kind === 'todo' && html`<${TimeInput} value=${it.time} placeholder="时间" onChange=${(v) => editItem(m.id, it.id, { time: v })} />`}
                ${it.kind === 'block' && html`<${TimeInput} value=${it.start} placeholder="开始" clearable=${false} onChange=${(v) => editItem(m.id, it.id, { start: v, end: minToTime(timeToMin(v) + Math.max(15, timeToMin(it.end) - timeToMin(it.start))) })} /><span class="ac-dash">–</span><${TimeInput} value=${it.end} placeholder="结束" clearable=${false} onChange=${(v) => { if (timeToMin(v) > timeToMin(it.start)) editItem(m.id, it.id, { end: v }); }} />`}
                <button class="ac-done" type="button" title="完成" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setEditing(null); }}><${Icon} name="check" size=${12} /></button>
              </span>`}
            </label>`)}
            <div class="ac-f">
              ${saved ? html`<span class="ac-ok"><${Icon} name="check" size=${13} /> 已保存 ${m.saved} 项</span><span class="flex1"></span>${m.open && html`<button class="btn sm ghost" onClick=${() => go(m.open)}>打开</button>`}${undoRef.current[m.id] && html`<button class="btn sm ghost" onClick=${() => unsave(m)}>撤销</button>`}`
                : html`<span class=${'ac-hint ' + (needCheck ? 'warn' : '')}>${needCheck ? (m.items.some((it) => it.on && (it.inferred || []).includes('end')) ? '结束时间是按一小时估的（橙色点线），不对就改' : '橙色点线是建议值，请看一眼') : on ? '确认后写进对应模块' : '至少勾选一项'}</span><span class="flex1"></span><button class="btn primary sm ac-save" disabled=${!on} onClick=${() => save(m)}>保存 ${on} 项</button>`}
            </div>
          </div>`; })()}
          ${m.steps && m.steps.length > 0 && (() => {
            const on = m.steps.filter((x) => x.on), saved = m.saved != null, total = on.reduce((a, x) => a + (x.minutes || 25), 0);
            return html`<div class=${'ac steps ' + (saved ? 'saved' : '')}>
            <div class="ac-h"><span>「${m.todo.title}」拆成 ${m.steps.length} 步</span><small>约 ${fmtMin(total)}</small></div>
            ${m.steps.map((x, i) => html`<label key=${x.id} class=${'ac-row ' + (x.on ? '' : 'off')}>
              <input type="checkbox" checked=${x.on} disabled=${saved} onChange=${() => toggleStep(m.id, x.id)} />
              <span class="ac-n">${i + 1}</span>
              <span class="ac-b"><span class="ac-t">${x.title}</span>${x.hint && html`<span class="ac-k">${x.hint}</span>`}</span>
              <span class="ac-m"><span>${x.kind}</span><span>${x.minutes || 25} 分</span></span>
              <button class="ac-go" title=${`开始这一步 · ${x.minutes || 25} 分钟番茄钟`} onClick=${(e) => { e.preventDefault(); e.stopPropagation(); startStep(m, x); }}><${Icon} name="play" size=${11} /></button>
            </label>`)}
            <div class="ac-f">
              ${saved ? html`<span class="ac-ok"><${Icon} name="check" size=${13} /> ${m.scheduled ? `已排进时间线 ${m.scheduled} 段` : `已加为「${m.todo.title}」的 ${m.saved} 步`}</span><span class="flex1"></span>${m.open && html`<button class="btn sm ghost" onClick=${() => go(m.open)}>${m.scheduled ? '看时间线' : '去看看'}</button>`}`
                : html`<span class="ac-hint">子任务会挂在这条待办下面</span><span class="flex1"></span><button class="btn sm ghost" disabled=${!on.length} title="加为子任务，并从现在起依次排进时间线（避开已有安排，只排 8:00–22:00）" onClick=${() => scheduleMsg(m)}>排进时间线</button><button class="btn primary sm ac-save" disabled=${!on.length} onClick=${() => saveSteps(m)}>加为子任务</button>`}
            </div>
          </div>`; })()}
        </div>`)}
        ${busy && html`<div class="sm bot typing"><i></i><i></i><i></i></div>`}
      </div></div>`}
      <div class="seal-col seal-cw"><form class=${'seal-form ' + (busy ? 'busy' : '')} onSubmit=${(e) => { e.preventDefault(); ask(txt); }}>
        <textarea ref=${inRef} rows="1" value=${txt} placeholder="说一句话，比如「周三下午三点和导师开会」" autocomplete="off" disabled=${busy} onInput=${(e) => setTxt(e.target.value)} onKeyDown=${onKey}></textarea>
        <button class="seal-send" type="submit" title="发送（Enter，Shift+Enter 换行）" disabled=${!txt.trim() || busy}>${busy ? html`<i class="spin"></i>` : html`<${Icon} name="up" size=${15} />`}</button>
      </form></div>
    </div>`;
}
