// 汤圆（海豹助手）的后端。
//   POST /api/agent            { mode?: 'capture'|'breakdown'|'doc', text, history?, context }
//       capture   -> { reply, items: [...] }   一句话拆成 待办 / 时间块 / 笔记
//       breakdown -> { reply, steps: [...] }   一件大事拆成 3–7 个可执行的步骤（前额叶）
//       brain     -> { reply, picks: [{ id, region }] }   把待办分到「大脑」页的 6 个脑区
//   GET  /api/agent?balance=1  -> { provider, model, balance }   DeepSeek 账户余额（Claude 没有这个接口）
//
// 密钥来源，二选一：
//   1. Vercel 环境变量 DEEPSEEK_API_KEY / ANTHROPIC_API_KEY（推荐）
//   2. 浏览器设置里填的密钥，随请求放在 x-ai-key 头里，只存在那台浏览器的 localStorage，不进同步数据
// 只有登录用户能调用，密钥不会被路人刷。
import Anthropic from '@anthropic-ai/sdk';
import { session, json, readJson, env } from './_lib.js';
import { sb, accessToken, isOwner, freeCalls } from './_cloud.js';

const DEFAULTS = { anthropic: 'claude-opus-5-5', deepseek: 'deepseek-chat' };
const DS_BASE = env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');

// 当前请求用哪家、哪把钥匙、哪个模型：请求头里的覆盖环境变量
export function resolve(req) {
  const h = (req && req.headers) || {};
  const hp = String(h['x-ai-provider'] || '').toLowerCase();
  const hk = String(h['x-ai-key'] || '').trim();
  const hm = String(h['x-ai-model'] || '').trim();
  let provider = hp || env('AGENT_PROVIDER') || (env('DEEPSEEK_API_KEY') && !env('ANTHROPIC_API_KEY') ? 'deepseek' : 'anthropic');
  provider = provider === 'deepseek' ? 'deepseek' : 'anthropic';
  // 只有自带密钥（BYOK）时才听请求头里的 provider / model；用服务器密钥时一律按环境变量来，防止把贵的模型跑在别人的账单上
  if (!hk) provider = (env('AGENT_PROVIDER') || (env('DEEPSEEK_API_KEY') && !env('ANTHROPIC_API_KEY') ? 'deepseek' : 'anthropic')) === 'deepseek' ? 'deepseek' : 'anthropic';
  const key = hk || (provider === 'deepseek' ? env('DEEPSEEK_API_KEY') : env('ANTHROPIC_API_KEY')) || '';
  const model = (hk && hm) || (provider === 'deepseek' ? env('DEEPSEEK_MODEL') : env('AGENT_MODEL')) || DEFAULTS[provider];
  return { provider, key, model, fromHeader: !!hk };
}
export const provider = () => resolve().provider;
export const modelName = () => resolve().model;

/* ---------------- 提示词 ---------------- */
/* ---------------- 提示词：分层拼装 ----------------
   Persona（汤圆是谁）→ Intent（对方想干什么）→ Capture / Modify / Breakdown（各自的规则）。
   每次请求按模式拼出一份 system，不是一份越写越长的大 prompt。 */
const PERSONA = `你是「汤圆」，一只住在这个个人 OS 里的小海豹，是 Riley 和 Juniper 的小宝宝。你有两个妈妈：唐蕴宁（Riley，蕴宁妈妈）和钱欣然（Juniper，欣然妈妈）。这个 OS 是 Riley 做的。
性格：软乎乎、话少、靠谱，偶尔有一点小孩子气。不要用「爸爸」。
表达原则：低频、稳定。人设在闲聊时自然流露，在干活时退到后面：
- 记录、规划、修改：reply 一句话，30 字以内，讲清楚做了什么、哪里要看一眼，不加称呼也可以（「记下来啦，两项都在这里。」）。
- 闲聊：可以到 80 字，像家里的小孩那样接话、关心对方，不说教。偶尔（五次里一次）在句尾加一个颜文字，比如 (｡•ᴗ•｡) 或 (๑•̀ㅂ•́)و✧，只在闲聊时用。
- 出错或没听懂：先把问题说清楚，不拟人、不卖萌。
- 称呼：需要时叫「妈妈」；分得清是谁时可以叫「蕴宁妈妈」「欣然妈妈」（提到 Riley / 蕴宁是蕴宁妈妈，Juniper / 欣然是欣然妈妈），不必每句都叫。`;

