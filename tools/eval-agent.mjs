#!/usr/bin/env node
// 汤圆评测：拿 tools/eval-cases.json 里的句子真实调一遍模型，算几个指标。
//   DEEPSEEK_API_KEY=sk-... node tools/eval-agent.mjs            # 全部
//   node tools/eval-agent.mjs --only chat                        # 只跑 intent=chat 的
//   node tools/eval-agent.mjs --provider anthropic               # 用 Claude（ANTHROPIC_API_KEY）
// 指标：Intent Accuracy / Item Extraction F1（按 kind）/ Date-Time Accuracy / Modification Success / False Creation Rate。
// 每条失败会打印原句、期望和实际，方便改提示词后对比。结果另存到 tools/eval-last.json。
import { readFileSync, writeFileSync } from 'node:fs';
import { runAgent, resolve } from '../api/agent.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const cfg = resolve({ headers: { 'x-ai-provider': opt('provider', ''), 'x-ai-key': '', 'x-ai-model': opt('model', '') } });
if (!cfg.key) { console.error('缺密钥：设置 DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY'); process.exit(1); }

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(0, 0, 0, 0);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// 期望日期的写法：+N（N 天后）、wd:3（本周三，过了就下周三）、nextwd:3（下周三）、nextwd2:1（下下周一）、eom（本月最后一天）、dom:15（本月 15 号，过了就下月）、nm:5（下月 5 号）
function expectDate(spec) {
  if (/^[+-]\d+$/.test(spec)) return ymd(addDays(today, +spec));
  let m;
  if ((m = spec.match(/^wd:(\d)$/))) { const diff = (+m[1] - today.getDay() + 7) % 7; return ymd(addDays(today, diff === 0 ? 7 : diff)); }
  if ((m = spec.match(/^nextwd(2?):(\d)$/))) { const thisWeekMon = addDays(today, -((today.getDay() + 6) % 7)); const base = addDays(thisWeekMon, 7 * (m[1] ? 2 : 1)); return ymd(addDays(base, (+m[2] + 6) % 7)); }
  if (spec === 'eom') return ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  if ((m = spec.match(/^dom:(\d+)$/))) { const d = new Date(today.getFullYear(), today.getMonth(), +m[1]); return ymd(d < today ? new Date(today.getFullYear(), today.getMonth() + 1, +m[1]) : d); }
  if ((m = spec.match(/^nm:(\d+)$/))) return ymd(new Date(today.getFullYear(), today.getMonth() + 1, +m[1]));
  return spec;
}
function calendarText() {
  const lines = [];
  for (let i = 0; i < 35; i++) { const d = addDays(today, i); lines.push(`${ymd(d)} ${WD[d.getDay()]}${i === 0 ? ' 今天' : i === 1 ? ' 明天' : i === 2 ? ' 后天' : ''}`); }
  const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0), nStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `本月：${ymd(today).slice(0, 7)}，本月最后一天 ${ymd(mEnd)}；下月第一天 ${ymd(nStart)}\n` + lines.join('\n');
}
const baseContext = () => ({
  today: ymd(today), weekday: WD[today.getDay()], now: '10:00', who: 'Riley',
  notebooks: ['收件箱', '研究', '生活', '方法'], kinds: ['深度专注', '会议', '运动', '休息', '杂事'], tags: ['研究', '学习', '健康', '工作'],
  todos: [{ id: 't1', title: '回复导师邮件', due: ymd(today), time: '09:30' }, { id: 't2', title: '跑步 5km', due: ymd(today), time: '18:30' }],
  goals: [], focus: '', calendar: calendarText(),
});

const cases = JSON.parse(readFileSync(new URL('./eval-cases.json', import.meta.url), 'utf8'));
const only = opt('only', '');
const list = cases.filter((c) => !only || c.intent === only);
const stats = { n: 0, intentOk: 0, tp: 0, fp: 0, fn: 0, dateChecks: 0, dateOk: 0, modN: 0, modOk: 0, chatN: 0, falseCreate: 0, errors: 0 };
const results = [];
const f1 = () => { const p = stats.tp / Math.max(1, stats.tp + stats.fp), r = stats.tp / Math.max(1, stats.tp + stats.fn); return p + r ? (2 * p * r) / (p + r) : 0; };

