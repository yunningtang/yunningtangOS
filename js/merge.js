// Three-way merge of two state documents against the last synced copy ("base").
// Per record: whichever side changed it since the base wins; if both changed, the fields are merged
// one by one (lists with ids — note paragraphs, steps — record by record again), and where the same
// field changed on both sides the newer `updated` stamp wins (local when there is none).
// A deletion loses to an edit on the other side.
import { blocksToMd } from './blocks.js';
const LISTS = ['todos', 'blocks', 'books', 'links', 'notes', 'notebooks', 'trash', 'trips', 'canvases', 'sessions'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = (x) => (x && (x.updated || x.updatedAt || x.deletedAt || x.completedAt || '')) || '';

// 记录用 id 分组；没有 id 的（自定义时间块类型只有 v）退回用 v，再不行就整条 JSON，绝不把多条挤到同一个 key
const keyOf = (x) => (x && (x.id ?? x.v ?? JSON.stringify(x)));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const idList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && x.id != null);

// 同一条两边都改了：按字段合；两边都改的字段，带 id 的列表（笔记段落、步骤）再按条合，其余看谁更晚。
// 这样同一篇笔记在两台设备上改了不同的段落，两边的改动都留下；同一段两边都改了才以更晚的为准
// rNewer：外层那条是云端更晚（段落、步骤自己没有时间，就跟外层）
function mergeRec(b, l, r, rNewer = false) {
  const sr = stamp(r), sl = stamp(l);
  const newer = sr > sl || (sr === sl && rNewer) ? r : l;
  if (!isObj(b) || !isObj(l) || !isObj(r)) return newer;
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const lc = !same(b[k], l[k]), rc = !same(b[k], r[k]);
    let v;
    if (!lc) v = r[k]; else if (!rc) v = l[k];
    else if (Array.isArray(l[k]) && Array.isArray(r[k]) && (idList(l[k]) || idList(r[k]))) v = mergeList(Array.isArray(b[k]) ? b[k] : [], l[k], r[k], newer === r);
    else v = newer[k];
    if (v !== undefined) out[k] = v;
  }
  // 笔记的正文 markdown 跟着段落走：段落是拼出来的新内容时重新生成
  if (Array.isArray(out.blocks) && typeof out.body === 'string' && !same(out.blocks, l.blocks) && !same(out.blocks, r.blocks)) {
    try { out.body = blocksToMd(out.blocks); } catch {}
  }
  return out;
}
export function mergeList(base = [], local = [], remote = [], rNewer = false) {
  const arr = (l) => (Array.isArray(l) ? l.filter(Boolean) : []); base = arr(base); local = arr(local); remote = arr(remote);
  const bm = new Map(base.map((x) => [keyOf(x), x])), lm = new Map(local.map((x) => [keyOf(x), x])), rm = new Map(remote.map((x) => [keyOf(x), x]));
  const ids = [...new Set([...base, ...local, ...remote].map(keyOf))];
  const out = [];
  for (const id of ids) {
    const b = bm.get(id), l = lm.get(id), r = rm.get(id);
    const lc = !same(b, l), rc = !same(b, r);
    let pick;
    if (!lc) pick = r; else if (!rc) pick = l;
    else if (!l) pick = r; else if (!r) pick = l;
    else pick = mergeRec(b, l, r, rNewer);
    if (pick) out.push(pick);
  }
  // 顺序：以动过顺序的一边为准（都没动就用云端的），另一边新加的放在它原来前一条的后面
  const orderOf = (l) => l.map(keyOf).join('\u0001');
  const localMoved = orderOf(local) !== orderOf(base.filter((x) => lm.has(keyOf(x))));
  const primary = localMoved ? local : remote, secondary = localMoved ? remote : local;
  const byKey = new Map(out.map((x) => [keyOf(x), x]));
  const order = [...new Set(primary.map(keyOf))].filter((k) => byKey.has(k)); const placed = new Set(order);
  secondary.forEach((x, i) => {
    const k = keyOf(x); if (placed.has(k) || !byKey.has(k)) return;
    let j = i - 1; while (j >= 0 && !placed.has(keyOf(secondary[j]))) j--;
    order.splice(j < 0 ? 0 : order.indexOf(keyOf(secondary[j])) + 1, 0, k); placed.add(k);
  });
  return order.map((k) => byKey.get(k));
}

