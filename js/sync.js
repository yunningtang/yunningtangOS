// Sync the whole state document to a JSON file in a GitHub repo.
// Two transports:
//  - "login": the site runs on Vercel with /api/* functions; you sign in with GitHub and the
//    token stays in an encrypted httpOnly cookie, the browser only talks to /api/sync.
//  - "token": static hosting (GitHub Pages etc.); a fine-grained token pasted in Settings.
import { get, replace, update, exportJSON } from './store.js';
import { listFiles, markSynced, putRemote, blobToBase64, base64ToBlob, kvGet, kvSet } from './files.js';
import { seedDoc } from './seed.js';
import { merge3, syncView, SHARED_SETTINGS } from './merge.js';
import { debounce } from './util.js';

const API = 'https://api.github.com';
let api = null; // { configured, user, target } or null when /api is unavailable

export async function detectLogin() {
  try {
    const r = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) { api = null; return null; }
    api = await r.json();
    window.dispatchEvent(new Event('ytos:login')); // 先渲染出来的页面（比如大脑页的 AI 按钮）等登录状态到了再刷新
    return api;
  } catch { api = null; return null; }
}
export function loginState() { return api; }
export function loggedIn() { return !!(api && api.user); }

/* ---- transports ---- */
// Vercel 收的请求体上限约 4.5 MB；留点余量
const MAX_DOC = 4.2 * 1048576;
// 读接口返回：服务器出错时可能不是 JSON（413 太大、504 超时的网页），给一句看得懂的话；409 = 另一台设备刚同步过
async function readRes(r) {
  let j = null; try { j = await r.json(); } catch {}
  if (r.ok && j) return j;
  const msg = (j && j.error) || (r.status === 413 ? '数据太大了，云端收不下（约 4 MB 上限）' : r.status === 401 ? '登录过期了，重新登录一下' : r.status >= 500 ? `云端暂时出错了（${r.status}），等一下会自动再试` : `HTTP ${r.status}`);
  const e = new Error(msg); e.status = r.status; throw e;
}
const viaApi = {
  async pull() {
    const r = await fetch('/api/sync', { cache: 'no-store' });
    const j = await readRes(r);
    return j.data ? { sha: j.sha, data: j.data } : null;
  },
  async push(content, sha) {
    if (content.length > MAX_DOC) throw new Error(`数据太大了（${(content.length / 1048576).toFixed(1)} MB），云端一次只收 4 MB 左右。多半是笔记里直接粘贴的大图片——删掉几张，或者改成「上传图片」（图片会作为附件单独同步）`);
    const r = await fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, sha }) });
    await readRes(r);
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
// 「上次同步时两边一致的那份」。存在 IndexedDB；存不进去（隐私模式、被清理）时退一步存 localStorage，
// 不然每次都当成「第一次同步」只加不删——删掉的东西刷新后又会从云端合并回来
const BASE_LS = 'ytos.syncbase';
async function getBase() {
  const b = await kvGet(BASE_KEY); if (b) return b;
  try { const v = localStorage.getItem(BASE_LS); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}
async function setBase(doc) {
  const copy = typeof doc === 'string' ? JSON.parse(doc) : JSON.parse(JSON.stringify(doc));
  const ok = await kvSet(BASE_KEY, copy);
  try { if (ok) localStorage.removeItem(BASE_LS); else localStorage.setItem(BASE_LS, JSON.stringify(copy)); } catch {}
}
const keepLocal = (doc) => { const l = get(); return { ...doc, settings: { ...(doc.settings || {}), sync: l.settings.sync, theme: l.settings.theme, seeded: l.settings.seeded, lastSync: new Date().toISOString() } }; };

// force: local overwrites remote
export async function push() {
  const remote = await pullRemote();
  const sent = exportJSON();
  await transport().push(sent, remote ? remote.sha : undefined);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
  await setBase(sent);
  pushAttachments().catch(() => {});
}

// force: remote overwrites local
export async function pull() {
  const remote = await pullRemote();
  if (!remote) throw new Error('远端还没有数据文件，先推送一次。');
  replace(keepLocal(remote.data));
  await setBase(remote.data);
}

// Three-way merge: local and remote changes since the last sync are combined record by record,
// so two devices can both edit without one overwriting the other.
// 另一台设备刚好同时同步（409）：重新拉一次再合并，最多再试两次
export async function smartSync() {
  for (let i = 0; ; i++) {
    try { return await syncOnce(); } catch (e) { if (e.status !== 409 || i >= 2) throw e; await new Promise((r) => setTimeout(r, 400 + i * 600)); }
  }
}
async function syncOnce() {
  const remote = await pullRemote();
  const local = get();
  if (!remote) { const sent = exportJSON(); await transport().push(sent); update((d) => { d.settings.lastSync = new Date().toISOString(); }); await setBase(sent); pushAttachments().catch(() => {}); return 'pushed'; }
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
    merged.settings = { ...(merged.settings || {}) };
    for (const k of SHARED_SETTINGS) if (rs[k] != null && (k === 'dash' || k === 'place' || merged.settings[k] == null)) merged.settings[k] = rs[k];
  }
  const localChanged = syncView(merged) !== syncView(local);
  const remoteChanged = syncView(merged) !== syncView(remote.data);
  if (localChanged) replace(keepLocal(merged));
  // base 必须是「两边此刻真正一致的那份」：推上去的就是它，不推的话云端就是它。
  // 不能在 await 之后再取 get()——推送的这几秒里删掉的东西，会被当成「云端新加的」又合并回来
  const sent = exportJSON();
  if (remoteChanged) await transport().push(sent, remote.sha);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
  await setBase(remoteChanged ? sent : remote.data);
  if (remoteChanged) pushAttachments().then((r) => { if (r.failed) setStatus({ error: `有 ${r.failed} 个附件（图片 / 文件）没传上去，下次同步会再试` }); }).catch(() => {});
  return remoteChanged ? (localChanged ? 'merged' : 'pushed') : (localChanged ? 'pulled' : 'same');
}

let again = null; // 正在同步时又来了一次：等这次完了再跑一次，不直接丢掉
export async function guarded(fn) {
  if (busy) { again = fn; return; }
  busy = true; setStatus({ busy: true, error: '' });
  try { const r = await fn(); setStatus({ last: new Date().toISOString() }); return r; } catch (e) { setStatus({ error: e.message }); throw e; } finally { busy = false; setStatus({ busy: false }); if (again) { const f = again; again = null; setTimeout(() => guarded(f).catch(() => {}), 300); } }
}

/* ---- auto sync when logged in: pull on open, push shortly after edits ---- */
let armed = false;
export function autoSync(subscribe) {
  if (armed || !loggedIn()) return;
  armed = true;
  let lastSeen = get().updatedAt;
  // 记「开始同步那一刻」的版本：同步途中又改的东西，跑完会发现还没同步、几秒后再跑一次（以前会被当成已同步，要等下次再改才上去）
  const run = () => { const startedAt = get().updatedAt; return guarded(smartSync).then(() => { lastSeen = startedAt; if (get().updatedAt !== startedAt) soon(); }).catch(() => {}); };
  run();
  const soon = debounce(() => { if (get().updatedAt !== lastSeen) run(); }, 8000);
  subscribe(() => { if (get().updatedAt !== lastSeen) soon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && get().updatedAt !== lastSeen) run(); else if (document.visibilityState === 'visible') run(); });
}
