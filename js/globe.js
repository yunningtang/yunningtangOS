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
    // halo
    const halo = ctx.createRadialGradient(cx, cy, r * 0.95, cx, cy, r * 1.25);
    halo.addColorStop(0, 'rgba(180,200,225,.18)'); halo.addColorStop(1, 'rgba(180,200,225,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    // sphere
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const sea = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    sea.addColorStop(0, '#2b3b55'); sea.addColorStop(1, '#141c2a');
    ctx.fillStyle = sea; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
    // graticule
    ctx.beginPath(); path(grat); ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = .5; ctx.stroke();
    // land
    if (land) {
      ctx.beginPath(); path(land);
      ctx.fillStyle = 'rgba(225,232,240,.78)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = .6; ctx.stroke();
    }
    // markers
    const t = performance.now() / 1000;
    for (const m of markers) {
      const p = proj([m.lng, m.lat]);
      if (!p) continue;
      // visible side only
      const [lx, ly] = [m.lng, m.lat];
      const vis = geoVisible(proj, lx, ly);
      if (!vis) continue;
      const sel = selected && selected === m.id;
      const wish = m.kind === 'wish';
      const pulse = sel ? 6 + Math.sin(t * 4) * 2 : 0;
      ctx.beginPath(); ctx.arc(p[0], p[1], 9 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = sel ? 'rgba(111,196,184,.3)' : wish ? 'rgba(220,180,106,.2)' : 'rgba(43,138,131,.22)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], sel ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle = sel ? '#6fc4b8' : wish ? '#dcb46a' : '#2b8a83'; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke();
      if (sel && m.label) {
        ctx.font = '500 12px "Noto Serif SC", serif';
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.textAlign = 'left';
        ctx.fillText(m.label, p[0] + 10, p[1] + 4);
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
