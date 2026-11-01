// 空闲 / 多标签页的请求数测试：node tools/test-sync-idle.mjs <秒数> <标签页数> [edit]（模拟云端会像 Postgres jsonb 一样打乱键顺序）
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const SECS = +(process.argv[2] || 60), TABS = +(process.argv[3] || 1);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1300, height: 850 } });
let doc = null, ver = 0; const n = { get: 0, head: 0, put: 0, inB: 0, outB: 0 };
const jsonb = (v) => Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jsonb(v[k])])) : v;
await ctx.route('**/vendor/three.min.js', r => r.abort()); await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());
await ctx.route('**/api/auth/me', r => r.fulfill({ json: { cloud: true, configured: true, user: { email: 'x@y.com', login: 'x' }, target: { repo: 'x', branch: '' }, ai: false } }));
await ctx.route('**/api/file**', r => r.fulfill({ json: { ok: true, files: [] } }));
await ctx.route('**/api/sync', async (r) => {
  if (r.request().method() === 'GET' && r.request().url().includes('head=1')) { n.head++; return r.fulfill({ json: { sha: doc ? String(ver) : null } }); }
  if (r.request().method() === 'GET') { n.get++; const body = JSON.stringify(doc ? { sha: String(ver), data: doc } : { sha: null, data: null }); n.outB += body.length; return r.fulfill({ body, contentType: 'application/json', headers: { date: new Date().toUTCString() } }); }
  const raw = r.request().postData(); n.inB += raw.length; n.put++; const j = JSON.parse(raw);
  if (doc && String(j.sha) !== String(ver)) return r.fulfill({ status: 409, json: { error: 'conflict' } });
  doc = jsonb(JSON.parse(j.content)); ver++; return r.fulfill({ json: { sha: String(ver) }, headers: { date: new Date().toUTCString() } });
});
const pages = [];
for (let i = 0; i < TABS; i++) { const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message)); await p.goto('http://localhost:8000/#/'); pages.push(p); await p.waitForTimeout(1500); }
const t0 = { ...n }; await pages[0].waitForTimeout(SECS * 1000);
if (process.argv[4] === 'edit') { await pages[0].evaluate(async () => { const st = await import('/js/store.js'); st.upsert('todos', { id: 'zz1', title: '新待办', done: false, tags: [], created: '2026-11-01' }); }); await pages[0].waitForTimeout(15000);
  // tab switch away and back
  for (const p of pages) { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); }
  await pages[0].waitForTimeout(5000);
  console.log('other tab has the edit:', await pages[pages.length - 1].evaluate(async () => (await import('/js/store.js')).get().todos.some((t) => t.id === 'zz1'))); }
console.log(`after ${SECS}s idle${process.argv[4] ? ' + edit' : ''}, ${TABS} tab(s): head ${n.head - t0.head}, GET ${n.get - t0.get}, PUT ${n.put - t0.put}, version ${ver}, doc ${doc ? JSON.stringify(doc).length : 0} B, in ${(n.inB / 1024).toFixed(0)} KB out ${(n.outB / 1024).toFixed(0)} KB`);
await b.close();
