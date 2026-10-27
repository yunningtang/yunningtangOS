// POST { password } -> 给已登录的云端帐号设置 / 修改密码，之后可以用「邮箱 + 密码」登录
import { session, json, readJson } from '../_lib.js';
import { cloudOn, sb, errMsg, accessToken } from '../_cloud.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (!cloudOn()) return json(res, 503, { error: '云端还没配置' });
  const s = await session(req);
  if (!s || s.k !== 'sb') return json(res, 401, { error: '先登录' });
  const body = await readJson(req, 4096);
  const password = String((body && body.password) || '');
  if (password.length < 8 || password.length > 72) return json(res, 400, { error: '密码要 8 到 72 位' });
  let tok; try { tok = await accessToken(s, res); } catch (e) { return json(res, 401, { error: e.message }); }
  const r = await sb('/auth/v1/user', { as: tok, method: 'PUT', body: { password } });
  if (!r.ok) return json(res, r.status === 422 ? 400 : 502, { error: r.status === 422 ? '密码太简单了，换一个' : errMsg(r) });
  json(res, 200, { ok: true });
}
