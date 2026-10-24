// GET  -> { sha, data } of the data file (data null if it does not exist yet)
// PUT  -> body { content: string, sha?: string } writes the file as a commit
import { session, json, gh, dataTarget, readJson, resolveBranch } from './_lib.js';

export default async function handler(req, res) {
  const s = await session(req);
  if (!s) return json(res, 401, { error: 'not logged in' });
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
