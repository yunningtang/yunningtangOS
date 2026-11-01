// 钱包：资产、订阅、记账、宇宙支票的数据和计算；一句话 / 截图 / CSV / 邮件收据的识别和去重。界面在 views/money.js。
// 数据都是顶层列表（跟着同步、合并、删除记录走）：
//   assets  { id, name, price, cur, bought, img(附件 id), status: use|retired|sold, retiredAt, soldAt, soldPrice, note }
//   subs    { id, name, amount, cur, cycle: week|month|quarter|year, next, card, status: active|cancelled, cancelledAt, lastUsed, consider, note }
//   txns    { id, date, amount, cur, kind: out|in, cat, note, merchant, project, source, via }
//   cheques { id, target, cur, opened, cash, wish, weights: { 'YYYY-MM': n }, plan: { salary: n, … } }
// 设置在 settings.money：{ base, cats, rates: { USD: 1.39, CNY: 0.19 }（1 单位 = 多少 CAD）, ratesAt, remindDays, idleDays }
import { get, update, upsert } from './store.js';
import { uid, todayStr, addDays, parseDate, nowISO, pad } from './util.js';
import { aiHeaders, aiEnabled, aiConfig, recordUsage } from './ai.js';
import { loginState } from './sync.js';

export const CURS = ['CAD', 'USD', 'CNY'];
export const SYM = { CAD: 'C$', USD: 'US$', CNY: '¥' };
export const DEFAULT_CATS = ['餐饮', '交通', '购物', '住房', '学习', '娱乐', '医疗', '订阅', '其他'];
export const SOURCES = [['salary', '工资'], ['scholarship', '奖学金'], ['side', '副业'], ['windfall', '意外之财'], ['other', '其他']];
export const CYCLES = [['week', '每周', 52 / 12], ['month', '每月', 1], ['quarter', '每季', 1 / 3], ['year', '每年', 1 / 12]];
export const ASSET_STATUS = [['use', '使用中'], ['retired', '退役'], ['sold', '已售出']];
const DEFAULT_RATES = { CAD: 1, USD: 1.39, CNY: 0.193 }; // 1 单位 = 多少加币（联网时可以一键更新）

export function cfg(s = get()) {
  const m = (s.settings && s.settings.money) || {};
  return {
    base: CURS.includes(m.base) ? m.base : 'CAD',
    cats: Array.isArray(m.cats) && m.cats.length ? m.cats : DEFAULT_CATS,
    rates: { ...DEFAULT_RATES, ...(m.rates || {}), CAD: 1 },
    ratesAt: m.ratesAt || '',
    remindDays: Number.isFinite(m.remindDays) ? m.remindDays : 3,
    idleDays: Number.isFinite(m.idleDays) ? m.idleDays : 45,
  };
}
export const setCfg = (patch) => update((d) => { d.settings.money = { ...(d.settings.money || {}), ...patch }; });