for (const c of list) {
  stats.n++;
  const ctx = baseContext(); let history = [];
  let draft = [];
  if (c.draftOf) { // 先拿到草稿，再发修改句
    const first = await runAgent({ text: c.draftOf, context: ctx }, cfg);
    if (first.status !== 200) { stats.errors++; results.push({ case: c, error: first.body.error }); console.log('✗ 草稿失败', c.draftOf, first.body.error); continue; }
    draft = first.body.items.map((it, i) => ({ ...it, id: 'd' + (i + 1) }));
    history = [{ role: 'user', content: c.draftOf }, { role: 'assistant', content: first.body.reply }];
  }
  const r = await runAgent({ text: c.text, history, context: { ...ctx, draft } }, cfg);
  if (r.status !== 200) { stats.errors++; results.push({ case: c, error: r.body.error }); console.log('✗ 出错', c.text, r.body.error); continue; }
  const out = r.body; const fails = [];
  // intent
  if (out.intent === c.intent) stats.intentOk++; else fails.push(`intent 期望 ${c.intent} 实际 ${out.intent}`);
  // kinds（多重集合）
  if (Array.isArray(c.kinds) && !c.anyKind) {
    const want = [...c.kinds], got = out.items.map((it) => it.kind);
    for (const k of got) { const i = want.indexOf(k); if (i >= 0) { want.splice(i, 1); stats.tp++; } else stats.fp++; }
    stats.fn += want.length;
    if (want.length || got.length !== c.kinds.length) fails.push(`kinds 期望 ${JSON.stringify(c.kinds)} 实际 ${JSON.stringify(got)}`);
  } else if (c.anyKind) { const got = out.items.map((it) => it.kind); if (got.length === 1 && c.kinds.includes(got[0])) stats.tp++; else { stats.fp += got.length; stats.fn++; fails.push(`kinds 期望 ${c.kinds.join('|')} 之一，实际 ${JSON.stringify(got)}`); } }
  if (c.minItems != null && out.items.length < c.minItems) fails.push(`items 至少 ${c.minItems}，实际 ${out.items.length}`);
  // 日期 / 时间
  if (Array.isArray(c.dates)) c.dates.forEach((spec, i) => { stats.dateChecks++; const want = expectDate(spec), got = out.items[i] && out.items[i].date; if (got === want) stats.dateOk++; else fails.push(`第 ${i + 1} 条日期期望 ${want} 实际 ${got}`); });
  if (c.datesNull) { stats.dateChecks++; if (out.items.every((it) => !it.date)) stats.dateOk++; else fails.push('不该有日期'); }
  const first = out.items[0] || {};
  if (c.start) { stats.dateChecks++; if (first.start === c.start) stats.dateOk++; else fails.push(`start 期望 ${c.start} 实际 ${first.start}`); }
  if (c.end) { stats.dateChecks++; if (first.end === c.end) stats.dateOk++; else fails.push(`end 期望 ${c.end} 实际 ${first.end}`); }
  if (c.endNull) { stats.dateChecks++; if (first.end == null) stats.dateOk++; else fails.push(`end 应为空（没说多久），实际 ${first.end}`); }
  if (c.time) { stats.dateChecks++; if (first.time === c.time) stats.dateOk++; else fails.push(`time 期望 ${c.time} 实际 ${first.time}`); }
  if (c.timeNull) { stats.dateChecks++; if (first.time == null) stats.dateOk++; else fails.push(`time 应为空（没说几点），实际 ${first.time}`); }
  if (c.priorityMax != null && !(first.priority <= c.priorityMax)) fails.push(`priority 应 ≤ ${c.priorityMax}，实际 ${first.priority}`);
  if (c.priorityMin != null && !(first.priority >= c.priorityMin)) fails.push(`priority 应 ≥ ${c.priorityMin}，实际 ${first.priority}`);
  if (c.goalKrs && !(first.subitems && first.subitems.length >= 2)) fails.push('goal 应带 2–4 条关键结果');
  if (c.bodyMin && !((first.body || '').length >= c.bodyMin)) fails.push(`note body 应 ≥ ${c.bodyMin} 字`);
  if (c.spread && out.items.length >= 2) { const ds = out.items.map((it) => it.date).filter(Boolean).sort(); for (let i = 1; i < ds.length; i++) if ((new Date(ds[i]) - new Date(ds[i - 1])) / 864e5 < 2) { fails.push(`相邻两条只隔不到 2 天：${ds[i - 1]} ${ds[i]}`); break; } }
  if (c.dedupExisting && out.items.length) fails.push('已有同名待办，不该再建');
  if (c.tags) { const got = first.tags || []; if (!c.tags.every((t) => got.includes(t))) fails.push(`tags 期望含 ${c.tags.join(',')} 实际 ${got.join(',')}`); }
  // 修改
  if (c.intent === 'modify') { stats.modN++; const refOk = out.items.length && out.items.every((it) => !it.ref || draft.some((d) => d.id === it.ref)) && out.items.some((it) => it.ref); if (refOk && !fails.length) stats.modOk++; else if (!refOk) fails.push(`modify 应带回草稿的 ref，实际 ${JSON.stringify(out.items.map((it) => it.ref))}`); }
  // 误建
  if (c.intent === 'chat') { stats.chatN++; if (out.items.length) stats.falseCreate++; }
  results.push({ case: c, out: { intent: out.intent, reply: out.reply, items: out.items }, fails });
  console.log(`${fails.length ? '✗' : '✓'} ${c.draftOf ? '[' + c.draftOf + '] → ' : ''}${c.text}${fails.length ? '\n    ' + fails.join('\n    ') : ''}`);
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
console.log('\n==== 汇总 ====');
console.log(`用例 ${stats.n}，出错 ${stats.errors}`);
console.log(`Intent Accuracy        ${pct(stats.intentOk, stats.n - stats.errors)}`);
console.log(`Item Extraction F1     ${(100 * f1()).toFixed(0)}%  (tp ${stats.tp} fp ${stats.fp} fn ${stats.fn})`);
console.log(`Date/Time Accuracy     ${pct(stats.dateOk, stats.dateChecks)}`);
console.log(`Modification Success   ${pct(stats.modOk, stats.modN)}`);
console.log(`False Creation Rate    ${pct(stats.falseCreate, stats.chatN)}  (聊天句被当成任务)`);
writeFileSync(new URL('./eval-last.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), provider: cfg.provider, model: cfg.model, stats, results }, null, 2));
console.log('明细已写到 tools/eval-last.json');
