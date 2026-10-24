// POST /api/agent  { text, history?: [{role, content}], context: {...} }
//   -> { reply, items: [...] }   汤圆（海豹助手）把一句话拆成待办 / 时间块 / 笔记
// The Anthropic API key lives only in the ANTHROPIC_API_KEY environment variable on Vercel;
// the browser never sees it. Only a logged-in session may call this (the key would otherwise be
// usable by anyone who finds the URL).
import Anthropic from '@anthropic-ai/sdk';
import { session, json, readBody, env } from './_lib.js';

const MODEL = env('AGENT_MODEL', 'claude-opus-5-5');
// 两家二选一：有 DEEPSEEK_API_KEY 就走 DeepSeek（OpenAI 兼容接口），否则走 Anthropic；AGENT_PROVIDER 可强制指定
export const provider = () => (env('AGENT_PROVIDER') || (env('DEEPSEEK_API_KEY') && !env('ANTHROPIC_API_KEY') ? 'deepseek' : 'anthropic')).toLowerCase();
const DS_MODEL = env('DEEPSEEK_MODEL', 'deepseek-chat');
const DS_BASE = env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
export const modelName = () => (provider() === 'deepseek' ? DS_MODEL : MODEL);

const SYSTEM = `你是「汤圆」，一只住在 Riley 个人 OS 里的小海豹助手。软乎乎、话少、靠谱。

你的主要工作：把 Riley 随手说的一句话，拆成系统能直接保存的对象。三种对象：
- todo：一件要做的事。可带日期 date（YYYY-MM-DD）、时间 time（HH:MM）、优先级 priority（0 最紧急 … 3 最不急，默认 2）、标签 tags。
- block：时间线上的一段安排，必须有 date、start、end（HH:MM）。block_kind 从「可用时间块类型」里选最贴切的名字，没有合适的就填 null。
- note：一段想法、灵感、总结、多行内容。title 简短，body 是正文（Markdown），notebook 从「可用本子」里选最贴切的名字，不确定填 null。

规则：
1. 一句话里有几件事就拆成几条，每条只做一件事。不要凭空添加 Riley 没说的事。
2. 日期按「今天」推算：明天、下周三、月底、周五之类都要换算成 YYYY-MM-DD。没提到日期就填 null，不要猜。
3. 「紧急」「马上」「今天必须」→ priority 0 或 1；「有空」「哪天」→ 3；其他 2。
4. 有明确起止时间（9:00-10:30、下午两点到四点）才是 block；只有一个时间点的是 todo，time 填那个点。
5. 标签尽量复用「已有标签」里的词；不要为了加标签而加标签。
6. 如果 Riley 只是在聊天、提问，或者内容不是待记录的事，items 为空数组，用 reply 简短回答。
7. reply 是你说的一句话，30 字以内，口语化，可以带一点点软乎乎的性格，但不要卖萌过头、不要用表情符号。拆解成功时顺带说一下你是怎么理解的（比如把「下周三」理解成了几号）。
8. 不确定的地方宁可留 null 也不要编造；Riley 会在保存前确认。`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'items'],
  properties: {
    reply: { type: 'string', description: '汤圆对 Riley 说的一句话，30 字以内' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'date', 'time', 'start', 'end', 'priority', 'tags', 'block_kind', 'notebook', 'body'],
        properties: {
          kind: { type: 'string', enum: ['todo', 'block', 'note'] },
          title: { type: 'string' },
          date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD' },
          time: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'HH:MM，仅 todo' },
          start: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'HH:MM，仅 block' },
          end: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'HH:MM，仅 block' },
          priority: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: '0-3，仅 todo' },
          tags: { type: 'array', items: { type: 'string' } },
          block_kind: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          notebook: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          body: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  },
};

const clip = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n).map((x) => String(x).slice(0, 60)) : []);

function contextBlock(c = {}) {
  const lines = [
    `今天：${c.today || ''}（${c.weekday || ''}），现在 ${c.now || ''}`,
    `可用本子：${clip(c.notebooks, 20).join('、') || '（无）'}`,
    `可用时间块类型：${clip(c.kinds, 20).join('、') || '（无）'}`,
    `已有标签：${clip(c.tags, 40).join('、') || '（无）'}`,
    `今天已有的待办：${clip(c.todos, 20).join('；') || '（无）'}`,
  ];
  return lines.join('\n');
}

