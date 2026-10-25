// 字体清单。系统自带的不用下载；开源字体从 Google Fonts 按需加载——选到才加载，中文字体按 unicode 分片只下用到的字。
// 行内 .ff-<id>、整块 .bf-<id>、整页 .beditor.font-<id> 三套规则由 fontCss() 生成，页面启动时注入。
export const FONTS = [
  { id: 'default', n: '默认', g: '系统', css: 'var(--font)' },
  { id: 'serif', n: '衬线', g: '系统', css: 'var(--serif)' },
  { id: 'mono', n: '等宽', g: '系统', css: 'var(--mono)' },
  { id: 'hand', n: '手写', g: '系统', css: 'var(--hand)' },
  { id: 'songti', n: '宋体', g: '中文', css: '"Songti SC","STSong","SimSun","宋体","Noto Serif SC",serif' },
  { id: 'kaiti', n: '楷体', g: '中文', css: '"Kaiti SC","STKaiti","KaiTi","楷体",serif' },
  { id: 'fangsong', n: '仿宋', g: '中文', css: '"FangSong SC","STFangsong","FangSong","仿宋",serif' },
  { id: 'heiti', n: '黑体', g: '中文', css: '"PingFang SC","Heiti SC","Microsoft YaHei","微软雅黑",sans-serif' },
  { id: 'noto-sans-sc', n: '思源黑体', g: '中文开源', css: '"Noto Sans SC",sans-serif', gf: 'Noto+Sans+SC:wght@400;500;700' },
  { id: 'noto-serif-sc', n: '思源宋体', g: '中文开源', css: '"Noto Serif SC",serif', gf: 'Noto+Serif+SC:wght@400;600' },
  { id: 'wenkai', n: '霞鹜文楷', g: '中文开源', css: '"LXGW WenKai TC","LXGW WenKai","Kaiti SC","KaiTi",serif', gf: 'LXGW+WenKai+TC:wght@400;700' },
  { id: 'xiaowei', n: '站酷小薇', g: '中文开源', css: '"ZCOOL XiaoWei",serif', gf: 'ZCOOL+XiaoWei' },
  { id: 'kuaile', n: '站酷快乐体', g: '中文开源', css: '"ZCOOL KuaiLe",sans-serif', gf: 'ZCOOL+KuaiLe' },
  { id: 'mashanzheng', n: '马善政楷书', g: '中文开源', css: '"Ma Shan Zheng",cursive', gf: 'Ma+Shan+Zheng' },
  { id: 'zhimangxing', n: '芝麻行书', g: '中文开源', css: '"Zhi Mang Xing",cursive', gf: 'Zhi+Mang+Xing' },
  { id: 'longcang', n: '龙藏体', g: '中文开源', css: '"Long Cang",cursive', gf: 'Long+Cang' },
  { id: 'inter', n: 'Inter', g: '英文开源', css: '"Inter",sans-serif', gf: 'Inter:wght@400;500;600;700' },
  { id: 'roboto', n: 'Roboto', g: '英文开源', css: '"Roboto",sans-serif', gf: 'Roboto:wght@400;500;700' },
  { id: 'lora', n: 'Lora', g: '英文开源', css: '"Lora",serif', gf: 'Lora:wght@400;600' },
  { id: 'merriweather', n: 'Merriweather', g: '英文开源', css: '"Merriweather",serif', gf: 'Merriweather:wght@400;700' },
  { id: 'source-serif', n: 'Source Serif', g: '英文开源', css: '"Source Serif 4",serif', gf: 'Source+Serif+4:wght@400;600' },
  { id: 'jetbrains', n: 'JetBrains Mono', g: '英文开源', css: '"JetBrains Mono",monospace', gf: 'JetBrains+Mono:wght@400;600' },
  { id: 'plex-mono', n: 'IBM Plex Mono', g: '英文开源', css: '"IBM Plex Mono",monospace', gf: 'IBM+Plex+Mono:wght@400;600' },
];
export const FONT_IDS = FONTS.map((f) => f.id);
export const FONT_GROUPS = [...new Set(FONTS.map((f) => f.g))];
export const fontOf = (id) => FONTS.find((f) => f.id === id);
const loaded = new Set();
export function ensureFont(id) {
  const f = fontOf(id); if (!f || !f.gf || loaded.has(id) || typeof document === 'undefined') return; loaded.add(id);
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f.gf + '&display=swap'; document.head.appendChild(l);
}
// 一页里用到的字体（整页、整块、行内 ff-xxx、表格里的）都先加载
export function ensureNoteFonts(note) {
  const ids = new Set(); if (note.font) ids.add(note.font);
  const scan = (h) => { for (const m of String(h || '').matchAll(/\bff-([a-z0-9-]+)/g)) ids.add(m[1]); };
  (note.blocks || []).forEach((b) => { if (b.font) ids.add(b.font); scan(b.html); (b.rows || []).forEach((r) => r.forEach(scan)); });
  ids.forEach(ensureFont);
}
export function fontCss() {
  return FONTS.filter((f) => f.id !== 'default').map((f) => `.b-text .ff-${f.id},.cv-text .ff-${f.id}{font-family:${f.css}}.b-text.bf-${f.id}{font-family:${f.css}}.beditor.font-${f.id}{font-family:${f.css}}`).join('\n');
}
export function injectFontCss() { if (typeof document === 'undefined' || document.getElementById('font-css')) return; const st = document.createElement('style'); st.id = 'font-css'; st.textContent = fontCss(); document.head.appendChild(st); }
