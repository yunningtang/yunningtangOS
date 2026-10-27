// POST { email, password } -> 用邮箱 + 密码登录（密码是登录后在设置里设的；新人还是走验证码 + 邀请码注册）
import { json, readJson } from '../_lib.js';
import { cloudOn, sb, writeSession, sessionFromAuth, admit, EMAIL_RE } from '../_cloud.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (!cloudOn()) return json(res, 503, { error: '云端还没配置' });
  const body = await readJson(req, 4096);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!EMAIL_RE.test(email) || !password) return json(res, 400, { error: '邮箱或密码没填' });
  const r = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!r.ok || !r.data || !r.data.access_token) return json(res, r.status === 429 ? 429 : 401, { error: r.status === 429 ? '试得太频繁了，过一会儿再试' : '邮箱或密码不对（没设过密码的话，先用验证码登录）' });
  const ok = await admit(r.data.user.id, email, '');
  if (!ok.ok) return json(res, ok.status, { error: ok.error });
  await writeSession(res, sessionFromAuth(r.data));
  json(res, 200, { ok: true, email });
}
