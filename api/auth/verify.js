// POST { email, code } -> 用验证码换登录；第一次登录的人在这里用掉邀请码、写进成员表
import { json, readJson, cookies, open, setCookie } from '../_lib.js';
import { cloudOn, sb, errMsg, isOwner, writeSession, sessionFromAuth, EMAIL_RE } from '../_cloud.js';

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
  const m = await sb('/rest/v1/members?select=user_id&user_id=eq.' + encodeURIComponent(uid), { as: 'service' });
  const member = m.ok && Array.isArray(m.data) && m.data.length > 0;
  if (!member) {
    let by = 'owner';
    if (!isOwner(email)) {
      const p = await open(cookies(req).ytos_inv || '');
      if (!p || p.e !== email || Date.now() - p.t > 30 * 60 * 1000) return json(res, 403, { error: '邀请码过期了，重新输入邀请码再发一次验证码' });
      const inv = await sb('/rest/v1/invites?select=code,uses,max_uses&code=eq.' + encodeURIComponent(p.c), { as: 'service' });
      const row = inv.ok && Array.isArray(inv.data) ? inv.data[0] : null;
      if (!row || row.uses >= row.max_uses) return json(res, 403, { error: '邀请码无效或已用完' });
      // 只在 uses 没变的情况下 +1，两个人同时用最后一个名额时只有一个成功
      const up = await sb(`/rest/v1/invites?code=eq.${encodeURIComponent(row.code)}&uses=eq.${row.uses}`, { as: 'service', method: 'PATCH', body: { uses: row.uses + 1 }, headers: { Prefer: 'return=representation' } });
      if (!up.ok || !Array.isArray(up.data) || !up.data.length) return json(res, 409, { error: '邀请码刚被别人用掉了' });
      by = row.code;
    }
    const ins = await sb('/rest/v1/members', { as: 'service', method: 'POST', body: { user_id: uid, email, invited_by: by }, headers: { Prefer: 'resolution=ignore-duplicates' } });
    if (!ins.ok) return json(res, 502, { error: '写成员表失败：' + errMsg(ins) });
  }
  await writeSession(res, sessionFromAuth(r.data));
  setCookie(res, 'ytos_inv', '', { maxAge: 0 });
  json(res, 200, { ok: true, email });
}
