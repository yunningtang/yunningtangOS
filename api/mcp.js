// SealoNote 的 MCP 服务：让 Claude（claude.ai 的自定义连接器、Claude 桌面版、手机 App）读写你自己的待办、时间线、笔记、便利贴。
//
//   https://www.sealonote.com/mcp                                  MCP（Streamable HTTP，JSON-RPC，一次请求一个回复，不用 SSE）
//   /.well-known/oauth-protected-resource                          这个资源归哪个授权服务器管
//   /.well-known/oauth-authorization-server                        授权服务器的说明（RFC 8414）
//   /oauth/register  /oauth/authorize  /oauth/approve  /oauth/token 动态注册客户端（RFC 7591）、授权页（PKCE S256）、换令牌
//
// 不建数据库表：客户端编号、授权码、令牌都是用 SESSION_SECRET 加密封好的（AES-GCM），只有本站能解开、改不了。
// 收回授权：设置里点「取消所有授权」会更新 settings.mcpEpoch，之前发出去的令牌全部作废。
// 写入和网页一样走 docs 表的版本号（乐观锁），各个设备拉下来时三方合并；不提供任何删除工具。
import { env, seal, open, session, readBody } from './_lib.js';
import { sb, cloudOn } from './_cloud.js';
import { uid, PRIORITY, BLOCK_KINDS } from '../js/util.js';
import { mdToBlocks } from '../js/blocks.js';

const SCOPE = 'sealonote';
const AT_TTL = 60 * 60;            // access token：1 小时
const RT_TTL = 60 * 60 * 24 * 60;  // refresh token：60 天
const CODE_TTL = 5 * 60;           // 授权码：5 分钟
const nowS = () => Math.floor(Date.now() / 1000);

function origin(req) {
  const fixed = env('SITE_URL'); if (fixed) return fixed.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.sealonote.com';
  return `${/^localhost|^127\./.test(host) ? 'http' : 'https'}://${host}`;
}
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === null || body === undefined) return res.end();
  if (typeof body === 'string') { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(body); }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
}
const redirect = (res, url) => send(res, 302, null, { Location: url });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function form(req) { const raw = (await readBody(req, 1e5)).toString('utf8'); if (/json/.test(req.headers['content-type'] || '')) { try { return JSON.parse(raw); } catch { return {}; } } return Object.fromEntries(new URLSearchParams(raw)); }
const b64url = (buf) => Buffer.from(buf).toString('base64url');
async function sha256(s) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
const okRedirect = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(x.hostname)); } catch { return false; } };

/* ---------------- 数据：一个人一行 docs ---------------- */
// 测试时可以换成假的（见 tools/test-mcp.mjs）
export const db = {
  async read(uid) { const r = await sb('/rest/v1/docs?select=doc,version&user_id=eq.' + encodeURIComponent(uid), { as: 'service' }); if (!r.ok) throw new Error('读取数据失败'); const row = Array.isArray(r.data) && r.data[0]; return row ? { doc: row.doc, version: row.version } : null; },
  async write(uid, doc, version) {
    const r = await sb(`/rest/v1/docs?user_id=eq.${encodeURIComponent(uid)}&version=eq.${version}&select=version`, { as: 'service', method: 'PATCH', body: { doc, version: version + 1, updated_at: new Date().toISOString() }, headers: { Prefer: 'return=representation' } });
    if (r.ok && Array.isArray(r.data) && r.data.length) return 'ok';
    if (r.ok) return 'conflict';
    if (/rate_limited/.test(JSON.stringify(r.data || ''))) return 'busy';
    throw new Error('保存失败');
  },
};
// 改数据：读 → 改 → 带版本号写；别的设备刚好也在写（版本变了 / 1.5 秒限速）就重来
async function mutate(uid, fn) {
  for (let i = 0; i < 4; i++) {
    const cur = await db.read(uid); if (!cur) throw new Error('这个账号在云端还没有数据：先在 SealoNote 里登录并同步一次');
    const doc = JSON.parse(JSON.stringify(cur.doc)); const out = fn(doc);
    const r = await db.write(uid, doc, cur.version);
    if (r === 'ok') return out;
    await new Promise((ok) => setTimeout(ok, r === 'busy' ? 1700 : 300));
  }
  throw new Error('数据正在被别的设备同步，稍后再试一次');
}

