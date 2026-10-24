// GET  -> { sha, data } of the data file (data null if it does not exist yet)
// PUT  -> body { content: string, sha?: string } writes the file as a commit
import { session, json, gh, dataTarget, readBody, resolveBranch } from './_lib.js';

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
    const content = Buffer.from(r.body.content.replace(/\n/g, ''), 'base64').toString('utf8');
    let data = null;
    try { data = JSON.parse(content); } catch { return json(res, 500, { error: 'remote file is not valid JSON' }); }
    return json(res, 200, { sha: r.body.sha, data });
  }
  if (req.method === 'PUT') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
    if (typeof body.content !== 'string') return json(res, 400, { error: 'content required' });
    const payload = { message: `os: sync ${new Date().toISOString()}`, content: Buffer.from(body.content, 'utf8').toString('base64'), branch };
    if (body.sha) payload.sha = body.sha;
    const r = await gh(s.t, file, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) return json(res, r.status, { error: r.body?.message || 'github error' });
    return json(res, 200, { sha: r.body.content.sha });
  }
  json(res, 405, { error: 'method not allowed' });
}
