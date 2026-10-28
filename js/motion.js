// 动效小工具：文字渐显、复制后的对勾。系统打开了「减少动态效果」就都不做。
const still = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// 一段新出现的文字逐字浮现：每个字 120ms 从 blur(6px) 渐显，前 20 个字错开 30ms，后面的加快，整段控制在约 1.2 秒内。
// 动画结束后把拆开的字还原成原来的文本节点，不留一堆 span。
export function revealText(el) {
  if (!el || still()) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const total = nodes.reduce((n, t) => n + t.nodeValue.length, 0); if (!total) return;
  const step = total > 20 ? Math.min(30, 600 / (total - 20)) : 30;
  const delay = (k) => (k < 20 ? k * 30 : 600 + (k - 20) * step);
  let k = 0; const spans = [];
  for (const t of nodes) {
    const frag = document.createDocumentFragment();
    for (const ch of t.nodeValue) {
      if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(ch)); continue; }
      const s = document.createElement('span'); s.className = 'rv'; s.style.setProperty('--d', Math.round(delay(k++)) + 'ms'); s.textContent = ch; frag.appendChild(s); spans.push(s);
    }
    t.replaceWith(frag);
  }
  setTimeout(() => { spans.forEach((s) => { if (s.isConnected) s.replaceWith(document.createTextNode(s.textContent)); }); el.normalize(); }, delay(k) + 200);
}

// 复制按钮：图标换成对勾，2.5 秒后自己换回来
export function copied(btn) {
  if (!btn) return;
  btn.classList.add('copied'); clearTimeout(btn._copiedT);
  btn._copiedT = setTimeout(() => btn.classList.remove('copied'), 2500);
}
