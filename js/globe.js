// Rotating orthographic globe on canvas: land outlines, graticule, glowing trip markers.
import { geoOrthographic, geoPath, geoGraticule, feature, geoCentroid } from '../vendor/geo.js';

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
  let land = null, markers = opts.markers || [], selected = null;
  let rot = [-105, -30], vel = 0.06, auto = true, raf, w, h, dpr;
  let drag = null, lastInteract = 0;

  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    proj.translate([w / 2, h / 2]).scale(Math.min(w, h) * 0.46);
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const r = proj.scale(), [cx, cy] = proj.translate();
    // atmosphere
    const atm = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.16);
    atm.addColorStop(0, 'rgba(120,180,255,.55)'); atm.addColorStop(0.5, 'rgba(90,150,255,.18)'); atm.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2); ctx.fill();
    // ocean
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
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
    // markers
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
    rot = [drag.r[0] + dx * 0.4, Math.max(-80, Math.min(80, drag.r[1] - dy * 0.4))];
    lastInteract = performance.now();
  });
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
  loop();

  return {
    setMarkers(m) { markers = m; },
    select(id, fly = true) {
      selected = id;
      const m = markers.find((x) => x.id === id);
      if (m && fly) { rot = [-m.lng, -m.lat * 0.9]; lastInteract = performance.now() + 4000; }
    },
    toggleAuto() { auto = !auto; return auto; },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
