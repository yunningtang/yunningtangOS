// 语音：说话变成文字（浏览器自带的语音识别），以及把讲解读出来（浏览器自带的朗读）。都不花 AI 用量。
// 语音识别 Chrome / Edge / Safari 支持，Firefox 不支持（按钮就不显示）。
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = () => !!SR();
export const canSpeak = () => 'speechSynthesis' in window;
const lang = () => (/^zh/i.test(navigator.language || '') ? 'zh-CN' : navigator.language || 'zh-CN');

// 开始听写：onText(全文, 是否已定稿) 会被反复调用；返回 stop()
export function dictate({ onText, onEnd, onError } = {}) {
  const C = SR(); if (!C) { onError && onError('这个浏览器不支持语音输入，换 Chrome 或 Safari 试试'); return () => {}; }
  const r = new C(); r.lang = lang(); r.interimResults = true; r.continuous = true;
  let done = '';
  r.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) done += t; else interim += t; } onText && onText(done + interim, !interim); };
  r.onerror = (e) => { const m = { 'not-allowed': '没有麦克风权限：在浏览器地址栏左边允许麦克风', 'no-speech': '没听到声音', 'audio-capture': '没找到麦克风', network: '语音识别要联网' }[e.error]; if (m && onError) onError(m); };
  r.onend = () => onEnd && onEnd(done);
  try { r.start(); } catch (e) { onError && onError(e.message); }
  return () => { try { r.stop(); } catch {} };
}

// 把 Markdown + LaTeX 变成好读的纯文字：常见的分数、根号、上下标读成中文，剩下的命令和括号去掉
export function speakable(md) {
  const mathSay = (m) => m
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 除以 $2').replace(/\\sqrt\{([^{}]*)\}/g, '根号 $1')
    .replace(/\\hat\s*\{?(\w)\}?/g, '$1 帽').replace(/\\bar\s*\{?(\w)\}?/g, '$1 拔').replace(/\^\{?2\}?/g, ' 的平方').replace(/\^\{?([^{}\s]+)\}?/g, ' 的 $1 次方').replace(/_\{?([^{}\s]+)\}?/g, ' $1')
    .replace(/\\times|\\cdot/g, ' 乘 ').replace(/\\pm/g, ' 正负 ').replace(/\\approx/g, ' 约等于 ').replace(/\\neq/g, ' 不等于 ').replace(/\\le(q)?/g, ' 小于等于 ').replace(/\\ge(q)?/g, ' 大于等于 ')
    .replace(/\\alpha/g, '阿尔法').replace(/\\beta/g, '贝塔').replace(/\\mu/g, '缪').replace(/\\sigma/g, '西格玛').replace(/\\sum/g, '求和').replace(/\\left|\\right/g, '')
    .replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}]/g, '').replace(/=/g, ' 等于 ').replace(/-/g, ' 减 ').replace(/\+/g, ' 加 ').replace(/\//g, ' 除以 ');
  return String(md || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => '，' + mathSay(m) + '，').replace(/\$([^$\n]+?)\$/g, (_, m) => mathSay(m))
    .replace(/[*_`#>|]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}
let cur = null;
// 朗读一段文字，长的按句子切开读（有的浏览器一次读太长会卡住）。返回 stop()
export function speak(text, { onEnd } = {}) {
  if (!canSpeak()) return () => {};
  stopSpeak();
  const parts = String(text).split(/(?<=[。！？；.!?;])\s*/).filter((x) => x.trim());
  const token = {}; cur = token; let i = 0;
  const next = () => {
    if (cur !== token) return;
    if (i >= parts.length) { cur = null; onEnd && onEnd(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]); u.lang = lang(); u.rate = 1.02;
    u.onend = next; u.onerror = () => { cur = null; onEnd && onEnd(); };
    speechSynthesis.speak(u);
  };
  next();
  return () => { if (cur === token) stopSpeak(); onEnd && onEnd(); };
}
export function stopSpeak() { cur = null; try { speechSynthesis.cancel(); } catch {} }