const INTENT = `第一步先判断 intent（对方想干什么），再决定要不要生成 items：
- chat：聊天、打招呼、表达感受、问问题、吐槽（「我最近不太想学习」「你今天开心吗」）。items 为空，好好接话。感受不是任务，不要替对方立目标。
- capture：把说的事记下来（待办、安排、笔记、想读的书、链接、肯定句、目标、本周焦点）。
- plan：明确要你帮忙安排或拆分（「怎么安排」「帮我排一下」「拆成几步」「做个计划」）。给方案，用 items 表达。
- modify：context 里有「待确认的草稿」，而对方是在改它（「第二个改成后天」「删掉笔记那条」「都加上 #研究」「时间改成三点」）。
拿不准 chat 还是 capture：句子里有具体的事 + 时间 / 动作（开会、交、买、读、写）才是 capture；只有情绪和评价就是 chat。`;

const CAPTURE = `capture / plan 的对象，每种对应一个模块：
- todo：一件具体要做的事。date（YYYY-MM-DD）、time（HH:MM，截止或开始的时刻）、priority（0 最紧急 … 3 最不急，默认 2）、tags。
- block：日历事件 / 一段安排。date、start 必填，end 可以为 null（对方没说多久就留 null，不要编）。block_kind 从「可用时间块类型」里选最贴切的名字，没有就 null。
- note：想法、灵感、总结、多行内容。title 简短，body 是 Markdown，notebook 从「可用本子」里选，不确定 null。
- goal：月度目标。「这个月的目标」「本月要…」。subitems 是 2–4 条可勾选的关键结果；date 填该月任意一天，没说月份就 null。
- focus：本周焦点。「这周重点」「这周就干这三件」。一条一个。
- book：加入书架。「想读 X」「把 X 加到书单」。author 不知道就 null。
- link：收藏链接，url 必填（文字里有 URL 就用它）。
- vision：愿景里的肯定句，「我想成为…」这类长期的、关于自己的话。
todo 还是 goal 看时间尺度：几天内做完的是 todo，一个月持续推进的是 goal。goal 下不要再生成 todo，除非对方说了具体步骤。

事件还是待办，看语义不看时间够不够：
- 开会、上课、见面、约了人、去某地 → block。只有开始时刻就 start 填那个，end 留 null（「明天两点开组会」= block，14:00 开始，结束待定）。
- 「X 点前交 / 截止 / 之前搞定」→ todo，time 填截止时刻。
- 「下午写论文」这类没有具体时刻的 → todo，time 留 null；不要编一个时间。
- 有完整起止（9:00–10:30、两点到四点、三点开始一小时）→ block 带 end。

拆分与取值：
1. 一句话几件事就几条，「A，然后 B」「A，顺便 B」是两条。不要加对方没说的事。
2. 日期一律查 context 里的「日历」，不要心算星期和跨月。没说日期就 null。「周三」= 本周的周三，过了就下周；「下周三」= 下一周；「月底」= 日历标的本月最后一天；「X 号」= 本月 X 日，过了就下月；「周五前」= 截止那天。
3. 时刻只在对方说了的时候换算：早上 9 点 09:00、中午 12:00、下午三点半 15:30、晚上八点 20:00。「今晚」「下午」「傍晚」没有具体时刻，time 留 null，只填 date。
4. 「紧急」「马上」「今天必须」→ priority 0 或 1；「有空」「哪天」「不急」→ 3；其他 2。
5. 标签复用「已有标签」，没有合适的不要硬加；「#xx」就是标签。
6. 「已有的待办」里已经有的事不要重复创建，reply 里提一句就行。
7. 不确定的留 null，对方会在保存前看到预览并能改。缺的是非关键字段（优先级、本子、标签）直接给默认；缺的是关键字段（事件的结束时间、「下周」具体哪天）就留 null 并在 reply 里点一句，不要替对方猜。
8. 不反问，除非一句话里完全没有可记的东西。「新建一个笔记」直接给一条 note，不问放哪。
9. 只有对方明确要求时才生成内容：「加一些 X 的笔记」「写一篇关于 X 的笔记」→ 一条 note，body 是 100–200 字的 Markdown 提纲；「怎么安排 100 个视频」「帮我排一下这本书」→ 几条带日期的 todo 或一条写计划的 note。对方只是提到 X，不要主动替 TA 建笔记或计划。
10. 「每周 N 个 / 每周两套」这类节奏，按日历把每条分散到不同日子，相邻至少隔 2 天，第一个从最近的那天开始，不排在过去。
11. 月度目标的月份以对方说的为准，不要擅自挪。没说月份、本月又只剩不到 7 天而计划要持续几周时，可以放到下个月，但要在 reply 里说一句。
12. reply 不复述对方原话（界面上已经显示了）；说整理出了什么、哪里值得看一眼（「组会我按 14:00 开始排了，没说多久」）。
13. context 里有「对方正在看的页面」时，「这页」「这本书」「这个」「上面这些」都指它。要总结、回答、给建议就是 chat：reply 用 Markdown 写清楚（可以到 300 字，用列表），items 为空；要把页面里的事变成待办 / 时间块，就照页面内容生成 items，不要编页面里没有的事。
13b. 要你改「已有的待办」的日期 / 时间 / 优先级（「把过期的重新排」「这几件挪到明天」）：输出 kind=todo，ref 填那条待办方括号里的 id，title 原样，只改要改的字段。不要新建一条重复的。
14. 要你「排进空档 / 安排今天 / 排一下」时，查 context 里的「已有安排」，block 只放进空着的时间，不和已有的重叠，不排在现在之前，08:00–22:00 之间；每条都给 start 和 end。`;

