// Small helpers shared by every view.

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
  { v: 0, label: 'P0', name: '紧急', color: '#d94a4a' },
  { v: 1, label: 'P1', name: '重要', color: '#e0973a' },
  { v: 2, label: 'P2', name: '普通', color: '#3a8fd9' },
  { v: 3, label: 'P3', name: '随缘', color: '#9aa3ad' },
];

export const AREAS = ['学习', '工作', '创作', '健康', '关系', '财务', '生活', '探索'];

export const BLOCK_KINDS = [
  { v: 'focus', name: '深度专注', color: '#2f80ed' },
  { v: 'study', name: '学习', color: '#7b61ff' },
  { v: 'work', name: '工作', color: '#1f9d8a' },
  { v: 'create', name: '创作', color: '#e2598b' },
  { v: 'life', name: '生活', color: '#f2a93b' },
  { v: 'move', name: '运动', color: '#4caf6e' },
  { v: 'rest', name: '休息', color: '#9aa3ad' },
];

export function kindColor(v) {
  return (BLOCK_KINDS.find((k) => k.v === v) || BLOCK_KINDS[0]).color;
}

// Stable pastel colour for a label (tags, areas).
export const TAG_HUES = [4, 28, 48, 96, 160, 200, 230, 270, 320];
export function tagHue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_HUES[h % TAG_HUES.length];
}
