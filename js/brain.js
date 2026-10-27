// 「大脑」：把待办按处理方式分到 6 个脑区。只是一个好玩的比喻，不是神经科学。
// 分法：自己指定的（todo.brain）> 学到的习惯（settings.brainWords：标题开头的词 → 脑区）> 动词规则 > 还没分（丘脑）
import { get, update, upsert } from './store.js';
import { aiHeaders, recordUsage } from './ai.js';
import { todayStr, pad, WEEKDAY_SUN } from './util.js';

export const REGIONS = [
  { id: 'plan', name: '前额叶', role: '计划与决策', color: '#2383E2', bg: '#E7F3F8', icon: 'target' },
  { id: 'memory', name: '海马体', role: '学习与复习', color: '#9065B0', bg: '#F6F3F9', icon: 'book' },
  { id: 'talk', name: '语言区', role: '沟通', color: '#D9730D', bg: '#FBECDD', icon: 'chat' },
  { id: 'move', name: '运动皮层', role: '体力与跑腿', color: '#CB912F', bg: '#FBF3DB', icon: 'zap' },
  { id: 'habit', name: '小脑', role: '习惯与例行', color: '#448361', bg: '#EDF3EC', icon: 'refresh' },
  { id: 'alarm', name: '杏仁核', role: '让人焦虑的事', color: '#E03E3E', bg: '#FDEBEC', icon: 'flag' },
];
export const THALAMUS = { id: '', name: '丘脑', role: '还没分', color: '#9B9A97', bg: '#F1F1EF', icon: 'layers' };
export const regionOf = (id) => REGIONS.find((r) => r.id === id) || THALAMUS;

// 动词规则：从上往下第一个命中的算数（「规划论文」算前额叶，所以计划排在学习前面）。杏仁核不猜——焦不焦虑只有自己知道
const RULES = [
  ['habit', /每天|每日|每周|坚持|打卡|冥想|早起|喝水|习惯/],
  ['talk', /回复|回信|回邮件|邮件|发消息|消息|打电话|电话|聊|联系|沟通|开会|会议|汇报|约|面谈|问一下|告诉/],
  ['move', /买|取|寄|快递|跑步|跑|运动|健身|游泳|散步|搬|打扫|收拾|洗|做饭|家务|出门|机票|体检|办理|去/],
  ['plan', /计划|规划|想|定|决定|拆|梳理|整理|安排|设计|方案|准备|思考|写|做.*(PPT|ppt|报告)/],
  ['memory', /复习|背|学|课|读|阅读|看书|论文|单词|雅思|托福|考试|练习|笔记|看完/],
];
// 标题开头的「词」：英文取第一个单词，中文取开头连着的前两个汉字（不够两个就不学）
const headWord = (title) => { const t = String(title || '').trim(); const m = t.match(/^[A-Za-z]{2,}/); if (m) return m[0].toLowerCase(); const c = t.match(/^[\u4e00-\u9fff]{2}/); return c ? c[0] : ''; };

export function guess(t, words = (get().settings.brainWords || {})) {
  const w = headWord(t.title); if (w && words[w]) return words[w];
  if (t.repeat) return 'habit';
  for (const [id, re] of RULES) if (re.test(t.title || '')) return id;
  return '';
}
export const brainOf = (t, words) => (t.brain === undefined || t.brain === null ? guess(t, words) : t.brain);

// 手动换脑区：记下这个标题开头的词，下次同样开头的就照这个分
export function setBrain(t, id) {
  upsert('todos', { id: t.id, brain: id, brainBy: '' });
  const w = headWord(t.title);
  if (w && id && id !== 'alarm') update((d) => { d.settings.brainWords = { ...(d.settings.brainWords || {}), [w]: id }; });
}
export const unsortedCount = (s) => { const words = s.settings.brainWords || {}; return s.todos.filter((t) => !t.done && !brainOf(t, words)).length; };
export const brainMenu = (t) => ({ label: '换脑区', icon: 'layers', hint: regionOf(brainOf(t)).name, sub: [...REGIONS, THALAMUS].map((r) => ({ label: `${r.name} · ${r.role}`, color: r.color, icon: brainOf(t) === r.id ? 'check' : '', onClick: () => setBrain(t, r.id) })) });

