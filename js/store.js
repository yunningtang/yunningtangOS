// Single-document state. Everything lives in one object persisted to localStorage;
// views subscribe through useStore() and mutate through update().
import { useEffect, useReducer } from '../vendor/preact.js';
import { debounce, todayStr } from './util.js';
import { mdToBlocks, sanitizeBlocks, sanitize } from './blocks.js';
import { merge3 } from './merge.js';

const KEY = 'ytos.v1';
const subs = new Set();

export function blank() {
  return {
    v: 1,
    profile: { name: 'Riley', motto: '保持好奇，探索世界', avatar: '' },
    todos: [],
    blocks: [],
    weeks: {},
    goals: {},
    sessions: [],
    books: [],
    links: [],
    notes: [],
    notebooks: [],
    trash: [],
    vision: { statements: [], board: [], areas: [], longterm: [] },
    trips: [],
    canvases: [],
    settings: { theme: 'auto', sync: { repo: '', branch: 'main', path: 'data/os.json', token: '' }, lastSync: null, seeded: false },
    updatedAt: null,
  };
}

const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 0; };
function migrate(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  const b = blank();
  const out = { ...b, ...s };
  for (const k of Object.keys(b)) if (out[k] == null) out[k] = b[k];
  // 列表字段必须是数组，里面必须是对象（手改过 / 写坏的 JSON 不能让整份文档加载失败）
  for (const k of ['todos', 'blocks', 'books', 'links', 'notes', 'notebooks', 'trash', 'trips', 'canvases', 'sessions']) out[k] = (Array.isArray(out[k]) ? out[k] : []).filter((x) => x && typeof x === 'object');
  if (!out.goals || typeof out.goals !== 'object') out.goals = {}; if (!out.weeks || typeof out.weeks !== 'object') out.weeks = {};
  // 每条记录的基本字段类型（视图里直接 .map / .includes，缺了会整页白掉）
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  out.todos = out.todos.map((t) => ({ ...t, id: String(t.id || 'b' + Math.random().toString(36).slice(2, 10)), title: String(t.title ?? ''), done: !!t.done, priority: Number.isInteger(t.priority) ? Math.max(0, Math.min(3, t.priority)) : 2, tags: arr(t.tags), due: typeof t.due === 'string' ? t.due : '', time: typeof t.time === 'string' ? t.time : '', steps: Array.isArray(t.steps) ? t.steps.filter((x) => x && typeof x === 'object') : t.steps }));
  for (const k of ['books', 'links', 'trips']) out[k] = out[k].map((x) => ({ ...x, tags: arr(x.tags) }));
  out.blocks = out.blocks.filter((b) => typeof b.start === 'string' && typeof b.end === 'string' || b.pomo);
  out.vision = { ...b.vision, ...(s.vision || {}) };
  out.settings = { ...b.settings, ...(s.settings || {}) };
  out.settings.sync = { ...b.settings.sync, ...((s.settings || {}).sync || {}) };
  out.profile = { ...b.profile, ...(s.profile || {}) };
  out.notes = (out.notes || []).map((n, i) => { const x = { parent: null, order: i, icon: '', pinned: false, tags: [], cover: '', font: 'default', wide: false, nb: null, ...n }; if (!Array.isArray(x.tags)) x.tags = []; if (typeof x.title !== 'string') x.title = String(x.title ?? ''); if (Array.isArray(x.blocks)) x.blocks = sanitizeBlocks(x.blocks); if (!x.blocks || !x.blocks.length) x.blocks = mdToBlocks(x.body || ''); return x; });
  out.notebooks = out.notebooks || [];
  out.sessions = out.sessions || [];
  // pomodoro records used to be timeline blocks (pomo: true); move them into sessions
  const moved = (out.blocks || []).filter((b) => b.pomo || (b.kind === 'focus' && typeof b.note === 'string' && b.note.startsWith('todo:')));
  if (moved.length) { moved.forEach((b) => { if (!out.sessions.some((x) => x.id === b.id)) out.sessions.push({ id: b.id, date: b.date, start: b.start, end: b.end, mins: Math.max(1, toMin(b.end) - toMin(b.start)), title: b.title || '专注', todo: (b.note || '').startsWith('todo:') ? b.note.slice(5) : '', note: '', updated: new Date().toISOString() }); }); out.blocks = out.blocks.filter((b) => !b.pomo); }
  out.canvases = (out.canvases || []).map((c) => { const x = { nodes: [], edges: [], strokes: [], ...c }; x.nodes = (Array.isArray(x.nodes) ? x.nodes : []).filter((n) => n && typeof n === 'object').map((n) => (typeof n.html === 'string' && /[<&]/.test(n.html) ? { ...n, html: sanitize(n.html) } : n)); x.edges = Array.isArray(x.edges) ? x.edges : []; x.strokes = (Array.isArray(x.strokes) ? x.strokes : []).filter((st) => st && Array.isArray(st.pts)); return x; });
  out.trash = out.trash.map((n) => (Array.isArray(n.blocks) ? { ...n, blocks: sanitizeBlocks(n.blocks), tags: Array.isArray(n.tags) ? n.tags : [] } : n));
  // 拆解出来的步骤以前写在待办的关联页面里；现在挂在待办自己身上（t.steps），页面里的那段搬过来
  for (const t of out.todos || []) {
    if (Array.isArray(t.steps)) continue;
    const page = out.notes.find((n) => n.ref === 'todo:' + t.id);
    const blocks = page && page.blocks ? page.blocks.filter((b) => b.type === 'todo') : [];
    if (!blocks.length) { t.steps = []; continue; } // 标记已迁移，别每次加载都来一遍
    t.steps = blocks.map((b) => { const text = String(b.html || '').replace(/<[^>]+>/g, '').trim(); const m = text.match(/^(.*?)\s*[（(]\s*(\d{1,3})\s*分(?:钟)?\s*[)）]\s*$/); return { id: b.id, title: m ? m[1].trim() : text, minutes: m ? Math.max(5, Math.min(180, +m[2])) : 25, kind: '', done: !!b.checked }; }).filter((x) => x.title);
    page.blocks = page.blocks.filter((b) => b.type !== 'todo' && !(b.type === 'h2' && /步骤/.test(b.html || '')));
    if (!page.blocks.length) page.blocks = [{ id: 'b' + Math.random().toString(36).slice(2, 8), type: 'p', html: '' }];
  }
  const cutoff = Date.now() - 30 * 86400000;
  out.trash = (out.trash || []).filter((n) => !n.deletedAt || new Date(n.deletedAt).getTime() > cutoff);
  // Migration to notebooks: top-level pages that have children become notebooks; loose pages go to 收件箱.
  if (!out.notebooks.length && out.notes.length) {
    const byId = new Map(out.notes.map((n) => [n.id, n]));
    const hasKids = new Set(out.notes.filter((n) => n.parent).map((n) => n.parent));
    const rootOf = (n) => { let c = n, guard = 0; while (c.parent && byId.has(c.parent) && guard++ < 50) c = byId.get(c.parent); return c; };
    const colors = ['#4f7cf5', '#7461c9', '#2d8f88', '#c9588a', '#c7873a', '#4a9a6a'];
    const inbox = { id: 'nb-inbox', name: '收件箱', color: '#8a8f98', order: 0 };
    out.notebooks.push(inbox);
    let ci = 0;
    out.notes.filter((n) => !n.parent && hasKids.has(n.id)).forEach((root) => {
      const nb = { id: 'nb-' + root.id, name: root.title || '未命名本子', color: colors[ci++ % colors.length], order: out.notebooks.length };
      out.notebooks.push(nb);
      root.nb = nb.id; root.isCover = true;
    });
    out.notes.forEach((n) => { const r = rootOf(n); n.nb = r.nb || inbox.id; if (r.isCover && n.id !== r.id && n.parent === r.id) n.parent = null; });
    out.notes.forEach((n) => { if (n.isCover) { if (!(n.body || '').trim()) n._drop = true; else n.title = n.title || '概览'; delete n.isCover; } });
    out.notes = out.notes.filter((n) => !n._drop);
  }
  return out;
}

