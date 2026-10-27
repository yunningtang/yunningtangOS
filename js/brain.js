// 「大脑」：把待办按处理方式分到 6 个脑区。只是一个好玩的比喻，不是神经科学。
// 分法：自己指定的（todo.brain）> 学到的习惯（settings.brainWords：标题开头的词 → 脑区）> 动词规则 > 还没分（丘脑）
import { get, update, upsert } from './store.js';
import { aiHeaders, recordUsage } from './ai.js';
import { todayStr, pad, WEEKDAY_SUN } from './util.js';

// label 是大家一眼看得懂的叫法（主），name 是脑区名（副）
export const REGIONS = [
  { id: 'plan', label: '计划', name: '前额叶', role: '计划与决策', desc: '项目、目标、要拿主意的事', example: '定下这周最重要的三件事', color: '#2383E2', bg: '#E7F3F8', icon: 'target' },
  { id: 'memory', label: '学习', name: '海马体', role: '学习与复习', desc: '读、学、复习、整理知识', example: '复习第三章', color: '#9065B0', bg: '#F6F3F9', icon: 'book' },
  { id: 'talk', label: '表达', name: '语言区', role: '沟通与表达', desc: '回消息、写邮件、开会、写东西给人看', example: '回复导师的邮件', color: '#D9730D', bg: '#FBECDD', icon: 'chat' },
  { id: 'move', label: '行动', name: '运动皮层', role: '跑腿与动手', desc: '出门办事、家务、运动、动手操作', example: '去取快递', color: '#CB912F', bg: '#FBF3DB', icon: 'zap' },
  { id: 'habit', label: '习惯', name: '小脑', role: '习惯与例行', desc: '每天、每周重复的事', example: '每天散步 20 分钟', color: '#448361', bg: '#EDF3EC', icon: 'refresh' },
  { id: 'alarm', label: '压力', name: '杏仁核', role: '让人有压力的事', desc: '一直拖着、想起来就难受的事', example: '把拖着的报税拆出第一步', color: '#E03E3E', bg: '#FDEBEC', icon: 'flag' },
];
export const THALAMUS = { id: '', label: '先不分', name: '丘脑', role: '还没分', desc: '还没决定放哪', example: '', color: '#9B9A97', bg: '#F1F1EF', icon: 'layers' };
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
// 自己选的主脑区（没选就猜）
const ownBrain = (t, words) => (t.brain === undefined || t.brain === null ? guess(t, words) : t.brain);
// 步骤类型 → 脑区（汤圆拆解出来的步骤自带类型）
const STEP_REGION = { 思考: 'plan', 记忆: 'memory', 语言: 'talk', 动手: 'move' };
const stepRegion = (x) => (x && (x.brain || STEP_REGION[x.kind])) || '';
// 流转：步骤跨了两个以上脑区时，按步骤顺序排成几段；现在这段 = 第一个没做完的步骤所在的脑区
export function flowOf(t) {
  const st = Array.isArray(t.steps) ? t.steps : []; const seq = [];
  st.forEach((x) => { const r = stepRegion(x); if (!r) return; const last = seq[seq.length - 1]; if (last && last.id === r) { last.n++; last.done += x.done ? 1 : 0; } else seq.push({ id: r, n: 1, done: x.done ? 1 : 0 }); });
  if (new Set(seq.map((x) => x.id)).size < 2) return null;
  const at = seq.findIndex((x) => x.done < x.n);
  return { seq, at };
}
// 一件事只有一个类别：自己改过的 > 猜的。不会因为做完某一步就自己跳走（步骤在哪类，行下面的路线里看得到）
export const brainOf = (t, words) => ownBrain(t, words);
// 这件事的步骤还用到哪些类别（只看步骤，不用手动设）：用来在脑图上连线、在那一类里列出「有一步在这里」
export function alsoOf(t, words) {
  const p = brainOf(t, words); const f = flowOf(t);
  return f ? [...new Set(f.seq.map((x) => x.id))].filter((id) => id && id !== p) : [];
}

// 手动换类别：记下这个标题开头的词，下次同样开头的就照这个分
export function setBrain(t, id) {
  upsert('todos', { id: t.id, brain: id, brainBy: '' });
  const w = headWord(t.title);
  if (w && id && id !== 'alarm') update((d) => { d.settings.brainWords = { ...(d.settings.brainWords || {}), [w]: id }; });
}
export const unsortedCount = (s) => { const words = s.settings.brainWords || {}; return s.todos.filter((t) => !t.done && !brainOf(t, words)).length; };
// 换类别并给一个「撤销」
export function moveTo(t, id) {
  const prev = { brain: t.brain === undefined ? null : t.brain, brainBy: t.brainBy || '' }; const from = brainOf(t);
  if (from === id && t.brain != null) return;
  const words = get().settings.brainWords; // 换区时会顺便学开头词，撤销要一起退回去
  setBrain(t, id);
  import('./nav.js').then(({ toast }) => toast(`「${String(t.title).slice(0, 14)}」放到了${regionOf(id).label}`, { label: '撤销', onClick: () => { upsert('todos', { id: t.id, ...prev }); update((d) => { d.settings.brainWords = words; }); } }));
}
// 换类别的菜单：一列，选一个
export function regionItems(t) {
  const p = brainOf(t);
  return [...REGIONS, THALAMUS].map((r) => ({ label: r.label, color: r.color, icon: p === r.id ? 'check' : '', onClick: () => moveTo(t, r.id) }));
}
export const brainMenu = (t) => ({ label: '换类别', icon: 'layers', hint: regionOf(brainOf(t)).label, sub: regionItems(t) });

// 今天的进度：今天做完的 / （做完的 + 今天及以前还没做的）。只是计数，不假装测什么
export function progress(s, date) {
  const words = s.settings.brainWords || {};
  const done = s.todos.filter((t) => t.done && t.completedAt === date);
  const left = s.todos.filter((t) => !t.done && t.due && t.due <= date).length;
  const by = {}; done.forEach((t) => { const id = brainOf(t, words) || ''; by[id] = (by[id] || 0) + 1; });
  const total = done.length + left;
  return { done: done.length, left, total, pct: total ? Math.round((done.length / total) * 100) : 0, by };
}

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
  const m = Object.fromEntries(picks.map((p) => [p.id, p]));
  if (picks.length) update((d) => { d.todos = d.todos.map((t) => { const p = m[t.id]; if (!p || !(t.brain == null || t.brainBy === 'ai')) return t; return { ...t, brain: p.region, brainBy: 'ai' }; }); });
  return { n: picks.length, reply: j.reply || '' };
}