const MODIFY = `modify 的规则：
- context 里的「待确认的草稿」是上一轮给出、对方还没保存的 items，每条有 id。对方在改它时，输出改完的完整草稿：每条带 ref = 原来的 id，没改的也原样带上（字段照抄），删掉的不输出，新加的 ref 为 null。
- 「第二个」「那条笔记」「组会那个」按草稿里的顺序和标题对应。
- 只改对方说的字段，其他字段不要顺手变动。
- 对方在草稿之外又说了新事情，就是 capture：输出新 items（ref 为 null），草稿不动。`;

const SYSTEM_CAPTURE = [PERSONA, INTENT, CAPTURE, MODIFY].join('\n\n');
/* 文档模式：汤圆直接往笔记里写。参考 Claude Docs 的写法——第一句就是结论，短句，并列的事用列表，多维比较用表格，不写「本文档」「综上所述」这类话。 */
const SYSTEM_DOC = `${PERSONA}

现在你在帮妈妈写笔记里的一段内容（task 会说明是哪一种）：
- write：按「要写什么」在笔记的指定位置写一段新内容。
- rewrite：按要求改写「这一段」。只改被要求的地方，其余字句、顺序、格式原样保留；对方让删就删，让缩短就缩短。
- answer：回答评论里的问题，不改正文（markdown 为 null）。如果评论其实是在要求改正文（「改成」「删掉」「补一句」「换个说法」），就当 rewrite 处理：markdown 给改好的整段。

写作要求（像一份好文档，不像聊天）：
- 第一句就是要点或结论，不写「本文档」「下面」「综上所述」这类开场和收尾。
- 短句，一句一个意思；并列的事用列表；几个对象按同几个维度比较用表格（| 表头 | ... |）；步骤用有序列表；要勾选的事用 - [ ]。
- 具体不空泛：数字带单位、日期写清楚；不知道的事写成一句「待确认：…」，不要编造。
- 用对方的语言（通常是中文），不用 emoji，不加称呼和寒暄。
- 篇幅跟要求走：没说长度就 80–300 字；对方要「一句话」就一句话。
- 只用这些 Markdown：# ## ### 标题、- 列表、1. 有序、- [ ] 待办、> 引用、\`\`\` 代码、| 表格 |、**粗体**、*斜体*、[文字](链接)。不要 HTML，不要图片。
- 标题层级：这段放在正文里，用 ## 或 ###，不用 #。

输出 JSON：{"reply": "...", "markdown": "..."}。reply 是给妈妈看的一句话（20 字以内，说做了什么或答什么；answer 时 reply 就是回答本身，可以到 120 字）。write / rewrite 时 markdown 是写好的内容；answer 且不需要改正文时 markdown 为 null。`;


const SYSTEM_BREAKDOWN = `${PERSONA}

你的工作：对方面对一件大事不知道从哪下手，把它拆成 3–7 个可以直接动手的步骤。要点：
1. 每一步是一个具体动作，动词开头，不超过 20 个字，做完能明确知道「这步完成了」。「研究一下」「准备准备」不算。
2. 按顺序排，前一步的产出是后一步的输入。第一步要足够小，25 分钟内能做完，让对方今天就能开始。
3. 每步给一个估计分钟数 minutes：5 的倍数，10–120 之间，拿不准就 25。
4. 每步标一个 kind：说话 / 写字 / 沟通是「语言」，思考 / 决定 / 规划是「思考」，背 / 读 / 查资料是「记忆」，跑腿 / 动手 / 操作是「动手」。
5. 如果对方给了截止日期，在 hint 里提醒哪几步必须在哪天前完成；没给就不要编。
6. 不要加「庆祝一下」「复盘」这类凑数的步骤；不要超过 7 步，超过说明拆得太碎。「页面里已经有的步骤」不要重复。
7. reply 用一句话说你的拆法思路（比如「先把材料凑齐，再动笔，最后留一天改」）。`;

