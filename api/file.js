// Attachments in the data repo: assets/<id> next to the data file.
// GET  ?id=...            -> { name, type, content (base64) }
// PUT  { id, name, type, content (base64) }  -> writes / updates the file as a commit
import { session, json, gh, dataTarget, readBody } from './_lib.js';

export default async function handler(req, res) {
  const s = await session(req);
  if (!s) return json(res, 401, { error: 'not logged in' });
  const { repo, branch, path } = dataTarget();
  if (!repo) return json(res, 500, { error: 'DATA_REPO is not set' });
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
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
    const id = String(body.id || '').replace(/[^\w-]/g, '');
    if (!id || typeof body.content !== 'string') return json(res, 400, { error: 'id and content required' });
    const file = `/repos/${repo}/contents/${dir}/${id}`;
    const cur = await gh(s.t, `${file}?ref=${encodeURIComponent(branch)}`);
    const payload = { message: `os: attachment ${body.name || id}`, content: body.content, branch };
    if (cur.ok && cur.body && cur.body.sha) payload.sha = cur.body.sha;
    const r = await gh(s.t, file, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) return json(res, r.status, { error: r.body?.message || 'github error' });
    return json(res, 200, { ok: true });
  }
  json(res, 405, { error: 'method not allowed' });
}