// field-level merge of a plain object (profile, a week entry)
export function mergeObj(base = {}, local = {}, remote = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const lc = !same(base[k], local[k]), rc = !same(base[k], remote[k]);
    const v = !lc ? remote[k] : !rc ? local[k] : local[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// map of keys (weeks by week key, goals by month) with a merger for the values
export function mergeMap(base = {}, local = {}, remote = {}, mergeVal) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[k], l = local[k], r = remote[k];
    const lc = !same(b, l), rc = !same(b, r);
    let v;
    if (!lc) v = r; else if (!rc) v = l;
    else if (l == null) v = r; else if (r == null) v = l;
    else v = mergeVal(b, l, r);
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// 跟着帐号走的设置（换设备也要在）；其余（主题、外观、汤圆的样子、同步凭据）留在这台设备
export const SHARED_SETTINGS = ['dash', 'place', 'focusGoal', 'kinds', 'brainWords', 'brainReview', 'brainNav', 'doing', 'navOrder', 'readTypes', 'prompts', 'tagColors', 'photo'];
// 一项设置的三方合并：列表按条合并，对象按键合并，其余谁改了用谁（两边都改用本地）
export function mergeSetting(b, l, r) {
  if (Array.isArray(l) || Array.isArray(r)) return mergeList(Array.isArray(b) ? b : [], Array.isArray(l) ? l : [], Array.isArray(r) ? r : []);
  if (isObj(l) && isObj(r)) return mergeObj(isObj(b) ? b : {}, l, r);
  const lc = !same(b, l), rc = !same(b, r);
  return !lc ? r : !rc ? l : l;
}
// 删除记录过滤：删除时间晚于最后一次编辑的不要
const alive = (tombs, c) => (x) => { const t = x && x.id != null && tombs[c + ':' + x.id]; return !t || stamp(x) > t; };

// opts.allSettings：同一台设备的两个标签页之间合并，所有设置都合
export function merge3(base, local, remote, opts = {}) {
  base = base || {};
  const out = { ...local };
  for (const c of LISTS) out[c] = mergeList(base[c] || [], local[c] || [], remote[c] || []);
  out.goals = mergeMap(base.goals, local.goals, remote.goals, (b, l, r) => mergeList(b || [], l || [], r || []));
  out.weeks = mergeMap(base.weeks, local.weeks, remote.weeks, (b, l, r) => ({ ...mergeObj(b || {}, l || {}, r || {}), items: mergeMap((b || {}).items, (l || {}).items, (r || {}).items, (bb, ll, rr) => mergeList(bb || [], ll || [], rr || [])) }));
  const bv = base.vision || {}, lv = local.vision || {}, rv = remote.vision || {};
  out.vision = { ...lv, statements: mergeList(bv.statements, lv.statements, rv.statements), board: mergeList(bv.board, lv.board, rv.board), longterm: mergeList(bv.longterm, lv.longterm, rv.longterm), areas: mergeList(bv.areas, lv.areas, rv.areas) };
  // 删除记录：两边的合起来（同一条取更晚的时间）。删除时间晚于这条最后一次编辑的 → 不要它。
  // 这样即使「上次同步的那份」不准，另一边也没法把已经删掉的东西带回来；删除之后又在别处改过的，照样留着
  const tombs = { ...(remote.tombs || {}) }; for (const [k, v] of Object.entries(local.tombs || {})) if (!tombs[k] || v > tombs[k]) tombs[k] = v;
  out.tombs = tombs;
  for (const c of LISTS) out[c] = out[c].filter(alive(tombs, c));
  for (const mk of Object.keys(out.goals)) out.goals[mk] = (out.goals[mk] || []).filter(alive(tombs, 'goals'));
  for (const k of ['statements', 'board', 'longterm', 'areas']) out.vision[k] = (out.vision[k] || []).filter(alive(tombs, 'vision.' + k));
  // 同一页不能既在笔记里又在最近删除里：看哪边更晚——删除得晚就留在最近删除，删除后又改过就留在笔记
  const trashAt = new Map(out.trash.map((n) => [n.id, n.deletedAt || n.updated || '']));
  out.notes = out.notes.filter((n) => !trashAt.has(n.id) || stamp(n) > trashAt.get(n.id));
  const live = new Set(out.notes.map((n) => n.id)); out.trash = out.trash.filter((n) => !live.has(n.id));
  out.profile = mergeObj(base.profile, local.profile, remote.profile);
  const ls = local.settings || {}, rs = remote.settings || {}, bs = base.settings || {};
  out.settings = { ...ls };
  for (const k of opts.allSettings ? new Set([...Object.keys(bs), ...Object.keys(ls), ...Object.keys(rs)]) : SHARED_SETTINGS) {
    if (k === 'sync') continue; // 同步凭据永远用本机的
    const v = mergeSetting(bs[k], ls[k], rs[k]); if (v === undefined) delete out.settings[k]; else out.settings[k] = v;
  }
  out.updatedAt = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || null;
  return out;
}

// what the sync compares: everything except per-device settings and the stamp（跟着帐号走的设置算在内）
export function syncView(doc) {
  const { settings, updatedAt, ...rest } = doc || {};
  const st = settings || {};
  return JSON.stringify({ ...rest, settings: Object.fromEntries(SHARED_SETTINGS.map((k) => [k, st[k]])) });
}
