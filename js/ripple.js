// Faint cursor ripple on the background canvas, in the spirit of the portfolio's rippleCanvas.
export function startRipple(canvas) {
  if (!canvas || !matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const rings = [];
  let w, h, raf;
  const size = () => {
    w = canvas.width = innerWidth * devicePixelRatio;
    h = canvas.height = innerHeight * devicePixelRatio;
  };
  size();
  addEventListener('resize', size);
  let last = 0;
  addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - last < 90) return;
    last = now;
    rings.push({ x: e.clientX * devicePixelRatio, y: e.clientY * devicePixelRatio, r: 4, a: 0.22 });
    if (!raf) loop();
  });
  function loop() {
    ctx.clearRect(0, 0, w, h);
    const dark = document.documentElement.dataset.theme === 'dark';
    for (let i = rings.length - 1; i >= 0; i--) {
      const q = rings[i];
      q.r += 1.6 * devicePixelRatio;
      q.a *= 0.955;
      if (q.a < 0.01) { rings.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? `rgba(95,212,176,${q.a})` : `rgba(24,168,162,${q.a})`;
      ctx.lineWidth = 1 * devicePixelRatio;
      ctx.stroke();
    }
    raf = rings.length ? requestAnimationFrame(loop) : 0;
  }
}
