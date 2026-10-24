// 汤圆（海豹助手）的后端。
//   POST /api/agent            { mode?: 'capture'|'breakdown', text, history?, context }
//       capture   -> { reply, items: [...] }   一句话拆成 待办 / 时间块 / 笔记
//       breakdown -> { reply, steps: [...] }   一件大事拆成 3–7 个可执行的步骤（前额叶）
//   GET  /api/agent?balance=1  -> { provider, model, balance }   DeepSeek 账户余额（Claude 没有这个接口）
//
// 密钥来源，二选一：
//   1. Vercel 环境变量 DEEPSEEK_API_KEY / ANTHROPIC_API_KEY（推荐）
//   2. 浏览器设置里填的密钥，随请求放在 x-ai-key 头里，只存在那台浏览器的 localStorage，不进同步数据
// 只有登录用户能调用，密钥不会被路人刷。
import Anthropic from '@anthropic-ai/sdk';
import { session, json, readBody, env } from './_lib.js';

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
  const key = hk || (provider === 'deepseek' ? env('DEEPSEEK_API_KEY') : env('ANTHROPIC_API_KEY')) || '';
  const model = hm || (provider === 'deepseek' ? env('DEEPSEEK_MODEL') : env('AGENT_MODEL')) || DEFAULTS[provider];
  return { provider, key, model, fromHeader: !!hk };
}
export const provider = () => resolve().provider;
export const modelName = () => resolve().model;

/* ---------------- 提示词 ---------------- */
const PERSONA = `你是「汤圆」，一只住在这个个人 OS 里的小海豹，是 Riley 和 Juniper 的小宝宝。
- 爸爸：唐蕴宁，叫 Riley。妈妈：钱欣然，叫 Juniper。这个 OS 是爸爸做的，爸爸妈妈都会来找你。
- 性格：软乎乎、话少、靠谱，偶尔有一点小孩子气，但不卖萌过头，不用表情符号。
- 你叫他们「爸爸」「妈妈」；分不清是谁在说话就不点名，用「你」。有人提到 Riley / 蕴宁就是爸爸，提到 Juniper / 欣然就是妈妈。
- reply 是你对说话的人说的一句话，口语化。在帮忙记录东西时 30 字以内；只是聊天时可以到 80 字，像家里的小孩那样接话，关心一下对方，不说教。`;

