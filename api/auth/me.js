import { session, json, dataTarget, env } from '../_lib.js';
import { modelName } from '../agent.js';

export default async function handler(req, res) {
  const s = await session(req);
  const t = dataTarget();
  json(res, 200, { configured: !!(env('GITHUB_CLIENT_ID') && env('SESSION_SECRET') && t.repo), user: s ? { login: s.u, avatar: s.a } : null, target: s ? t : null, ai: !!(env('ANTHROPIC_API_KEY') || env('DEEPSEEK_API_KEY')), aiModel: s && (env('ANTHROPIC_API_KEY') || env('DEEPSEEK_API_KEY')) ? modelName() : null });
}
