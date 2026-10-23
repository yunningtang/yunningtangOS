// Rotating orthographic globe on canvas: land outlines, graticule, glowing trip markers.
import { geoOrthographic, geoPath, geoGraticule, feature, geoCentroid } from '../vendor/geo.js';

// Satellite imagery (NASA Blue Marble, served from a CDN); falls back to the drawn globe if it cannot load.
const TEXTURE = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
let texPromise;
function loadTexture() {
  texPromise = texPromise || new Promise((res) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { try { const W = 2048, H = 1024; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H); res({ data: g.getImageData(0, 0, W, H).data, W, H }); } catch { res(null); } };
    img.onerror = () => res(null);
    img.src = TEXTURE;
  });
  return texPromise;
}
let landPromise;
function loadLand() {
  landPromise = landPromise || fetch(new URL('../vendor/land-110m.json', import.meta.url)).then((r) => r.json()).then((topo) => feature(topo, topo.objects.land));
  return landPromise;
}

export function mountGlobe(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const proj = geoOrthographic().clipAngle(90);
  const path = geoPath(proj, ctx);
  const grat = geoGraticule().step([30, 30])();
  let land = null, markers = opts.markers || [], selected = null, tex = null;
  let rot = [-105, -30], vel = 0.06, auto = true, raf, w, h, dpr;
  let zoom = 1, base = 100;
  const applyScale = () => proj.scale(base * zoom);
  // zoom; when a screen point is given the place under it stays put (zoom towards the cursor)
  const setZoom = (z, cx, cy) => {
    const nz = Math.max(0.7, Math.min(6, z));
    let a = null;
    if (cx != null) { proj.rotate(rot); a = proj.invert([cx, cy]); }
    zoom = nz; applyScale(); lastInteract = performance.now();
    if (a && isFinite(a[0])) {
      const b = proj.invert([cx, cy]);
      if (b && isFinite(b[0])) { let dl = b[0] - a[0]; if (dl > 180) dl -= 360; if (dl < -180) dl += 360; rot = [rot[0] + dl, Math.max(-85, Math.min(85, rot[1] + (b[1] - a[1])))]; proj.rotate(rot); }
    }
  };
  let drag = null, lastInteract = 0;
  // raster cache: the textured sphere is re-rendered only when rotation / size change
  let rasterKey = '', raster = null;

  function renderRaster(cx, cy, r) {
    const key = [rot[0].toFixed(2), rot[1].toFixed(2), r.toFixed(1), w, h].join(',');
    if (raster && rasterKey === key) return raster;
    if (!raster || raster.width !== w || raster.height !== h) { raster = document.createElement('canvas'); raster.width = w; raster.height = h; }
    const g = raster.getContext('2d'); const out = g.createImageData(w, h); const px = out.data;
    const { data, W, H } = tex;
    const toR = Math.PI / 180; const lam0 = rot[0] * toR, phi0 = rot[1] * toR; const cphi = Math.cos(phi0), sphi = Math.sin(phi0);
    const inv = 1 / r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h, Math.ceil(cy + r));
    for (let j = y0; j < y1; j++) {
      const yv = (cy - j - 0.5) * inv;
      for (let i = x0; i < x1; i++) {
        const xv = (i - cx + 0.5) * inv; const d2 = xv * xv + yv * yv; if (d2 > 1) continue;
        const zv = Math.sqrt(1 - d2);
        const x = zv, y = xv, z = yv;
        const k = z * cphi - x * sphi;
        const lam = Math.atan2(y, x * cphi + z * sphi) - lam0; const phi = Math.asin(Math.max(-1, Math.min(1, k)));
        let u = (lam / (2 * Math.PI) + 0.5) % 1; if (u < 0) u += 1;
        const v = 0.5 - phi / Math.PI;
        const tx = (u * W) | 0, ty = Math.min(H - 1, (v * H) | 0); const ti = (ty * W + tx) * 4; const o = (j * w + i) * 4;
        const l = 0.72 + 0.28 * Math.max(0, (-xv * 0.5 + yv * 0.6 + zv * 0.62));
        px[o] = data[ti] * l; px[o + 1] = data[ti + 1] * l; px[o + 2] = data[ti + 2] * l; px[o + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0); rasterKey = key; return raster;
  }

  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    base = Math.min(w, h) * 0.46;
    proj.translate([w / 2, h / 2]); applyScale();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const r = proj.scale(), [cx, cy] = proj.translate();
    // atmosphere
    const atm = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.16);
    atm.addColorStop(0, 'rgba(120,180,255,.55)'); atm.addColorStop(0.5, 'rgba(90,150,255,.18)'); atm.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (tex) {
      const ras = renderRaster(cx, cy, r); ctx.drawImage(ras, 0, 0, w, h);
      const sh = ctx.createRadialGradient(cx - r * 0.5, cy - r * 0.5, r * 0.2, cx, cy, r);
      sh.addColorStop(0, 'rgba(255,255,255,.08)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)'); sh.addColorStop(0.92, 'rgba(5,12,40,.25)'); sh.addColorStop(1, 'rgba(2,6,24,.7)');
      ctx.fillStyle = sh; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(160,200,255,.45)'; ctx.lineWidth = 1; ctx.stroke();
      drawMarkers(cx, cy, r); return;
    }
    const sea = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.45, r * 0.05, cx, cy, r * 1.05);
    sea.addColorStop(0, '#4f9ff5'); sea.addColorStop(0.35, '#2c6fd6'); sea.addColorStop(0.75, '#153f9a'); sea.addColorStop(1, '#0a1f5c');
    ctx.fillStyle = sea; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // graticule
    ctx.beginPath(); path(grat); ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = .5; ctx.stroke();
    // land, coloured by screen latitude band (ice at poles, green temperate, tan subtropics)
    if (land) {
      const lg = ctx.createLinearGradient(0, cy - r, 0, cy + r);
      [[0, '#eef3f6'], [0.07, '#cfdcd6'], [0.14, '#5e8d57'], [0.3, '#78a35a'], [0.42, '#b9a86a'], [0.5, '#5f9a4a'], [0.6, '#7fa85c'], [0.72, '#8aa55f'], [0.88, '#c9d6d2'], [1, '#eef3f6']].forEach(([o, c]) => lg.addColorStop(o, c));
      ctx.beginPath(); path(land); ctx.fillStyle = lg; ctx.fill();
      ctx.strokeStyle = 'rgba(30,60,40,.35)'; ctx.lineWidth = .5; ctx.stroke();
      // soft relief: darker inner edge
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // terminator-ish shading and specular
    const sh = ctx.createRadialGradient(cx - r * 0.5, cy - r * 0.5, r * 0.1, cx, cy, r);
    sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(0.85, 'rgba(5,12,40,.35)'); sh.addColorStop(1, 'rgba(2,6,24,.75)');
    ctx.fillStyle = sh; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const spec = ctx.createRadialGradient(cx - r * 0.55, cy - r * 0.55, 0, cx - r * 0.55, cy - r * 0.55, r * 0.5);
    spec.addColorStop(0, 'rgba(255,255,255,.35)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    // limb
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(160,200,255,.45)'; ctx.lineWidth = 1; ctx.stroke();
    drawMarkers(cx, cy, r);
  }

  function drawMarkers(cx, cy, r) {
    const t = performance.now() / 1000;
    for (const m of markers) {
      const p = proj([m.lng, m.lat]);
      if (!p || !geoVisible(proj, m.lng, m.lat)) continue;
      const sel = selected && selected === m.id;
      const col = m.kind === 'wish' ? '#f0c060' : m.kind === 'live' ? '#7fe0b0' : '#ffffff';
      const pulse = sel ? 6 + Math.sin(t * 4) * 2 : 0;
      ctx.beginPath(); ctx.arc(p[0], p[1], 8 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = sel ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.14)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], sel ? 5 : 3.8, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(10,30,80,.8)'; ctx.lineWidth = 1; ctx.stroke();
      if (sel && m.label) {
        ctx.font = '500 12px "Noto Serif SC", serif';
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6;
        ctx.fillText(m.label, p[0] + 11, p[1] + 4); ctx.shadowBlur = 0;
      }
    }
  }

  function geoVisible(p, lng, lat) {
    const [l0, p0] = p.rotate();
    const toR = Math.PI / 180;
    const x = Math.cos(lat * toR) * Math.cos((lng + l0) * toR);
    const y = Math.cos(lat * toR) * Math.sin((lng + l0) * toR);
    const z = Math.sin(lat * toR);
    // rotate around y by -p0
    const zz = -x * Math.sin(-p0 * toR) + z * Math.cos(-p0 * toR);
    const xx = x * Math.cos(-p0 * toR) + z * Math.sin(-p0 * toR);
    return xx > 0 || Math.abs(xx) < 1e-9 && zz >= 0;
  }

  function loop() {
    if (auto && !drag && performance.now() - lastInteract > 2500) rot[0] += vel;
    proj.rotate(rot);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function pick(x, y) {
    let best = null, bd = 14;
    for (const m of markers) {
      const p = proj([m.lng, m.lat]);
      if (!p || !geoVisible(proj, m.lng, m.lat)) continue;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, r: [...rot], moved: false };
    canvas.setPointerCapture(e.pointerId); canvas.classList.add('on');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.pinch) { const o = pointers.get(e.pointerId); if (o) { o.x = e.clientX; o.y = e.clientY; } const pts = [...pointers.values()]; if (pts.length === 2) { const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); setZoom(drag.z0 * d / drag.d0); } return; }
    const k = 0.4 / zoom;
    rot = [drag.r[0] + dx * k, Math.max(-85, Math.min(85, drag.r[1] - dy * k))];
    lastInteract = performance.now();
  });
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2 && drag) { const pts = [...pointers.values()]; drag.pinch = true; drag.d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1; drag.z0 = zoom; } });
  const forget = (e) => { pointers.delete(e.pointerId); if (drag && drag.pinch && pointers.size < 2) { drag = null; canvas.classList.remove('on'); } };
  canvas.addEventListener('pointerup', forget); canvas.addEventListener('pointercancel', forget);
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), x, y); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const [x, y] = local(e); if (zoom >= 3) setZoom(1); else setZoom(zoom * 1.8, x, y); });
  const up = (e) => {
    if (!drag) return;
    if (!drag.moved) {
      const rect = canvas.getBoundingClientRect();
      const m = pick(e.clientX - rect.left, e.clientY - rect.top);
      if (m && opts.onSelect) opts.onSelect(m.id);
    }
    drag = null; canvas.classList.remove('on'); lastInteract = performance.now();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  size();
  loadLand().then((l) => { land = l; });
  loadTexture().then((t) => { tex = t; });
  loop();

  return {
    setMarkers(m) { markers = m; },
    select(id, fly = true) {
      selected = id;
      const m = markers.find((x) => x.id === id);
      if (m && fly) { rot = [-m.lng, -m.lat * 0.9]; lastInteract = performance.now() + 4000; }
    },
    toggleAuto() { auto = !auto; return auto; },
    zoomBy(f) { setZoom(zoom * f); },
    reset() { zoom = 1; applyScale(); rot = [-105, -30]; lastInteract = 0; },
    getZoom() { return zoom; },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
