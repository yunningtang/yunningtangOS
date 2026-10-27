// GET /api/auth/google?invite=CODE -> 跳去 Google 登录（经 Supabase，PKCE）。邀请码和 code_verifier 先放在加密 cookie 里
import { json, seal, setCookie } from '../_lib.js';
import { cloudOn, supabaseUrl } from '../_cloud.js';

export default async function handler(req, res) {
  if (!cloudOn()) return json(res, 503, { error: '云端还没配置' });
  const url = new URL(req.url, 'https://x');
  const invite = String(url.searchParams.get('invite') || '').trim().slice(0, 64);
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  setCookie(res, 'ytos_oauth', await seal({ v: verifier, c: invite, t: Date.now() }), { maxAge: 600 });
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const back = `https://${host}/api/auth/google-callback`;
  res.statusCode = 302;
  res.setHeader('Location', `${supabaseUrl()}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=s256`);
  res.end();
}