// 多巴胺：今天做完的事攒出来的「爽感」。每件 10，杏仁核里的 25（最难开头的事最值），
// 今天动过的脑区每多一块再加 5（换着做比一直做同一类更提神）。满 100 封顶
export function dopamine(s, date) {
  const words = s.settings.brainWords || {};
  const done = s.todos.filter((t) => t.done && t.completedAt === date);
  const by = {}; done.forEach((t) => { const id = brainOf(t, words) || ''; by[id] = (by[id] || 0) + 1; });
  const regions = Object.keys(by).filter(Boolean).length;
  const raw = done.reduce((n, t) => n + (brainOf(t, words) === 'alarm' ? 25 : 10), 0) + Math.max(0, regions - 1) * 5;
  return { value: Math.min(100, raw), done: done.length, by, regions };
}
export const dopamineWord = (v) => (v >= 80 ? '满格' : v >= 50 ? '很不错' : v >= 20 ? '在涨' : v > 0 ? '起步了' : '还没开始');

// 晚上复盘：settings.brainReview[日期] = { mood, note }，只留最近 60 天
export const MOODS = [{ v: 1, label: '好累' }, { v: 2, label: '一般' }, { v: 3, label: '还行' }, { v: 4, label: '不错' }, { v: 5, label: '很好' }];
export function saveReview(date, patch) {
  update((d) => {
    const all = { ...(d.settings.brainReview || {}), [date]: { ...((d.settings.brainReview || {})[date] || {}), ...patch, at: Date.now() } };
    d.settings.brainReview = Object.fromEntries(Object.entries(all).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60));
  });
}
// 今天没做完、日期在今天或更早的 → 挪到明天
export function pushOpenTo(s, today, tomorrow) {
  const ids = s.todos.filter((t) => !t.done && t.due && t.due <= today).map((t) => t.id);
  if (ids.length) update((d) => { d.todos = d.todos.map((t) => (ids.includes(t.id) ? { ...t, due: tomorrow } : t)); });
  return ids.length;
}

// 让汤圆（AI）分：没手动指定过脑区的未完成待办，一次最多 60 件。AI 分的记成 brainBy: 'ai'，不拿来学习开头词
export async function aiSort(s, { onlyUnsorted = false } = {}) {
  const words = s.settings.brainWords || {};
  const list = s.todos.filter((t) => !t.done && (onlyUnsorted ? !brainOf(t, words) : (t.brain == null || t.brainBy === 'ai'))).slice(0, 60);
  if (!list.length) return { n: 0, reply: '没有要分的事' };
  const text = list.map((t) => `${t.id} | ${String(t.title || '').replace(/\s+/g, ' ').slice(0, 60)}${t.note ? ' | ' + String(t.note).replace(/\s+/g, ' ').slice(0, 40) : ''}`).join('\n');
  const now = new Date();
  const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders() }, signal: AbortSignal.timeout(90000), body: JSON.stringify({ mode: 'brain', text, context: { today: todayStr(), weekday: WEEKDAY_SUN[now.getDay()], now: `${pad(now.getHours())}:${pad(now.getMinutes())}` } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  recordUsage(j);
  const ids = new Set(list.map((t) => t.id)); const picks = (j.picks || []).filter((p) => ids.has(p.id) && regionOf(p.region).id);
  const m = Object.fromEntries(picks.map((p) => [p.id, p.region]));
  if (picks.length) update((d) => { d.todos = d.todos.map((t) => (m[t.id] && (t.brain == null || t.brainBy === 'ai') ? { ...t, brain: m[t.id], brainBy: 'ai' } : t)); });
  return { n: picks.length, reply: j.reply || '' };
}
