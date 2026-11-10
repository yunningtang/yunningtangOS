// 从一句平常打的中文里认出日期和时间（不用 AI）：
//   「明天下午3点到4点 写周报」「周五晚上8点半 跑步」「下周一 9:00-10:30 组会」「11月20号 交报告」「今晚七点 看书」
// 返回 { due, time, end, rest }：due = YYYY-MM-DD，time / end = HH:MM（有起止就是一段时间），rest = 去掉日期时间后剩下的字。
// 待办输入框、随手记、汤圆没连上 AI 时的本地规则、便签都用这一个。
import { todayStr, addDays } from './util.js';

const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
// 「十一」「二十」「二十三」「12」都变成数字
export function cnNum(s) {
  if (s == null || s === '') return NaN;
  if (/^\d+$/.test(s)) return +s;
  if (s === '十') return 10;
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
  if (s.length === 1 && s in CN) return CN[s];
  return NaN;
}
const NUM = '(?:\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})';
const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 末: 6 };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s) => new Date(s.replace(/-/g, '/'));

// 时段词 → 把 12 小时制的钟点换成 24 小时
const PERIOD = '(凌晨|清晨|早上|早晨|上午|中午|午饭后|下午|傍晚|晚上|今晚|明晚|夜里|晚)';
function to24(h, period) {
  if (!period) return h >= 1 && h <= 5 ? h + 12 : h; // 没说上午下午的「3 点」：多半是下午，不是凌晨
  if (/下午|傍晚|晚|夜里/.test(period) && h < 12) return h + 12;
  if (/中午|午饭后/.test(period) && h < 6) return h + 12;
  if (/凌晨/.test(period) && h === 12) return 0;
  return h;
}
// 一个钟点：「15:30」「3点」「3点半」「3点一刻」「三点四十」「3点15分」
const CLOCK = `(?:(\\d{1,2})[:：](\\d{2})|(${NUM})\\s*[点點时](?:\\s*(半|一刻|三刻|(${NUM})\\s*分?))?)`;
function clockOf(m, i, period) {
  let h, mm = 0;
  if (m[i] != null) { h = +m[i]; mm = +m[i + 1]; }
  else { h = cnNum(m[i + 2]); const x = m[i + 3]; if (x === '半') mm = 30; else if (x === '一刻') mm = 15; else if (x === '三刻') mm = 45; else if (m[i + 4] != null) mm = cnNum(m[i + 4]); }
  if (!Number.isFinite(h) || h > 24 || !Number.isFinite(mm) || mm > 59) return null;
  h = to24(h, period); if (h === 24) h = 0;
  return `${pad(h)}:${pad(mm)}`;
}

export function parseWhen(text, today = todayStr()) {
  let s = ' ' + String(text || '') + ' '; let due = '', time = '', end = '', period = '';
  const cut = (re, fn) => { s = s.replace(re, (...a) => { const r = fn(a); return r === false ? a[0] : ' '; }); };
  const T = dateOf(today);
  // 日期
  cut(/@?(大后天|后天|明天|明早|明晚|今天|今早|今晚|今儿|明儿)/, (a) => {
    const w = a[1]; due = addDays(today, /大后天/.test(w) ? 3 : /后天/.test(w) ? 2 : /明/.test(w) ? 1 : 0);
    if (/晚/.test(w)) period = '晚上'; else if (/早/.test(w)) period = '早上';
  });
  if (!due) cut(/@?(下下|下个?|这个?|本)?(?:周|星期|礼拜)([一二三四五六日天末])/, (a) => {
    const target = WD[a[2]]; const cur = T.getDay(); const mon = (cur + 6) % 7; // 离本周一几天
    const pre = a[1] || ''; const tIdx = (target + 6) % 7; // 周一=0 … 周日=6
    let diff;
    if (/下下/.test(pre)) diff = 14 - mon + tIdx; else if (/下/.test(pre)) diff = 7 - mon + tIdx; else if (/这|本/.test(pre)) diff = tIdx - mon;
    else { diff = tIdx - mon; if (diff < 0) diff += 7; } // 光说「周五」：这周还没到就是这周，过了就是下周
    due = addDays(today, diff);
  });
  if (!due) cut(/@?(?:(\d{4})[年\-/.])?(\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:月|[\-/.])\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:日|号)?(?!\s*[点:：])/, (a) => {
    const mo = cnNum(a[2]), d = cnNum(a[3]); if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return false;
    let y = a[1] ? +a[1] : T.getFullYear(); let c = `${y}-${pad(mo)}-${pad(d)}`;
    if (!a[1] && c < addDays(today, -30)) c = `${y + 1}-${pad(mo)}-${pad(d)}`; // 说的是已经过去很久的日子：多半指明年
    due = c;
  });
  if (!due) cut(new RegExp(`@?(${NUM})\\s*(?:号|日)(?![\\u4e00-\\u9fa5]{0,1}[点:])`), (a) => {
    const d = cnNum(a[1]); if (!(d >= 1 && d <= 31)) return false;
    let c = `${today.slice(0, 7)}-${pad(d)}`; if (c < today) { const n = new Date(T.getFullYear(), T.getMonth() + 1, d); c = ymd(n); }
    due = c;
  });
  // 时段词单独出现（「下午 3 点」）
  cut(new RegExp(PERIOD), (a) => { if (!period || a[1] !== '晚') period = a[1]; });
  // 时间段：「3点到4点」「15:00-16:30」「下午3点至5点半」
  const range = new RegExp(`${CLOCK}\\s*(?:到|至|-|–|—|~|～)\\s*${PERIOD}?\\s*${CLOCK}`);
  cut(range, (a) => {
    const t1 = clockOf(a, 1, period); const t2 = clockOf(a, 7, a[6] || period);
    if (!t1 || !t2) return false;
    time = t1; end = t2 > t1 ? t2 : (() => { const [h, m] = t2.split(':').map(Number); return h + 12 < 24 && `${pad(h + 12)}:${pad(m)}` > t1 ? `${pad(h + 12)}:${pad(m)}` : ''; })();
  });
  if (!time) cut(new RegExp(CLOCK), (a) => { const t1 = clockOf(a, 1, period); if (!t1) return false; time = t1; });
  // 只说了「今晚」「下午」没说几点：给个默认钟点，不然这件事就没有时间
  if (!time && period) time = { 凌晨: '06:00', 清晨: '07:00', 早上: '08:00', 早晨: '08:00', 上午: '09:00', 中午: '12:00', 午饭后: '13:00', 下午: '14:00', 傍晚: '18:00', 晚上: '20:00', 今晚: '20:00', 明晚: '20:00', 夜里: '22:00', 晚: '20:00' }[period] || '';
  if (time && !due) due = today;
  const rest = s.replace(/^[\s,，、:：]+|[\s,，、]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  return { due, time, end, rest };
}
