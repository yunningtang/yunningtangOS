import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, upsert, remove, removeUndo } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Stars, TagInput, confirmDel, DateInput, Select } from '../ui.js';
import { uid, todayStr, sortBy, fmtDate } from '../util.js';
import { mountGlobe } from '../globe.js';
import { ctxMenu } from '../ctx.js';
import { Splitter } from '../resize.js';
import { linkedPage } from './notes.js';
import { go } from '../nav.js';
import { dragProps, dropProps } from '../dnd.js';
import { searchPlace } from '../weather.js';
import { toast } from '../nav.js';

// 地点搜索：打字就出候选（Open-Meteo 地名库，中文可搜），选一个自动填省 / 国家 / 经纬度
function PlaceSearch({ value, onInput, onPick, hasCoords }) {
  const [list, setList] = useState([]); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [hi, setHi] = useState(0);
  const timer = useRef(); const seq = useRef(0);
  const run = (q) => {
    clearTimeout(timer.current); if (!q.trim() || q.trim().length < 2) { setList([]); setOpen(false); return; }
    timer.current = setTimeout(async () => { const my = ++seq.current; setBusy(true); try { const r = await searchPlace(q.trim()); if (my === seq.current) { setList(r); setOpen(true); setHi(0); } } catch { if (my === seq.current) setList([]); } finally { if (my === seq.current) setBusy(false); } }, 280);
  };
  const pick = (r) => { onPick(r); setOpen(false); setList([]); };
  return html`<div class="pl-wrap">
    <input type="text" autofocus value=${value} placeholder="输入城市或地名，比如 多伦多 / Kanas / 冰岛" autocomplete="off" onInput=${(e) => { onInput(e.target.value); run(e.target.value); }} onFocus=${() => list.length && setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 150)}
      onKeyDown=${(e) => { if (!open || !list.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % list.length); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + list.length) % list.length); } else if (e.key === 'Enter') { e.preventDefault(); pick(list[hi]); } else if (e.key === 'Escape') setOpen(false); }} />
    ${busy && html`<span class="pl-busy"></span>`}
    ${!busy && hasCoords && html`<span class="pl-ok" title="已有坐标"><${Icon} name="check" size=${12} /></span>`}
    ${open && list.length > 0 && html`<div class="pl-list">${list.map((r, i) => html`<button type="button" key=${i} class=${i === hi ? 'on' : ''} onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(r)}><b>${r.name}</b><small>${r.sub}</small></button>`)}</div>`}
  </div>`;
}

