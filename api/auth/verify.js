// POST { email, code } -> 用验证码换登录；第一次登录的人在这里用掉邀请码、写进成员表
import { json, readJson, cookies, open, setCookie } from '../_lib.js';
import { cloudOn, sb, errMsg, isOwner, writeSession, sessionFromAuth, admit, EMAIL_RE } from '../_cloud.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (!cloudOn()) return json(res, 503, { error: '云端还没配置' });
  const body = await readJson(req, 4096);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const code = String((body && body.code) || '').replace(/\s/g, '');
  if (!EMAIL_RE.test(email) || !/^\d{6,10}$/.test(code)) return json(res, 400, { error: '邮箱或验证码格式不对' });
  const r = await sb('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: code } });
  if (!r.ok || !r.data || !r.data.access_token) return json(res, 401, { error: r.status === 403 || r.status === 401 ? '验证码不对或已过期' : errMsg(r) });
  const uid = r.data.user && r.data.user.id;
  let inviteCode = '';
  if (!isOwner(email)) {
    const p = await open(cookies(req).ytos_inv || '');
    if (p && p.e === email && Date.now() - p.t <= 30 * 60 * 1000) inviteCode = p.c;
  }
  const ok = await admit(uid, email, inviteCode);
  if (!ok.ok) return json(res, ok.status, { error: ok.status === 403 && !inviteCode ? '邀请码过期了，重新输入邀请码再发一次验证码' : ok.error });
  await writeSession(res, sessionFromAuth(r.data));
  setCookie(res, 'ytos_inv', '', { maxAge: 0 });
  json(res, 200, { ok: true, email });
}
