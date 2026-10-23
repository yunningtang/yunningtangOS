// "此刻" dashboard widget: live clock, where you are, and the weather there.
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { Icon, Card, Btn } from '../ui.js';
import { WEEKDAY_SUN, weekKey, todayStr, pad } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { toast } from '../nav.js';
import { getPosition, reverseGeo, searchPlace, fetchWeather, describe } from '../weather.js';

const WD = ['日', '一', '二', '三', '四', '五', '六'];

export function NowWidget() {
  const s = useStore();
  const place = s.settings.place || null; // { name, sub, lat, lng, auto }
  const [now, setNow] = useState(new Date());
  const [wx, setWx] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(null); // null | { q, results }
  const inRef = useRef();
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const setPlace = (p) => update((d) => { d.settings.place = p; });
  const locate = async () => {
    setBusy(true); setErr('');
    try { const pos = await getPosition(); const geo = await reverseGeo(pos.lat, pos.lng); setPlace({ ...geo, ...pos, auto: true }); }
    catch (e) { setErr(e && e.code === 1 ? '浏览器没有允许定位，可以手动选一个城市。' : '定位失败，可以手动选一个城市。'); }
    setBusy(false);
  };
  // first run: ask for the position once
  useEffect(() => { if (!place && navigator.geolocation) locate(); }, []);
  // weather follows the place, refreshed every 30 minutes
  useEffect(() => {
    if (!place) return; let alive = true;
    const load = (force) => fetchWeather(place.lat, place.lng, force).then((d) => alive && setWx(d)).catch((e) => alive && setErr(e.message));
    load(false); const t = setInterval(() => load(true), 30 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [place && place.lat, place && place.lng]);

  const doSearch = async (q) => { if (!q.trim()) return; try { const results = await searchPlace(q.trim()); setSearch({ q, results, none: results.length === 0 }); } catch { setSearch({ q, results: [], none: true }); } };
  const menu = (e) => ctxMenu(e, [
    { label: '使用当前位置', icon: 'target', onClick: locate },
    { label: '手动选择城市…', icon: 'search', onClick: () => { setSearch({ q: '', results: [] }); setTimeout(() => inRef.current && inRef.current.focus(), 50); } },
    'sep',
    { label: '刷新天气', icon: 'refresh', disabled: !place, onClick: () => place && fetchWeather(place.lat, place.lng, true).then(setWx).catch((x) => toast(x.message)) },
  ], '位置');

  const d = wx ? describe(wx.code, wx.isDay) : null;
  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());
  return html`<${Card} class="now-w" onContextMenu=${(e) => { if (!e.target.closest('input')) menu(e); }}>
    <div class="now-clock"><b>${hh}:${mm}</b><small>${ss}</small></div>
    <div class="now-date">${now.getMonth() + 1}月${now.getDate()}日 周${WD[now.getDay()]} · ${weekKey(todayStr())}</div>
    ${search ? html`<div class="now-msg">
        <input ref=${inRef} type="text" value=${search.q} placeholder="输入城市，回车搜索" style="flex:1;min-width:0;height:30px;font-size:.8rem" onInput=${(e) => setSearch({ ...search, q: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') doSearch(e.target.value); if (e.key === 'Escape') setSearch(null); }} />
        <button class="ibtn" title="取消" onClick=${() => setSearch(null)}><${Icon} name="x" size=${13} /></button>
        ${search.results.length > 0 && html`<div class="popmenu place-pop" style="position:static;width:100%">${search.results.map((r) => html`<div class="pm" key=${r.lat + ',' + r.lng} onClick=${() => { setPlace({ name: r.name, sub: r.sub, lat: r.lat, lng: r.lng, auto: false }); setSearch(null); setErr(''); }}><b>${r.name}</b><small>${r.sub}</small></div>`)}</div>`}
        ${search.none && html`<span>没找到，换个写法试试（比如城市的英文名）。</span>`}
      </div>`
    : html`<button class="now-loc" title="点击更换位置" onClick=${menu}><${Icon} name="pin" size=${13} /><span>${place ? place.name : busy ? '正在定位…' : '未设置位置'}</span>${place && place.sub && html`<small>· ${place.sub}</small>`}</button>`}
    ${wx && d ? html`
      <div class=${'now-wx ' + (wx.isDay ? '' : 'night')}>
        <span class="wx-ic"><${Icon} name=${d.icon} size=${22} /></span>
        <div class="flex1" style="min-width:0"><div class="wx-t">${wx.temp}<i>°</i></div><div class="wx-d">${d.label} · 体感 ${wx.feels}° · ${wx.lo}° / ${wx.hi}° · 风 ${wx.wind} km/h</div></div>
      </div>
      <div class="now-days">${wx.days.map((x) => { const dd = describe(x.code, true); const dt = new Date(x.date + 'T00:00:00'); return html`<div key=${x.date}><span>周${WD[dt.getDay()]}</span><${Icon} name=${dd.icon} size=${15} /><b>${x.lo}°/${x.hi}°</b></div>`; })}</div>`
    : place ? html`<div class="now-msg">${err || '正在获取天气…'}</div>`
    : html`<div class="now-msg">${err || '允许定位后显示这里的天气。'}<${Btn} small kind="ghost" onClick=${locate} disabled=${busy}>使用当前位置<//><${Btn} small kind="ghost" onClick=${() => { setSearch({ q: '', results: [] }); setTimeout(() => inRef.current && inRef.current.focus(), 50); }}>选择城市<//></div>`}
  <//>`;
}
