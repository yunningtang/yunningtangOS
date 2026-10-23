// "此刻" dashboard widget: live clock, where you are, and the weather there.
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { Icon, Card, Btn } from '../ui.js';
import { WEEKDAY_SUN, weekKey, todayStr, pad } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { toast } from '../nav.js';
import { getPosition, reverseGeo, searchPlace, fetchWeather, describe } from '../weather.js';

const WD = ['日', '一', '二', '三', '四', '五', '六'];

// weather code -> animated backdrop
function sceneOf(code, isDay) {
  const c = +code;
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 3) return 'cloudy';
  if (c === 2) return isDay ? 'partly' : 'night-cloud';
  return isDay ? 'sunny' : 'night';
}
const seeded = (n, f) => Array.from({ length: n }, (_, i) => f(i, ((i * 9301 + 49297) % 233280) / 233280));
function Sky({ kind, sunX, sunY }) {
  const night = kind === 'night' || kind === 'night-cloud';
  const clouds = kind === 'sunny' || kind === 'night' ? 0 : kind === 'partly' || kind === 'night-cloud' ? 2 : 4;
  return html`<div class="sky" aria-hidden="true">
    ${(kind === 'sunny' || kind === 'partly') && html`<i class="sun" style=${`left:${sunX}%;top:${sunY}%`}></i>`}
    ${night && html`<i class="moon" style=${`left:${sunX}%;top:${sunY}%`}></i>${seeded(14, (i, r) => html`<b class="star" key=${i} style=${`left:${(i * 37) % 100}%;top:${(r * 70)}%;animation-delay:${(r * 3).toFixed(2)}s`}></b>`)}`}
    ${seeded(clouds, (i, r) => html`<i class=${'cloud c' + i} key=${i} style=${`top:${8 + i * 18}%;animation-duration:${(38 + r * 30).toFixed(0)}s;animation-delay:${(-r * 40).toFixed(0)}s`}></i>`)}
    ${kind === 'rain' && seeded(26, (i, r) => html`<b class="drop" key=${i} style=${`left:${(i * 3.9) % 100}%;animation-duration:${(0.7 + r * 0.6).toFixed(2)}s;animation-delay:${(-r * 2).toFixed(2)}s`}></b>`)}
    ${kind === 'storm' && html`${seeded(26, (i, r) => html`<b class="drop" key=${i} style=${`left:${(i * 3.9) % 100}%;animation-duration:${(0.5 + r * 0.5).toFixed(2)}s;animation-delay:${(-r * 2).toFixed(2)}s`}></b>`)}<i class="flash"></i>`}
    ${kind === 'snow' && seeded(22, (i, r) => html`<b class="flake" key=${i} style=${`left:${(i * 4.6) % 100}%;animation-duration:${(5 + r * 5).toFixed(1)}s;animation-delay:${(-r * 9).toFixed(1)}s`}></b>`)}
    ${kind === 'fog' && html`<i class="fog f1"></i><i class="fog f2"></i><i class="fog f3"></i>`}
  </div>`;
}

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
  const scene = d ? sceneOf(wx.code, wx.isDay) : (place ? (new Date().getHours() >= 19 || new Date().getHours() < 6 ? 'night' : 'sunny') : '');
  const hour = now.getHours() + now.getMinutes() / 60;
  const tod = hour < 5.5 || hour >= 19.5 ? 'night' : hour < 7.5 ? 'dawn' : hour >= 17 ? 'dusk' : 'day';
  const sunX = Math.max(8, Math.min(92, ((hour - 6) / 12) * 84 + 8)); // sun / moon travels left→right through the day
  const sunY = 14 + 30 * Math.pow(Math.abs(hour - 12) / 6, 1.6);
  const placeBtn = html`<button class="now-loc" title="点击更换位置" onClick=${menu}><${Icon} name="pin" size=${13} /><span>${place ? place.name : busy ? '正在定位…' : '未设置位置'}</span>${place && place.sub && html`<small>· ${place.sub}</small>`}</button>`;
  return html`<${Card} class=${'now-w ' + (scene ? 'has-sky sky-' + scene + ' tod-' + tod : 'no-sky')} pad=${false} onContextMenu=${(e) => { if (!e.target.closest('input')) menu(e); }}>
    ${scene && html`<${Sky} kind=${scene} sunX=${sunX} sunY=${sunY} />`}
    <div class="now-in">
      <div class="now-head">
        <div class="now-clock"><b>${hh}:${mm}</b><small>${ss}</small><div class="now-date">${now.getMonth() + 1}月${now.getDate()}日 周${WD[now.getDay()]}</div></div>
        ${!search && placeBtn}
      </div>
      ${search && html`<div class="now-msg now-search">
        <input ref=${inRef} type="text" value=${search.q} placeholder="输入城市，回车搜索" onInput=${(e) => setSearch({ ...search, q: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') doSearch(e.target.value); if (e.key === 'Escape') setSearch(null); }} />
        <button class="ibtn" title="取消" onClick=${() => setSearch(null)}><${Icon} name="x" size=${13} /></button>
        ${search.results.length > 0 && html`<div class="popmenu place-pop" style="position:static;width:100%">${search.results.map((r) => html`<div class="pm" key=${r.lat + ',' + r.lng} onClick=${() => { setPlace({ name: r.name, sub: r.sub, lat: r.lat, lng: r.lng, auto: false }); setSearch(null); setErr(''); }}><b>${r.name}</b><small>${r.sub}</small></div>`)}</div>`}
        ${search.none && html`<span>没找到，换个写法试试（比如城市的英文名）。</span>`}
      </div>`}
      ${wx && d ? html`
        <div class="now-big"><span class="nb-temp">${wx.temp}<i>°</i></span><div class="nb-side"><span class="nb-cond">${d.label}</span><span class="nb-hl">最高 ${wx.hi}° 最低 ${wx.lo}°</span></div></div>
        <div class="now-feel"><span>体感 <b>${wx.feels}°</b></span><span>风 <b>${wx.wind}</b> km/h</span>${wx.humidity != null && html`<span>湿度 <b>${wx.humidity}</b>%</span>`}</div>
        <div class="now-days">${wx.days.map((x) => { const dd = describe(x.code, true); const dt = new Date(x.date + 'T00:00:00'); const span = Math.max(1, wx.days.reduce((m, y) => Math.max(m, y.hi), -99) - wx.days.reduce((m, y) => Math.min(m, y.lo), 99)); const lo = wx.days.reduce((m, y) => Math.min(m, y.lo), 99); return html`<div key=${x.date}><span>周${WD[dt.getDay()]}</span><${Icon} name=${dd.icon} size=${16} /><small>${x.lo}°</small><i class="nd-bar"><b style=${`left:${((x.lo - lo) / span) * 100}%;width:${((x.hi - x.lo) / span) * 100}%`}></b></i><small>${x.hi}°</small></div>`; })}</div>`
      : place ? html`<div class="now-msg">${err || '正在获取天气…'}</div>`
      : html`<div class="now-msg">${err || '允许定位后显示这里的天气。'}<${Btn} small kind="ghost" onClick=${locate} disabled=${busy}>使用当前位置<//><${Btn} small kind="ghost" onClick=${() => { setSearch({ q: '', results: [] }); setTimeout(() => inRef.current && inRef.current.focus(), 50); }}>选择城市<//></div>`}
    </div>
  <//>`;
}