// 载入失败不能悄悄变成空白文档再把真数据覆盖掉：把原文另存一份、禁止写回、让界面提示
export let loadError = '';
let lastSeen = null; // 这个标签页最后一次读到 / 写入 localStorage 的原文，用来发现别的标签页写过
let state = (() => {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) { const st = migrate(JSON.parse(raw)); lastSeen = raw; return st; }
  } catch (e) {
    console.warn('state load failed', e);
    loadError = e && e.message ? e.message : String(e);
    try { localStorage.setItem(KEY + '.broken-' + Date.now(), raw || ''); } catch {}
    const b = blank(); b.settings.seeded = true; return b; // 不播种，也不写回（见 flush）
  }
  return blank();
})();

export let persistError = '';
const signal = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {} };
function flush() {
  if (loadError) return; // 载入失败的那份原文还在 localStorage 里，不能覆盖
  try {
    // 别的标签页写过了：三方合并（我上次看到的 / 我现在的 / 它写的），不要整份覆盖
    const cur = localStorage.getItem(KEY);
    if (cur && lastSeen !== null && cur !== lastSeen) { try { state = migrate(merge3(JSON.parse(lastSeen), state, JSON.parse(cur))); subs.forEach((f) => f()); } catch (e) { console.warn('cross-tab merge failed', e); } }
    const json = JSON.stringify(state);
    localStorage.setItem(KEY, json); lastSeen = json;
    if (persistError) { persistError = ''; signal('ytos:persist-ok'); }
  } catch (e) {
    console.warn('persist failed', e);
    if (!persistError) { persistError = e && e.name === 'QuotaExceededError' ? 'quota' : (e && e.message) || 'error'; signal('ytos:persist-error', persistError); }
  }
}
const persist = debounce(flush, 250);
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
// 别的标签页写了 localStorage：把它的改动合进来（而不是等自己下次写时覆盖掉）
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue || e.newValue === lastSeen || loadError) return;
  try {
    const incoming = JSON.parse(e.newValue);
    const mine = JSON.stringify(state);
    state = migrate(lastSeen && mine !== lastSeen ? merge3(JSON.parse(lastSeen), state, incoming) : incoming);
    lastSeen = e.newValue; subs.forEach((f) => f());
  } catch (err) { console.warn('cross-tab merge failed', err); }
});

