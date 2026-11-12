// 界面语言：中文是原文；选 English 时，把界面上的字换成英文（i18n-en.js 里的词典 + 句式）。
// 只换界面上的字：你自己写的内容（待办标题、笔记、便利贴、汤圆的回复、所有输入框）不碰。
// App 和官网首页共用同一个选择（存在这台设备上：localStorage ytos.lang）。
const KEY = 'ytos.lang';
export function getLang() {
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'zh') return v; } catch {}
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en'; // 第一次来：跟浏览器的语言
}
export function setLang(v) { try { localStorage.setItem(KEY, v); } catch {} location.reload(); }
export const isEn = () => getLang() === 'en';

const CJK = /[一-鿿]/;
// 这些地方是你自己的内容（或者 AI 写的），一个字都不换
const SKIP = '[contenteditable],textarea,input,select,script,style,.sm-t,.sm.me,.beditor,.nv-read,.stk-ta,.nv-ta,.no-i18n,.ti,.fd-t,.sk-tt b,.cd-lead,.blk .bt,.pt-title,.note-title';
const PUNCT = { '，': ', ', '。': '. ', '：': ': ', '；': '; ', '、': ', ', '（': ' (', '）': ')', '！': '! ', '？': '? ', '「': '“', '」': '”', '·': '·', '／': ' / ' };
const WD = { 日: 'Sun', 一: 'Mon', 二: 'Tue', 三: 'Wed', 四: 'Thu', 五: 'Fri', 六: 'Sat', 天: 'Sun' };
const WD1 = { 日: 'S', 一: 'M', 二: 'T', 三: 'W', 四: 'T', 五: 'F', 六: 'S' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let DICT = null, PATS = [];
// 「还有 {0} 天」→ /^还有 (.+?) 天$/，英文模板里的 {0} 换回去
function compile(patterns) {
  return Object.entries(patterns).filter(([, en]) => en).map(([zh, en]) => {
    const parts = zh.split(/(\{\d+\})/); const idx = [];
    const src = parts.map((p) => { const m = p.match(/^\{(\d+)\}$/); if (m) { idx.push(+m[1]); return '([\\s\\S]+?)'; } return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('');
    return { re: new RegExp('^' + src + '$'), idx, en, fixed: zh.replace(/\{\d+\}/g, '').length };
  }).sort((a, b) => b.fixed - a.fixed); // 固定字多的先试，免得「{0}」这种太宽的吃掉一切
}
// 日期、星期、单位这些规律的写法
const RULES = [
  [/^(\d{1,2})月(\d{1,2})日\s*(?:周|星期)([日一二三四五六天])$/, (m) => `${WD[m[3]]}, ${MON[m[1] - 1]} ${+m[2]}`],
  [/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/, (m) => `${MON[m[2] - 1]} ${+m[3]}, ${m[1]}`],
  [/^(\d{1,2})月(\d{1,2})日$/, (m) => `${MON[m[1] - 1]} ${+m[2]}`],
  [/^(\d{4})\s*年\s*(\d{1,2})\s*月$/, (m) => `${MONL[m[2] - 1]} ${m[1]}`],
  [/^(\d{1,2})\s*月$/, (m) => MON[m[1] - 1]],
  [/^(\d{4})\s*年$/, (m) => m[1]],
  [/^(?:周|星期)([日一二三四五六天])$/, (m) => WD[m[1]]],
  [/^(\d+)\s*天$/, (m) => `${m[1]} ${+m[1] === 1 ? 'day' : 'days'}`],
  [/^(\d+)\s*(?:分钟|分)$/, (m) => `${m[1]} min`],
  [/^(\d+)\s*小时$/, (m) => `${m[1]} h`],
  [/^(\d+)\s*(?:件|条|个|项|张|页|本|段|次|步)$/, (m) => m[1]],
  [/^(\d+(?:\.\d+)?)\s*秒$/, (m) => `${m[1]} s`],
];
const cache = new Map();
export function tr(s) {
  if (!DICT || !s || !/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s)) return null;
  if (cache.has(s)) return cache.get(s);
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0]; const core = s.trim();
  let out = null;
  if (DICT[core]) out = DICT[core];
  else if (/^[，。：；、（）！？「」·／\s]+$/.test(core)) out = core.replace(/./g, (c) => PUNCT[c] ?? c).trim() + (/[，。：；、！？]$/.test(core) ? ' ' : '');
  else {
    for (const [re, fn] of RULES) { const m = core.match(re); if (m) { out = fn(m); break; } }
    if (out == null) for (const p of PATS) { const m = core.match(p.re); if (!m) continue; const vals = {}; p.idx.forEach((k, i) => { const v = m[i + 1]; vals[k] = tr(v) ?? v; }); out = p.en.replace(/\{(\d+)\}/g, (_, k) => vals[k] ?? ''); break; }
    // 用「 · 」「 / 」「：」拼起来的：一段一段换
    if (out == null && /( · | \/ |：|，|、)/.test(core)) {
      // 每一段都认得才换；有一段是你自己写的内容（认不出来）就整句不动，免得中英夹杂
      const segs = core.split(/( · | \/ |：|，|、)/); let all = true;
      const res = segs.map((x) => { if (/^( · | \/ |：|，|、)$/.test(x)) return PUNCT[x] ? PUNCT[x] : x; if (!CJK.test(x)) return x; const t = tr(x); if (t == null) all = false; return t ?? x; });
      if (all) out = res.join('').replace(/\s+([,.:;])/g, '$1');
    }
  }
  const r = out == null ? null : lead + out + tail;
  if (cache.size < 20000) cache.set(s, r);
  return r;
}

const done = new WeakMap(); // 文字节点 → 我们换上去的英文（Preact 改回中文时再换一次）
function skip(el) { return !el || (el.closest && el.closest(SKIP)); }
const CJKP = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
// 「11」「月」「12」「日 周」「四」这种拼起来的日期：看父元素的整段文字，认得就整段换成一句
function doDate(el) {
  if (!el || el.childNodes.length < 2 || el.childNodes.length > 9 || el.children.length) return false;
  const all = el.textContent.trim(); if (!/^[\d\s年月日周星期一二三四五六天]+$/.test(all) || !/[年月日周]/.test(all)) return false;
  for (const [re, fn] of RULES) { const m = all.match(re); if (m) { const t = fn(m); const ns = [...el.childNodes]; ns.forEach((n, i) => { const v = i === 0 ? t : ''; done.set(n, v); n.nodeValue = v; }); return true; } }
  return false;
}
function doText(node) {
  const v = node.nodeValue; if (!v || !CJKP.test(v) || done.get(node) === v) return;
  if (skip(node.parentElement)) return;
  if (/^[\d\s年月日周星期一二三四五六天]+$/.test(v.trim()) && doDate(node.parentElement)) return;
  // 日历表头那一个字（日 一 二 …）：只在它自己占一格时才换成 S M T…
  const one = v.trim(); if (WD1[one] && node.parentElement && node.parentElement.textContent.trim() === one) { done.set(node, WD1[one]); node.nodeValue = WD1[one]; return; }
  const t = tr(v); if (t != null && t !== v) { done.set(node, t); node.nodeValue = t; }
}
const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];
function doAttrs(el) {
  if (el.nodeType !== 1) return;
  const skipped = skip(el) && !/^(INPUT|TEXTAREA)$/.test(el.tagName); // 输入框的提示文字（placeholder）要换，里面写的字不换
  if (skipped) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v && CJK.test(v)) { const t = tr(v); if (t != null && t !== v) el.setAttribute(a, t); } }
}
function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doAttrs(root);
  if (skip(root)) { root.querySelectorAll && root.querySelectorAll('input,textarea').forEach(doAttrs); return; }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
}
function titleWatch() {
  const fix = () => { const t = tr(document.title); if (t != null && t !== document.title) document.title = t; };
  fix(); const el = document.querySelector('title'); if (el) new MutationObserver(fix).observe(el, { childList: true, characterData: true, subtree: true });
}

export async function initI18n(extra = null) {
  const lang = getLang();
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.lang = lang;
  if (lang !== 'en') return;
  const m = await import('./i18n-en.js');
  DICT = Object.fromEntries(Object.entries({ ...m.DICT, ...(extra || {}) }).filter(([, v]) => v));
  PATS = compile(m.PATTERNS);
  const start = () => {
    walk(document.body);
    new MutationObserver((list) => {
      for (const r of list) {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttrs(r.target);
        else r.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    titleWatch();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
}