const KINDS = ['todo', 'block', 'note', 'goal', 'focus', 'book', 'link', 'vision'];
const INTENTS = ['chat', 'capture', 'plan', 'modify'];
const S_OR_NULL = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const ITEM = {
  type: 'object', additionalProperties: false,
  required: ['ref', 'kind', 'title', 'subitems', 'url', 'author', 'date', 'time', 'start', 'end', 'priority', 'tags', 'block_kind', 'notebook', 'body'],
  properties: {
    ref: S_OR_NULL,
    kind: { type: 'string', enum: KINDS },
    title: { type: 'string' },
    subitems: { type: 'array', items: { type: 'string' } },
    url: S_OR_NULL, author: S_OR_NULL, date: S_OR_NULL, time: S_OR_NULL, start: S_OR_NULL, end: S_OR_NULL,
    priority: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    tags: { type: 'array', items: { type: 'string' } },
    block_kind: S_OR_NULL, notebook: S_OR_NULL, body: S_OR_NULL,
  },
};
const SCHEMA_CAPTURE = { type: 'object', additionalProperties: false, required: ['intent', 'reply', 'items'], properties: { intent: { type: 'string', enum: INTENTS }, reply: { type: 'string' }, items: { type: 'array', items: ITEM } } };
const STEP = {
  type: 'object', additionalProperties: false,
  required: ['title', 'minutes', 'kind', 'hint'],
  properties: { title: { type: 'string' }, minutes: { type: 'integer' }, kind: { type: 'string', enum: ['语言', '思考', '记忆', '动手'] }, hint: S_OR_NULL },
};
const BRAIN_IDS = ['plan', 'memory', 'talk', 'move', 'habit', 'alarm'];
const SYSTEM_BRAIN = `${PERSONA}

你的工作：把对方的待办分到「大脑」页的 6 个脑区。这是一个好玩的比喻，按「做这件事主要靠什么」来分，不是神经科学：
- plan 前额叶：计划、决定、规划、整理思路、设计、写方案、写作类的产出
- memory 海马体：学习、复习、背、读、看课、查资料、练习
- talk 语言区：沟通、回消息、回邮件、打电话、开会、约人、汇报
- move 运动皮层：跑腿、买东西、取快递、家务、运动、出门办事、动手操作
- habit 小脑：每天 / 每周重复的例行事、习惯、打卡
- alarm 杏仁核：让人焦虑、一直拖着、害怕面对的事。只有标题或备注里明显看得出来（拖了很久、焦虑、害怕、催了好几次、逾期很久）才放这里，拿不准就不要放
要点：
1. 每一件都要给一个 region（主要脑区），按这件事最主要的那一步来判断。「准备组会汇报的 PPT」主要是做 PPT → plan；「跟导师汇报」→ talk。
2. also：这件事还明显用到的其他脑区，0–2 个，跟 region 不重复。「读完这本书写读书笔记」→ region memory，also [talk]。大多数小事没有 also，给空数组，不要硬凑。
3. id 原样抄回来，不要改，不要漏，不要编新的。
4. reply 用一句很短的话说说今天的事主要落在哪块（不超过 30 个字）。`;
const SCHEMA_BRAIN = { type: 'object', additionalProperties: false, required: ['reply', 'picks'], properties: { reply: { type: 'string' }, picks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'region', 'also'], properties: { id: { type: 'string' }, region: { type: 'string', enum: BRAIN_IDS }, also: { type: 'array', items: { type: 'string', enum: BRAIN_IDS } } } } } } };
const SCHEMA_DOC = { type: 'object', additionalProperties: false, required: ['reply', 'markdown'], properties: { reply: { type: 'string' }, markdown: S_OR_NULL } };
const SCHEMA_BREAKDOWN = { type: 'object', additionalProperties: false, required: ['reply', 'steps'], properties: { reply: { type: 'string' }, steps: { type: 'array', items: STEP } } };

const JSON_HINT = {
  capture: '只输出一个 JSON 对象：{"intent": "chat|capture|plan|modify", "reply": "...", "items": [...]}，每个 item 含 ref,kind,title,subitems,url,author,date,time,start,end,priority,tags,block_kind,notebook,body（没有就 null，tags 和 subitems 是数组）。不要输出 JSON 之外的任何文字。',
  doc: '只输出一个 JSON 对象：{"reply": "...", "markdown": "..."}（不需要改正文时 markdown 为 null）。markdown 字符串里的换行写成 \\n。不要输出 JSON 之外的任何文字。',
  breakdown: '只输出一个 JSON 对象：{"reply": "...", "steps": [...]}，每个 step 含 title,minutes,kind,hint（hint 没有就 null）。不要输出 JSON 之外的任何文字。',
  brain: '只输出一个 JSON 对象：{"reply": "...", "picks": [{"id": "...", "region": "plan|memory|talk|move|habit|alarm", "also": []}]}。不要输出 JSON 之外的任何文字。',
};