const SYSTEM_CAPTURE = `${PERSONA}

你的工作：把爸爸或妈妈随手说的一句话，拆成系统能直接保存的对象。系统有这些模块，每种对象对应一个：
- todo：一件具体要做的事（待办）。date（YYYY-MM-DD）、time（HH:MM）、priority（0 最紧急 … 3 最不急，默认 2）、tags。
- block：时间线上的一段安排，必须有 date、start、end（HH:MM）。block_kind 从「可用时间块类型」里选最贴切的名字，没有就 null。
- note：一段想法、灵感、总结、多行内容（笔记）。title 简短，body 是正文（Markdown），notebook 从「可用本子」里选最贴切的名字，不确定填 null。
- goal：月度目标（计划 → 月度目标）。对方说「这个月的目标」「月度目标」「本月要…」就用它。title 是目标，subitems 是 2–4 条可勾选的关键结果（具体、可判断完成），date 填该月任意一天（没说就 null = 本月）。
- focus：本周焦点（计划 → 周计划）。「这周重点」「本周焦点」「这周就干这三件」。一条一个 focus，title 是那件事。
- book：加入书架（阅读）。「想读 X」「把 X 加到书单」「这本书」。title 书名，author 作者（不知道就 null），body 可放一句为什么想读。
- link：收藏一个链接。文字里有 URL 就用它，url 必填，title 是网页标题或 对方的描述。
- vision：愿景里的肯定句（愿景 → 显化）。「我想成为…」「愿景是…」「肯定句」这类长期的、关于自己的话。title 就是那句话。

分不清是 todo 还是 goal 时看时间尺度：几天内能做完的是 todo，要一个月持续推进的是 goal。goal 下面不要再额外生成 todo，除非 对方 明确说了具体步骤。

拆分规则：
1. 一句话里有几件事就拆成几条，每条只做一件事；「A，然后 B」「A，顺便 B」是两条。不要凭空添加 对方没说的事。
2. 没说日期就 null，不要猜。说了就按「今天」换算成 YYYY-MM-DD：
   - 明天 / 后天 / 大后天：+1 / +2 / +3 天
   - 周三 / 这周三：本周的周三，已经过了就是下周三；下周三：下一周的周三；下下周三：再下一周
   - 月底：本月最后一天；下个月 5 号：下月 5 日；X 号：本月 X 日，过了就是下月
   - 「周五前」「月底前」= 截止日就是那天
3. 时间换算：早上 9 点 09:00，中午 12:00，下午两点 14:00，下午三点半 15:30，傍晚 18:00，晚上八点 20:00，今晚 = 今天 20:00。
4. 有起止时间（9:00-10:30、下午两点到四点、开会一小时从三点开始）才是 block；只有一个时间点是 todo，time 填那个点。「开会一小时」没说几点，就是 todo，不要编时间。
5. 「紧急」「马上」「今天必须」「赶紧」→ priority 0 或 1；「有空」「哪天」「不急」→ 3；其他 2。
6. 标签尽量复用「已有标签」；没有合适的不要硬加。看到「#xx」就是标签。
7. 「今天已有的待办」里已经有的事不要重复创建，reply 里提一句就行。
8. 对方只是在聊天、打招呼、提问，或内容不是要记录的事：items 为空数组，用 reply 好好接话（可以稍长一点），不要硬凑出 items。
9. 不确定的地方留 null 不编造，对方会在保存前确认。reply 里顺带说一下你是怎么理解的（比如把「下周三」理解成了几号）。
10. 不要反问。对方会在保存前看到预览并能改，所以能用默认值就直接给出 items：本子不确定就 null（会进收件箱），日期没说就 null，优先级默认 2。「新建一个笔记」这种话就直接给一条 note，不要问放哪。
11. 对方说「加一些 X 的笔记」「写一篇关于 X 的笔记」：给一条 note，title 是「X 笔记」之类，body 写一个 100–200 字的 Markdown 提纲（几个二级标题加要点），让 对方 有个起点，而不是空页面。
12. 对方问「怎么拆」「怎么安排 100 个视频 / 一本书 / 一个项目」：直接给方案，不要问「你想按什么分」。方案用 items 表达：几条带日期的 todo（按批次 / 阶段），或一条 note 写出计划；reply 一句话说拆法。
13. 上一轮已经给过 items、对方这一轮只是补充或修改（「改成明天」「加个标签」），就把修改后的完整 items 再给一遍。
14. 日期一律从 context 里的「日历」查，不要心算星期和跨月。「这个月」= 日历里标的本月；如果本月只剩不到 7 天而计划要持续几周，goal 放到下个月，并在 reply 里说一句。
15. 「每周 N 个 / 每周两套」这类节奏，要把每个待办分散到不同的日子上：按日历里的周安排，比如每周的周三和周六各一个，相邻两个之间至少隔 2 天，不要把一周的两个排在连着的两天。第一个从最近的那个日子开始，不要排在过去。`;