export function get() {
  return state;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function update(fn) {
  const draft = structuredClone(state);
  const r = fn(draft);
  state = r === undefined ? draft : r;
  state.updatedAt = new Date().toISOString();
  persist();
  subs.forEach((f) => f());
}

export function replace(next) {
  const keepToken = state && state.settings && state.settings.sync && state.settings.sync.token;
  state = migrate(next);
  if (keepToken && !(state.settings.sync && state.settings.sync.token)) state.settings.sync.token = keepToken;
  state.updatedAt = new Date().toISOString();
  persist();
  subs.forEach((f) => f());
}

export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    subs.add(force);
    return () => subs.delete(force);
  }, []);
  return state;
}

export function exportJSON() {
  // 导出 / 同步的文档里不带本机的 GitHub token
  const { settings, ...rest } = state;
  const { sync, ...sRest } = settings || {};
  return JSON.stringify({ ...rest, settings: { ...sRest, sync: { ...(sync || {}), token: '' } } }, null, 2);
}

// Convenience mutators used by several views.
export function listOf(s, name) {
  return s[name];
}

// Hot paths avoid cloning the whole document: only the touched collection is copied.
function commit(next) {
  state = { ...next, updatedAt: new Date().toISOString() };
  persist();
  subs.forEach((f) => f());
}

export function upsert(name, item) {
  const list = state[name];
  const i = list.findIndex((x) => x.id === item.id);
  // 改了才盖时间戳：同步合并冲突时「谁更新谁赢」要靠它
  const stamp = new Date().toISOString();
  const next = i >= 0 ? list.map((x, j) => { if (j !== i) return x; const merged = { ...x, ...item }; return JSON.stringify(merged) === JSON.stringify(x) ? x : { ...merged, updated: item.updated || stamp }; }) : [{ updated: stamp, ...item }, ...list];
  commit({ ...state, [name]: next });
}

export function remove(name, id) {
  commit({ ...state, [name]: state[name].filter((x) => x.id !== id) });
}

// Remove and offer undo via toast; restores at the original index.
export function removeUndo(name, id, label) {
  const i = state[name].findIndex((x) => x.id === id);
  if (i < 0) return;
  const item = state[name][i];
  remove(name, id);
  import('./nav.js').then(({ toast }) => toast(`已删除${label ? '「' + String(label).slice(0, 24) + '」' : ''}`, { label: '撤销', onClick: () => commit({ ...state, [name]: [...state[name].slice(0, i), item, ...state[name].slice(i)] }) }));
}

export function toggleTodo(id) {
  const t = state.todos.find((x) => x.id === id);
  if (!t) return;
  const done = !t.done;
  commit({ ...state, todos: state.todos.map((x) => (x.id === id ? { ...x, done, completedAt: done ? todayStr() : null } : x)) });
}

// ---- 标签：跨所有集合重命名 / 删除 ----
const TAGGED = ['todos', 'notes', 'books', 'links', 'trips'];
export function renameTag(from, to) {
  const a = String(from).trim(), b = String(to).trim().replace(/^#/, '');
  if (!a || !b || a === b) return 0;
  let n = 0;
  update((d) => { for (const k of TAGGED) for (const it of d[k] || []) if (Array.isArray(it.tags) && it.tags.includes(a)) { it.tags = [...new Set(it.tags.map((t) => (t === a ? b : t)))]; it.updated = new Date().toISOString(); n++; } });
  return n;
}
export function removeTag(name) {
  const a = String(name).trim(); let n = 0;
  update((d) => { for (const k of TAGGED) for (const it of d[k] || []) if (Array.isArray(it.tags) && it.tags.includes(a)) { it.tags = it.tags.filter((t) => t !== a); it.updated = new Date().toISOString(); n++; } });
  return n;
}
export function countTag(name) {
  const a = String(name).trim(); const st = get(); let n = 0;
  for (const k of TAGGED) for (const it of st[k] || []) if (Array.isArray(it.tags) && it.tags.includes(a)) n++;
  return n;
}
