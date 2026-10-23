// Single-document state. Everything lives in one object persisted to localStorage;
// views subscribe through useStore() and mutate through update().
import { useEffect, useReducer } from '../vendor/preact.js';
import { debounce, todayStr } from './util.js';
import { mdToBlocks } from './blocks.js';

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
    focus: {},
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

function migrate(s) {
  const b = blank();
  const out = { ...b, ...s };
  for (const k of Object.keys(b)) if (out[k] == null) out[k] = b[k];
  out.vision = { ...b.vision, ...(s.vision || {}) };
  out.settings = { ...b.settings, ...(s.settings || {}) };
  out.settings.sync = { ...b.settings.sync, ...((s.settings || {}).sync || {}) };
  out.profile = { ...b.profile, ...(s.profile || {}) };
  out.notes = (out.notes || []).map((n, i) => { const x = { parent: null, order: i, icon: '', pinned: false, tags: [], cover: '', font: 'default', wide: false, nb: null, ...n }; if (!x.blocks || !x.blocks.length) x.blocks = mdToBlocks(x.body || ''); return x; });
  out.notebooks = out.notebooks || [];
  out.focus = out.focus || {};
  out.canvases = (out.canvases || []).map((c) => ({ nodes: [], edges: [], strokes: [], ...c }));
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

let state = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('state load failed', e);
  }
  return blank();
})();

function flush() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('persist failed', e);
  }
}
const persist = debounce(flush, 250);
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

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
  state = migrate(next);
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
  return JSON.stringify(state, null, 2);
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
  const next = i >= 0 ? list.map((x, j) => (j === i ? { ...x, ...item } : x)) : [item, ...list];
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