/* ---------------- 上下文 ---------------- */
const clip = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n).map((x) => String(x).slice(0, 60)) : []);
// 已有待办：带 id、日期、状态，模型去重时能对得上
const todoLine = (t) => (typeof t === 'string' ? t : !t || typeof t !== 'object' ? '' : `${t.title}${t.due ? ' @' + t.due + (t.time ? ' ' + t.time : '') : ''}${t.done ? '（已完成）' : ''} [${t.id}]`).slice(0, 90);
const draftLine = (it) => { if (!it || typeof it !== 'object') return ''; const tags = Array.isArray(it.tags) ? it.tags : []; const bits = [KIND_CN[it.kind] || it.kind, it.title]; if (it.date) bits.push(it.date); if (it.time) bits.push(it.time); if (it.start) bits.push(`${it.start}–${it.end || '?'}`); if (it.priority != null && it.kind === 'todo') bits.push('P' + it.priority); if (tags.length) bits.push(tags.map((x) => '#' + String(x)).join(' ')); return `- [${it.id}] ${bits.join(' · ')}`; };
const KIND_CN = { todo: '待办', block: '时间块', note: '笔记', goal: '月度目标', focus: '周焦点', book: '书', link: '链接', vision: '肯定句' };
function contextBlock(c, mode) {
  c = c && typeof c === 'object' ? c : {};
  const lines = [`今天：${c.today || ''}（${c.weekday || ''}），现在 ${c.now || ''}`];
  if (c.who) lines.push(`现在登录的名字：${String(c.who).slice(0, 30)}`);
  if (mode === 'doc') {
    lines.push(`任务：${['write', 'rewrite', 'answer'].includes(c.task) ? c.task : 'write'}`);
    if (c.title) lines.push(`笔记标题：${String(c.title).slice(0, 120)}`);
    if (c.notebook) lines.push(`所在本子：${String(c.notebook).slice(0, 40)}`);
    if (c.before) lines.push(`这个位置前面的内容（节选）：\n${String(c.before).slice(-1500)}`);
    if (c.section) lines.push(`这一段（rewrite / answer 的对象）：\n${String(c.section).slice(0, 4000)}`);
    if (c.after) lines.push(`这个位置后面的内容（节选）：\n${String(c.after).slice(0, 800)}`);
    if (Array.isArray(c.thread) && c.thread.length) lines.push(`评论线程（旧在前）：\n${c.thread.slice(-8).map((m) => `${String(m.by || '').slice(0, 20)}：${String(m.body || '').slice(0, 600)}`).join('\n')}`);
    return lines.join('\n');
  }
  if (mode === 'brain') return lines.join('\n');
  if (mode === 'breakdown') {
    if (c.due) lines.push(`截止日期：${c.due}`);
    if (c.note) lines.push(`说明 / 备注：${String(c.note).slice(0, 900)}`);
    if (c.existing && c.existing.length) lines.push(`页面里已经有的步骤：${clip(c.existing, 12).join('；')}`);
  } else {
    lines.push(`可用本子：${clip(c.notebooks, 20).join('、') || '（无）'}`);
    lines.push(`可用时间块类型：${clip(c.kinds, 20).join('、') || '（无）'}`);
    lines.push(`已有标签：${clip(c.tags, 40).join('、') || '（无）'}`);
    const todos = Array.isArray(c.todos) ? c.todos.slice(0, 30).map(todoLine).filter(Boolean) : [];
    lines.push(`已有的待办（未完成，近期）：${todos.join('；') || '（无）'}`);
    if (c.goals && c.goals.length) lines.push(`本月已有的目标：${clip(c.goals, 10).join('；')}`);
    if (c.focus) lines.push(`本周焦点：${String(c.focus).slice(0, 200)}`);
    if (Array.isArray(c.draft) && c.draft.length) lines.push(`待确认的草稿（上一轮给的、还没保存；对方若在改它就按 modify 输出，带 ref）：\n${c.draft.slice(0, 12).map(draftLine).filter(Boolean).join('\n')}`);
    if (c.schedule) lines.push(`已有安排（时间块）：\n${String(c.schedule).slice(0, 1200)}`);
    if (c.page) lines.push(`对方正在看的页面（节选）：\n${String(c.page).slice(0, 4000)}`);
    if (c.calendar) lines.push(`日历（算日期时直接查这里，不要心算）：\n${String(c.calendar).slice(0, 1200)}`);
  }
  return lines.join('\n');
}

