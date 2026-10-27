// /api/auth/* 合成一个函数：Vercel 免费版最多 12 个函数，各个登录接口放在 api/_auth/ 里，这里按路径分发
import callback from '../_auth/callback.js';
import email from '../_auth/email.js';
import google from '../_auth/google.js';
import googleCallback from '../_auth/google-callback.js';
import login from '../_auth/login.js';
import logout from '../_auth/logout.js';
import me from '../_auth/me.js';
import password from '../_auth/password.js';
import signin from '../_auth/signin.js';
import verify from '../_auth/verify.js';

const ROUTES = { callback, email, google, 'google-callback': googleCallback, login, logout, me, password, signin, verify };

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || new URL(req.url, 'https://x').pathname.split('/').pop();
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, action) && ROUTES[action];
  if (!fn) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"not found"}'); }
  return fn(req, res);
}