export function TripModal({ open, trip, onClose }) {
  const [f, setF] = useState(null);
  const [showXY, setShowXY] = useState(false);
  useEffect(() => { if (open) { setF(trip ? { ...trip } : { id: uid(), place: '', region: '', country: '', lat: '', lng: '', date: todayStr(), end: '', note: '', photos: [], rating: 0, tags: [], kind: 'trip' }); setShowXY(false); } }, [open, trip]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const hasXY = f.lat !== '' && f.lng !== '' && !Number.isNaN(parseFloat(f.lat)) && !Number.isNaN(parseFloat(f.lng));
  const save = async () => {
    if (!f.place.trim()) return;
    let lat = parseFloat(f.lat), lng = parseFloat(f.lng), extra = {};
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      // 没选候选就直接保存：拿第一个搜索结果
      try { const r = await searchPlace(f.place.trim()); if (r.length) { lat = r[0].lat; lng = r[0].lng; extra = { region: f.region || r[0].region, country: f.country || r[0].country }; } } catch {}
      if (Number.isNaN(lat) || Number.isNaN(lng)) { toast('没找到这个地方，换个写法试试，或者展开「坐标」手动填'); setShowXY(true); return; }
    }
    upsert('trips', { ...f, ...extra, place: f.place.trim(), lat, lng, photos: (Array.isArray(f.photos) ? f.photos : String(f.photos).split('\n')).map((x) => x.trim()).filter(Boolean) });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${trip ? '编辑足迹' : '记录一个地方'} foot=${html`
    ${trip && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { removeUndo('trips', trip.id, trip.title || trip.place || trip.url); onClose(); }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="地点" hint="打两个字就出候选，选中自动填省 / 国家 / 坐标；不选也行，保存时按第一个结果">
        <${PlaceSearch} value=${f.place} hasCoords=${hasXY} onInput=${(v) => set('place', v)} onPick=${(r) => setF({ ...f, place: r.name, region: r.region, country: r.country, lat: r.lat, lng: r.lng })} />
      <//>
      <div class="grid2">
        <${Field} label="省 / 州"><input type="text" value=${f.region} onInput=${(e) => set('region', e.target.value)} /><//>
        <${Field} label="国家 / 地区"><input type="text" value=${f.country} placeholder="中国" onInput=${(e) => set('country', e.target.value)} /><//>
      </div>
      <button type="button" class="xy-tg" onClick=${() => setShowXY(!showXY)}><${Icon} name=${showXY ? 'down' : 'right'} size=${11} /> 坐标${hasXY ? ` · ${(+f.lat).toFixed(4)}, ${(+f.lng).toFixed(4)}` : '（还没有）'}</button>
      ${showXY && html`<div class="grid2">
        <${Field} label="纬度 lat" hint="北纬为正"><input type="number" step="0.0001" value=${f.lat} placeholder="43.65" onInput=${(e) => set('lat', e.target.value)} /><//>
        <${Field} label="经度 lng" hint="东经为正"><input type="number" step="0.0001" value=${f.lng} placeholder="-79.38" onInput=${(e) => set('lng', e.target.value)} /><//>
      </div>`}
      <div class="grid3">
        <${Field} label="开始"><${DateInput} value=${f.date} onChange=${(v) => set('date', v)} /><//>
        <${Field} label="结束"><${DateInput} value=${f.end} onChange=${(v) => set('end', v)} /><//>
        <${Field} label="类型"><${Select} value=${f.kind} options=${[{ v: 'trip', label: '旅行' }, { v: 'live', label: '居住过' }, { v: 'wish', label: '想去' }]} onChange=${(v) => set('kind', v)} /><//>
      </div>
      <${Field} label="评分"><${Stars} value=${f.rating} onChange=${(v) => set('rating', v)} size=${16} /><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="照片 URL · 每行一个"><textarea rows="3" value=${Array.isArray(f.photos) ? f.photos.join('\n') : f.photos} onInput=${(e) => set('photos', e.target.value)}></textarea><//>
      <${Field} label="记录"><textarea rows="5" value=${f.note} placeholder="看到了什么，想到了什么。" onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

export default function Explore({ route }) {
  const s = useStore();
  const [sel, setSel] = useState((route && route.query && route.query.sel) || null);
  useEffect(() => { const id = route && route.query && route.query.sel; if (id) setSel(id); }, [route && route.query && route.query.sel]);
  const tripPage = (t) => { const n = linkedPage('trip:' + t.id, { title: t.place, nb: '旅行', color: '#c7873a', tags: ['旅行', ...t.tags], body: `${[t.region, t.country].filter(Boolean).join(' · ')} · ${t.date}${t.end ? ' – ' + t.end : ''}\n\n${t.note ? t.note + '\n\n' : ''}## 行程\n\n## 记录\n` }); go('notes/' + n.id); };
  const hasPage = (t) => s.notes.some((n) => n.ref === 'trip:' + t.id);
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [kind, setKind] = useState('all');
  const canvas = useRef();
  const globe = useRef();
  const trips = useMemo(() => sortBy(kind === 'all' ? s.trips : s.trips.filter((t) => (t.kind || 'trip') === kind), '-date'), [s.trips, kind]);
  const markers = useMemo(() => s.trips.map((t) => ({ id: t.id, lat: t.lat, lng: t.lng, label: t.place, kind: t.kind || 'trip' })), [s.trips]);

  useEffect(() => {
    globe.current = mountGlobe(canvas.current, { markers, onSelect: (id) => setSel(id) });
    return () => globe.current && globe.current.destroy();
  }, []);
  useEffect(() => { globe.current && globe.current.setMarkers(markers); }, [markers]);
  useEffect(() => { globe.current && globe.current.select(sel); }, [sel]);

  const countries = useMemo(() => { const m = new Map(); s.trips.filter((t) => t.kind !== 'wish').forEach((t) => { const k = t.country || '未知'; m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [s.trips]);
  const regions = new Set(s.trips.filter((t) => t.kind !== 'wish' && t.region).map((t) => t.country + t.region)).size;
  const selTrip = s.trips.find((t) => t.id === sel);

  return html`<div>
    <div class="page-h">
      <div class="acts"><${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>记录足迹<//></div>
    </div>
    <div class="explore">
      <div class="stack">
        <${Card} class="globe-card grow" pad=${false} style="min-height:480px">
          <canvas ref=${canvas}></canvas>
          <div class="stat"><span><b>${countries.length}</b><small>国家 / 地区</small></span><span><b>${regions}</b><small>省 / 州</small></span><span><b>${s.trips.filter((t) => t.kind !== 'wish').length}</b><small>足迹</small></span></div>
          <div class="gbtns">
            <button class="gbtn" title="放大（滚轮 / 双击）" onClick=${() => globe.current.zoomBy(1.4)}><${Icon} name="plus" size=${14} /></button>
            <button class="gbtn" title="缩小" onClick=${() => globe.current.zoomBy(1 / 1.4)}><${Icon} name="minus" size=${14} /></button>
            <button class="gbtn" title="复位视角" onClick=${() => globe.current.reset()}><${Icon} name="target" size=${14} /></button>
            <button class="gbtn" title="自动旋转" onClick=${() => globe.current.toggleAuto()}><${Icon} name="refresh" size=${14} /></button>
          </div>
          <div class="ov">拖动旋转 · 滚轮或双指缩放 · 点击光点查看 · 琥珀色为想去</div>
        <//>
        ${selTrip && html`<${Card} class="fi" title=${selTrip.place} sub=${`${selTrip.region ? selTrip.region + ' · ' : ''}${selTrip.country} · ${fmtDate(selTrip.date, true)}${selTrip.end ? ' – ' + fmtDate(selTrip.end) : ''}`} action=${html`<${Btn} small kind=${hasPage(selTrip) ? '' : 'ghost'} icon="note" onClick=${() => tripPage(selTrip)}>${hasPage(selTrip) ? '打开游记' : '写游记'}<//><${IconBtn} icon="edit" title="编辑" onClick=${() => { setEditing(selTrip); setModal(true); }} /><${IconBtn} icon="x" title="关闭" onClick=${() => setSel(null)} />`}>
          <div class="row wrap" style="gap:6px;margin-bottom:8px">${selTrip.rating > 0 && html`<${Stars} value=${selTrip.rating} />`}${selTrip.tags.map((t) => html`<${Tag}>${t}<//>`)}<${Tag}>${{ trip: '旅行', live: '居住', wish: '想去' }[selTrip.kind || 'trip']}<//></div>
          ${selTrip.note && html`<p style="font-size:.86rem;line-height:1.7;white-space:pre-wrap">${selTrip.note}</p>`}
          ${selTrip.photos.length > 0 && html`<div class="trip-photos">${selTrip.photos.map((p) => html`<a href=${p} target="_blank" rel="noopener"><img src=${p} alt="" loading="lazy" /></a>`)}</div>`}
        <//>`}
      </div>
      <${Splitter} varName="expside" min=${260} max=${560} dir=${-1} class="sp-col" />
      <div class="stack">
        <${Card} class="grow" title="地点列表" sub="按时间倒序" action=${html`<div class="seg" data-liquid="button"><span class="liq"></span>${[['all', '全部'], ['trip', '旅行'], ['live', '居住'], ['wish', '想去']].map(([v, n]) => html`<button type="button" class=${kind === v ? 'on' : ''} onClick=${() => setKind(v)} ...${v === 'all' ? {} : dropProps('trip', (d) => upsert('trips', { id: d.id, kind: v }))}>${n}</button>`)}</div>`}>
          ${trips.length === 0 ? html`<${Empty} icon="pin" text="还没有足迹。从出生的城市开始吧。" />` : html`<div class="trip-list">${trips.map((t) => html`<div class=${'trip ' + (sel === t.id ? 'on' : '')} key=${t.id} ...${dragProps('trip', { id: t.id })} onClick=${() => setSel(t.id)} onContextMenu=${(e) => ctxMenu(e, [{ label: '在星球上查看', icon: 'globe', onClick: () => setSel(t.id) }, { label: hasPage(t) ? '打开游记' : '写游记', icon: 'note', onClick: () => tripPage(t) }, { label: '编辑', icon: 'edit', onClick: () => { setEditing(t); setModal(true); } }, 'sep', ...[['trip', '旅行'], ['live', '居住过'], ['wish', '想去']].map(([v, n]) => ({ label: n, icon: (t.kind || 'trip') === v ? 'check' : 'pin', onClick: () => upsert('trips', { id: t.id, kind: v }) })), 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('trips', t.id, t.title || t.place || t.url) }], t.place)}>
            <div class="pinic" data-kind=${t.kind || 'trip'}><${Icon} name=${t.kind === 'wish' ? 'star' : t.kind === 'live' ? 'home' : 'pin'} size=${14} /></div>
            <div class="ti"><b>${t.place}</b><small>${t.region ? t.region + ' · ' : ''}${t.country} · ${t.date}</small>${t.note && html`<p>${t.note}</p>`}</div>
          </div>`)}</div>`}
        <//>
        ${countries.length > 0 && html`<${Card} title="去过"><div class="country-list">${countries.map(([c, n]) => html`<div class="r"><span>${c}</span><b>${n}</b></div>`)}</div><//>`}
      </div>
    </div>
    <${TripModal} open=${modal} trip=${editing} onClose=${() => setModal(false)} />
  </div>`;
}