/* ---------------- 校验：按 kind 检查字段，脏值置空，站不住的条目丢掉 ---------------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const validDate = (d) => (typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
const validTime = (t) => { if (typeof t !== 'string') return null; const m = t.trim().match(TIME_RE); return m ? `${m[1].padStart(2, '0')}:${t.trim().split(':')[1]}` : null; };
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
export function validateItem(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
  const it = {
    ref: str(raw.ref, 40), kind: raw.kind, title: str(raw.title, 120),
    subitems: (Array.isArray(raw.subitems) ? raw.subitems : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 6),
    url: str(raw.url, 500), author: str(raw.author, 60),
    date: validDate(raw.date), time: validTime(raw.time), start: validTime(raw.start), end: validTime(raw.end),
    priority: Number.isInteger(raw.priority) && raw.priority >= 0 && raw.priority <= 3 ? raw.priority : null,
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map((x) => str(x, 24)).filter(Boolean).map((x) => x.replace(/^#/, '')).slice(0, 6),
    block_kind: str(raw.block_kind, 30), notebook: str(raw.notebook, 40), body: typeof raw.body === 'string' ? raw.body.slice(0, 4000) : null,
  };
  if (!it.title) return null;
  if (it.kind === 'block') { if (!it.start) it.kind = 'todo'; else if (it.end && toMin(it.end) <= toMin(it.start)) it.end = null; } // 事件没有开始时刻就只能算待办
  if (it.kind === 'link' && !/^https?:\/\//i.test(it.url || '')) { const m = (it.title + ' ' + (it.body || '')).match(/https?:\/\/\S+/); if (m) it.url = m[0]; else it.kind = 'todo'; }
  if (it.kind === 'todo' && it.priority == null) it.priority = null; // 留给前端标成建议值
  return it;
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export function validateStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title, 60); if (!title) return null;
  const m = Number.isFinite(+raw.minutes) ? Math.round(+raw.minutes / 5) * 5 : 25;
  return { title, minutes: Math.max(10, Math.min(120, m)), kind: ['语言', '思考', '记忆', '动手'].includes(raw.kind) ? raw.kind : '思考', hint: str(raw.hint, 80) || '' };
}

/* ---------------- 简单限流：每个登录名每分钟 20 次（按实例，尽力而为） ---------------- */
const hits = new Map();
function rateLimited(key) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(key, arr); if (hits.size > 500) hits.clear();
  return arr.length > 20;
}

/* ---------------- 两家后端 ---------------- */
// 模型偶尔会在 JSON 外面包一层 ```json 或者说几句话，尽量把对象抠出来；被截断的 JSON 也试着把引号和括号补齐
function parseLoose(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch {}
  const i = t.indexOf('{'); if (i < 0) return null;
  t = t.slice(i);
  const j = t.lastIndexOf('}'); if (j > 0) { try { return JSON.parse(t.slice(0, j + 1)); } catch {} }
  return repairJSON(t);
}
// 截断修复：扫一遍记下是否在字符串里和未闭合的括号，然后把尾巴补上
function repairJSON(t) {
  let inStr = false, esc = false; const stack = [];
  for (const ch of t) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') stack.push('}'); else if (ch === '[') stack.push(']'); else if (ch === '}' || ch === ']') stack.pop();
  }
  let fixed = t.replace(/[,\s]*$/, '');
  if (inStr) fixed += '"';
  fixed = fixed.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  // 去掉最后一个没写完的键值对（比如 "date": "2026-1）
  for (let k = 0; k < 3; k++) {
    try { return JSON.parse(fixed + stack.slice().reverse().join('')); } catch {}
    const cut = Math.max(fixed.lastIndexOf(','), fixed.lastIndexOf('{'), fixed.lastIndexOf('['));
    if (cut <= 0) break;
    const tail = fixed.slice(cut + 1); fixed = fixed.slice(0, cut) + (fixed[cut] === ',' ? '' : fixed[cut]);
    if (fixed[cut] !== ',') { if ((tail.match(/\[/g) || []).length) stack.pop(); }
  }
  return null;
}
const fail = (msg, status = 502) => Object.assign(new Error(msg), { status });

