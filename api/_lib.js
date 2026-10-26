// Shared helpers for the serverless functions: encrypted session cookie + GitHub API.
const enc = new TextEncoder();
const dec = new TextDecoder();

export const env = (k, d) => process.env[k] ?? d;
export const COOKIE = 'ytos_session';

async function key() {
  const secret = env('SESSION_SECRET');
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

export async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(JSON.stringify(obj)));
  return b64u(iv) + '.' + b64u(ct);
}
export async function open(str) {
  try {
    const [iv, ct] = str.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await key(), unb64u(ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch { /* 坏的 % 序列：忽略这个 cookie，别让所有接口 500 */ } }
  }
  return out;
}
export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 天，服务端也检查，不只靠浏览器的 Max-Age
export function allowedUsers() { return (env('ALLOWED_USER') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean); }
export async function session(req) {
  const c = cookies(req)[COOKIE];
  const s = c ? await open(c) : null;
  if (!s) return null;
  if (!s.at || Date.now() - s.at > SESSION_MAX_AGE * 1000) return null; // 过期
  // 云端（Supabase 邮箱登录）会话：身份由 Supabase 的 token 决定，不走 GitHub 白名单
  if (s.k === 'sb') return s.uid && s.a && s.r ? { ...s, u: s.email } : null;
  if (!s.t || !s.u) return null;
  const allowed = allowedUsers(); if (!allowed.length || !allowed.includes(String(s.u).toLowerCase())) return null; // 每次请求都重查允许名单
  return s;
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function gh(token, path, init = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'yunningtang-os', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: r.status, ok: r.ok, body };
}

export function readBody(req, limit = 6e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); // 拼完再解码，中文不会在分块边界被切坏
    req.on('error', reject);
  });
}
// 请求体必须是 JSON 对象
export async function readJson(req, limit) {
  let body; try { body = JSON.parse(await readBody(req, limit)); } catch { return null; }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function dataTarget() {
  return { repo: env('DATA_REPO'), branch: env('DATA_BRANCH', 'main'), path: env('DATA_PATH', 'data/os.json') };
}
// 配置的分支在仓库里不存在（比如填了 master 但仓库是 main）时，改用仓库的默认分支；结果按函数实例缓存
const branchCache = new Map();
export async function resolveBranch(token, repo, want) {
  const key = repo + '#' + want;
  if (branchCache.has(key)) return branchCache.get(key);
  let out = want;
  const b = await gh(token, `/repos/${repo}/branches/${encodeURIComponent(want)}`);
  if (b.status === 404) {
    const r = await gh(token, `/repos/${repo}`);
    if (r.ok && r.body && r.body.default_branch) out = r.body.default_branch;
  }
  branchCache.set(key, out);
  return out;
}
