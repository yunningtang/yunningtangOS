// 同步防护的回归测试（用模拟的云端，不碰真实数据）：熔断、失败退避、上传前缩水确认、历史版本恢复、附件直传与失败退避。
// 用法：在仓库根目录 python3 -m http.server 8000，然后 node tools/test-sync-guards.mjs [breaker|retry|shrink|files|all]
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const WHICH = process.argv[2] || 'all';
const b = await chromium.launch();
const jsonb = (v) => Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, c) => a.length - c.length || (a < c ? -1 : a > c ? 1 : 0)).map((k) => [k, jsonb(v[k])])) : v;
// mock Supabase-backed /api/sync: version lock, 1.5 s rate limit, history snapshots, optional forced 500s
const srv = { doc: null, ver: 0, last: 0, hist: [], n: { get: 0, head: 0, put: 0, put429: 0, put500: 0, fileProxy: 0, signed: 0, signedPut: 0 }, fail500: false, failSigned: false };
async function mk(seedFn) {
  const ctx = await b.newContext();
  await ctx.route('**/vendor/three.min.js', r => r.abort());
  await ctx.route('https://fake-storage.test/**', async (r) => { srv.n.signedPut++; return srv.failSigned ? r.fulfill({ status: 500, body: 'x' }) : r.fulfill({ json: { Key: 'ok' } }); });
  await ctx.route(/^https?:\/\/(?!localhost|fake-storage)/, r => r.abort());
  await ctx.route('**/api/auth/me', r => r.fulfill({ json: { cloud: true, configured: true, user: { email: 'x@y.com', login: 'x' }, target: { repo: 'x', branch: '' } } }));
  await ctx.route('**/api/file**', async (r) => { const q = r.request(); if (q.method() === 'POST') { srv.n.signed++; return r.fulfill({ json: { url: 'https://fake-storage.test/up/' + JSON.parse(q.postData()).id } }); } if (q.method() === 'PUT') { srv.n.fileProxy++; return r.fulfill({ json: { ok: true } }); } return r.fulfill({ json: { ok: true, files: [] } }); });
  await ctx.route('**/api/sync**', async (r) => { const q = r.request(); const u = new URL(q.url());
    if (u.searchParams.get('history') === 'list') return r.fulfill({ json: { list: srv.hist.map((h, i) => ({ id: i + 1, version: h.ver, saved_at: h.at, bytes: JSON.stringify(h.doc).length, n_notes: (h.doc.notes || []).length, n_todos: (h.doc.todos || []).length })).reverse() } });
    if (u.searchParams.get('history')) { const h = srv.hist[+u.searchParams.get('history') - 1]; return r.fulfill({ json: { doc: h.doc, version: h.ver, saved_at: h.at } }); }
    if (u.searchParams.get('head')) { srv.n.head++; return r.fulfill({ json: { sha: srv.doc ? String(srv.ver) : null } }); }
    if (q.method() === 'GET') { srv.n.get++; return r.fulfill({ json: srv.doc ? { sha: String(srv.ver), data: srv.doc } : { sha: null, data: null } }); }
    srv.n.put++; if (srv.fail500) { srv.n.put500++; return r.fulfill({ status: 500, json: { error: 'boom' } }); }
    const j = JSON.parse(q.postData());
    if (srv.doc && Date.now() - srv.last < 1500) { srv.n.put429++; return r.fulfill({ status: 429, json: { error: 'rate', rate: true } }); }
    if (srv.doc && String(j.sha) !== String(srv.ver)) return r.fulfill({ status: 409, json: { error: 'c' } });
    if (srv.doc) srv.hist.push({ ver: srv.ver, doc: srv.doc, at: new Date().toISOString() });
    srv.doc = jsonb(JSON.parse(j.content)); srv.ver++; srv.last = Date.now(); return r.fulfill({ json: { sha: String(srv.ver) } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  if (seedFn) await p.addInitScript(seedFn);
  await p.goto('http://localhost:8000/#/'); await p.waitForTimeout(2500); return p;
}
const S = (p) => p.evaluate(async () => (await import('/js/sync.js')).status.error);
const edit = (p, id) => p.evaluate(async (id) => (await import('/js/store.js')).upsert('todos', { id, title: id, done: false, tags: [], created: '2026-11-01' }), id);
const hide = (p) => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });

if (WHICH === 'all' || WHICH === 'breaker') { // 1. a runaway loop gets cut off
  const A = await mk(); const p0 = srv.n.put + srv.n.get;
  for (let i = 0; i < 40; i++) { await edit(A, 'loop' + i); await hide(A); await A.waitForTimeout(1700); }
  const used = srv.n.put + srv.n.get - p0; console.log('breaker: requests during 40 forced syncs:', used, '| status:', await S(A));
  await A.context().close();
}
if (WHICH === 'all' || WHICH === 'retry') { // 2. server 500 → backoff, not a storm
  srv.fail500 = true; const A = await mk(); const p0 = srv.n.put500;
  await edit(A, 'r1'); await hide(A); await A.waitForTimeout(30000);
  console.log('retry: PUT attempts in 30 s while server returns 500:', srv.n.put500 - p0, '(expect ~3: now, ~5 s, ~20 s)');
  srv.fail500 = false; await A.waitForTimeout(50000); console.log('retry: recovered by itself:', !(await S(A)), '| cloud has r1:', JSON.stringify(srv.doc || {}).includes('"r1"'));
  await A.context().close();
}
if (WHICH === 'all' || WHICH === 'shrink') { // 3. big shrink asks first
  srv.doc = null; srv.ver = 0; srv.hist = [];
  const A = await mk(); for (let i = 0; i < 30; i++) await A.evaluate(async (i) => (await import('/js/store.js')).upsert('todos', { id: 'k' + i, title: 'k' + i, done: false, tags: [], created: '2026-11-01' }), i);
  await hide(A); await A.waitForTimeout(3000); const v0 = srv.ver;
  await A.evaluate(async () => { const st = await import('/js/store.js'); st.update((d) => { d.todos = []; d.notes = []; d.blocks = []; d.sessions = []; }); });
  await hide(A); await A.waitForTimeout(1500);
  console.log('shrink: confirm shown:', await A.locator('.modal', { hasText: '要上传的数据少了很多' }).count(), '| text:', (await A.locator('.modal').innerText().catch(() => '')).split('\n')[1]);
  await A.locator('.modal button', { hasText: '取消' }).click(); await A.waitForTimeout(800);
  console.log('shrink: after cancel, cloud untouched:', srv.ver === v0, '| status:', await S(A));
  // 4. history restore through settings
  await A.goto('http://localhost:8000/#/settings?sec=data'); await A.waitForTimeout(1200);
  await A.locator('.sx-btn', { hasText: '查看' }).click(); await A.waitForTimeout(800);
  console.log('history rows:', await A.locator('.hist-row').count(), '|', (await A.locator('.hist-row').first().innerText().catch(() => '')).replace(/\n/g, ' '));
  await A.locator('.hist-row .sx-btn').first().click(); await A.waitForTimeout(400); await A.locator('.modal.confirm .modal-f button', { hasText: '恢复' }).click(); await A.waitForTimeout(3500);
  console.log('toast:', await A.locator('.toast').allInnerTexts().catch(() => []), '| confirm open:', await A.locator('.modal.confirm').count(), '| hist modal:', await A.locator('.hist-row').count()); const after = await A.evaluate(async () => (await import('/js/store.js')).get().todos.length);
  console.log('restore: local todos', after, '| cloud todos', (srv.doc.todos || []).length, '| status:', await S(A));
  await A.context().close();
}
if (WHICH === 'all' || WHICH === 'files') { // 5. attachments go direct; failures back off
  const A = await mk(); const f0 = { ...srv.n };
  await A.evaluate(async () => { const f = await import('/js/files.js'); await f.saveFile(new File([new Uint8Array(20000)], 'a.png', { type: 'image/png' })); });
  await edit(A, 'f1'); await hide(A); await A.waitForTimeout(4000);
  console.log('files: via Vercel proxy:', srv.n.fileProxy - f0.fileProxy, '| signed direct:', srv.n.signedPut - f0.signedPut);
  srv.failSigned = true; await A.evaluate(async () => { const f = await import('/js/files.js'); await f.saveFile(new File([new Uint8Array(20000)], 'b.png', { type: 'image/png' })); });
  const s0 = srv.n.signedPut; for (let i = 0; i < 6; i++) { await edit(A, 'g' + i); await hide(A); await A.waitForTimeout(2200); }
  console.log('files: upload attempts for a failing file across 6 syncs:', srv.n.signedPut - s0, '(expect 1)');
  srv.failSigned = false; await A.context().close();
}
console.log('rate-limited PUTs seen:', srv.n.put429);
await b.close();
