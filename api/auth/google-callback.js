// Google 登录回来：用 code + code_verifier 换 Supabase 的 token，再按邮箱登录同样的规则放行（成员 / 站长 / 有效邀请码）。
// 同一个邮箱用验证码注册过的话，Supabase 会把 Google 身份并到同一个账号上，数据是同一份。
import { cookies, open, setCookie } from '../_lib.js';
import { cloudOn, sb, errMsg, writeSession, sessionFromAuth, admit } from '../_cloud.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://x');
  const done = (msg) => { setCookie(res, 'ytos_oauth', '', { maxAge: 0 }); res.statusCode = 302; res.setHeader('Location', '/#/settings?sec=sync&auth=' + encodeURIComponent(msg)); res.end(); };
  if (!cloudOn()) return done('云端还没配置');
  const err = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (err) return done('Google 登录没完成：' + err);
  const code = url.searchParams.get('code');
  const p = await open(cookies(req).ytos_oauth || '');
  if (!code || !p || !p.v || Date.now() - p.t > 10 * 60 * 1000) return done('登录超时了，再点一次 Google 登录');
  const r = await sb('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: p.v } });
  if (!r.ok || !r.data || !r.data.access_token || !r.data.user) return done(errMsg(r));
  const uid = r.data.user.id, email = String(r.data.user.email || '').toLowerCase();
  if (!email) return done('这个 Google 账号没有邮箱');
  const ok = await admit(uid, email, p.c);
  if (!ok.ok) {
    // 没放行的新人：把 Supabase 刚建的空账号删掉，免得留下一堆没注册成功的用户
    const m = await sb('/rest/v1/members?select=user_id&user_id=eq.' + encodeURIComponent(uid), { as: 'service' });
    if (m.ok && Array.isArray(m.data) && !m.data.length) await sb('/auth/v1/admin/users/' + encodeURIComponent(uid), { as: 'service', method: 'DELETE' });
    return done(ok.status === 403 && !p.c ? 'need-invite' : ok.error);
  }
  await writeSession(res, sessionFromAuth(r.data));
  setCookie(res, 'ytos_oauth', '', { maxAge: 0 });
  res.statusCode = 302; res.setHeader('Location', '/#/settings?sec=sync&auth=ok'); res.end();
}
