// GET  -> { sha, data } of the data file (data null if it does not exist yet)
// PUT  -> body { content: string, sha?: string } writes the file as a commit
import { session, json, gh, dataTarget, readJson, resolveBranch } from './_lib.js';
import { sb, accessToken, errMsg } from './_cloud.js';

// 云端用户：一行 docs，version 充当 sha（乐观锁：只在版本没变时才写得进去，否则 409，前端会重新拉取合并）
async function cloud(req, res, s) {
  let tok; try { tok = await accessToken(s, res); } catch (e) { return json(res, 401, { error: e.message }); }
  if (req.method === 'GET') {
    const r = await sb('/rest/v1/docs?select=doc,version&user_id=eq.' + encodeURIComponent(s.uid), { as: tok });
    if (!r.ok) return json(res, 502, { error: errMsg(r) });
    const row = Array.isArray(r.data) ? r.data[0] : null;
    return json(res, 200, row ? { sha: String(row.version), data: row.doc } : { sha: null, data: null });
  }
  if (req.method === 'PUT') {
    const body = await readJson(req);
    if (!body || typeof body.content !== 'string') return json(res, 400, { error: 'content required' });
    let doc; try { doc = JSON.parse(body.content); if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw 0; } catch { return json(res, 400, { error: '要写入的内容不是合法的 JSON 文档' }); }
    const now = new Date().toISOString();
    if (body.sha == null) {
      const r = await sb('/rest/v1/docs', { as: tok, method: 'POST', body: { user_id: s.uid, doc, version: 1, updated_at: now }, headers: { Prefer: 'return=representation' } });
      if (r.status === 409) return json(res, 409, { error: '云端已经有数据了，先同步一次再推送' });
      if (!r.ok) return json(res, 502, { error: errMsg(r) });
      return json(res, 200, { sha: '1' });
    }
    const v = parseInt(String(body.sha), 10); if (!(v > 0)) return json(res, 400, { error: 'bad sha' });
    const r = await sb(`/rest/v1/docs?user_id=eq.${encodeURIComponent(s.uid)}&version=eq.${v}`, { as: tok, method: 'PATCH', body: { doc, version: v + 1, updated_at: now }, headers: { Prefer: 'return=representation' } });
    if (!r.ok) return json(res, 502, { error: errMsg(r) });
    if (!Array.isArray(r.data) || !r.data.length) return json(res, 409, { error: '另一台设备刚同步过，重新同步一次就好' });
    return json(res, 200, { sha: String(v + 1) });
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
  const file = `/repos/${repo}/contents/${path}`;
  if (req.method === 'GET') {
    const r = await gh(s.t, `${file}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) return json(res, 200, { sha: null, data: null });
    if (!r.ok) return json(res, r.status, { error: r.body?.message || 'github error' });
    if (!r.body || typeof r.body !== 'object' || Array.isArray(r.body) || r.body.type !== 'file') return json(res, 500, { error: 'DATA_PATH 不是一个文件' });
    let content;
    if (r.body.content) content = Buffer.from(r.body.content.replace(/\n/g, ''), 'base64').toString('utf8');
    else { // 超过 1 MB 时 Contents API 不给 content，走 blob 接口（到 100 MB）
      const blob = await gh(s.t, `/repos/${repo}/git/blobs/${r.body.sha}`);
      if (!blob.ok || !blob.body || !blob.body.content) return json(res, 502, { error: '数据文件太大，读不回来：' + (blob.body?.message || blob.status) });
      content = Buffer.from(String(blob.body.content).replace(/\n/g, ''), 'base64').toString('utf8');
    }
    let data = null;
    try { data = JSON.parse(content); } catch { return json(res, 500, { error: 'remote file is not valid JSON' }); }
    return json(res, 200, { sha: r.body.sha, data });
  }
  if (req.method === 'PUT') {
    const body = await readJson(req);
    if (!body || typeof body.content !== 'string') return json(res, 400, { error: 'content required' });
    try { const d = JSON.parse(body.content); if (!d || typeof d !== 'object' || Array.isArray(d)) throw 0; } catch { return json(res, 400, { error: '要写入的内容不是合法的 JSON 文档' }); } // 别把坏文件提交进仓库
    if (body.sha != null && !/^[0-9a-f]{40}$/i.test(String(body.sha))) return json(res, 400, { error: 'bad sha' });
    const payload = { message: `os: sync ${new Date().toISOString()}`, content: Buffer.from(body.content, 'utf8').toString('base64'), branch };
    if (body.sha) payload.sha = body.sha;
    const r = await gh(s.t, file, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) return json(res, r.status, { error: r.body?.message || 'github error' });
    return json(res, 200, { sha: r.body && r.body.content ? r.body.content.sha : null });
  }
  json(res, 405, { error: 'method not allowed' });
}
