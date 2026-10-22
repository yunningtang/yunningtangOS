// Sync the whole state document to a JSON file in a GitHub repo.
// Two transports:
//  - "login": the site runs on Vercel with /api/* functions; you sign in with GitHub and the
//    token stays in an encrypted httpOnly cookie, the browser only talks to /api/sync.
//  - "token": static hosting (GitHub Pages etc.); a fine-grained token pasted in Settings.
import { get, replace, update, exportJSON } from './store.js';
import { debounce } from './util.js';

const API = 'https://api.github.com';
let api = null; // { configured, user, target } or null when /api is unavailable

export async function detectLogin() {
  try {
    const r = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) { api = null; return null; }
    api = await r.json();
    return api;
  } catch { api = null; return null; }
}
export function loginState() { return api; }
export function loggedIn() { return !!(api && api.user); }

/* ---- transports ---- */
const viaApi = {
  async pull() {
    const r = await fetch('/api/sync', { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j.data ? { sha: j.sha, data: j.data } : null;
  },
  async push(content, sha) {
    const r = await fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, sha }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  },
};
function cfg() {
  const c = get().settings.sync;
  if (!c.repo || !c.token) throw new Error('请先登录 GitHub，或在下方填写仓库和 token');
  return c;
}
const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
const b64 = (str) => btoa(unescape(encodeURIComponent(str)));
const unb64 = (b) => decodeURIComponent(escape(atob(b.replace(/\n/g, ''))));
const viaToken = {
  async pull() {
    const c = cfg();
    const r = await fetch(`${API}/repos/${c.repo}/contents/${c.path}?ref=${c.branch}`, { headers: headers(c.token) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || ''}`);
    const j = await r.json();
    return { sha: j.sha, data: JSON.parse(unb64(j.content)) };
  },
  async push(content, sha) {
    const c = cfg();
    const body = { message: `os: sync ${new Date().toISOString()}`, content: b64(content), branch: c.branch };
    if (sha) body.sha = sha;
    const r = await fetch(`${API}/repos/${c.repo}/contents/${c.path}`, { method: 'PUT', headers: { ...headers(c.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || ''}`);
  },
};
const transport = () => (loggedIn() ? viaApi : viaToken);

/* ---- operations ---- */
let busy = false;
export const status = { busy: false, error: '', last: null, listeners: new Set() };
function setStatus(patch) { Object.assign(status, patch); status.listeners.forEach((f) => f()); }

export async function pullRemote() { return transport().pull(); }

export async function push() {
  const remote = await pullRemote();
  await transport().push(exportJSON(), remote ? remote.sha : undefined);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
}

export async function pull() {
  const remote = await pullRemote();
  if (!remote) throw new Error('远端还没有数据文件，先推送一次。');
  const local = get();
  replace({ ...remote.data, settings: { ...remote.data.settings, sync: local.settings.sync, theme: local.settings.theme, lastSync: new Date().toISOString() } });
}

export async function smartSync() {
  const remote = await pullRemote();
  const local = get();
  if (remote && remote.data.updatedAt && (!local.updatedAt || remote.data.updatedAt > local.updatedAt)) {
    replace({ ...remote.data, settings: { ...remote.data.settings, sync: local.settings.sync, theme: local.settings.theme, lastSync: new Date().toISOString() } });
    return 'pulled';
  }
  if (remote && local.updatedAt && remote.data.updatedAt === local.updatedAt) { update((d) => { d.settings.lastSync = new Date().toISOString(); }); return 'same'; }
  await transport().push(exportJSON(), remote ? remote.sha : undefined);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
  return 'pushed';
}

async function guarded(fn) {
  if (busy) return;
  busy = true; setStatus({ busy: true, error: '' });
  try { const r = await fn(); setStatus({ last: new Date().toISOString() }); return r; } catch (e) { setStatus({ error: e.message }); throw e; } finally { busy = false; setStatus({ busy: false }); }
}

/* ---- auto sync when logged in: pull on open, push shortly after edits ---- */
let armed = false;
export function autoSync(subscribe) {
  if (armed || !loggedIn()) return;
  armed = true;
  guarded(smartSync).catch(() => {});
  let lastSeen = get().updatedAt;
  const pushSoon = debounce(() => { if (get().updatedAt !== lastSeen) { lastSeen = get().updatedAt; guarded(push).catch(() => {}); } }, 8000);
  subscribe(() => { if (get().updatedAt !== lastSeen) pushSoon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && get().updatedAt !== lastSeen) { lastSeen = get().updatedAt; guarded(push).catch(() => {}); } });
}
