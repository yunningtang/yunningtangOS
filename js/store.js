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
    books: [],
    links: [],
    notes: [],
    vision: { statements: [], board: [], areas: [], longterm: [] },
    trips: [],
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
  out.notes = (out.notes || []).map((n, i) => { const x = { parent: null, order: i, icon: '', pinned: false, tags: [], cover: '', font: 'default', wide: false, ...n }; if (!x.blocks || !x.blocks.length) x.blocks = mdToBlocks(x.body || ''); return x; });
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

export function upsert(name, item) {
  update((s) => {
    const i = s[name].findIndex((x) => x.id === item.id);
    if (i >= 0) s[name][i] = { ...s[name][i], ...item };
    else s[name].unshift(item);
  });
}

export function remove(name, id) {
  update((s) => {
    s[name] = s[name].filter((x) => x.id !== id);
  });
}

export function toggleTodo(id) {
  update((s) => {
    const t = s.todos.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? todayStr() : null;
  });
}