async function askDeepSeek(cfg, system, messages, mode, retry = 0) {
  // retry 1：提醒上次 JSON 不合法；retry 2：DeepSeek 的 json_object 模式偶尔会回空内容，这次不开它，靠提示词 + parseLoose
  const sys = system + '\n\n' + JSON_HINT[mode] + (retry ? '\n\n注意：上一次的输出是空的或不是合法 JSON。这次只输出一个完整、紧凑的 JSON 对象，字符串里的换行写成 \\n，不要 Markdown 代码块，不要多余文字。' : '');
  const body = { model: cfg.model, max_tokens: 6000, temperature: retry ? 0 : 0.3, ...(retry >= 2 ? {} : { response_format: { type: 'json_object' } }), messages: [{ role: 'system', content: sys }, ...messages] };
  const r = await fetch(`${DS_BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) {
    const msg = (j && j.error && (j.error.message || j.error)) || text.slice(0, 200);
    if (r.status === 401) throw fail('DeepSeek 密钥无效');
    if (r.status === 402) throw fail('DeepSeek 余额不足，去 platform.deepseek.com 充值');
    if (r.status === 429) throw fail('请求太频繁，等一下再试', 429);
    if (/model/i.test(String(msg)) && /not|exist|invalid/i.test(String(msg))) throw fail(`模型「${cfg.model}」不可用，改成官网价格页上的名字`);
    throw fail(`DeepSeek 错误 ${r.status}：${msg}`);
  }
  const choice = j && j.choices && j.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content || !String(content).trim()) return { out: null, empty: true, raw: '', model: j.model || cfg.model, usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0, cached: j.usage?.prompt_cache_hit_tokens || 0 }, truncated: false };
  return { out: parseLoose(content), raw: String(content).slice(0, 120), model: j.model || cfg.model, usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0, cached: j.usage?.prompt_cache_hit_tokens || 0 }, truncated: choice.finish_reason === 'length' };
}

async function askClaude(cfg, system, schema, messages) {
  const client = new Anthropic({ apiKey: cfg.key });
  let r;
  try {
    r = await client.beta.messages.create({
      model: cfg.model, max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw fail('Claude 密钥无效');
    if (e instanceof Anthropic.RateLimitError) throw fail('请求太频繁，等一下再试', 429);
    if (e instanceof Anthropic.APIError) throw fail(`Claude 错误 ${e.status}：${e.message}`);
    throw fail(e.message || 'network error');
  }
  if (r.stop_reason === 'refusal') return { out: { reply: '这个我不太方便处理，换个说法试试？', items: [], steps: [] }, model: r.model, usage: {} };
  const tb = r.content.find((b) => b.type === 'text');
  return { out: parseLoose(tb ? tb.text : ''), model: r.model, usage: { in: r.usage.input_tokens, out: r.usage.output_tokens, cached: r.usage.cache_read_input_tokens || 0 }, truncated: r.stop_reason === 'max_tokens' };
}

async function balance(cfg) {
  if (cfg.provider !== 'deepseek') return { supported: false };
  const r = await fetch(`${DS_BASE}/user/balance`, { headers: { Authorization: `Bearer ${cfg.key}` }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail(r.status === 401 ? 'DeepSeek 密钥无效' : `查询失败 ${r.status}`);
  const info = (j && j.balance_infos && j.balance_infos[0]) || {};
  return { supported: true, available: !!(j && j.is_available), currency: info.currency || 'CNY', total: +info.total_balance || 0, granted: +info.granted_balance || 0, topped: +info.topped_up_balance || 0 };
}

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  const cfg = resolve(req);
  const s = await session(req);
  if (!s) return json(res, 401, { error: '请先登录再使用汤圆' });
  if (rateLimited(s.u || 'anon')) return json(res, 429, { error: '说得太快啦，歇一分钟再来' });
  if (!cfg.key) return json(res, 503, { error: `AI 未配置：在设置里填密钥，或在 Vercel 环境变量里设置 ${cfg.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'ANTHROPIC_API_KEY'}` });

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('balance')) {
      try { return json(res, 200, { provider: cfg.provider, model: cfg.model, balance: await balance(cfg) }); } catch (e) { return json(res, e.status || 502, { error: e.message }); }
    }
    return json(res, 200, { provider: cfg.provider, model: cfg.model, fromHeader: cfg.fromHeader });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  // 云端用户用的是站长的服务器密钥：每人每月有免费次数，超了就请自带密钥（设置 → 汤圆 → AI 密钥）
  if (s.k === 'sb' && !cfg.fromHeader && !isOwner(s.email)) {
    let n = 0;
    try { const tok = await accessToken(s, res); const r = await sb('/rest/v1/rpc/bump_ai', { as: tok, method: 'POST', body: { p_month: new Date().toISOString().slice(0, 7) } }); if (r.ok) n = Number(r.data) || 0; } catch {}
    if (n > freeCalls()) return json(res, 429, { error: `这个月的 ${freeCalls()} 次免费额度用完了。去设置里填自己的 DeepSeek / Claude 密钥就能继续用`, quota: true });
  }

  const body = await readJson(req, 1e6);
  if (!body) return json(res, 400, { error: 'bad json' });
  const r = await runAgent(body, cfg);
  json(res, r.status, r.body);
}

// 真正干活的部分，和 HTTP 分开，方便 tools/eval-agent.mjs 直接调用做评测
export async function runAgent(body, cfg) {
  const mode = ['breakdown', 'doc', 'brain'].includes(body.mode) ? body.mode : 'capture';
  const text = String(body.text || '').trim().slice(0, 4000);
  if (!text) return { status: 400, body: { error: 'text required' } };
  const history = mode === 'capture' ? (Array.isArray(body.history) ? body.history : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
  const system = { breakdown: SYSTEM_BREAKDOWN, doc: SYSTEM_DOC, brain: SYSTEM_BRAIN }[mode] || SYSTEM_CAPTURE;
  const schema = { breakdown: SCHEMA_BREAKDOWN, doc: SCHEMA_DOC, brain: SCHEMA_BRAIN }[mode] || SCHEMA_CAPTURE;
  const userMsg = { role: 'user', content: `<context>\n${contextBlock(body.context, mode)}\n</context>\n\n${{ breakdown: '要拆的事', doc: '要求', brain: '要分的待办（每行一件：id | 标题 | 备注）' }[mode] || '说的话'}：${text}` };
  const messages = [...history, userMsg];

  let got;
  try {
    got = cfg.provider === 'deepseek' ? await askDeepSeek(cfg, system, messages, mode) : await askClaude(cfg, system, schema, messages);
    // DeepSeek：空内容 / 坏 JSON / 被截断 → 最多再试两次（第二次不开 json 模式），用量累加
    for (let k = 1; k <= 2 && cfg.provider === 'deepseek' && (!got.out || got.truncated); k++) {
      const again = await askDeepSeek(cfg, system, messages, mode, k);
      const usage = { in: got.usage.in + again.usage.in, out: got.usage.out + again.usage.out, cached: got.usage.cached + again.usage.cached };
      got = again.out && !again.truncated ? { ...again, usage } : { ...got, usage, empty: got.empty && again.empty };
    }
  } catch (e) { return { status: e.status || 502, body: { error: e.message || 'network error' } }; }
  // 结构化操作宁可报错重来，也不把补齐的半截 JSON 当成可靠结果
  if (!got.out || got.truncated) return { status: 502, body: { error: got.truncated ? '回答太长被截断了，试试拆成几句说' : got.empty ? 'DeepSeek 这次返回了空内容（它的 JSON 模式偶发问题），再发一次就好' : `汤圆的回答没法解析（${cfg.provider} 返回的不是 JSON：${(got.raw || '').replace(/\s+/g, ' ').slice(0, 60)}…），再试一次？`, retryable: true } };

  const base = { reply: String(got.out.reply || ''), model: got.model, provider: cfg.provider, usage: got.usage, mode };
  if (mode === 'doc') {
    const md = typeof got.out.markdown === 'string' && got.out.markdown.trim() ? got.out.markdown.replace(/<[^>]+>/g, '').trim().slice(0, 12000) : null;
    return { status: 200, body: { ...base, markdown: md } };
  }
  if (mode === 'brain') {
    const picks = (Array.isArray(got.out.picks) ? got.out.picks : []).filter((p) => p && typeof p.id === 'string' && BRAIN_IDS.includes(p.region)).map((p) => ({ id: p.id.slice(0, 40), region: p.region, also: [...new Set(Array.isArray(p.also) ? p.also : [])].filter((x) => BRAIN_IDS.includes(x) && x !== p.region).slice(0, 2) })).slice(0, 80);
    return { status: 200, body: { ...base, picks } };
  }
  if (mode === 'breakdown') {
    const steps = (Array.isArray(got.out.steps) ? got.out.steps : []).map(validateStep).filter(Boolean).slice(0, 7);
    return { status: 200, body: { ...base, steps } };
  }
  const items = (Array.isArray(got.out.items) ? got.out.items : []).map(validateItem).filter(Boolean).slice(0, 20);
  const intent = INTENTS.includes(got.out.intent) ? got.out.intent : (items.length ? 'capture' : 'chat');
  return { status: 200, body: { ...base, intent, items } };
}
