// Location + weather for the dashboard. No keys: Open-Meteo for weather and place search,
// BigDataCloud for turning coordinates into a place name. Results are cached in localStorage.
const WX_KEY = 'ytos.wx';
const CACHE_MS = 30 * 60 * 1000;

// WMO weather codes -> label + icon name
export function describe(code, isDay = true) {
  const c = +code;
  if (c === 0) return { label: '晴', icon: isDay ? 'sun' : 'moon' };
  if (c === 1) return { label: '大致晴朗', icon: isDay ? 'sun' : 'moon' };
  if (c === 2) return { label: '多云', icon: 'cloudsun' };
  if (c === 3) return { label: '阴', icon: 'cloud' };
  if (c === 45 || c === 48) return { label: '雾', icon: 'fog' };
  if (c >= 51 && c <= 57) return { label: '毛毛雨', icon: 'drizzle' };
  if (c >= 61 && c <= 67) return { label: c >= 65 ? '大雨' : '雨', icon: 'rain' };
  if (c >= 71 && c <= 77) return { label: '雪', icon: 'snow' };
  if (c >= 80 && c <= 82) return { label: '阵雨', icon: 'rain' };
  if (c === 85 || c === 86) return { label: '阵雪', icon: 'snow' };
  if (c >= 95) return { label: '雷雨', icon: 'storm' };
  return { label: '—', icon: 'cloud' };
}

export function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('浏览器不支持定位'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) }), (e) => rej(e), { timeout: 10000, maximumAge: 10 * 60 * 1000 });
  });
}

export async function reverseGeo(lat, lng) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`);
    if (!r.ok) throw new Error();
    const j = await r.json();
    const parts = [j.city || j.locality, j.principalSubdivision].filter(Boolean);
    const name = parts[0] || j.countryName || '';
    const sub = parts[1] && parts[1] !== parts[0] ? parts[1] : j.countryName || '';
    return { name: name || `${lat}, ${lng}`, sub: sub === name ? '' : sub };
  } catch { return { name: `${lat.toFixed(2)}, ${lng.toFixed(2)}`, sub: '' }; }
}

export async function searchPlace(q) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`);
  if (!r.ok) throw new Error('搜索失败');
  const j = await r.json();
  return (j.results || []).map((x) => ({ name: x.name, sub: [x.admin1, x.country].filter(Boolean).join(' · '), region: x.admin1 || '', country: x.country || '', cc: x.country_code || '', lat: x.latitude, lng: x.longitude }));
}

export async function fetchWeather(lat, lng, force = false) {
  const key = `${lat},${lng}`;
  try { const c = JSON.parse(localStorage.getItem(WX_KEY) || 'null'); if (!force && c && c.key === key && Date.now() - c.at < CACHE_MS) return c.data; } catch {}
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=4`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('天气服务暂时不可用');
  const j = await r.json();
  const cur = j.current || {};
  const data = {
    temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature), code: cur.weather_code, isDay: cur.is_day !== 0,
    wind: Math.round(cur.wind_speed_10m), humidity: cur.relative_humidity_2m,
    hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]),
    days: j.daily.time.slice(1).map((t, i) => ({ date: t, hi: Math.round(j.daily.temperature_2m_max[i + 1]), lo: Math.round(j.daily.temperature_2m_min[i + 1]), code: j.daily.weather_code[i + 1] })),
    at: Date.now(),
  };
  try { localStorage.setItem(WX_KEY, JSON.stringify({ key, at: Date.now(), data })); } catch {}
  return data;
}
