// 大脑页的 3D 脑模型（three.js r128）。全部程序化生成，不加载模型文件：
//   两个半球 = 球面按大脑比例拉伸、内侧压平、颞叶往下鼓，再用「领域扭曲的脊状噪声」推出脑回，刻出外侧裂和中央沟；
//   小脑是横向一道道小叶的椭球，加一截脑干。
// 脑区直接涂在表面的顶点颜色上：计划 = 额叶，行动 = 中央前回，表达 = 布罗卡区 + 颞上回，学习 = 颞叶下部，压力 = 颞极（杏仁核在它里面），习惯 = 小脑。
// 选中某件事时，它涉及的脑区之间拉出贴着脑表面拱起的「通路」，上面有信号点在走。
// 这只是比喻用的示意模型，不是解剖精确的。
import { loadThree } from './seal3d.js';

/* ---------- 3D simplex noise（Stefan Gustavson 的公开实现，精简版） ---------- */
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const P = new Uint8Array(512); { const p = []; let s = 1337; for (let i = 0; i < 256; i++) p[i] = i; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
function noise3(x, y, z) {
  const F = 1 / 3, G = 1 / 6; const s = (x + y + z) * F; const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G; const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
  else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
  const c = [[x0, y0, z0, 0, 0, 0], [x0 - i1 + G, y0 - j1 + G, z0 - k1 + G, i1, j1, k1], [x0 - i2 + 2 * G, y0 - j2 + 2 * G, z0 - k2 + 2 * G, i2, j2, k2], [x0 - 1 + 3 * G, y0 - 1 + 3 * G, z0 - 1 + 3 * G, 1, 1, 1]];
  let n = 0; const ii = i & 255, jj = j & 255, kk = k & 255;
  for (const [a, b, d, di, dj, dk] of c) { let tt = 0.6 - a * a - b * b - d * d; if (tt < 0) continue; const g = G3[P[ii + di + P[jj + dj + P[kk + dk]]] % 12]; tt *= tt; n += tt * tt * (g[0] * a + g[1] * b + g[2] * d); }
  return 32 * n;
}

/* ---------- 形状与分区：都用单位球上的 (u 前后, v 上下, w 外侧) 来算 ---------- */
// u：-1 = 额头（屏幕左边）… +1 = 枕叶；v：-1 底 … +1 顶；w：0 中线 … 1 外侧
const sylv = (u) => -0.15 + 0.45 * u; // 外侧裂：从颞极往后上斜
const cent = (v) => -0.2 + 0.16 * v; // 中央沟：从顶上往前下斜
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function regionAt(u, v, w) {
  const vs = sylv(u), uc = cent(v);
  if (Math.hypot(u + 0.42, v + 0.42) < 0.17 && w > 0.35) return 'alarm'; // 颞极
  if (v < vs && u > -0.62 && u < 0.78) return v > vs - 0.2 && u > -0.35 ? 'talk' : 'memory';
  if (u < uc && u > uc - 0.24 && v > vs) return 'move';
  if (u < uc - 0.24 && v > vs && v < vs + 0.24 && u > -0.62) return 'talk'; // 布罗卡区
  if (u < uc - 0.24) return 'plan';
  return '';
}
// 一个半球表面上的点：单位球方向 (x,y,z) → 位置 + 「沟有多深」（0 沟底 … 1 回顶）
function cortex(x, y, z) {
  const u = x, v = y, w = Math.abs(z);
  let X = x * 1.32, Y = y * 0.98, Z = z * 0.62;
  if (z < 0) Z = z * 0.22; // 内侧压平
  if (y < 0) Y = y * 0.74; // 底面收平
  // 颞叶往下鼓
  const tb = smooth(0, 0.6, -y) * Math.exp(-(((u + 0.02) / 0.5) ** 2)) * smooth(0.1, 0.6, w); Y -= 0.24 * tb; Z += 0.05 * tb * Math.sign(z);
  if (u < -0.55) Y *= 0.94; // 额叶前下方略收
  // 脑回：噪声的「零线」就是沟——弯弯曲曲、窄而深；其余是饱满的回。先做一层领域扭曲，让沟像真的一样绕
  const wq = 1.3; const wx = noise3(x * wq + 7, y * wq, z * wq) * 0.7, wy = noise3(x * wq, y * wq + 11, z * wq) * 0.7, wz = noise3(x * wq, y * wq, z * wq + 5) * 0.7;
  const q = 2.35; const n = noise3(x * q + wx, y * q * 1.1 + wy, z * q + wz);
  let ridge = smooth(0, 0.2, Math.abs(n)); // 0 沟底 … 1 回顶
  const n2 = noise3(x * 4.2 + wx, y * 4.2 + wy, z * 4.2); ridge *= 0.88 + 0.12 * smooth(0, 0.22, Math.abs(n2)); // 回上偶尔的浅沟
  let disp = (ridge - 0.8) * 0.095;
  // 外侧裂、中央沟刻深一点
  const vs = sylv(u); if (u > -0.6 && u < 0.7 && w > 0.2) { const g = Math.exp(-(((v - vs) / 0.04) ** 2)); disp -= 0.09 * g; ridge *= 1 - 0.9 * g; }
  const uc = cent(v); if (v > vs + 0.05 && w > 0.15) { const g = Math.exp(-(((u - uc) / 0.03) ** 2)); disp -= 0.06 * g; ridge *= 1 - 0.85 * g; }
  const len = Math.hypot(X, Y, Z) || 1; const k = 1 + disp / len;
  return { p: [X * k, Y * k, Z * k], ridge, region: regionAt(u, v, w), u, v, w };
}
const HEMI_OFF = 0.25; // 半球中心离中线的距离（内侧面压平到 0.22，中间留一条纵裂）
// 每个脑区在左半球（朝镜头）上的「中心点」：用来放数字和连线
const ANCHOR = { plan: [-0.72, 0.38], move: [-0.2, 0.62], talk: [0.12, -0.12], memory: [0.12, -0.5], alarm: [-0.42, -0.42] };

export async function createBrain3D(host, { onPick, onHover } = {}) {
  const THREE = await loadThree();
  const cv = document.createElement('canvas'); cv.className = 'b3-cv'; host.appendChild(cv);
  const overlay = document.createElement('div'); overlay.className = 'b3-ov'; host.appendChild(overlay);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true }); } catch (e) { cv.remove(); overlay.remove(); throw e; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50); camera.position.set(0, 0.55, 6.1); camera.lookAt(0, -0.18, 0);
  // 柔光：顶光 + 侧光 + 半球环境光
  scene.add(new THREE.HemisphereLight(0xfff6f2, 0x8a7f86, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.95); key.position.set(-2.5, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe9ff, 0.45); rim.position.set(3, 1.5, -4); scene.add(rim);

  let dirty = true;
  const root = new THREE.Group(); root.rotation.set(0.12, -0.32, 0); scene.add(root);
  const meshes = []; // { mesh, region: [], ridge: Float32Array }
  const TISSUE = new THREE.Color('#efd9d3'), DEEP = new THREE.Color('#9c7470'), GREY = new THREE.Color('#dcd6d4');

  // 两个半球
  for (const side of [1, -1]) {
    const g = new THREE.SphereGeometry(1, 220, 160); const pos = g.attributes.position; const N = pos.count;
    const region = new Array(N); const ridge = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i) * side; // 右半球镜像：外侧都是 z>0
      const c = cortex(x, y, z);
      pos.setXYZ(i, c.p[0], c.p[1], (c.p[2] + HEMI_OFF) * side);
      region[i] = c.region; ridge[i] = c.ridge;
    }
    if (side === -1) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; } // 镜像后翻转三角形朝向
    g.computeVertexNormals(); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }));
    root.add(m); meshes.push({ mesh: m, region, ridge });
  }
  // 小脑：横向小叶
  {
    const g = new THREE.SphereGeometry(1, 110, 80); const pos = g.attributes.position; const N = pos.count; const ridge = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(y, x); const f = smooth(0, 0.35, Math.abs(Math.sin(a * 26 + noise3(x * 2, y * 2, z * 2) * 1.4))); const d = 1 + 0.05 * (f - 0.8) - 0.1 * Math.exp(-((z / 0.1) ** 2));
      ridge[i] = f;
      pos.setXYZ(i, x * 0.44 * d + 0.78, y * 0.27 * d - 0.66, z * 0.62 * d);
    }
    g.computeVertexNormals(); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66 })); root.add(m);
    meshes.push({ mesh: m, region: new Array(N).fill('habit'), ridge });
  }
  // 脑干
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.7, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color('#c4a29d').convertSRGBToLinear(), roughness: 0.7 }));
  stem.position.set(0.36, -0.98, 0); stem.rotation.z = -0.3; root.add(stem);

  // 锚点：把单位球方向套进 cortex() 得到表面点，再往外提一点
  const anchor = {}, anchorN = {};
  for (const [id, [u, v]] of Object.entries(ANCHOR)) {
    const w = Math.sqrt(Math.max(0.02, 1 - u * u - v * v)); const c = cortex(u, v, w);
    const p = new THREE.Vector3(c.p[0], c.p[1], c.p[2] + HEMI_OFF);
    anchorN[id] = new THREE.Vector3(c.p[0] * 0.3, c.p[1] * 0.4, 1).normalize(); anchor[id] = p.add(anchorN[id].clone().multiplyScalar(0.03));
  }
  anchor.habit = new THREE.Vector3(0.86, -0.7, 0.64); anchorN.habit = new THREE.Vector3(0.2, -0.2, 1).normalize();

  // 颜色
  let st = { count: {}, colors: {}, sel: '', hover: '', focus: null, dropHover: '' };
  const flash = {};
  const tmp = new THREE.Color();
  function paint() {
    const max = Math.max(1, ...Object.values(st.count));
    const strength = {}; const regionCol = {};
    for (const [id, col] of Object.entries(st.colors)) {
      const n = st.count[id] || 0; let k = 0.4 + (n ? 0.15 + 0.3 * (n / max) : 0);
      if (st.sel === id) k += 0.12; if (st.hover === id || st.dropHover === id) k += 0.14; if (flash[id]) k += 0.3 * flash[id];
      if (st.focus) k = st.focus.primary === id ? 0.85 : st.focus.also.includes(id) ? 0.55 : 0.08;
      strength[id] = Math.min(0.92, k); regionCol[id] = new THREE.Color(col).convertSRGBToLinear();
    }
    const tissue = TISSUE.clone().convertSRGBToLinear(), deep = DEEP.clone().convertSRGBToLinear(), grey = GREY.clone().convertSRGBToLinear();
    for (const { mesh, region, ridge } of meshes) {
      const col = mesh.geometry.attributes.color; const a = col.array;
      for (let i = 0; i < region.length; i++) {
        const r = region[i]; const sh = 0.35 + 0.65 * ridge[i];
        tmp.copy(deep).lerp(st.focus && !(r && (st.focus.primary === r || st.focus.also.includes(r))) ? grey : tissue, sh);
        if (r && regionCol[r]) tmp.lerp(regionCol[r], strength[r] * (0.35 + 0.65 * sh));
        a[i * 3] = tmp.r; a[i * 3 + 1] = tmp.g; a[i * 3 + 2] = tmp.b;
      }
      col.needsUpdate = true;
    }
    dirty = true;
  }

  // 通路：两个脑区之间贴着脑表面拱起的管子 + 走动的信号点
  const links = new THREE.Group(); links.renderOrder = 2; root.add(links); let pulses = [];
  function buildLinks() {
    while (links.children.length) { const c = links.children.pop(); c.geometry && c.geometry.dispose(); }
    pulses = [];
    const f = st.focus; if (!f || !f.also.length || !anchor[f.primary]) return;
    const col = new THREE.Color(st.colors[f.primary] || '#888').convertSRGBToLinear();
    for (const id of f.also) {
      if (!anchor[id]) continue;
      const a = anchor[f.primary], b = anchor[id]; const mid = a.clone().add(b).multiplyScalar(0.5);
      // 往上、往外拱：从侧面看是一道明显的弧，而不是冲着镜头的直线
      // 垂直于两点连线往旁边拱（从侧面看是一道清楚的弧），再往外提一点离开脑表面
      const d = a.distanceTo(b); const perp = b.clone().sub(a).cross(new THREE.Vector3(0, 0, 1)).normalize(); if (perp.x + perp.y < 0) perp.negate();
      const out = perp.multiplyScalar(0.3 + d * 0.35).add(anchorN[f.primary].clone().add(anchorN[id]).normalize().multiplyScalar(0.25));
      const curve = new THREE.CubicBezierCurve3(a, a.clone().lerp(mid, 0.45).add(out), b.clone().lerp(mid, 0.45).add(out), b);
      const over = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false }; // 通路画在最上面，不会被脑回挡住
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.026, 8), new THREE.MeshBasicMaterial({ color: col, opacity: 0.9, ...over }));
      const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.06, 8), new THREE.MeshBasicMaterial({ color: col, opacity: 0.22, ...over }));
      links.add(tube, halo);
      for (const end of [a, b]) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: col, ...over })); s.position.copy(end); links.add(s); const r = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 32), new THREE.MeshBasicMaterial({ color: col, opacity: 0.5, side: THREE.DoubleSide, ...over })); r.position.copy(end); r.lookAt(end.clone().add(anchorN[end === a ? f.primary : id])); links.add(r); }
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, ...over }));
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), new THREE.MeshBasicMaterial({ color: col, opacity: 0.4, ...over }));
        links.add(p, g); pulses.push({ curve, p, g, off: k / 3 });
      }
    }
    links.traverse((o) => { o.renderOrder = 5; });
  }

  // 数字标记：HTML 叠在画布上，每帧投影到锚点
  const badges = {};
  function syncBadges() {
    for (const id of Object.keys(st.colors)) {
      let el = badges[id]; if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'b3-badge'; el.addEventListener('click', () => onPick && onPick(id)); overlay.appendChild(el); badges[id] = el; }
      const n = st.count[id] || 0; const involved = st.focus && (st.focus.primary === id || st.focus.also.includes(id));
      el.textContent = n || ''; el.style.setProperty('--c', st.colors[id]);
      el.classList.toggle('on', st.sel === id); el.classList.toggle('show', !!(n || involved)); el.classList.toggle('dim', !!(st.focus && !involved));
    }
  }
  const v3 = new THREE.Vector3(), camDir = new THREE.Vector3();
  function placeBadges(w, h) {
    for (const [id, el] of Object.entries(badges)) {
      if (!anchor[id]) continue;
      v3.copy(anchor[id]).applyMatrix4(root.matrixWorld); const nrm = anchorN[id].clone().applyQuaternion(root.quaternion);
      camDir.copy(camera.position).sub(v3).normalize(); const facing = nrm.dot(camDir);
      v3.project(camera); el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px,${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`;
      el.style.opacity = facing < 0.05 ? '0' : '';
    }
  }

  // 尺寸
  let W = 0, H = 0;
  const resize = () => { const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); renderer.setSize(W, H, false); camera.aspect = W / H; camera.fov = W / H < 1 ? 38 : 30; camera.updateProjectionMatrix(); dirty = true; };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  // 交互：拖着转、点一下选脑区、悬停高亮、把待办拖进来
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const regionAtPx = (cx, cy) => {
    const r = cv.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0]; if (!hit) return null;
    const m = meshes.find((x) => x.mesh === hit.object); return m ? m.region[hit.face.a] || '' : null;
  };
  let yaw = -0.32, pitch = 0.12, drag = null, idleAt = 0, t0 = performance.now();
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; yaw = Math.max(-1.3, Math.min(1.0, drag.yaw + dx * 0.008)); pitch = Math.max(-0.35, Math.min(0.55, drag.pitch + dy * 0.006)); dirty = true; return; }
    const id = regionAtPx(e.clientX, e.clientY); cv.style.cursor = id ? 'pointer' : 'grab'; if (onHover) onHover(id || '');
  });
  cv.addEventListener('pointerup', (e) => { const d = drag; drag = null; idleAt = performance.now() + 4000; if (d && !d.moved) { const id = regionAtPx(e.clientX, e.clientY); if (id && onPick) onPick(id); } });
  cv.addEventListener('pointerleave', () => { if (!drag && onHover) onHover(''); });
  cv.addEventListener('dragover', (e) => { const id = regionAtPx(e.clientX, e.clientY); if (id !== st.dropHover) { st.dropHover = id || ''; paint(); } });
  cv.addEventListener('dragleave', () => { if (st.dropHover) { st.dropHover = ''; paint(); } });
  cv.addEventListener('drop', () => { if (st.dropHover) { st.dropHover = ''; paint(); } });

  // 渲染：看得见才画；闲着时轻轻左右转；慢设备自动降帧
  let alive = true, visible = true, raf = 0, skip = 0, slow = 0;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); }); io.observe(host);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function loop() {
    cancelAnimationFrame(raf); if (!alive || !visible || document.hidden) return;
    raf = requestAnimationFrame(loop);
    if (skip > 0) { skip--; return; }
    const now = performance.now(); const t = (now - t0) / 1000;
    if (!drag && now > idleAt && !reduce) { yaw += ((-0.32 + Math.sin(t * 0.25) * 0.22) - yaw) * 0.02; pitch += (0.12 - pitch) * 0.02; dirty = true; }
    for (const id of Object.keys(flash)) { flash[id] -= 0.03; if (flash[id] <= 0) delete flash[id]; paint(); }
    if (pulses.length) { for (const pl of pulses) { const k = ((t * 0.45 + pl.off) % 1); pl.curve.getPoint(k, pl.p.position); pl.g.position.copy(pl.p.position); } dirty = true; }
    if (!dirty) return;
    root.rotation.set(pitch, yaw, 0); root.updateMatrixWorld();
    const a = performance.now(); renderer.render(scene, camera); placeBadges(W, H); dirty = false;
    const dt = performance.now() - a; slow = slow * 0.9 + dt * 0.1; skip = slow > 30 ? 3 : slow > 16 ? 1 : 0;
  }
  const onVis = () => loop(); document.addEventListener('visibilitychange', onVis);
  loop();

  return {
    update(next) {
      const focusChanged = JSON.stringify(next.focus || null) !== JSON.stringify(st.focus || null);
      st = { ...st, ...next }; paint(); syncBadges(); if (focusChanged) buildLinks(); dirty = true; loop();
    },
    flash(id) { flash[id] = 1; loop(); },
    regionAt: (x, y) => regionAtPx(x, y) || '',
    destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); renderer.dispose(); scene.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); cv.remove(); overlay.remove(); },
  };
}