/* ---------------- 日期：按这个人设置的时区算「今天」 ---------------- */
function todayIn(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); }
}
function nowHM(tz) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); } catch { return ''; } }
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const iso = () => new Date().toISOString();
const pri = (p) => (Number.isInteger(p) && p >= 0 && p <= 3 ? p : 2);
const PNAME = Object.fromEntries(PRIORITY.map((p) => [p.v, p.name]));
const list = (doc, k) => (Array.isArray(doc[k]) ? doc[k] : (doc[k] = []));

const todoOut = (t, today) => ({ id: t.id, title: t.title, done: !!t.done, due: t.due || null, time: t.time || null, priority: pri(t.priority), priority_name: PNAME[pri(t.priority)], overdue: !t.done && !!t.due && t.due < today, focus_today: t.focus === today, tags: t.tags || [], note: t.note || undefined, steps: (t.steps || []).map((s) => ({ id: s.id, title: s.title, minutes: s.minutes, done: !!s.done })) });
const blockOut = (b) => ({ id: b.id, date: b.date, start: b.start, end: b.end, title: b.title, kind: b.kind === 'check' ? 'checkpoint' : b.kind, todo_id: b.todoId || undefined, status: b.kind === 'check' ? b.status || 'pending' : undefined });
const noteTitle = (n) => n.title || (n.body || '').split('\n').map((l) => l.replace(/^[#>\-*\s\d.)[\]x]+/, '').trim()).find(Boolean) || '无标题';
const nbName = (doc, id) => ((doc.notebooks || []).find((b) => b.id === id) || {}).name || '';
function findNotebook(doc, name) {
  if (!name) return null; const k = String(name).trim().toLowerCase();
  return (doc.notebooks || []).find((b) => String(b.name).toLowerCase() === k) || null;
}
function ensureNotebook(doc, name, color = '#8a8f98') {
  const ex = findNotebook(doc, name); if (ex) return ex;
  const b = { id: uid(), name: String(name).slice(0, 40), color, order: Date.now() }; list(doc, 'notebooks').push(b); return b;
}

/* ---------------- 工具 ---------------- */
const S = (props, req = []) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const str = (d) => ({ type: 'string', description: d });
const TOOLS = [
  { name: 'get_overview', title: 'Today at a glance', readOnly: true,
    description: "Get the user's day in SealoNote: today's priorities, to-dos due today or overdue, the timeline (time blocks and checkpoints) and countdowns. Use this first to understand what the user's day looks like. Dates are in the user's own time zone.",
    inputSchema: S({ date: str('Optional day to look at, YYYY-MM-DD. Defaults to today.') }) },
  { name: 'list_todos', title: 'List to-dos', readOnly: true,
    description: 'List to-dos. status: open (not done), today (due today or overdue), overdue, upcoming (due after today), done (recently completed). Optional text query filters by title, tag or note.',
    inputSchema: S({ status: { type: 'string', enum: ['open', 'today', 'overdue', 'upcoming', 'done'] }, query: str('Optional text to match'), limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
  { name: 'add_todo', title: 'Add a to-do',
    description: 'Create a to-do. Priority: 0 urgent, 1 high, 2 normal (default), 3 low. Steps are optional sub-tasks with minutes. Set focus=true to make it one of today\'s priorities (max 3). If a time is given for today or later, a matching time block is added to the timeline unless schedule=false.',
    inputSchema: S({ title: str('What to do'), due: str('YYYY-MM-DD'), time: str('HH:MM, 24-hour'), priority: { type: 'integer', minimum: 0, maximum: 3 }, tags: { type: 'array', items: { type: 'string' } }, note: str('Optional note'), steps: { type: 'array', items: S({ title: { type: 'string' }, minutes: { type: 'integer', minimum: 5, maximum: 180 } }, ['title']) }, focus: { type: 'boolean' }, schedule: { type: 'boolean' } }, ['title']) },
  { name: 'update_todo', title: 'Update a to-do',
    description: 'Change an existing to-do by id (from list_todos or get_overview): rename, reschedule (due/time), change priority or note, mark done or not done, add steps, or tick a step done by step id. Only the fields you pass change.',
    inputSchema: S({ id: str('To-do id'), title: { type: 'string' }, due: str('YYYY-MM-DD, or empty string to clear'), time: str('HH:MM, or empty string to clear'), priority: { type: 'integer', minimum: 0, maximum: 3 }, note: { type: 'string' }, done: { type: 'boolean' }, focus: { type: 'boolean' }, add_steps: { type: 'array', items: S({ title: { type: 'string' }, minutes: { type: 'integer', minimum: 5, maximum: 180 } }, ['title']) }, step_done: str('Id of a step to mark done') }, ['id']) },
  { name: 'schedule_block', title: 'Put a time block on the timeline',
    description: `Add a time block to the user's timeline. kind is one of: ${BLOCK_KINDS.map((k) => k.v).join(', ')} (default focus). Link it to a to-do with todo_id; the to-do's date and time then follow the block. Use kind=checkpoint with start=end for a checkpoint (a goal to check at that moment).`,
    inputSchema: S({ title: str('What the time is for'), date: str('YYYY-MM-DD'), start: str('HH:MM'), end: str('HH:MM'), kind: { type: 'string', enum: [...BLOCK_KINDS.map((k) => k.v), 'checkpoint'] }, todo_id: str('Optional to-do id'), note: { type: 'string' } }, ['title', 'date', 'start']) },
  { name: 'search_notes', title: 'Search notes', readOnly: true,
    description: 'Find note pages by text in the title or body. Returns ids, titles, notebook and a short snippet. Use read_note for the full text.',
    inputSchema: S({ query: str('Text to look for. Empty lists the most recently edited pages.'), notebook: str('Optional notebook name'), limit: { type: 'integer', minimum: 1, maximum: 50 } }) },
  { name: 'read_note', title: 'Read a note', readOnly: true,
    description: 'Read one note page as Markdown by id.', inputSchema: S({ id: str('Note id') }, ['id']) },
  { name: 'create_note', title: 'Create a note',
    description: 'Create a note page from Markdown (headings, lists, - [ ] to-dos, tables, quotes, code). Put it in a notebook by name (created if missing); defaults to the inbox.',
    inputSchema: S({ title: { type: 'string' }, markdown: str('Page content in Markdown'), notebook: str('Notebook name'), tags: { type: 'array', items: { type: 'string' } } }, ['title']) },
  { name: 'append_to_note', title: 'Add to a note',
    description: 'Append Markdown to the end of an existing note page (by id). Existing content and formatting are kept.',
    inputSchema: S({ id: str('Note id'), markdown: str('Markdown to add') }, ['id', 'markdown']) },
  { name: 'add_sticky_note', title: 'Add a sticky note',
    description: 'Put a sticky note on the user\'s sticky board (shown in the desktop sticky window). Colors: yellow, pink, blue, green, purple, gray.',
    inputSchema: S({ text: str('Sticky note text (first line becomes the title)'), color: { type: 'string', enum: ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'] } }, ['text']) },
  { name: 'list_notebooks', title: 'List notebooks', readOnly: true,
    description: 'List the user\'s notebooks with page counts.', inputSchema: S({}) },
];

const OUT = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }], structuredContent: typeof data === 'string' ? undefined : data });
const FAIL = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

async function callTool(name, a, ctx) {
  a = a && typeof a === 'object' ? a : {};
  const { uid: u } = ctx;
  if (['get_overview', 'list_todos', 'search_notes', 'read_note', 'list_notebooks'].includes(name)) {
    const cur = await db.read(u); if (!cur) return FAIL('这个账号在云端还没有数据：先在 SealoNote 里登录并同步一次。');
    const doc = cur.doc; const tz = (doc.settings || {}).tz; const today = todayIn(tz);
    const todos = list(doc, 'todos');
    if (name === 'get_overview') {
      const d = DATE.test(a.date || '') ? a.date : today;
      const focus = todos.filter((t) => t.focus === d).map((t) => todoOut(t, today));
      const due = todos.filter((t) => !t.done && t.due && (d === today ? t.due <= today : t.due === d) && t.focus !== d).sort((x, y) => pri(x.priority) - pri(y.priority) || String(x.time || '99').localeCompare(String(y.time || '99'))).map((t) => todoOut(t, today));
      const timeline = list(doc, 'blocks').filter((b) => b.date === d && !b.pomo).sort((x, y) => String(x.start).localeCompare(String(y.start))).map(blockOut);
      const cds = ((doc.settings || {}).countdowns || []).slice(0, 5).map((c) => { const diff = Math.round((Date.parse(c.date) - Date.parse(today)) / 864e5); return { title: c.title, date: c.date, mode: c.mode === 'up' ? 'count-up' : 'countdown', days: c.mode === 'up' ? -diff + 1 : diff, category: c.cat || undefined }; });
      return OUT({ date: d, today, now: nowHM(tz), time_zone: tz || 'Asia/Shanghai (default)', priorities: focus, todos_due: due, timeline, countdowns: cds });
    }
    if (name === 'list_todos') {
      const st = a.status || 'open'; const q = String(a.query || '').toLowerCase(); const lim = Math.min(100, a.limit || 30);
      let xs = todos.filter((t) => (st === 'done' ? t.done : !t.done));
      if (st === 'today') xs = xs.filter((t) => t.due && t.due <= today);
      if (st === 'overdue') xs = xs.filter((t) => t.due && t.due < today);
      if (st === 'upcoming') xs = xs.filter((t) => t.due && t.due > today);
      if (q) xs = xs.filter((t) => [t.title, t.note, ...(t.tags || [])].join(' ').toLowerCase().includes(q));
      xs.sort(st === 'done' ? (x, y) => String(y.completedAt || '').localeCompare(String(x.completedAt || '')) : (x, y) => String(x.due || '9999').localeCompare(String(y.due || '9999')) || pri(x.priority) - pri(y.priority));
      return OUT({ today, count: xs.length, todos: xs.slice(0, lim).map((t) => todoOut(t, today)) });
    }
    if (name === 'search_notes') {
      const q = String(a.query || '').trim().toLowerCase(); const nb = a.notebook ? findNotebook(doc, a.notebook) : null; const lim = Math.min(50, a.limit || 15);
      let xs = list(doc, 'notes').filter((n) => !nb || n.nb === nb.id);
      if (q) xs = xs.filter((n) => (noteTitle(n) + '\n' + (n.body || '')).toLowerCase().includes(q));
      xs = xs.sort((x, y) => String(y.updated || '').localeCompare(String(x.updated || ''))).slice(0, lim);
      return OUT({ count: xs.length, notes: xs.map((n) => { const body = String(n.body || ''); const i = q ? body.toLowerCase().indexOf(q) : 0; return { id: n.id, title: noteTitle(n), notebook: nbName(doc, n.nb), updated: n.updated, sticky: n.sticky ? true : undefined, snippet: body.slice(Math.max(0, i - 40), Math.max(0, i - 40) + 200).replace(/\s+/g, ' ').trim() }; }) });
    }
    if (name === 'read_note') {
      const n = list(doc, 'notes').find((x) => x.id === a.id); if (!n) return FAIL('找不到这页笔记（id 不对，或者已经删掉了）。');
      return OUT(`# ${noteTitle(n)}\n\n_Notebook: ${nbName(doc, n.nb) || 'Inbox'} · updated ${n.updated || ''} · id ${n.id}_\n\n${n.body || ''}`);
    }
    if (name === 'list_notebooks') {
      const notes = list(doc, 'notes');
      return OUT({ notebooks: (doc.notebooks || []).map((b) => ({ id: b.id, name: b.name, pages: notes.filter((n) => n.nb === b.id).length })) });
    }
  }

  // 下面都会改数据
  if (name === 'add_todo') {
    const title = String(a.title || '').trim().slice(0, 200); if (!title) return FAIL('title 不能为空');
    if (a.due && !DATE.test(a.due)) return FAIL('due 要写成 YYYY-MM-DD'); if (a.time && !TIME.test(a.time)) return FAIL('time 要写成 HH:MM（24 小时制）');
    return mutate(u, (doc) => {
      const tz = (doc.settings || {}).tz; const today = todayIn(tz);
      const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 20).map((s) => ({ id: uid(), title: String(s.title || '').slice(0, 120), minutes: Math.max(5, Math.min(180, s.minutes || 25)), done: false, kind: '' })).filter((s) => s.title);
      const due = a.due || (a.time || a.focus ? today : '');
      const t = { id: uid(), title, done: false, priority: pri(a.priority), due, time: a.time || '', tags: (a.tags || []).map(String).slice(0, 8), area: '', note: String(a.note || ''), created: today, updated: iso(), ...(steps.length ? { steps } : {}), src: { kind: 'mcp', title: 'Claude' } };
      if (a.focus) { if (list(doc, 'todos').filter((x) => x.focus === due && !x.done).length >= 3) throw new Error('今天的焦点已经有 3 件了，先完成或移出一件'); t.focus = due; t.focusAt = iso(); }
      list(doc, 'todos').push(t);
      let block = null;
      if (t.time && t.due >= today && a.schedule !== false) {
        const len = steps.length ? steps.reduce((n, s) => n + s.minutes, 0) : 60; const [h, m] = t.time.split(':').map(Number); const e = Math.min(23 * 60 + 59, h * 60 + m + len);
        block = { id: uid(), date: t.due, start: t.time, end: `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`, title, kind: 'focus', note: '', todoId: t.id };
        list(doc, 'blocks').push(block);
      }
      return OUT({ created: todoOut(t, today), time_block: block ? blockOut(block) : null });
    });
  }
  if (name === 'update_todo') {
    if (a.due && !DATE.test(a.due)) return FAIL('due 要写成 YYYY-MM-DD'); if (a.time && !TIME.test(a.time)) return FAIL('time 要写成 HH:MM');
    return mutate(u, (doc) => {
      const today = todayIn((doc.settings || {}).tz);
      const t = list(doc, 'todos').find((x) => x.id === a.id); if (!t) throw new Error('找不到这件待办（id 不对，或者已经删掉了）');
      if (typeof a.title === 'string' && a.title.trim()) t.title = a.title.trim().slice(0, 200);
      if (a.due !== undefined) t.due = a.due || ''; if (a.time !== undefined) t.time = a.time || '';
      if (a.priority !== undefined) t.priority = pri(a.priority); if (typeof a.note === 'string') t.note = a.note;
      if (a.done !== undefined) { t.done = !!a.done; t.completedAt = a.done ? today : null; }
      if (a.focus === true) { if (list(doc, 'todos').filter((x) => x.focus === today && !x.done && x.id !== t.id).length >= 3) throw new Error('今天的焦点已经有 3 件了'); t.focus = today; t.focusAt = iso(); if (!t.due || t.due > today) t.due = today; }
      if (a.focus === false) { t.focus = ''; t.focusAt = ''; }
      if (Array.isArray(a.add_steps)) t.steps = [...(t.steps || []), ...a.add_steps.slice(0, 20).map((s) => ({ id: uid(), title: String(s.title || '').slice(0, 120), minutes: Math.max(5, Math.min(180, s.minutes || 25)), done: false, kind: '' })).filter((s) => s.title)];
      if (a.step_done) { const s = (t.steps || []).find((x) => x.id === a.step_done); if (!s) throw new Error('这件待办里没有这个步骤 id'); s.done = true; }
      t.updated = iso();
      return OUT({ updated: todoOut(t, today) });
    });
  }
  if (name === 'schedule_block') {
    if (!DATE.test(a.date || '')) return FAIL('date 要写成 YYYY-MM-DD'); if (!TIME.test(a.start || '')) return FAIL('start 要写成 HH:MM');
    const check = a.kind === 'checkpoint'; const end = check ? a.start : a.end;
    if (!TIME.test(end || '') || (!check && end <= a.start)) return FAIL('end 要写成 HH:MM，并且晚于 start');
    return mutate(u, (doc) => {
      const b = { id: uid(), date: a.date, start: a.start, end, title: String(a.title || '').trim().slice(0, 120) || '时间块', kind: check ? 'check' : a.kind || 'focus', note: String(a.note || ''), ...(check ? { status: '' } : {}) };
      if (a.todo_id) { const t = list(doc, 'todos').find((x) => x.id === a.todo_id); if (!t) throw new Error('找不到 todo_id 对应的待办'); b.todoId = t.id; t.due = a.date; t.time = a.start; t.updated = iso(); }
      list(doc, 'blocks').push(b);
      return OUT({ scheduled: blockOut(b) });
    });
  }
  if (name === 'create_note') {
    const title = String(a.title || '').trim().slice(0, 120); if (!title) return FAIL('title 不能为空');
    const md = String(a.markdown || '').slice(0, 200000);
    return mutate(u, (doc) => {
      const nb = a.notebook ? ensureNotebook(doc, a.notebook) : ensureNotebook(doc, (doc.notebooks || []).find((b) => b.id === 'nb-inbox') ? (doc.notebooks.find((b) => b.id === 'nb-inbox').name) : '收件箱');
      const today = todayIn((doc.settings || {}).tz);
      const n = { id: uid(), title, body: md, blocks: mdToBlocks(md), tags: (a.tags || []).map(String).slice(0, 8), parent: null, nb: nb.id, order: Date.now(), pinned: false, icon: '', created: today, updated: iso() };
      list(doc, 'notes').push(n);
      return OUT({ created: { id: n.id, title, notebook: nb.name } });
    });
  }
  if (name === 'append_to_note') {
    const md = String(a.markdown || '').slice(0, 200000); if (!md.trim()) return FAIL('markdown 不能为空');
    return mutate(u, (doc) => {
      const n = list(doc, 'notes').find((x) => x.id === a.id); if (!n) throw new Error('找不到这页笔记');
      n.body = (n.body ? n.body.replace(/\s+$/, '') + '\n\n' : '') + md;
      if (Array.isArray(n.blocks) && n.blocks.length) n.blocks = [...n.blocks, ...mdToBlocks(md)]; else n.blocks = mdToBlocks(n.body);
      n.updated = iso();
      return OUT({ appended_to: { id: n.id, title: noteTitle(n) } });
    });
  }
  if (name === 'add_sticky_note') {
    const text = String(a.text || '').trim().slice(0, 20000); if (!text) return FAIL('text 不能为空');
    return mutate(u, (doc) => {
      const nb = ensureNotebook(doc, '便利贴', '#c7873a'); const today = todayIn((doc.settings || {}).tz);
      const first = text.split('\n').map((l) => l.replace(/^[#>\-*\s\d.)[\]x]+/, '').trim()).find(Boolean) || '';
      const n = { id: uid(), title: first.slice(0, 40), body: text, blocks: mdToBlocks(text), tags: [], parent: null, nb: nb.id, order: Date.now(), pinned: false, icon: '', created: today, updated: iso(), sticky: a.color || 'yellow', stickyAt: iso() };
      list(doc, 'notes').push(n);
      return OUT({ sticky_note: { id: n.id, title: n.title, color: n.sticky } });
    });
  }
  return FAIL('没有这个工具：' + name);
}

/* ---------------- MCP（JSON-RPC）---------------- */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = 'SealoNote is the user\'s personal planner and notebook. Call get_overview first to see their day. Dates are YYYY-MM-DD and times HH:MM in the user\'s own time zone (get_overview returns today and the time zone). Ask before large changes. There are no delete tools on purpose. Write titles in the language the user uses.';
async function rpc(msg, ctx) {
  const { id, method, params } = msg || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return error(-32600, 'Invalid Request');
  if (method.startsWith('notifications/')) return null;
  switch (method) {
    case 'initialize': {
      const want = params && params.protocolVersion;
      return reply({ protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sealonote', title: 'SealoNote', version: '1.0.0' }, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, idempotentHint: !!t.readOnly, openWorldHint: false } })) });
    case 'tools/call': {
      const name = params && params.name; if (!TOOLS.some((t) => t.name === name)) return error(-32602, 'Unknown tool: ' + name);
      try { return reply(await callTool(name, params.arguments, ctx)); } catch (e) { return reply(FAIL(e && e.message ? e.message : '出错了')); }
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return error(-32601, 'Method not found: ' + method);
  }
}

/* ---------------- OAuth ---------------- */
async function currentEpoch(u) { try { const cur = await db.read(u); return Number(((cur && cur.doc && cur.doc.settings) || {}).mcpEpoch || 0); } catch { return 0; } }
async function bearer(req) {
  const h = String(req.headers.authorization || ''); const m = h.match(/^Bearer\s+(.+)$/i); if (!m) return null;
  const tok = m[1].trim(); if (!tok.startsWith('sn_at.')) return null;
  const t = await open(tok.slice(6)); if (!t || t.typ !== 'at' || !t.uid || t.exp < nowS()) return null;
  return t;
}
function unauthorized(req, res, why = 'invalid_token') {
  return send(res, 401, { error: why }, { 'WWW-Authenticate': `Bearer realm="sealonote", error="${why}", resource_metadata="${origin(req)}/.well-known/oauth-protected-resource"` });
}
const PAGE = (title, inner) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · SealoNote</title><link rel="icon" href="/assets/favicon.svg"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#1f1e1c;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(420px,calc(100vw - 32px));background:#fff;border-radius:20px;padding:32px 28px 26px;box-shadow:0 0 0 1px #e8e6e1,0 24px 60px -30px rgba(0,0,0,.25)}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px;margin-bottom:22px}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 14px;color:#5f5e5a}
ul{margin:0 0 20px;padding:0;list-style:none;display:grid;gap:8px}li{padding-left:22px;position:relative;color:#3a3936}li::before{content:"";position:absolute;left:3px;top:8px;width:9px;height:5px;border-left:2px solid #2383e2;border-bottom:2px solid #2383e2;transform:rotate(-45deg)}
.who{padding:10px 12px;border-radius:12px;background:#f6f5f2;font-size:14px;margin-bottom:18px}.row{display:flex;gap:10px}.btn{flex:1;display:inline-flex;justify-content:center;align-items:center;height:44px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px}
.ok{background:#1f1e1c;color:#fff}.no{background:#fff;color:#1f1e1c;box-shadow:inset 0 0 0 1px #d8d6d1}small{display:block;margin-top:16px;color:#8e8d88;font-size:12px}
@media (prefers-color-scheme:dark){body{background:#151619;color:#ecebe7}.card{background:#1d1f23;box-shadow:0 0 0 1px #2c2e33}p,li{color:#b5b4af}.who{background:#25272c}.ok{background:#ecebe7;color:#151619}.no{background:transparent;color:#ecebe7;box-shadow:inset 0 0 0 1px #3a3c42}}
</style></head><body><div class="card"><div class="logo"><img src="/assets/favicon.svg" width="30" height="30" alt="">SealoNote</div>${inner}</div></body></html>`;

async function oauth(route, req, res) {
  const base = origin(req);
  if (route === 'prm') return send(res, 200, { resource: base + '/mcp', authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: [SCOPE], resource_name: 'SealoNote', resource_documentation: base + '/home' });
  if (route === 'asm') return send(res, 200, { issuer: base, authorization_endpoint: base + '/oauth/authorize', token_endpoint: base + '/oauth/token', registration_endpoint: base + '/oauth/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: [SCOPE], service_documentation: base + '/home' });

  if (route === 'register') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    const b = await form(req); const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((x) => typeof x === 'string') : [];
    if (!uris.length || !uris.every(okRedirect)) return send(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https URLs' });
    const name = String(b.client_name || 'MCP client').slice(0, 60);
    const client_id = 'snc_' + await seal({ typ: 'client', ru: uris.slice(0, 5), n: name, iat: nowS() });
    return send(res, 201, { client_id, client_id_issued_at: nowS(), client_name: name, redirect_uris: uris.slice(0, 5), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE });
  }

  if (route === 'authorize' || route === 'approve') {
    const q = new URL(req.url, base).searchParams;
    if (route === 'approve') {
      const t = await open(q.get('t') || ''); const s = await session(req);
      if (!t || t.typ !== 'consent' || t.exp < nowS()) return send(res, 400, PAGE('授权已过期', '<h1>授权页已经过期</h1><p>回到 Claude 重新点一次「连接」就好。</p>'));
      if (!s || s.k !== 'sb' || s.uid !== t.uid) return send(res, 403, PAGE('需要登录', '<h1>登录状态变了</h1><p>请回到 Claude 重新点一次「连接」。</p>'));
      const back = new URL(t.ru);
      if (q.get('deny')) { back.searchParams.set('error', 'access_denied'); if (t.st) back.searchParams.set('state', t.st); return redirect(res, back.toString()); }
      const code = await seal({ typ: 'code', uid: t.uid, cid: t.cid, ru: t.ru, cc: t.cc, exp: nowS() + CODE_TTL });
      back.searchParams.set('code', code); if (t.st) back.searchParams.set('state', t.st);
      return redirect(res, back.toString());
    }
    const cid = q.get('client_id') || '', ru = q.get('redirect_uri') || '', cc = q.get('code_challenge') || '', st = q.get('state') || '';
    const client = cid.startsWith('snc_') ? await open(cid.slice(4)) : null;
    if (!client || client.typ !== 'client') return send(res, 400, PAGE('无效的请求', '<h1>这个连接请求无效</h1><p>客户端没有注册，或者注册信息被改过。请回到 Claude 重新添加连接器。</p>'));
    if (!client.ru.includes(ru)) return send(res, 400, PAGE('无效的请求', '<h1>回调地址不对</h1><p>请回到 Claude 重新添加连接器。</p>'));
    const err = (e) => { const u = new URL(ru); u.searchParams.set('error', e); if (st) u.searchParams.set('state', st); return redirect(res, u.toString()); };
    if (q.get('response_type') !== 'code') return err('unsupported_response_type');
    if (!cc || (q.get('code_challenge_method') || 'plain') !== 'S256') return err('invalid_request');
    if (!cloudOn()) return send(res, 503, PAGE('暂不可用', '<h1>云端账号还没开通</h1><p>这个网站还没有配置云端同步。</p>'));
    const s = await session(req);
    if (!s || s.k !== 'sb') {
      const here = base + req.url;
      return send(res, 200, PAGE('先登录', `<h1>先登录 SealoNote</h1><p><b>${esc(client.n)}</b> 想连接你的 SealoNote。先在这个浏览器里登录你的账号（用邮箱），登录好以后回到这一页点「我已经登录，继续」。</p>
<div class="row"><a class="btn ok" href="/#/settings?sec=sync" target="_blank" rel="noopener">去登录</a><a class="btn no" href="${esc(here)}">我已经登录，继续</a></div><small>登录只需要一次；以后 Claude 会自动续期。</small>`));
    }
    const t = await seal({ typ: 'consent', uid: s.uid, cid, ru, cc, st, exp: nowS() + 600 });
    const appr = base + '/oauth/approve?t=' + encodeURIComponent(t);
    return send(res, 200, PAGE('允许连接', `<h1>允许 ${esc(client.n)} 连接？</h1><p>连接以后，它可以在你让它做事的时候：</p>
<ul><li>查看你的待办、时间线、焦点、倒计时和笔记</li><li>新建和修改待办、排时间块</li><li>新建笔记、往笔记里加内容、贴便利贴</li></ul>
<div class="who">账号：${esc(s.email || '')}</div>
<div class="row"><a class="btn no" href="${esc(appr + '&deny=1')}">不允许</a><a class="btn ok" href="${esc(appr)}">允许</a></div>
<small>它不能删除任何东西。随时可以在 SealoNote 的「设置 → 汤圆 → 连接 Claude」里取消授权。</small>`));
  }

  if (route === 'token') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    const b = await form(req); const bad = (e, d) => send(res, 400, { error: e, error_description: d });
    let uidv, cid;
    if (b.grant_type === 'authorization_code') {
      const c = await open(String(b.code || '')); if (!c || c.typ !== 'code' || c.exp < nowS()) return bad('invalid_grant', 'code expired or invalid');
      if (b.redirect_uri && b.redirect_uri !== c.ru) return bad('invalid_grant', 'redirect_uri mismatch');
      if (b.client_id && b.client_id !== c.cid) return bad('invalid_grant', 'client mismatch');
      if (!b.code_verifier || await sha256(String(b.code_verifier)) !== c.cc) return bad('invalid_grant', 'PKCE verification failed');
      uidv = c.uid; cid = c.cid;
    } else if (b.grant_type === 'refresh_token') {
      const r = await open(String(b.refresh_token || '').replace(/^sn_rt\./, '')); if (!r || r.typ !== 'rt' || r.exp < nowS()) return bad('invalid_grant', 'refresh token expired');
      if (Number(r.ep || 0) !== await currentEpoch(r.uid)) return bad('invalid_grant', 'access was revoked');
      uidv = r.uid; cid = r.cid;
    } else return bad('unsupported_grant_type', 'use authorization_code or refresh_token');
    const ep = await currentEpoch(uidv);
    const access = 'sn_at.' + await seal({ typ: 'at', uid: uidv, cid, ep, exp: nowS() + AT_TTL });
    const refresh = 'sn_rt.' + await seal({ typ: 'rt', uid: uidv, cid, ep, exp: nowS() + RT_TTL });
    return send(res, 200, { access_token: access, token_type: 'Bearer', expires_in: AT_TTL, refresh_token: refresh, scope: SCOPE });
  }
  return send(res, 404, { error: 'not_found' });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, null, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  const url = new URL(req.url, 'https://x'); const route = url.searchParams.get('r') || '';
  try {
    if (route) return await oauth(route, req, res);
    // MCP 本体
    if (req.method === 'GET') return send(res, 405, { error: 'This MCP server only answers POST (no SSE stream).' }, { Allow: 'POST' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    const tok = await bearer(req); if (!tok) return unauthorized(req, res);
    if (Number(tok.ep || 0) !== await currentEpoch(tok.uid)) return unauthorized(req, res, 'invalid_token');
    let msg; try { msg = JSON.parse((await readBody(req, 1e6)).toString('utf8')); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const ctx = { uid: tok.uid };
    if (Array.isArray(msg)) { const out = (await Promise.all(msg.map((m) => rpc(m, ctx)))).filter(Boolean); return out.length ? send(res, 200, out) : send(res, 202, null); }
    const out = await rpc(msg, ctx);
    return out ? send(res, 200, out) : send(res, 202, null);
  } catch (e) {
    return send(res, 500, { error: 'server_error', error_description: e && e.message });
  }
}