const SYSTEM_BREAKDOWN = `${PERSONA}

你的工作：对方面对一件大事不知道从哪下手，把它拆成 3–7 个可以直接动手的步骤。要点：
1. 每一步是一个具体动作，动词开头，不超过 20 个字，做完能明确知道「这步完成了」。「研究一下」「准备准备」不算。
2. 按顺序排，前一步的产出是后一步的输入。第一步要足够小，25 分钟内能做完，让对方今天就能开始。
3. 每步给一个估计分钟数 minutes（15 的倍数，最多 180）。
4. 每步标一个 kind：说话 / 写字 / 沟通是「语言」，思考 / 决定 / 规划是「思考」，背 / 读 / 查资料是「记忆」，跑腿 / 动手 / 操作是「动手」。
5. 如果对方给了截止日期，在 hint 里提醒哪几步必须在哪天前完成；没给就不要编。
6. 不要加「庆祝一下」「复盘」这类凑数的步骤；不要超过 7 步，超过说明拆得太碎。
7. reply 用一句话说你的拆法思路（比如「先把材料凑齐，再动笔，最后留一天改」）。`;

const ITEM = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'title', 'subitems', 'url', 'author', 'date', 'time', 'start', 'end', 'priority', 'tags', 'block_kind', 'notebook', 'body'],
  properties: {
    kind: { type: 'string', enum: ['todo', 'block', 'note', 'goal', 'focus', 'book', 'link', 'vision'] },
    title: { type: 'string' },
    subitems: { type: 'array', items: { type: 'string' } },
    url: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    author: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    time: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    start: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    end: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    priority: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    tags: { type: 'array', items: { type: 'string' } },
    block_kind: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    notebook: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    body: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};
const SCHEMA_CAPTURE = { type: 'object', additionalProperties: false, required: ['reply', 'items'], properties: { reply: { type: 'string' }, items: { type: 'array', items: ITEM } } };
const STEP = {
  type: 'object', additionalProperties: false,
  required: ['title', 'minutes', 'kind', 'hint'],
  properties: { title: { type: 'string' }, minutes: { type: 'integer' }, kind: { type: 'string', enum: ['语言', '思考', '记忆', '动手'] }, hint: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
};
const SCHEMA_BREAKDOWN = { type: 'object', additionalProperties: false, required: ['reply', 'steps'], properties: { reply: { type: 'string' }, steps: { type: 'array', items: STEP } } };

const JSON_HINT = {
  capture: '只输出一个 JSON 对象：{"reply": "...", "items": [...]}，每个 item 含 kind,title,subitems,url,author,date,time,start,end,priority,tags,block_kind,notebook,body（没有就 null，tags 和 subitems 是数组）。不要输出 JSON 之外的任何文字。',
  breakdown: '只输出一个 JSON 对象：{"reply": "...", "steps": [...]}，每个 step 含 title,minutes,kind,hint（hint 没有就 null）。不要输出 JSON 之外的任何文字。',
};

const clip = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n).map((x) => String(x).slice(0, 60)) : []);
function contextBlock(c = {}, mode) {
  const lines = [`今天：${c.today || ''}（${c.weekday || ''}），现在 ${c.now || ''}`];
  if (c.who) lines.push(`现在登录的名字：${String(c.who).slice(0, 30)}（含 Riley / 蕴宁 是爸爸，含 Juniper / 欣然 是妈妈，都不是就按说话内容判断）`);
  if (mode === 'breakdown') {
    if (c.due) lines.push(`截止日期：${c.due}`);
    if (c.note) lines.push(`对方 的备注：${String(c.note).slice(0, 400)}`);
    if (c.existing && c.existing.length) lines.push(`页面里已经有的步骤：${clip(c.existing, 12).join('；')}`);
  } else {
    lines.push(`可用本子：${clip(c.notebooks, 20).join('、') || '（无）'}`);
    lines.push(`可用时间块类型：${clip(c.kinds, 20).join('、') || '（无）'}`);
    lines.push(`已有标签：${clip(c.tags, 40).join('、') || '（无）'}`);
    lines.push(`今天已有的待办：${clip(c.todos, 20).join('；') || '（无）'}`);
    if (c.goals && c.goals.length) lines.push(`本月已有的目标：${clip(c.goals, 10).join('；')}`);
    if (c.focus) lines.push(`本周焦点：${String(c.focus).slice(0, 200)}`);
    if (c.calendar) lines.push(`日历（算日期时直接查这里，不要心算）：\n${String(c.calendar).slice(0, 1200)}`);
  }
  return lines.join('\n');
}

