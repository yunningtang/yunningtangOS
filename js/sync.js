// Sync the whole state document to a JSON file in a GitHub repo.
// Two transports:
//  - "login": the site runs on Vercel with /api/* functions; you sign in with GitHub and the
//    token stays in an encrypted httpOnly cookie, the browser only talks to /api/sync.
//  - "token": static hosting (GitHub Pages etc.); a fine-grained token pasted in Settings.
import { get, replace, update, exportJSON } from './store.js';
import { listFiles, markSynced, putRemote, blobToBase64, base64ToBlob, kvGet, kvSet } from './files.js';
import { seedDoc } from './seed.js';
import { merge3, syncView } from './merge.js';
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

/* ---- attachments: assets/<id> next to the data file ---- */
const assetDir = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/assets' : 'assets');
const files = {
  async put(rec) {
    const content = await blobToBase64(rec.blob);
    if (loggedIn()) { const r = await fetch('/api/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rec.id, name: rec.name, type: rec.type, content }) }); if (!r.ok) throw new Error('attachment upload failed'); return; }
    const c = cfg(); const file = `${API}/repos/${c.repo}/contents/${assetDir(c.path)}/${rec.id}`;
    const cur = await fetch(`${file}?ref=${c.branch}`, { headers: headers(c.token) }); const sha = cur.ok ? (await cur.json()).sha : undefined;
    const r = await fetch(file, { method: 'PUT', headers: { ...headers(c.token), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `os: attachment ${rec.name}`, content, branch: c.branch, ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('attachment upload failed');
  },
  async get(id) {
    if (loggedIn()) { const r = await fetch('/api/file?id=' + encodeURIComponent(id)); if (!r.ok) return null; return (await r.json()).content; }
    const c = cfg(); const r = await fetch(`${API}/repos/${c.repo}/contents/${assetDir(c.path)}/${id}?ref=${c.branch}`, { headers: headers(c.token) });
    if (!r.ok) return null; const j = await r.json(); if (j.content) return j.content; if (j.download_url) { const f = await fetch(j.download_url); return blobToBase64(await f.blob()); } return null;
  },
};
// push every attachment that has not reached the repo yet; failures are reported, not fatal
export async function pushAttachments() {
  let n = 0, failed = 0;
  for (const rec of await listFiles()) { if (rec.synced) continue; try { await files.put(rec); await markSynced(rec.id); n++; } catch (e) { failed++; } }
  return { n, failed };
}
// fetch one attachment that exists on another device (returns the stored record or null)
export async function fetchAttachment(id, meta = {}) {
  try { const b64 = await files.get(id); if (!b64) return null; return await putRemote(id, meta.name || id, meta.mime || 'application/octet-stream', base64ToBlob(b64, meta.mime || 'application/octet-stream')); } catch { return null; }
}
export const canSyncFiles = () => { try { return loggedIn() || !!(get().settings.sync.repo && get().settings.sync.token); } catch { return false; } };

/* ---- operations ---- */
let busy = false;
export const status = { busy: false, error: '', last: null, listeners: new Set() };
function setStatus(patch) { Object.assign(status, patch); status.listeners.forEach((f) => f()); }

export async function pullRemote() { return transport().pull(); }

const BASE_KEY = 'sync-base';
// 没同步过、而且内容和示例数据长得一样（标题集合一致）→ 当作空白设备
function isUntouchedSeed(doc) {
  if (!doc || !doc.settings || !doc.settings.seeded || doc.settings.lastSync) return false;
  const lists = ['notes', 'todos', 'books', 'links', 'trips'];
  // 新版示例数据每条都带 seed 标记：全是示例、一条自己的都没有 → 空白设备
  if (lists.some((k) => (doc[k] || []).some((x) => x && x.seed))) return lists.every((k) => (doc[k] || []).every((x) => x && x.seed));
  // 老版本没有标记：按标题和当前示例比对
  const titles = (l) => (l || []).map((x) => x.title || x.place || x.url || '').sort().join('\u0001');
  const sd = seedDoc();
  return lists.every((k) => titles(doc[k]) === titles(sd[k]));
}
const getBase = () => kvGet(BASE_KEY);
const setBase = (doc) => kvSet(BASE_KEY, JSON.parse(JSON.stringify(doc)));
const keepLocal = (doc) => { const l = get(); return { ...doc, settings: { ...(doc.settings || {}), sync: l.settings.sync, theme: l.settings.theme, seeded: l.settings.seeded, lastSync: new Date().toISOString() } }; };

// force: local overwrites remote
export async function push() {
  const remote = await pullRemote();
  await transport().push(exportJSON(), remote ? remote.sha : undefined);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
  await setBase(get());
  pushAttachments().catch(() => {});
}

// force: remote overwrites local
export async function pull() {
  const remote = await pullRemote();
  if (!remote) throw new Error('远端还没有数据文件，先推送一次。');
  replace(keepLocal(remote.data));
  await setBase(get());
}

// Three-way merge: local and remote changes since the last sync are combined record by record,
// so two devices can both edit without one overwriting the other.
export async function smartSync() {
  const remote = await pullRemote();
  const local = get();
  if (!remote) { await transport().push(exportJSON()); update((d) => { d.settings.lastSync = new Date().toISOString(); }); await setBase(get()); pushAttachments().catch(() => {}); return 'pushed'; }
  const base = await getBase();
  // 这台设备第一次同步（没有 base）：不能拿远端当 base，否则本地没有的东西全被当成「本地删除」，会把远端清掉。
  // 本地只是一份没动过的示例数据 → 直接以远端为准；本地有自己的内容 → 以空 base 合并（只加不删）。
  let merged;
  if (base) merged = merge3(base, local, remote.data);
  else if (isUntouchedSeed(local)) merged = remote.data;
  else { // 只加不删；个人资料 / 总览布局 / 位置这些「单值」以远端为准，别用新设备的默认值把远端盖掉
    merged = merge3({}, local, remote.data);
    const rp = remote.data.profile || {}, rs = remote.data.settings || {};
    merged.profile = { ...(local.profile || {}), ...Object.fromEntries(Object.entries(rp).filter(([, v]) => v != null && v !== '')) };
    merged.settings = { ...(merged.settings || {}), dash: rs.dash || (merged.settings || {}).dash, place: rs.place || (merged.settings || {}).place };
  }
  const localChanged = syncView(merged) !== syncView(local);
  const remoteChanged = syncView(merged) !== syncView(remote.data);
  if (localChanged) replace(keepLocal(merged));
  if (remoteChanged) await transport().push(exportJSON(), remote.sha);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
  await setBase(get());
  if (remoteChanged) pushAttachments().catch(() => {});
  return remoteChanged ? (localChanged ? 'merged' : 'pushed') : (localChanged ? 'pulled' : 'same');
}

export async function guarded(fn) {
  if (busy) return;
  busy = true; setStatus({ busy: true, error: '' });
  try { const r = await fn(); setStatus({ last: new Date().toISOString() }); return r; } catch (e) { setStatus({ error: e.message }); throw e; } finally { busy = false; setStatus({ busy: false }); }
}

/* ---- auto sync when logged in: pull on open, push shortly after edits ---- */
let armed = false;
export function autoSync(subscribe) {
  if (armed || !loggedIn()) return;
  armed = true;
  let lastSeen = get().updatedAt;
  const run = () => guarded(smartSync).then(() => { lastSeen = get().updatedAt; }).catch(() => {});
  run();
  const soon = debounce(() => { if (get().updatedAt !== lastSeen) run(); }, 8000);
  subscribe(() => { if (get().updatedAt !== lastSeen) soon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && get().updatedAt !== lastSeen) run(); else if (document.visibilityState === 'visible') run(); });
}