/* ---------- 金额和日期 ---------- */
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
export function conv(amount, from, to, rates) { const r = rates || cfg().rates; return (+amount || 0) * (r[from] || 1) / (r[to] || 1); }
export function fmt(n, cur = cfg().base, opts = {}) {
  const v = r2(n); const neg = v < 0; const a = Math.abs(v);
  const dec = opts.int ? 0 : a % 1 ? 2 : 0;
  return (neg ? '−' : '') + (SYM[cur] || '') + a.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const ym = (d) => String(d || '').slice(0, 7);
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, last))}`;
}
export function monthsBetween(fromYm, toYm) { const out = []; let [y, m] = fromYm.split('-').map(Number); const [ty, tm] = toYm.split('-').map(Number); let guard = 0; while ((y < ty || (y === ty && m <= tm)) && guard++ < 60) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } } return out; }
export const daysInMonth = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); };

/* ---------- 资产：日均成本 = 净成本 ÷ 已用天数 ---------- */
export function assetEnd(a, today = todayStr()) { return a.status === 'sold' ? a.soldAt || today : a.status === 'retired' ? a.retiredAt || today : today; }
export const assetDays = (a, today) => Math.max(1, daysBetween(a.bought || todayStr(), assetEnd(a, today)) + 1);
export const assetNet = (a) => Math.max(0, (+a.price || 0) - (a.status === 'sold' ? +a.soldPrice || 0 : 0));
export const assetDaily = (a, today) => assetNet(a) / assetDays(a, today);

/* ---------- 订阅 ---------- */
export const cycleOf = (c) => CYCLES.find((x) => x[0] === c) || CYCLES[1];
export const monthlyOf = (sub) => (+sub.amount || 0) * cycleOf(sub.cycle)[2];
export function stepDate(date, cycle, n = 1) { return cycle === 'week' ? addDays(date, 7 * n) : addMonths(date, n * (cycle === 'year' ? 12 : cycle === 'quarter' ? 3 : 1)); }
// 存着的「下次扣费日」过了就按周期往后推（不用每次手动改）
export function nextDue(sub, today = todayStr()) { if (!sub.next) return ''; let d = sub.next, g = 0; while (d < today && g++ < 1000) d = stepDate(d, sub.cycle); return d; }
export const activeSubs = (s) => (s.subs || []).filter((x) => x.status !== 'cancelled');
export function subsMonthly(s, c = cfg(s)) { return activeSubs(s).reduce((n, x) => n + conv(monthlyOf(x), x.cur || c.base, c.base, c.rates), 0); }
// 长期没用：自己标了「考虑取消」，或者最后一次使用已经超过 idleDays 天
export function isIdle(sub, c = cfg(), today = todayStr()) { return sub.status !== 'cancelled' && (!!sub.consider || (!!sub.lastUsed && daysBetween(sub.lastUsed, today) > c.idleDays)); }
export function dueSoon(s, days, today = todayStr()) {
  const c = cfg(s); const lim = days == null ? c.remindDays : days;
  return activeSubs(s).map((x) => ({ sub: x, due: nextDue(x, today) })).filter((x) => x.due && daysBetween(today, x.due) <= lim).sort((a, b) => a.due.localeCompare(b.due));
}
// 今年取消的订阅：取消以后到今天已经省下的（按月均折算）、以及到年底一共能省的
export function savedThisYear(s, today = todayStr()) {
  const c = cfg(s); const y = today.slice(0, 4); let sofar = 0, year = 0;
  for (const x of s.subs || []) {
    if (x.status !== 'cancelled' || !x.cancelledAt || x.cancelledAt.slice(0, 4) !== y) continue;
    const m = conv(monthlyOf(x), x.cur || c.base, c.base, c.rates);
    sofar += m * Math.max(0, daysBetween(x.cancelledAt, today)) / 30.44;
    year += m * Math.max(0, daysBetween(x.cancelledAt, `${y}-12-31`) + 1) / 30.44;
  }
  return { sofar, year };
}

/* ---------- 记账 ---------- */
export const inBase = (t, c) => conv(t.amount, t.cur || c.base, c.base, c.rates);
export function spentIn(s, monthKey, c = cfg(s)) { return (s.txns || []).filter((t) => t.kind !== 'in' && ym(t.date) === monthKey).reduce((n, t) => n + inBase(t, c), 0); }
export const projectsOf = (s) => [...new Set((s.txns || []).map((t) => (t.project || '').trim()).filter(Boolean))].sort();
// 连续记账天数：今天还没记的话从昨天往前数
export function streak(s, today = todayStr()) {
  const days = new Set((s.txns || []).map((t) => t.date)); let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d) && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
// 本月日均 vs 上月日均
export function dailyTrend(s, today = todayStr()) {
  const c = cfg(s); const cur = ym(today); const prev = ym(addMonths(today.slice(0, 8) + '01', -1));
  const now = spentIn(s, cur, c) / Math.max(1, +today.slice(8, 10)); const before = spentIn(s, prev, c) / daysInMonth(prev);
  return { now, before, down: before > 0 ? (before - now) / before : 0 };
}

/* ---------- 宇宙支票 ---------- */
export const chequeMonths = (ch) => monthsBetween(ym(ch.opened || todayStr()), ym(ch.cash || ch.opened || todayStr()));
export function monthTarget(ch, k) { const ms = chequeMonths(ch); const w = (m) => (ch.weights && Number.isFinite(+ch.weights[m]) ? Math.max(0, +ch.weights[m]) : 1); const sum = ms.reduce((n, m) => n + w(m), 0) || 1; return (+ch.target || 0) * w(k) / sum; }
// 支票期间的收入（换成支票的币种），按月份和来源分
export function chequeIncome(s, ch) {
  const c = cfg(s); const cur = ch.cur || c.base; const from = ch.opened || '0000', to = ch.cash || '9999';
  const list = (s.txns || []).filter((t) => t.kind === 'in' && t.date >= from && t.date <= to);
  const byMonth = {}, bySource = {}; let total = 0;
  for (const t of list) { const v = conv(t.amount, t.cur || c.base, cur, c.rates); total += v; byMonth[ym(t.date)] = (byMonth[ym(t.date)] || 0) + v; const src = t.source || 'other'; bySource[src] = (bySource[src] || 0) + v; }
  return { list, byMonth, bySource, total };
}
// 每个月：已兑现（≥100%）/ 接近（≥70%）/ 未达；本月显示进度；以后的月份还没到
export function monthStatus(got, target, k, today = todayStr()) {
  const cur = ym(today); if (k > cur) return 'future';
  const r = target > 0 ? got / target : 1;
  if (r >= 1) return 'done'; if (k === cur) return r >= 0.7 ? 'near' : 'now';
  return r >= 0.7 ? 'near' : 'miss';
}
export const activeCheque = (s, today = todayStr()) => [...(s.cheques || [])].sort((a, b) => (b.opened || '').localeCompare(a.opened || '')).find((ch) => (ch.opened || '') <= today && today <= (ch.cash || '9999')) || (s.cheques || [])[0] || null;

/* ---------- 一句话记账（本地规则，不花 AI 用量） ---------- */
const CAT_WORDS = [
  ['餐饮', /星巴克|starbucks|咖啡|coffee|tim ?hortons|奶茶|饭|餐|外卖|麦当劳|mcdonald|kfc|肯德基|早餐|午饭|晚饭|宵夜|火锅|寿司|披萨|pizza|面包|甜品|喝|吃|uber ?eats|doordash|超市|grocer|loblaws|no ?frills|t&t|大统华|菜/i],
  ['交通', /uber(?! ?eats)|lyft|打车|地铁|公交|presto|ttc|go ?train|加油|油费|停车|parking|机票|火车|高铁|flight|taxi/i],
  ['住房', /房租|rent|水电|电费|网费|internet|hydro|物业|押金/i],
  ['学习', /学费|tuition|教材|课本|textbook|课程|course|书|考试|报名/i],
  ['订阅', /订阅|会员|subscription|spotify|netflix|icloud|youtube|chatgpt|claude|vercel|supabase|notion|apple ?music|disney/i],
  ['娱乐', /电影|movie|游戏|game|steam|switch|演唱会|concert|ktv|酒吧|bar|门票/i],
  ['医疗', /药|医院|诊所|牙|clinic|pharmacy|shoppers|体检/i],
  ['购物', /买|amazon|亚马逊|淘宝|costco|walmart|衣服|鞋|ikea|宜家|uniqlo|优衣库|apple ?store|数码/i],
];
const IN_WORDS = [['salary', /工资|薪水|salary|payroll|发薪/i], ['scholarship', /奖学金|scholarship|bursary|助学金/i], ['side', /副业|稿费|接单|兼职|freelance|家教|外包/i], ['windfall', /红包|退税|中奖|意外|礼金|refund|退款|报销|捡到/i]];
const WEEK = '日一二三四五六';
export function guessCat(text, cats) { for (const [c, re] of CAT_WORDS) if (re.test(text) && cats.includes(c)) return c; return cats.includes('其他') ? '其他' : cats[cats.length - 1]; }
function parseDay(text, today) {
  let m;
  if (/大前天/.test(text)) return addDays(today, -3); if (/前天/.test(text)) return addDays(today, -2); if (/昨天|昨晚|yesterday/i.test(text)) return addDays(today, -1); if (/今天|今晚|today/i.test(text)) return today;
  if ((m = text.match(/(上)?(?:周|星期|礼拜)([一二三四五六日天])/))) { const want = WEEK.indexOf(m[2] === '天' ? '日' : m[2]); const dow = parseDate(today).getDay(); const back = (dow - want + 7) % 7 + (m[1] ? 7 : 0); return addDays(today, -back); }
  if ((m = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  if ((m = text.match(/(\d{1,2})月(\d{1,2})[日号]?/)) || (m = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/))) { let y = +today.slice(0, 4); const d = `${y}-${pad(+m[1])}-${pad(+m[2])}`; return d > today ? `${y - 1}-${pad(+m[1])}-${pad(+m[2])}` : d; }
  return today;
}
function parseCur(unit, pre, base) {
  const u = (unit || '').toLowerCase(), p = pre || '';
  if (/美刀|美元|usd|us\$/.test(u) || /us\$/i.test(p)) return 'USD';
  if (/加币|加元|cad|c\$/.test(u) || /c\$/i.test(p)) return 'CAD';
  if (/元|rmb|人民币|cny/.test(u) || /[¥￥]/.test(p)) return 'CNY';
  return base; // 「刀」「块」「$」「dollar」：按默认币种（在加拿大说「32 块」多半是加币）
}
export function quickParse(text, s = get(), today = todayStr()) {
  const c = cfg(s); const raw = String(text || '').trim(); if (!raw) return null;
  const re = /(us\$|c\$|[¥￥$])?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(美刀|美元|加币|加元|人民币|块钱?|元|刀|usd|cad|cny|rmb|dollars?|bucks?)?/i;
  // 取最像金额的那个数字：带货币符号 / 单位的优先，其次是最后一个数字（避免把「3 月 5 日」当成金额）
  const all = [...raw.matchAll(new RegExp(re.source, 'gi'))].filter((m) => m[2]);
  const pick = all.find((m) => m[1] || m[3]) || all.filter((m) => !/[月日号\/]/.test(raw.slice(m.index + m[0].length, m.index + m[0].length + 1))).pop();
  if (!pick) return null;
  const amount = r2(String(pick[2]).replace(/,/g, '')); if (!(amount > 0)) return null;
  const cur = parseCur(pick[3], pick[1], c.base);
  const src = IN_WORDS.find(([, re2]) => re2.test(raw)); const kind = src || /收入|到账|进账|收到/.test(raw) ? 'in' : 'out';
  const note = raw.replace(pick[0], ' ').replace(/大前天|前天|昨天|昨晚|今天|今晚|(上)?(周|星期|礼拜)[一二三四五六日天]|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]?/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,，。、在花了买]+|[\s,，。、]+$/g, '').trim().slice(0, 60);
  return { date: parseDay(raw, today), amount, cur, kind, cat: kind === 'out' ? guessCat(raw, c.cats) : '', source: kind === 'in' ? (src ? src[0] : 'other') : '', note, merchant: '' };
}

/* ---------- CSV（银行 / 信用卡导出） ---------- */
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false; const t = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',' || ch === '\t' || ch === ';') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; } else cell += ch;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}
function csvDate(v, today) {
  let m; v = String(v || '').trim();
  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  if ((m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { let [a, b, y] = [+m[1], +m[2], +m[3]]; if (y < 100) y += 2000; const [mo, d] = a > 12 ? [b, a] : [a, b]; return `${y}-${pad(mo)}-${pad(d)}`; } // 北美习惯：月/日/年；第一个数大于 12 就是日/月/年
  const d = new Date(v); return isNaN(d) ? '' : todayStr(d) || today;
}
const num = (v) => { const s = String(v || '').replace(/[,\s$¥￥]|CAD|USD|CNY/gi, ''); const neg = /^\(.*\)$/.test(s) || /^-/.test(s); const n = parseFloat(s.replace(/[()-]/g, '')); return isNaN(n) ? null : neg ? -n : n; };
// 认表头：日期、金额（或支出 / 收入两列）、说明、币种；没有表头时按「日期, 说明, 金额」猜
export function csvToTxns(text, s = get(), today = todayStr()) {
  const c = cfg(s); const rows = parseCSV(text); if (!rows.length) return { txns: [], note: '没读到内容' };
  const h = rows[0].map((x) => x.toLowerCase()); const find = (re) => h.findIndex((x) => re.test(x));
  let di = find(/date|日期|时间|posted|交易日/), ai = find(/^amount|金额|^cad\$?$|^usd\$?$|交易额/), oi = find(/debit|withdraw|支出|借方|消费/), ii = find(/credit|deposit|收入|贷方|存入/), ni = find(/desc|merchant|payee|name|memo|details|说明|摘要|商户|对方|备注|交易对方/), ci = find(/^currency|币种|货币/);
  let body = rows.slice(1);
  if (di < 0 && ai < 0 && oi < 0) { // 没有表头
    body = rows; const first = rows[0]; di = first.findIndex((x) => csvDate(x, today) && /\d/.test(x)); ai = first.map((x, i) => (num(x) != null && i !== di ? i : -1)).filter((i) => i >= 0).pop(); ni = first.findIndex((x, i) => i !== di && i !== ai && /[a-z一-龥]/i.test(x));
  }
  if (di < 0 || (ai < 0 && oi < 0 && ii < 0)) return { txns: [], note: '没认出日期和金额列。可以把 CSV 的内容粘贴给汤圆识别' };
  const raw = body.map((r) => {
    const date = csvDate(r[di], today); if (!date) return null;
    let v = ai >= 0 ? num(r[ai]) : null; if (v == null && (oi >= 0 || ii >= 0)) { const o = oi >= 0 ? num(r[oi]) : null, n2 = ii >= 0 ? num(r[ii]) : null; v = o ? -Math.abs(o) : n2 ? Math.abs(n2) : null; }
    if (!v) return null; const note = ni >= 0 ? r[ni] : ''; const cur = ci >= 0 && CURS.includes((r[ci] || '').toUpperCase()) ? r[ci].toUpperCase() : c.base;
    return { date, v, note, cur };
  }).filter(Boolean);
  // 只有一列金额时，正负号哪边是支出：大多数银行负数是支出；信用卡账单常常反过来（正数是消费，「PAYMENT」是负数）
  const negOut = ai >= 0 && oi < 0 && ii < 0 ? raw.filter((x) => x.v < 0).length >= raw.filter((x) => x.v > 0).length : true;
  const txns = raw.map((x) => { const out = negOut ? x.v < 0 : x.v > 0; const src = IN_WORDS.find(([, re]) => re.test(x.note)); return { date: x.date, amount: r2(Math.abs(x.v)), cur: x.cur, kind: out ? 'out' : 'in', cat: out ? guessCat(x.note, c.cats) : '', source: out ? '' : src ? src[0] : 'other', note: x.note.slice(0, 60), merchant: '' }; });
  return { txns, note: `从 CSV 读出 ${txns.length} 笔${ai >= 0 && oi < 0 && ii < 0 ? `（按「${negOut ? '负数' : '正数'}是支出」理解，反了可以一键对调）` : ''}` };
}

/* ---------- 邮件收据：.eml / 粘贴的邮件 → 纯文字 ---------- */
function qp(s) { return s.replace(/=\r?\n/g, '').replace(/(?:=[0-9A-F]{2})+/gi, (m) => { try { return decodeURIComponent(m.replace(/=/g, '%')); } catch { return m; } }); }
function b64utf8(s) { try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0))); } catch { return ''; } }
const stripHtml = (h) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
export function emlToText(raw) {
  const t = String(raw || ''); if (!/^(from|subject|date|received|mime-version|return-path):/im.test(t.slice(0, 2000))) return stripHtml(t).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const head = t.split(/\r?\n\r?\n/)[0]; const hv = (k) => { const m = head.match(new RegExp('^' + k + ':\\s*(.*(?:\\r?\\n[ \\t].*)*)', 'im')); return m ? m[1].replace(/\r?\n[ \t]/g, ' ').trim() : ''; };
  // 拆 MIME：优先 text/plain，没有就用 text/html 去掉标签
  const parts = []; const re = /Content-Type:\s*text\/(plain|html)[^]*?(?:\r?\n\r?\n)([\s\S]*?)(?=\r?\n--|$)/gi; let m;
  while ((m = re.exec(t))) { const hdr = t.slice(Math.max(0, m.index), m.index + 400); let body = m[2]; if (/Content-Transfer-Encoding:\s*base64/i.test(hdr)) body = b64utf8(body); else if (/quoted-printable/i.test(hdr)) body = qp(body); parts.push([m[1].toLowerCase(), body]); }
  const plain = parts.find((p) => p[0] === 'plain'); const html = parts.find((p) => p[0] === 'html');
  const body = plain ? plain[1] : html ? stripHtml(html[1]) : stripHtml(t.slice(head.length));
  return [`主题：${hv('Subject')}`, `发件人：${hv('From')}`, `日期：${hv('Date')}`, body.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()].join('\n').slice(0, 8000);
}

/* ---------- AI 识别（汤圆） ---------- */
export function canSeeImages() { const c = aiConfig(); const login = loginState() || {}; return c.provider === 'anthropic' || (c.provider === 'server' && /claude/i.test(login.aiModel || '')); }
export const aiReady = () => aiEnabled(loginState());
export async function aiExtract({ text, image, focus, sourceKind }, s = get()) {
  if (!aiReady()) throw new Error('登录并打开 AI 之后才能让汤圆识别（设置 → 汤圆 → AI）');
  const c = cfg(s);
  const resp = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(120000), body: JSON.stringify({ mode: 'money', text: text || '（见图片）', image: image || undefined, context: { today: todayStr(), currency: c.base, cats: c.cats, subs: activeSubs(s).map((x) => x.name), focus: focus || '', sourceKind: sourceKind || '' } }) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j.error || (resp.status === 413 ? '内容太大了，分几次发' : `出错了（${resp.status}）`));
  recordUsage(j);
  return { reply: j.reply || '', txns: (j.txns || []).map((t) => ({ date: t.date || todayStr(), amount: t.amount, cur: t.currency || c.base, kind: t.kind, cat: t.kind === 'out' ? (c.cats.includes(t.category) ? t.category : guessCat(`${t.category} ${t.merchant} ${t.note}`, c.cats)) : '', source: t.kind === 'in' ? t.source || 'other' : '', note: [t.merchant, t.note].filter(Boolean).join(' · ').slice(0, 60), merchant: t.merchant || '' })), subs: (j.subs || []).map((x) => ({ name: x.name, amount: x.amount, cur: x.currency || c.base, cycle: x.cycle, next: x.next || '', card: x.card || '' })) };
}
export async function imagePayload(file) {
  const { imageToDataUrl } = await import('./util.js');
  const url = await imageToDataUrl(file, 1600, 0.85); const m = url.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return m ? { type: m[1], data: m[2] } : null;
}

/* ---------- 草稿：识别结果先放这里，勾选确认后才保存；自动标出重复 ---------- */
const normName = (v) => String(v || '').toLowerCase().replace(/[\s\-_.·,，()（）]+/g, '').replace(/(subscription|plan|pro|plus|premium|会员|订阅)$/g, '');
const words = (v) => new Set(String(v || '').toLowerCase().split(/[\s·,，、/]+/).filter((w) => w.length > 1));
function similar(a, b) { if (!a || !b) return true; const A = words(a), B = words(b); if (!A.size || !B.size) return true; for (const w of A) if (B.has(w) || [...B].some((x) => x.includes(w) || w.includes(x))) return true; return false; }
export function txnDup(t, list) { return list.find((x) => x.kind === t.kind && (x.cur || '') === (t.cur || '') && Math.abs((+x.amount || 0) - (+t.amount || 0)) < 0.011 && Math.abs(daysBetween(x.date, t.date)) <= 1 && similar(x.note || x.merchant, t.note || t.merchant)); }
export function subDup(x, list) { const n = normName(x.name); return list.find((y) => { const m = normName(y.name); return m && n && (m === n || m.includes(n) || n.includes(m)); }); }
export function makeDrafts({ txns = [], subs = [] }, s = get()) {
  const out = []; const seenT = [...(s.txns || [])], seenS = [...(s.subs || [])];
  for (const t of txns) { const d = txnDup(t, seenT); out.push({ id: uid(), k: 'txn', on: !d, dup: d ? `可能重复：${d.date} ${fmt(d.amount, d.cur)} ${d.note || ''}`.trim() : '', data: t }); seenT.push({ ...t }); }
  for (const x of subs) { const d = subDup(x, seenS); out.push({ id: uid(), k: 'sub', on: !d, dup: d ? `已有「${d.name}」${Math.abs((+d.amount || 0) - (+x.amount || 0)) > 0.01 ? `（现在记的是 ${fmt(d.amount, d.cur)}，勾上会更新）` : ''}` : '', match: d ? d.id : '', data: x }); seenS.push({ ...x, id: '' }); }
  return out;
}
export function saveDrafts(drafts, via = 'ai') {
  let nT = 0, nS = 0; const now = nowISO();
  for (const d of drafts) {
    if (!d.on) continue; const x = d.data;
    if (d.k === 'txn') { upsert('txns', { id: uid(), date: x.date || todayStr(), amount: r2(x.amount), cur: x.cur, kind: x.kind === 'in' ? 'in' : 'out', cat: x.cat || '', note: x.note || '', merchant: x.merchant || '', project: x.project || '', source: x.kind === 'in' ? x.source || 'other' : '', via, created: now }); nT++; }
    else { const patch = { name: x.name, amount: r2(x.amount), cur: x.cur, cycle: x.cycle || 'month', ...(x.next ? { next: x.next } : {}), ...(x.card ? { card: x.card } : {}) }; upsert('subs', d.match ? { id: d.match, ...patch } : { id: uid(), status: 'active', created: now, lastUsed: todayStr(), next: x.next || '', card: x.card || '', ...patch }); nS++; }
  }
  return { nT, nS };
}

/* ---------- 汇率：联网更新（frankfurter，欧洲央行数据，免费不用密钥） ---------- */
export async function refreshRates() {
  const urls = ['https://api.frankfurter.dev/v1/latest?base=CAD&symbols=USD,CNY', 'https://api.frankfurter.app/latest?from=CAD&to=USD,CNY'];
  for (const u of urls) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(8000) }); if (!r.ok) continue; const j = await r.json(); const x = j.rates || {}; if (x.USD > 0 && x.CNY > 0) { const rates = { USD: r2(1 / x.USD * 1e4) / 1e4, CNY: Math.round(1 / x.CNY * 1e5) / 1e5 }; setCfg({ rates, ratesAt: j.date || todayStr() }); return rates; } } catch {}
  }
  throw new Error('没拿到汇率（网络问题），可以在设置里手动填');
}

/* ---------- 扣费前提醒：打开网站时，每个订阅每天提醒一次 ---------- */
export function remindDue(toast, go) {
  const s = get(); const list = dueSoon(s); if (!list.length) return;
  const key = 'ytos.money.reminded'; let seen = {}; try { seen = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  const today = todayStr(); const fresh = list.filter((x) => seen[x.sub.id] !== today + x.due); if (!fresh.length) return;
  fresh.forEach((x) => { seen[x.sub.id] = today + x.due; }); try { localStorage.setItem(key, JSON.stringify(seen)); } catch {}
  const c = cfg(s); const first = fresh[0]; const dd = daysBetween(today, first.due);
  toast(`${first.sub.name} ${dd === 0 ? '今天' : dd === 1 ? '明天' : dd + ' 天后'}扣费 ${fmt(first.sub.amount, first.sub.cur || c.base)}${fresh.length > 1 ? `，还有 ${fresh.length - 1} 个订阅也快扣费了` : ''}`, { label: '看看', onClick: () => go('money/subs') });
}