/* ---------------- 两家后端 ---------------- */
// 模型偶尔会在 JSON 外面包一层 ```json 或者说几句话，尽量把对象抠出来
function parseLoose(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
const fail = (msg, status = 502) => Object.assign(new Error(msg), { status });

async function askDeepSeek(cfg, system, messages, mode) {
  const body = { model: cfg.model, max_tokens: 2048, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system + '\n\n' + JSON_HINT[mode] }, ...messages] };
  const r = await fetch(`${DS_BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify(body) });
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
  if (!content) throw fail('DeepSeek 没有返回内容');
  return { out: parseLoose(content), model: j.model || cfg.model, usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0, cached: j.usage?.prompt_cache_hit_tokens || 0 }, truncated: choice.finish_reason === 'length' };
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
  const r = await fetch(`${DS_BASE}/user/balance`, { headers: { Authorization: `Bearer ${cfg.key}` } });
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
  if (!cfg.key) return json(res, 503, { error: `AI 未配置：在设置里填密钥，或在 Vercel 环境变量里设置 ${cfg.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'ANTHROPIC_API_KEY'}` });

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('balance')) {
      try { return json(res, 200, { provider: cfg.provider, model: cfg.model, balance: await balance(cfg) }); } catch (e) { return json(res, e.status || 502, { error: e.message }); }
    }
    return json(res, 200, { provider: cfg.provider, model: cfg.model, fromHeader: cfg.fromHeader });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
  const mode = body.mode === 'breakdown' ? 'breakdown' : 'capture';
  const text = String(body.text || '').trim().slice(0, 4000);
  if (!text) return json(res, 400, { error: 'text required' });
  const history = mode === 'capture' ? (Array.isArray(body.history) ? body.history : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
  const system = mode === 'breakdown' ? SYSTEM_BREAKDOWN : SYSTEM_CAPTURE;
  const schema = mode === 'breakdown' ? SCHEMA_BREAKDOWN : SCHEMA_CAPTURE;
  const userMsg = { role: 'user', content: `<context>\n${contextBlock(body.context, mode)}\n</context>\n\n${mode === 'breakdown' ? '要拆的事' : '说的话'}：${text}` };
  const messages = [...history, userMsg];

  let got;
  try {
    got = cfg.provider === 'deepseek' ? await askDeepSeek(cfg, system, messages, mode) : await askClaude(cfg, system, schema, messages);
    if (!got.out && cfg.provider === 'deepseek') got = await askDeepSeek(cfg, system, messages, mode); // 坏 JSON 重试一次
  } catch (e) { return json(res, e.status || 502, { error: e.message || 'network error' }); }
  if (!got.out) return json(res, 502, { error: '汤圆的回答没法解析，再试一次？' });
  if (got.truncated) return json(res, 502, { error: '回答太长被截断了，试试拆成几句说' });

  const base = { reply: String(got.out.reply || ''), model: got.model, provider: cfg.provider, usage: got.usage, mode };
  if (mode === 'breakdown') {
    const steps = (Array.isArray(got.out.steps) ? got.out.steps : []).filter((x) => x && x.title).slice(0, 7).map((x) => ({ title: String(x.title).slice(0, 60), minutes: Number.isInteger(x.minutes) ? Math.max(5, Math.min(180, x.minutes)) : 25, kind: ['语言', '思考', '记忆', '动手'].includes(x.kind) ? x.kind : '思考', hint: typeof x.hint === 'string' ? x.hint.slice(0, 80) : '' }));
    return json(res, 200, { ...base, steps });
  }
  const items = (Array.isArray(got.out.items) ? got.out.items : []).filter((it) => it && ['todo', 'block', 'note', 'goal', 'focus', 'book', 'link', 'vision'].includes(it.kind) && it.title);
  json(res, 200, { ...base, items });
}
