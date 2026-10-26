// 3D 小海豹模型：App 角落里的汤圆和官网首页共用。只依赖 vendor/three.min.js，不碰 App 的数据。
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
export function buildSeal(THREE, cv, size = 150) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5)); renderer.setSize(size, size, false);
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