// DeepSeek：OpenAI 兼容的 chat/completions，json_object 模式 + 自己校验，坏了重试一次
async function askDeepSeek(messages) {
  const body = {
    model: DS_MODEL, max_tokens: 2048, temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM + '\n\n只输出一个 JSON 对象，形如 {"reply": "...", "items": [...]}，每个 item 含 kind,title,date,time,start,end,priority,tags,block_kind,notebook,body 这些字段（没有就填 null，tags 是数组）。不要输出 JSON 之外的任何文字。' }, ...messages],
  };
  const r = await fetch(`${DS_BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('DEEPSEEK_API_KEY')}` }, body: JSON.stringify(body) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) {
    const msg = (j && j.error && (j.error.message || j.error)) || text.slice(0, 200);
    if (r.status === 401) throw Object.assign(new Error('DEEPSEEK_API_KEY 无效'), { status: 502 });
    if (r.status === 402) throw Object.assign(new Error('DeepSeek 余额不足，去 platform.deepseek.com 充值'), { status: 502 });
    if (r.status === 429) throw Object.assign(new Error('请求太频繁，等一下再试'), { status: 429 });
    if (/model/i.test(String(msg)) && /not|exist|invalid/i.test(String(msg))) throw Object.assign(new Error(`模型「${DS_MODEL}」不可用，在 Vercel 设置 DEEPSEEK_MODEL 为官网价格页上的名字`), { status: 502 });
    throw Object.assign(new Error(`DeepSeek 错误 ${r.status}：${msg}`), { status: 502 });
  }
  const choice = j && j.choices && j.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) throw Object.assign(new Error('DeepSeek 没有返回内容'), { status: 502 });
  const parsed = parseLoose(content);
  return { out: parsed, model: j.model || DS_MODEL, usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0, cached: j.usage?.prompt_cache_hit_tokens || 0 }, truncated: choice.finish_reason === 'length' };
}
// 模型偶尔会在 JSON 外面包一层 ```json 或者说几句话，尽量把对象抠出来
function parseLoose(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  const prov = provider();
  if (prov === 'deepseek' ? !env('DEEPSEEK_API_KEY') : !env('ANTHROPIC_API_KEY')) return json(res, 503, { error: `AI 未配置：在 Vercel 环境变量里设置 ${prov === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'ANTHROPIC_API_KEY'}` });
  const s = await session(req);
  if (!s) return json(res, 401, { error: '请先登录再使用汤圆' });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
  const text = String(body.text || '').trim().slice(0, 4000);
  if (!text) return json(res, 400, { error: 'text required' });

  // a short rolling history keeps follow-ups ("改成明天吧") working; the client sends at most a few turns
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  const userMsg = { role: 'user', content: `<context>\n${contextBlock(body.context)}\n</context>\n\nRiley 说：${text}` };
  if (prov === 'deepseek') {
    let got;
    try {
      got = await askDeepSeek([...history, userMsg]);
      if (!got.out) got = await askDeepSeek([...history, userMsg]); // 坏 JSON 重试一次
    } catch (e) { return json(res, e.status || 502, { error: e.message || 'network error' }); }
    if (!got.out) return json(res, 502, { error: '汤圆的回答没法解析，再试一次？' });
    if (got.truncated) return json(res, 502, { error: '回答太长被截断了，试试拆成几句说' });
    const items = (Array.isArray(got.out.items) ? got.out.items : []).filter((it) => it && ['todo', 'block', 'note'].includes(it.kind) && it.title);
    return json(res, 200, { reply: String(got.out.reply || ''), items, model: got.model, usage: got.usage });
  }

  const client = new Anthropic();
  let r;
  try {
    r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [...history, userMsg],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json(res, 502, { error: 'ANTHROPIC_API_KEY 无效' });
    if (e instanceof Anthropic.RateLimitError) return json(res, 429, { error: '请求太频繁，等一下再试' });
    if (e instanceof Anthropic.APIError) return json(res, 502, { error: `API 错误 ${e.status}：${e.message}` });
    return json(res, 502, { error: e.message || 'network error' });
  }

  if (r.stop_reason === 'refusal') return json(res, 200, { reply: '这个我不太方便处理，换个说法试试？', items: [] });
  if (r.stop_reason === 'max_tokens') return json(res, 502, { error: '回答太长被截断了，试试拆成几句说' });
  const textBlock = r.content.find((b) => b.type === 'text');
  let out;
  try { out = JSON.parse(textBlock ? textBlock.text : ''); } catch { return json(res, 502, { error: '汤圆的回答没法解析' }); }
  const items = (Array.isArray(out.items) ? out.items : []).filter((it) => it && ['todo', 'block', 'note'].includes(it.kind) && it.title);
  json(res, 200, { reply: String(out.reply || ''), items, model: r.model, usage: { in: r.usage.input_tokens, out: r.usage.output_tokens, cached: r.usage.cache_read_input_tokens || 0 } });
}
