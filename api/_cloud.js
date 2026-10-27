// 云端（Supabase）帮手：浏览器只和本站 /api/* 说话，这里再转发给 Supabase。
// 环境变量（Vercel 的 Supabase 集成会自动写入）：SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY
// 可选：OWNER_EMAILS（逗号分隔，不需要邀请码、AI 不限量）、AI_FREE_CALLS（每人每月免费次数，默认 60）
import { env, seal, setCookie, COOKIE } from './_lib.js';

const base = () => String(env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL') || '').replace(/\/+$/, '');
const anon = () => env('SUPABASE_ANON_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY') || '';
const service = () => env('SUPABASE_SERVICE_ROLE_KEY') || '';
export const supabaseUrl = base;
export const cloudOn = () => !!(base() && anon() && service() && env('SESSION_SECRET'));
export const owners = () => (env('OWNER_EMAILS') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
export const isOwner = (email) => owners().includes(String(email || '').toLowerCase());
export const freeCalls = () => Math.max(0, parseInt(env('AI_FREE_CALLS') || '60', 10) || 0);
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

// 调 Supabase：as = 'service'（服务端特权，只用于成员 / 邀请表）| 用户的 access token（走行级权限）| 'anon'
export async function sb(path, { as = 'anon', method = 'GET', body, headers = {}, raw = false } = {}) {
  const key = as === 'service' ? service() : anon();
  const auth = as === 'service' ? service() : as === 'anon' ? anon() : as;
  const r = await fetch(base() + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${auth}`, ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (raw && r.ok && method === 'GET') return { status: r.status, ok: true, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: r.status, ok: r.ok, data };
}
export const errMsg = (r) => (r.data && (r.data.msg || r.data.message || r.data.error_description || r.data.error)) || `Supabase ${r.status}`;

// 云端会话放在同一个加密 cookie 里：{ k:'sb', uid, email, a: access_token, r: refresh_token, x: 过期时间(ms), at: 登录时间 }
export async function writeSession(res, s) { setCookie(res, COOKIE, await seal(s), { maxAge: 60 * 60 * 24 * 90 }); }
export function sessionFromAuth(j, prev = {}) {
  return { k: 'sb', uid: j.user ? j.user.id : prev.uid, email: (j.user && j.user.email) || prev.email, a: j.access_token, r: j.refresh_token, x: Date.now() + (j.expires_in || 3600) * 1000, at: prev.at || Date.now() };
}
// 拿一个还有效的 access token；快过期就用 refresh token 换新，并把新 cookie 写回去
export async function accessToken(s, res) {
  if (s.x - Date.now() > 60 * 1000) return s.a;
  const r = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.r } });
  if (!r.ok || !r.data || !r.data.access_token) throw Object.assign(new Error('登录已过期，请重新登录'), { status: 401 });
  const ns = sessionFromAuth(r.data, s); Object.assign(s, ns);
  if (res) await writeSession(res, ns);
  return ns.a;
}

// 让一个刚通过 Supabase 验证的人进门：已经是成员 / 站长直接放行；新人要用掉一个邀请码（inviteCode），再写进成员表。
// 返回 { ok: true } 或 { ok: false, status, error }
export async function admit(uid, email, inviteCode) {
  const m = await sb('/rest/v1/members?select=user_id&user_id=eq.' + encodeURIComponent(uid), { as: 'service' });
  if (m.ok && Array.isArray(m.data) && m.data.length > 0) return { ok: true };
  let by = 'owner';
  if (!isOwner(email)) {
    if (!inviteCode) return { ok: false, status: 403, error: '这个账号还没注册，需要邀请码' };
    const inv = await sb('/rest/v1/invites?select=code,uses,max_uses&code=eq.' + encodeURIComponent(inviteCode), { as: 'service' });
    const row = inv.ok && Array.isArray(inv.data) ? inv.data[0] : null;
    if (!row || row.uses >= row.max_uses) return { ok: false, status: 403, error: '邀请码无效或已用完' };
    // 只在 uses 没变的情况下 +1，两个人同时用最后一个名额时只有一个成功
    const up = await sb(`/rest/v1/invites?code=eq.${encodeURIComponent(row.code)}&uses=eq.${row.uses}`, { as: 'service', method: 'PATCH', body: { uses: row.uses + 1 }, headers: { Prefer: 'return=representation' } });
    if (!up.ok || !Array.isArray(up.data) || !up.data.length) return { ok: false, status: 409, error: '邀请码刚被别人用掉了' };
    by = row.code;
  }
  const ins = await sb('/rest/v1/members', { as: 'service', method: 'POST', body: { user_id: uid, email, invited_by: by }, headers: { Prefer: 'resolution=ignore-duplicates' } });
  if (!ins.ok) return { ok: false, status: 502, error: '写成员表失败：' + errMsg(ins) };
  return { ok: true };
}
