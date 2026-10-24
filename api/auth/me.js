import { session, json, dataTarget, env } from '../_lib.js';
import { modelName } from '../agent.js';

export default async function handler(req, res) {
  const s = await session(req);
  const t = dataTarget();
  // 只报变量名，不报值：方便在浏览器里直接看缺了哪个
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'DATA_REPO', 'ALLOWED_USER'].filter((k) => !env(k));
  json(res, 200, { missing, configured: !!(env('GITHUB_CLIENT_ID') && env('SESSION_SECRET') && t.repo), user: s ? { login: s.u, avatar: s.a } : null, target: s ? t : null, ai: !!(env('ANTHROPIC_API_KEY') || env('DEEPSEEK_API_KEY')), aiModel: s && (env('ANTHROPIC_API_KEY') || env('DEEPSEEK_API_KEY')) ? modelName() : null });
}
