// Three-way merge of two state documents against the last synced copy ("base").
// Per record: whichever side changed it since the base wins; if both changed, the newer
// `updated` stamp wins (local when there is none). A deletion loses to an edit on the other side.
const LISTS = ['todos', 'blocks', 'books', 'links', 'notes', 'notebooks', 'trash', 'trips', 'canvases', 'sessions'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = (x) => (x && (x.updated || x.updatedAt || x.deletedAt || x.completedAt || '')) || '';

export function mergeList(base = [], local = [], remote = []) {
  const bm = new Map(base.map((x) => [x.id, x])), lm = new Map(local.map((x) => [x.id, x])), rm = new Map(remote.map((x) => [x.id, x]));
  const ids = [...new Set([...base, ...local, ...remote].map((x) => x.id))];
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
  const orderOf = (l) => l.map((x) => x.id).join('\u0001');
  const localMoved = orderOf(local) !== orderOf(base.filter((x) => lm.has(x.id)));
  const primary = localMoved ? local : remote, secondary = localMoved ? remote : local;
  const pos = new Map(primary.map((x, i) => [x.id, i])); const spos = new Map(secondary.map((x, i) => [x.id, i]));
  out.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + (spos.get(a.id) || 0)) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + (spos.get(b.id) || 0)));
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
