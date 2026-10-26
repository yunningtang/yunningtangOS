// POST { email, invite? } -> 给这个邮箱发 6 位验证码。没注册过的邮箱要有效邀请码（OWNER_EMAILS 里的除外）
import { json, readJson, seal, setCookie } from '../_lib.js';
import { cloudOn, sb, errMsg, isOwner, EMAIL_RE } from '../_cloud.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (!cloudOn()) return json(res, 503, { error: '云端还没配置：在 Vercel 里接上 Supabase（见 README）' });
  const body = await readJson(req, 4096);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const invite = String((body && body.invite) || '').trim();
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: '邮箱格式不对' });
  const m = await sb('/rest/v1/members?select=user_id&email=eq.' + encodeURIComponent(email), { as: 'service' });
  if (!m.ok) return json(res, 502, { error: '查不到成员表，是不是还没运行 supabase/schema.sql？' });
  const member = Array.isArray(m.data) && m.data.length > 0;
  if (!member && !isOwner(email)) {
    if (!invite) return json(res, 403, { error: '这个邮箱还没注册，需要邀请码', needInvite: true });
    const inv = await sb('/rest/v1/invites?select=code,uses,max_uses&code=eq.' + encodeURIComponent(invite), { as: 'service' });
    const row = inv.ok && Array.isArray(inv.data) ? inv.data[0] : null;
    if (!row || row.uses >= row.max_uses) return json(res, 403, { error: '邀请码无效或已用完', needInvite: true });
  }
  const r = await sb('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
  if (!r.ok) return json(res, r.status === 429 ? 429 : 502, { error: r.status === 429 ? '发得太频繁了，过一会儿再试' : errMsg(r) });
  // 邀请码先暂存在加密 cookie 里，验证成功时才真正用掉
  setCookie(res, 'ytos_inv', member ? '' : await seal({ e: email, c: invite, t: Date.now() }), { maxAge: member ? 0 : 60 * 30 });
  json(res, 200, { ok: true, newUser: !member });
}
