import { env, setCookie } from '../_lib.js';

export default async function handler(req, res) {
  const id = env('GITHUB_CLIENT_ID');
  if (!id) { res.statusCode = 500; return res.end('GITHUB_CLIENT_ID is not set'); }
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  setCookie(res, 'ytos_state', state, { maxAge: 600 });
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirect = `https://${host}/api/auth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirect)}&scope=repo&state=${state}`;
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}
