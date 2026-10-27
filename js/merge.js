// Three-way merge of two state documents against the last synced copy ("base").
// Per record: whichever side changed it since the base wins; if both changed, the newer
// `updated` stamp wins (local when there is none). A deletion loses to an edit on the other side.
const LISTS = ['todos', 'blocks', 'books', 'links', 'notes', 'notebooks', 'trash', 'trips', 'canvases', 'sessions'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = (x) => (x && (x.updated || x.updatedAt || x.deletedAt || x.completedAt || '')) || '';

// 记录用 id 分组；没有 id 的（自定义时间块类型只有 v）退回用 v，再不行就整条 JSON，绝不把多条挤到同一个 key
const keyOf = (x) => (x && (x.id ?? x.v ?? JSON.stringify(x)));
export function mergeList(base = [], local = [], remote = []) {
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
    else pick = stamp(r) > stamp(l) ? r : l;
    if (pick) out.push(pick);
  }
  const orderOf = (l) => l.map(keyOf).join('\u0001');
  const localMoved = orderOf(local) !== orderOf(base.filter((x) => lm.has(keyOf(x))));
  const primary = localMoved ? local : remote, secondary = localMoved ? remote : local;
  const pos = new Map(primary.map((x, i) => [keyOf(x), i])); const spos = new Map(secondary.map((x, i) => [keyOf(x), i]));
  out.sort((a, b) => (pos.has(keyOf(a)) ? pos.get(keyOf(a)) : 1e6 + (spos.get(keyOf(a)) || 0)) - (pos.has(keyOf(b)) ? pos.get(keyOf(b)) : 1e6 + (spos.get(keyOf(b)) || 0)));
  return out;
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

export function merge3(base, local, remote) {
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
  for (const c of LISTS) out[c] = out[c].filter((x) => { const t = x && x.id != null && tombs[c + ':' + x.id]; return !t || stamp(x) > t; });
  // 同一页不能既在笔记里又在最近删除里：看哪边更晚——删除得晚就留在最近删除，删除后又改过就留在笔记
  const trashAt = new Map(out.trash.map((n) => [n.id, n.deletedAt || n.updated || '']));
  out.notes = out.notes.filter((n) => !trashAt.has(n.id) || stamp(n) > trashAt.get(n.id));
  const live = new Set(out.notes.map((n) => n.id)); out.trash = out.trash.filter((n) => !live.has(n.id));
  out.profile = mergeObj(base.profile, local.profile, remote.profile);
  // settings stay per device, except the dashboard layout and place which are nice to share
  const ls = local.settings || {}, rs = remote.settings || {}, bs = base.settings || {};
  out.settings = { ...ls, dash: mergeObj({ dash: bs.dash }, { dash: ls.dash }, { dash: rs.dash }).dash, place: mergeObj({ place: bs.place }, { place: ls.place }, { place: rs.place }).place, focusGoal: ls.focusGoal ?? rs.focusGoal, kinds: mergeList(bs.kinds || [], ls.kinds || [], rs.kinds || []) };
  out.updatedAt = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || null;
  return out;
}

// what the sync compares: everything except per-device settings and the stamp
export function syncView(doc) {
  const { settings, updatedAt, ...rest } = doc || {};
  return JSON.stringify({ ...rest, settings: { dash: settings && settings.dash, place: settings && settings.place, focusGoal: settings && settings.focusGoal, kinds: settings && settings.kinds } });
}
