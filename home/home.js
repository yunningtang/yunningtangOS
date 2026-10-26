// 官网首屏的小演示：点模式 → 打字 → 换草稿；保存 / 撤回
(() => {
  const P = {
    record: ['周四下午和导师过一遍论文进度，之前要把这周读的三篇笔记整理好，顺便约个跑步。', '一条笔记'],
    split: ['帮我把「准备周四的论文讨论」拆成几步，每步小到马上能开始。', '5 个步骤'],
    plan: ['把这些排进这周，晚上和周三上午我比较有空。', '4 个时段'],
    resume: ['我回来了，上次做到哪了？', '上次的进度'],
  };
  const $ = (s) => document.querySelector(s);
  const typed = $('#typed'), kind = $('#kind');
  let mode = 'split', timer = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setSaved(v) { $('#savedRow').hidden = !v; $('#unsavedRow').hidden = v; }
  function show(m) {
    mode = m; clearInterval(timer); setSaved(false);
    document.querySelectorAll('[data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    document.querySelectorAll('[data-show]').forEach((d) => { d.hidden = d.dataset.show !== m; });
    kind.textContent = P[m][1];
    const full = P[m][0];
    if (still) { typed.textContent = full; return; }
    let n = 0; typed.textContent = '';
    timer = setInterval(() => { typed.textContent = full.slice(0, ++n); if (n >= full.length) clearInterval(timer); }, 38);
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => show(b.dataset.mode)));
  $('#replay').addEventListener('click', () => show(mode));
  $('#confirm').addEventListener('click', () => setSaved(true));
  $('#undo').addEventListener('click', () => setSaved(false));
  show('split');
})();
