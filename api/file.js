// Attachments in the data repo: assets/<id> next to the data file.
// GET  ?id=...            -> { name, type, content (base64) }
// GET  ?list=1            -> { files: [{ id, size, created }] }   列出云端的全部附件（清理没用的附件时用；只有云端帐号）
// PUT  { id, name, type, content (base64) }  -> writes / updates the file as a commit
// DELETE { ids: [...] }   -> { deleted }                            删掉这些附件（最多 200 个；只有云端帐号）
import { session, json, gh, dataTarget, readJson, resolveBranch } from './_lib.js';
import { sb, accessToken, errMsg } from './_cloud.js';

// 云端用户：Supabase Storage 私有桶 attachments/<user id>/<附件 id>（行级权限只允许自己的目录）
async function cloud(req, res, s) {
  let tok; try { tok = await accessToken(s, res); } catch (e) { return json(res, 401, { error: e.message }); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.searchParams.get('list')) {
    const files = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const r = await sb('/storage/v1/object/list/attachments', { as: tok, method: 'POST', body: { prefix: s.uid + '/', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } } });
      if (!r.ok) return json(res, 502, { error: errMsg(r) });
      const rows = Array.isArray(r.data) ? r.data : [];
      rows.forEach((x) => { if (x && x.name && x.id) files.push({ id: x.name, size: (x.metadata && x.metadata.size) || 0, created: x.created_at || '' }); });
      if (rows.length < 1000) break;
    }
    return json(res, 200, { files });
  }
  if (req.method === 'DELETE') {
    const body = await readJson(req); const ids = (body && Array.isArray(body.ids) ? body.ids : []).map((x) => String(x).replace(/[^\w-]/g, '')).filter(Boolean).slice(0, 200);
    if (!ids.length) return json(res, 400, { error: 'ids required' });
    const r = await sb('/storage/v1/object/attachments', { as: tok, method: 'DELETE', body: { prefixes: ids.map((id) => `${s.uid}/${id}`) } });
    if (!r.ok) return json(res, 502, { error: errMsg(r) });
    return json(res, 200, { deleted: Array.isArray(r.data) ? r.data.length : ids.length });
  }
  if (req.method === 'GET') {
    const id = (url.searchParams.get('id') || '').replace(/[^\w-]/g, ''); if (!id) return json(res, 400, { error: 'id required' });
    const r = await sb(`/storage/v1/object/authenticated/attachments/${s.uid}/${id}`, { as: tok, raw: true });
    if (!r.ok) return json(res, r.status === 400 || r.status === 404 ? 404 : 502, { error: 'not found' });
    return json(res, 200, { content: r.buf.toString('base64') });
  }
  if (req.method === 'PUT') {
    const body = await readJson(req); if (!body) return json(res, 400, { error: 'bad json' });
    const id = String(body.id || '').replace(/[^\w-]/g, '');
    if (!id || typeof body.content !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(body.content)) return json(res, 400, { error: 'id and base64 content required' });
    if (body.content.length > 5.5e6) return json(res, 413, { error: '附件太大（上限约 4 MB）' });
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(body.type || '')) ? body.type : 'application/octet-stream';
    const r = await sb(`/storage/v1/object/attachments/${s.uid}/${id}`, { as: tok, method: 'POST', raw: true, body: Buffer.from(body.content, 'base64'), headers: { 'Content-Type': type, 'x-upsert': 'true' } });
    if (!r.ok) return json(res, 502, { error: errMsg(r) });
    return json(res, 200, { ok: true });
  }
  json(res, 405, { error: 'method not allowed' });
}

export default async function handler(req, res) {
  const s = await session(req);
  if (!s) return json(res, 401, { error: 'not logged in' });
  if (s.k === 'sb') return cloud(req, res, s);
  const { repo, branch: wanted, path } = dataTarget();
  if (!repo) return json(res, 500, { error: 'DATA_REPO is not set' });
  const branch = await resolveBranch(s.t, repo, wanted);
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/assets' : 'assets';
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET') {
    const id = (url.searchParams.get('id') || '').replace(/[^\w-]/g, '');
    if (!id) return json(res, 400, { error: 'id required' });
    const r = await gh(s.t, `/repos/${repo}/contents/${dir}/${id}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) return json(res, 404, { error: 'not found' });
    if (!r.ok) return json(res, r.status, { error: r.body?.message || 'github error' });
    let content = r.body.content;
    if (!content && r.body.download_url) { const f = await fetch(r.body.download_url); content = Buffer.from(await f.arrayBuffer()).toString('base64'); }
    return json(res, 200, { content: (content || '').replace(/\n/g, '') });
  }
  if (req.method === 'PUT') {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: 'bad json' });
    const id = String(body.id || '').replace(/[^\w-]/g, '');
    if (!id || typeof body.content !== 'string') return json(res, 400, { error: 'id and content required' });
    if (!/^[A-Za-z0-9+/=\s]*$/.test(body.content)) return json(res, 400, { error: 'content must be base64' });
    if (body.content.length > 5.5e6) return json(res, 413, { error: '附件太大（上限约 4 MB）' });
    const file = `/repos/${repo}/contents/${dir}/${id}`;
    const cur = await gh(s.t, `${file}?ref=${encodeURIComponent(branch)}`);
    const payload = { message: `os: attachment ${String(body.name || id).replace(/[\r\n]/g, ' ').slice(0, 80)}`, content: body.content, branch };
    if (cur.ok && cur.body && cur.body.sha) payload.sha = cur.body.sha;
    const r = await gh(s.t, file, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) return json(res, r.status, { error: r.body?.message || 'github error' });
    return json(res, 200, { ok: true, sha: r.body && r.body.content ? r.body.content.sha : null });
  }
  json(res, 405, { error: 'method not allowed' });
}
