import { setCookie, COOKIE, session, env } from '../_lib.js';

// POST：清 cookie，并把这个 OAuth token 在 GitHub 那边吊销（GET 只做跳转，不再有副作用，免得被跨站链接登出）
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 302; res.setHeader('Location', '/#/settings'); res.end(); return; }
  const s = await session(req);
  if (s && s.t && env('GITHUB_CLIENT_ID') && env('GITHUB_CLIENT_SECRET')) {
    try {
      await fetch(`https://api.github.com/applications/${env('GITHUB_CLIENT_ID')}/token`, { method: 'DELETE', headers: { Authorization: 'Basic ' + Buffer.from(`${env('GITHUB_CLIENT_ID')}:${env('GITHUB_CLIENT_SECRET')}`).toString('base64'), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: s.t }) });
    } catch {}
  }
  setCookie(res, COOKIE, '', { maxAge: 0 });
  res.statusCode = 204; res.end();
}
