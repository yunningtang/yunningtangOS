// Tiny force-directed graph of pages and [[links]] on a canvas.
import { LINK_RE } from './views/notes.js';

export function mountGraph(canvas, notes, onOpen) {
  const ctx = canvas.getContext('2d');
  const byTitle = new Map(notes.map((n) => [n.title.trim().toLowerCase(), n]));
  const nodes = notes.map((n, i) => ({ id: n.id, label: n.title || '无标题', icon: n.icon, x: Math.cos(i * 2.4) * (80 + i * 14), y: Math.sin(i * 2.4) * (80 + i * 14), vx: 0, vy: 0, deg: 0 }));
  const idx = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const n of notes) {
    for (const m of (n.body || '').matchAll(LINK_RE)) {
      const t = byTitle.get(m[1].trim().toLowerCase());
      if (t && t.id !== n.id) { edges.push([idx.get(n.id), idx.get(t.id)]); idx.get(n.id).deg++; idx.get(t.id).deg++; }
    }
    if (n.parent && idx.has(n.parent)) { edges.push([idx.get(n.parent), idx.get(n.id), true]); }
  }
  let w, h, dpr, raf, drag = null, hover = null, pan = { x: 0, y: 0 }, alpha = 1;
  const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const style = () => getComputedStyle(document.documentElement);
  function tick() {
    const k = 0.012 * alpha;
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
      const f = (7000 / d2) * alpha;
      a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
    }
    for (const [a, b, soft] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (d - (soft ? 120 : 170)) * (soft ? 0.004 : 0.008) * alpha;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) { n.vx -= n.x * k; n.vy -= n.y * k; if (drag && drag.n === n) continue; n.x += n.vx; n.y += n.vy; n.vx *= 0.82; n.vy *= 0.82; }
    alpha = Math.max(0.02, alpha * 0.995);
  }
  function draw() {
    const st = style(); const text = st.getPropertyValue('--text').trim(), teal = st.getPropertyValue('--teal').trim(), muted = st.getPropertyValue('--text-4').trim();
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2 + pan.x, h / 2 + pan.y);
    for (const [a, b, soft] of edges) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = soft ? 'rgba(128,140,155,.18)' : 'rgba(128,140,155,.4)'; ctx.lineWidth = soft ? 1 : 1.2; if (soft) ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]); }
    for (const n of nodes) {
      const r = 5 + Math.min(n.deg, 8) * 1.4, hot = hover === n;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + (hot ? 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle = hot ? text : (n.deg ? 'rgba(80,80,80,.9)' : 'rgba(150,150,150,.7)'); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `${hot ? 600 : 400} 12px "Noto Serif SC", serif`; ctx.fillStyle = hot ? text : muted; ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + r + 14);
    }
    ctx.restore();
  }
  function loop() { tick(); draw(); raf = requestAnimationFrame(loop); }
  const pick = (x, y) => { const px = x - w / 2 - pan.x, py = y - h / 2 - pan.y; return nodes.find((n) => Math.hypot(n.x - px, n.y - py) < 16); };
  canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); const n = pick(e.clientX - r.left, e.clientY - r.top); drag = { n, x: e.clientX, y: e.clientY, moved: false, pan: { ...pan } }; canvas.setPointerCapture(e.pointerId); alpha = Math.max(alpha, 0.3); });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    if (drag) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true; if (drag.n) { drag.n.x = x - w / 2 - pan.x; drag.n.y = y - h / 2 - pan.y; } else { pan = { x: drag.pan.x + e.clientX - drag.x, y: drag.pan.y + e.clientY - drag.y }; } }
    else { hover = pick(x, y); canvas.style.cursor = hover ? 'pointer' : 'grab'; }
  });
  const up = () => { if (drag && drag.n && !drag.moved) onOpen(drag.n.id); drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  const ro = new ResizeObserver(size); ro.observe(canvas); size(); loop();
  return { destroy() { cancelAnimationFrame(raf); ro.disconnect(); } };
}
