// Optional sync: push/pull the whole state document to a file in a GitHub repo through the Contents API.
// The token lives only in this browser's localStorage. Use a fine-grained token scoped to one repo.
import { get, replace, update, exportJSON } from './store.js';

const API = 'https://api.github.com';

function cfg() {
  const c = get().settings.sync;
  if (!c.repo || !c.token) throw new Error('请先填写仓库和 token');
  return c;
}

function headers(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

function b64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function unb64(b) {
  return decodeURIComponent(escape(atob(b.replace(/\n/g, ''))));
}

export async function pullRemote() {
  const c = cfg();
  const r = await fetch(`${API}/repos/${c.repo}/contents/${c.path}?ref=${c.branch}`, { headers: headers(c.token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || ''}`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(unb64(j.content)) };
}

export async function push() {
  const c = cfg();
  const remote = await pullRemote();
  const body = { message: `os: sync ${new Date().toISOString()}`, content: b64(exportJSON()), branch: c.branch };
  if (remote) body.sha = remote.sha;
  const r = await fetch(`${API}/repos/${c.repo}/contents/${c.path}`, { method: 'PUT', headers: { ...headers(c.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || ''}`);
  update((d) => { d.settings.lastSync = new Date().toISOString(); });
}

export async function pull() {
  const remote = await pullRemote();
  if (!remote) throw new Error('远端还没有数据文件，先推送一次。');
  const local = get();
  const keep = { settings: { ...remote.data.settings, sync: local.settings.sync, theme: local.settings.theme, lastSync: new Date().toISOString() } };
  replace({ ...remote.data, ...keep });
}

export async function smartSync() {
  const remote = await pullRemote();
  const local = get();
  if (remote && remote.data.updatedAt && local.updatedAt && remote.data.updatedAt > local.updatedAt && (!local.settings.lastSync || remote.data.updatedAt > local.settings.lastSync)) {
    await pull();
    return 'pulled';
  }
  await push();
  return 'pushed';
}
