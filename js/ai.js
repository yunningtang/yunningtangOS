// 汤圆的本机 AI 设置和用量统计。
// 密钥只存在这台浏览器的 localStorage（ytos.ai），不进同步文档、不进导出备份；每次请求放在请求头里发给自己的 /api/agent。
import { lsGet, lsSet } from './util.js';

const CFG_KEY = 'ytos.ai', USE_KEY = 'ytos.ai.usage';
const read = (k, d) => { try { return JSON.parse(lsGet(k, 'null')) || d; } catch { return d; } };

// provider：server 用 Vercel 环境变量 | deepseek / anthropic 用本机填的密钥 | local 不用 AI，只按本地规则
// 密钥按家各存一份（keys），切换时不会把 DeepSeek 的密钥发给 Claude
export function aiConfig() {
  const c = { provider: 'server', key: '', model: '', keys: {}, models: {}, ...read(CFG_KEY, {}) };
  if (!c.keys || typeof c.keys !== 'object') c.keys = {};
  if (!c.models || typeof c.models !== 'object') c.models = {};
  if (c.provider === 'deepseek' || c.provider === 'anthropic') { if (c.key && !c.keys[c.provider]) c.keys[c.provider] = c.key; if (c.model && !c.models[c.provider]) c.models[c.provider] = c.model; } // 旧版只有一份 key / model
  c.key = c.keys[c.provider] || ''; c.model = c.models[c.provider] || '';
  return c;
}
export function setAiConfig(patch) {
  const cur = aiConfig(); const next = { ...cur, ...patch };
  if (patch.key !== undefined) next.keys = { ...cur.keys, [cur.provider]: patch.key };
  if (patch.model !== undefined) next.models = { ...cur.models, [cur.provider]: patch.model };
  lsSet(CFG_KEY, JSON.stringify({ provider: next.provider, keys: next.keys, models: next.models }));
  return aiConfig();
}
export function hasKey(provider) { return !!aiConfig().keys[provider]; }
// 请求头：填了自己的密钥才带，否则由服务器的环境变量决定
export function aiHeaders() {
  const c = aiConfig(); const h = {};
  if (c.provider !== 'server' && c.key) { h['x-ai-provider'] = c.provider; h['x-ai-key'] = c.key; if (c.model) h['x-ai-model'] = c.model; }
  return h;
}
// 能不能用 AI：服务器配了，或者本机填了密钥；都要先登录
export function aiEnabled(login) { const c = aiConfig(); if (c.provider === 'local') return false; return !!(login && login.user && ((c.provider === 'server' && login.ai) || (c.provider !== 'server' && c.key))); }
export function aiLabel(login) { const c = aiConfig(); if (c.provider === 'local') return '不用 AI'; if (c.provider !== 'server') return c.provider === 'deepseek' ? 'DeepSeek' : 'Claude'; return login && login.aiModel ? (/deepseek/i.test(login.aiModel) ? 'DeepSeek' : 'Claude') : 'AI'; }
// 可选的「谁来当汤圆的脑子」：给对话框头部和设置页用
export function aiOptions(login) {
  const c = aiConfig(); const serverName = login && login.aiModel ? (/deepseek/i.test(login.aiModel) ? 'DeepSeek' : 'Claude') : '';
  return [
    { v: 'server', label: '服务器配置', hint: login && login.ai ? 'Vercel · ' + serverName : '没配密钥', ok: !!(login && login.ai) },
    { v: 'deepseek', label: 'DeepSeek', hint: c.keys.deepseek ? '我的密钥' : '没填密钥', ok: !!c.keys.deepseek },
    { v: 'anthropic', label: 'Claude', hint: c.keys.anthropic ? '我的密钥' : '没填密钥', ok: !!c.keys.anthropic },
    { v: 'local', label: '不用 AI', hint: '本地语法', ok: true },
  ];
}

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
