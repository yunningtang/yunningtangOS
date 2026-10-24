// 汤圆的本机 AI 设置和用量统计。
// 密钥只存在这台浏览器的 localStorage（ytos.ai），不进同步文档、不进导出备份；每次请求放在请求头里发给自己的 /api/agent。
import { lsGet, lsSet } from './util.js';

const CFG_KEY = 'ytos.ai', USE_KEY = 'ytos.ai.usage';
const read = (k, d) => { try { return JSON.parse(lsGet(k, 'null')) || d; } catch { return d; } };

export function aiConfig() { return { provider: 'server', key: '', model: '', ...read(CFG_KEY, {}) }; }
export function setAiConfig(patch) { const next = { ...aiConfig(), ...patch }; lsSet(CFG_KEY, JSON.stringify(next)); return next; }
// 请求头：填了自己的密钥才带，否则由服务器的环境变量决定
export function aiHeaders() {
  const c = aiConfig(); const h = {};
  if (c.provider !== 'server' && c.key) { h['x-ai-provider'] = c.provider; h['x-ai-key'] = c.key; if (c.model) h['x-ai-model'] = c.model; }
  return h;
}
// 能不能用 AI：服务器配了，或者本机填了密钥；都要先登录
export function aiEnabled(login) { const c = aiConfig(); return !!(login && login.user && ((login.ai) || (c.provider !== 'server' && c.key))); }
export function aiLabel(login) { const c = aiConfig(); if (c.provider !== 'server' && c.key) return c.provider === 'deepseek' ? 'DeepSeek' : 'Claude'; return login && login.aiModel ? (/deepseek/i.test(login.aiModel) ? 'DeepSeek' : 'Claude') : 'AI'; }

/* ---- 用量：按月累计，本机 ---- */
const month = () => new Date().toISOString().slice(0, 7);
export function recordUsage(resp) {
  if (!resp || !resp.usage) return;
  const u = read(USE_KEY, {}); const m = month();
  const cur = u[m] || { calls: 0, in: 0, out: 0, cached: 0, modes: {} };
  cur.calls++; cur.in += resp.usage.in || 0; cur.out += resp.usage.out || 0; cur.cached += resp.usage.cached || 0;
  cur.modes[resp.mode || 'capture'] = (cur.modes[resp.mode || 'capture'] || 0) + 1;
  cur.model = resp.model || cur.model; cur.provider = resp.provider || cur.provider; cur.last = Date.now();
  u[m] = cur; lsSet(USE_KEY, JSON.stringify(u));
}
export function usageOf(m = month()) { return read(USE_KEY, {})[m] || { calls: 0, in: 0, out: 0, cached: 0, modes: {} }; }
export function clearUsage() { lsSet(USE_KEY, '{}'); }
// 粗略估价：每百万 token 的单价。DeepSeek 按官网人民币价，Claude 按美元换算；只是估计，以账单为准
const PRICE = { deepseek: { in: 2, out: 8, cur: '¥' }, anthropic: { in: 4 * 7.2, out: 20 * 7.2, cur: '¥' } };
export function estimateCost(u) {
  const p = PRICE[u.provider === 'deepseek' || /deepseek/i.test(u.model || '') ? 'deepseek' : 'anthropic'];
  const yuan = ((u.in - (u.cached || 0)) * p.in + (u.cached || 0) * p.in * 0.1 + u.out * p.out) / 1e6;
  return { text: `${p.cur}${yuan < 0.01 ? '不到 0.01' : yuan.toFixed(2)}`, yuan };
}
