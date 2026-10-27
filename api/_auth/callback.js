import { env, cookies, setCookie, seal, gh, COOKIE } from '../_lib.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://x');
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  const fail = (msg) => { res.statusCode = 302; res.setHeader('Location', '/#/settings?auth=' + encodeURIComponent(msg)); res.end(); };
  if (!code || !state || cookies(req).ytos_state !== state) return fail('state mismatch');
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env('GITHUB_CLIENT_ID'), client_secret: env('GITHUB_CLIENT_SECRET'), code, state }),
  });
  const tok = await r.json();
  if (!tok.access_token) return fail(tok.error_description || 'token exchange failed');
  const me = await gh(tok.access_token, '/user');
  if (!me.ok || !me.body || !me.body.login) return fail('could not read user');
  const allowed = (env('ALLOWED_USER') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return fail('ALLOWED_USER 没有配置：在 Vercel 环境变量里填上允许登录的 GitHub 用户名'); // 没配就一律拒绝，不能默认放行
  if (!allowed.includes(me.body.login.toLowerCase())) return fail('not allowed: ' + me.body.login);
  setCookie(res, COOKIE, await seal({ t: tok.access_token, u: me.body.login, a: me.body.avatar_url, at: Date.now() }), { maxAge: 60 * 60 * 24 * 90 });
  setCookie(res, 'ytos_state', '', { maxAge: 0 });
  res.statusCode = 302;
  res.setHeader('Location', '/#/settings?auth=ok');
  res.end();
}
