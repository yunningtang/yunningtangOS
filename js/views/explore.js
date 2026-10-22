import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, upsert, remove } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Stars, TagInput, confirmDel } from '../ui.js';
import { uid, todayStr, sortBy, fmtDate } from '../util.js';
import { mountGlobe } from '../globe.js';

export function TripModal({ open, trip, onClose }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open) setF(trip ? { ...trip } : { id: uid(), place: '', region: '', country: '', lat: '', lng: '', date: todayStr(), end: '', note: '', photos: [], rating: 0, tags: [], kind: 'trip' }); }, [open, trip]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.place.trim()) return;
    const lat = parseFloat(f.lat), lng = parseFloat(f.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) { alert('请填写经纬度（在地图里右键一个点可以复制坐标）。'); return; }
    upsert('trips', { ...f, place: f.place.trim(), lat, lng, photos: (Array.isArray(f.photos) ? f.photos : String(f.photos).split('\n')).map((x) => x.trim()).filter(Boolean) });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${trip ? '编辑足迹' : '记录一个地方'} foot=${html`
    ${trip && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { if (confirmDel()) { remove('trips', trip.id); onClose(); } }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <div class="grid3">
        <${Field} label="地点"><input type="text" autofocus value=${f.place} placeholder="喀纳斯 / Toronto" onInput=${(e) => set('place', e.target.value)} /><//>
        <${Field} label="省 / 州"><input type="text" value=${f.region} onInput=${(e) => set('region', e.target.value)} /><//>
        <${Field} label="国家 / 地区"><input type="text" value=${f.country} placeholder="中国" onInput=${(e) => set('country', e.target.value)} /><//>
      </div>
      <div class="grid2">
        <${Field} label="纬度 lat" hint="北纬为正"><input type="number" step="0.0001" value=${f.lat} placeholder="43.65" onInput=${(e) => set('lat', e.target.value)} /><//>
        <${Field} label="经度 lng" hint="东经为正"><input type="number" step="0.0001" value=${f.lng} placeholder="-79.38" onInput=${(e) => set('lng', e.target.value)} /><//>
      </div>
      <div class="grid3">
        <${Field} label="开始"><input type="date" value=${f.date} onInput=${(e) => set('date', e.target.value)} /><//>
        <${Field} label="结束"><input type="date" value=${f.end} onInput=${(e) => set('end', e.target.value)} /><//>
        <${Field} label="类型"><select value=${f.kind} onChange=${(e) => set('kind', e.target.value)}><option value="trip">旅行</option><option value="live">居住过</option><option value="wish">想去</option></select><//>
      </div>
      <${Field} label="评分"><${Stars} value=${f.rating} onChange=${(v) => set('rating', v)} size=${16} /><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="照片 URL · 每行一个"><textarea rows="3" value=${Array.isArray(f.photos) ? f.photos.join('\n') : f.photos} onInput=${(e) => set('photos', e.target.value)}></textarea><//>
      <${Field} label="记录"><textarea rows="5" value=${f.note} placeholder="看到了什么，想到了什么。" onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

export default function Explore() {
  const s = useStore();
  const [sel, setSel] = useState(null);
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
      <div><div class="kicker">Explore</div><h1>探索</h1><div class="desc">从一颗星球，看见走过的地方。</div></div>
      <div class="acts"><${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>记录足迹<//></div>
    </div>
    <div class="explore">
      <div class="stack">
        <${Card} class="globe-card" pad=${false} style="height:480px">
          <canvas ref=${canvas}></canvas>
          <div class="stat"><span><b>${countries.length}</b><small>国家 / 地区</small></span><span><b>${regions}</b><small>省 / 州</small></span><span><b>${s.trips.filter((t) => t.kind !== 'wish').length}</b><small>足迹</small></span></div>
          <button class="gbtn" title="自动旋转" onClick=${() => globe.current.toggleAuto()}><${Icon} name="refresh" size=${14} /></button>
          <div class="ov">拖动旋转 · 点击光点查看 · 琥珀色为想去</div>
        <//>
        ${selTrip && html`<${Card} class="fi" title=${selTrip.place} sub=${`${selTrip.region ? selTrip.region + ' · ' : ''}${selTrip.country} · ${fmtDate(selTrip.date, true)}${selTrip.end ? ' – ' + fmtDate(selTrip.end) : ''}`} action=${html`<${IconBtn} icon="edit" title="编辑" onClick=${() => { setEditing(selTrip); setModal(true); }} /><${IconBtn} icon="x" title="关闭" onClick=${() => setSel(null)} />`}>
          <div class="row wrap" style="gap:6px;margin-bottom:8px">${selTrip.rating > 0 && html`<${Stars} value=${selTrip.rating} />`}${selTrip.tags.map((t) => html`<${Tag}>${t}<//>`)}<${Tag}>${{ trip: '旅行', live: '居住', wish: '想去' }[selTrip.kind || 'trip']}<//></div>
          ${selTrip.note && html`<p style="font-size:.86rem;line-height:1.7;white-space:pre-wrap">${selTrip.note}</p>`}
          ${selTrip.photos.length > 0 && html`<div class="trip-photos">${selTrip.photos.map((p) => html`<a href=${p} target="_blank" rel="noopener"><img src=${p} alt="" loading="lazy" /></a>`)}</div>`}
        <//>`}
      </div>
      <div class="stack">
        <${Card} title="地点列表" sub="按时间倒序" action=${html`<select value=${kind} onChange=${(e) => setKind(e.target.value)} style="width:auto;padding:4px 26px 4px 8px;font-size:.72rem"><option value="all">全部</option><option value="trip">旅行</option><option value="live">居住</option><option value="wish">想去</option></select>`}>
          ${trips.length === 0 ? html`<${Empty} icon="pin" text="还没有足迹。从出生的城市开始吧。" />` : html`<div class="trip-list">${trips.map((t) => html`<div class=${'trip ' + (sel === t.id ? 'on' : '')} key=${t.id} onClick=${() => setSel(t.id)}>
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
