// 认图片里的字（OCR）：扫描版 PDF、拍的题、截图。在浏览器里跑（tesseract.js），不用上传、不花 AI 用量。
// 第一次用要下载约 9 MB（识别引擎 + 中英文字库），之后浏览器会缓存。识别结果按文件存在本机，同一页不会认第二遍。
import { kvGet, kvSet } from './files.js';

const V = new URL('../vendor/tesseract/', import.meta.url).href;
let workerP = null, onProg = null;
function worker() {
  if (!workerP) workerP = import(V + 'tesseract.esm.min.js').then((m) => (m.createWorker || m.default.createWorker)(['chi_sim', 'eng'], 1, {
    workerPath: V + 'worker.min.js', corePath: V, langPath: V + 'lang', gzip: true,
    logger: (m) => { if (onProg) onProg(m); },
  })).catch((e) => { workerP = null; throw new Error('文字识别组件加载失败：' + (e.message || e)); });
  return workerP;
}
// 中文识别结果字和字之间常有多余空格，去掉（英文单词之间的保留）
const tidy = (t) => String(t || '').replace(/([一-鿿，。、；：？！（）「」])\s+(?=[一-鿿，。、；：？！（）「」])/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// src：canvas / Blob / 图片地址。onProgress(0..1)
export async function ocrImage(src, onProgress) {
  const w = await worker();
  onProg = (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress || 0); };
  try { const { data } = await w.recognize(src); return tidy(data.text); } finally { onProg = null; }
}
// 扫描版 PDF：把要用的几页画成图再识别，结果按页缓存。render(i) 返回第 i 页（0 开始）的 canvas
export async function ocrPdfPages(fid, pageIdx, render, onStatus) {
  const key = 'pdfocr:' + fid; const cache = (await kvGet(key)) || {};
  const todo = pageIdx.filter((i) => typeof cache[i] !== 'string');
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    onStatus && onStatus(`正在识别文字：第 ${i + 1} 页（${k + 1} / ${todo.length}）…`);
    cache[i] = await ocrImage(await render(i), (p) => onStatus && onStatus(`正在识别文字：第 ${i + 1} 页（${k + 1} / ${todo.length}）${Math.round(p * 100)}%`));
    await kvSet(key, cache);
  }
  return cache;
}
