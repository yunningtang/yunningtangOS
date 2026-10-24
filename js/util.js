// Small helpers shared by every view.

export const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const pad = (n) => String(n).padStart(2, '0');

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}

// ISO week: Monday first.
export function weekStart(s = todayStr()) {
  const d = parseDate(s);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return todayStr(d);
}

export function weekKey(s = todayStr()) {
  const d = parseDate(weekStart(s));
  d.setDate(d.getDate() + 3);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const w = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${pad(w)}`;
}

export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const WEEKDAY_SUN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function fmtDate(s, withYear = false) {
  if (!s) return '';
  const d = parseDate(s);
  if (!d) return s;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withYear ? `${d.getFullYear()}年${md}` : md;
}

export function fmtShort(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function relDay(s) {
  const t = todayStr();
  if (s === t) return '今天';
  if (s === addDays(t, 1)) return '明天';
  if (s === addDays(t, -1)) return '昨天';
  const diff = Math.round((parseDate(s) - parseDate(t)) / 86400000);
  if (diff < 0) return `${-diff} 天前`;
  if (diff < 7) return WEEKDAY_SUN[parseDate(s).getDay()];
  return fmtDate(s);
}

export function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minToTime(min) {
  min = Math.max(0, Math.min(24 * 60, Math.round(min)));
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

// Pick an image file from disk (or pass a File), centre-crop it to a square and return a small data URL.
export function pickFile(accept = 'image/*') {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
    i.onchange = () => { res(i.files && i.files[0] ? i.files[0] : null); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}

export function imageToSquare(file, size = 320, quality = 0.88) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) return rej(new Error('请选择图片文件'));
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('图片无法读取')); };
    img.src = url;
  });
}

// Any image file -> data URL, downscaled so the longest side is at most maxSide.
export function imageToDataUrl(file, maxSide = 1600, quality = 0.86) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) return rej(new Error('请选择图片文件'));
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL(file.type === 'image/png' || file.type === 'image/gif' ? 'image/png' : 'image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('图片无法读取')); };
    img.src = url;
  });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function sortBy(arr, ...keys) {
  return [...arr].sort((a, b) => {
    for (const k of keys) {
      const desc = k.startsWith('-');
      const key = desc ? k.slice(1) : k;
      const av = a[key] ?? '', bv = b[key] ?? '';
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
    }
    return 0;
  });
}

export const PRIORITY = [
  { v: 0, label: 'P0', name: '紧急', color: 'var(--red)' },
  { v: 1, label: 'P1', name: '重要', color: 'var(--amber)' },
  { v: 2, label: 'P2', name: '普通', color: 'var(--blue)' },
  { v: 3, label: 'P3', name: '随缘', color: 'var(--text-4)' },
];

export const AREAS = ['学习', '工作', '创作', '健康', '关系', '财务', '生活', '探索'];

export const BLOCK_KINDS = [
  { v: 'focus', name: '深度专注', color: '#3b6fd6' },
  { v: 'study', name: '学习', color: '#7461c9' },
  { v: 'work', name: '工作', color: '#1f9d8a' },
  { v: 'create', name: '创作', color: '#c9588a' },
  { v: 'life', name: '生活', color: '#c99a4a' },
  { v: 'move', name: '运动', color: '#4a9a6a' },
  { v: 'rest', name: '休息', color: '#9aa3ad' },
];

// custom kinds live in settings.kinds ({ v, name, color }); app.js keeps this registry in sync
let EXTRA_KINDS = [];
export function setExtraKinds(list) { EXTRA_KINDS = Array.isArray(list) ? list : []; }
export function allKinds() { return [...BLOCK_KINDS, ...EXTRA_KINDS]; }
export function kindOf(v) { return allKinds().find((k) => k.v === v) || { v, name: v, color: '#9aa3ad' }; }
export function kindColor(v) { return kindOf(v).color; }
export const KIND_COLORS = ['#3b6fd6', '#7461c9', '#1f9d8a', '#c9588a', '#c99a4a', '#4a9a6a', '#d2524f', '#e08a3c', '#2f9fd0', '#8a6d3b', '#5b7cfa', '#b4457a'];
export const KIND_COLOR_NAMES = ['蓝', '紫', '青', '粉', '黄', '绿', '红', '橙', '天蓝', '棕', '靛', '玫红'];

// Stable pastel colour for a label (tags, areas).
// Each tag gets its own colour from the iOS system palette (light / dark variants), handed out
// in first-seen order so no two tags share one; past the palette, golden-angle hues keep them distinct.
export const TAG_COLORS = [
  ['#007AFF', '#0A84FF'], ['#FF3B30', '#FF453A'], ['#34C759', '#30D158'], ['#FF9500', '#FF9F0A'], ['#AF52DE', '#BF5AF2'], ['#30B0C7', '#40CBE0'],
  ['#FF2D55', '#FF375F'], ['#FFCC00', '#FFD60A'], ['#5856D6', '#5E5CE6'], ['#00C7BE', '#63E6E2'], ['#A2845E', '#AC8E68'], ['#32ADE6', '#64D2FF'],
];
const HUE_KEY = 'ytos.tagcolor';
let colorMap = null;
function loadColors() { if (colorMap) return colorMap; try { colorMap = new Map(Object.entries(JSON.parse(localStorage.getItem(HUE_KEY) || '{}'))); } catch { colorMap = new Map(); } return colorMap; }
export const TAG_COLOR_NAMES = ['蓝', '红', '绿', '橙', '紫', '青', '粉', '黄', '靛', '薄荷', '棕', '天蓝'];
let TAG_OVERRIDES = {};
// 设置里保存的颜色（跟数据一起同步）优先于本机自动分配的
export function setTagOverrides(obj) { TAG_OVERRIDES = obj && typeof obj === 'object' ? obj : {}; }
export const tagKey = (name) => String(name).trim().replace(/^#/, '').toLowerCase();
export function tagColor(name) {
  const key0 = tagKey(name); if (TAG_OVERRIDES[key0]) { const i = TAG_OVERRIDES[key0]; if (Array.isArray(i)) return i; if (TAG_COLORS[i]) return TAG_COLORS[i]; }
  return tagColorAuto(name);
}
function tagColorAuto(name) {
  const key = String(name).trim().replace(/^#/, '').toLowerCase(); if (!key) return TAG_COLORS[0];
  const m = loadColors(); if (m.has(key)) return m.get(key);
  const used = new Set([...m.values()].map((c) => c[0])); let c = TAG_COLORS.find((x) => !used.has(x[0]));
  if (!c) { let i = m.size; do { const h = Math.round((i * 137.508) % 360); c = [`hsl(${h} 70% 48%)`, `hsl(${h} 75% 62%)`]; i++; } while (used.has(c[0])); }
  m.set(key, c); try { localStorage.setItem(HUE_KEY, JSON.stringify(Object.fromEntries(m))); } catch {}
  return c;
}
export const tagHue = (name) => tagColor(name)[0];
