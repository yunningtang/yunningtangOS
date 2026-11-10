// 倒计时 / 正计时：倒数到某一天（deadline），或者正着数从某一天起过了多久（比如在一起多久了）。
// 侧栏有一页「倒计时」：卡片网格，可以分类、换背景（颜色 / 图片）；总览上的小卡显示最上面那个，其余列在下面。
// 存在 settings.countdowns（跟着账号同步）；图片和「图片」小卡一样存成附件。右键编辑，菜单和「图片」小卡同一种写法。
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { Icon, Card } from '../ui.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt, askDate, askConfirm } from '../confirm.js';
import { saveFile, fileUrl } from '../files.js';
import { fetchAttachment } from '../sync.js';
import { uid, todayStr, fmtShort, lsGet, lsSet } from '../util.js';

const list = (s) => (Array.isArray(s.settings.countdowns) ? s.settings.countdowns : []);
const setList = (fn) => update((d) => { d.settings.countdowns = fn(Array.isArray(d.settings.countdowns) ? d.settings.countdowns : []); });
const patch = (id, p) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
const DAY = 864e5;
const parse = (d) => new Date(d.replace(/-/g, '/')).getTime();
const wd = (d) => '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
// 卡片背景：几种柔和的渐变（深色模式下也看得清白字），或者一张图
export const CD_BG = [['', '默认'], ['sky', '晴空'], ['peach', '蜜桃'], ['mint', '薄荷'], ['lilac', '丁香'], ['sunset', '晚霞'], ['night', '夜空']];
const CD_BG_CSS = { sky: 'linear-gradient(135deg,#7fb2f0,#4f7cf5)', peach: 'linear-gradient(135deg,#f7b8a2,#e8788f)', mint: 'linear-gradient(135deg,#8fd8b8,#3f9f86)', lilac: 'linear-gradient(135deg,#c6b4f2,#8a6fd8)', sunset: 'linear-gradient(135deg,#f6c76a,#e8705a)', night: 'linear-gradient(135deg,#3a4a6b,#151b2b)' };

// 天数：倒计时 = 离那天还有几天（0 = 就是今天，负数 = 已经过了）；正计时 = 从那天到今天第几天（那天本身算第 1 天）
export function countOf(c, today = todayStr()) {
  const diff = Math.round((parse(c.date) - parse(today)) / DAY);
  return c.mode === 'up' ? -diff + 1 : diff;
}
function ymd(from, to) {
  const a = new Date(from.replace(/-/g, '/')), b = new Date(to.replace(/-/g, '/'));
  let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate();
  if (d < 0) { m -= 1; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return [y && `${y} 年`, m && `${m} 个月`, d && `${d} 天`].filter(Boolean).join(' ');
}
const shortCount = (c, k) => (c.mode === 'up' ? `${k} 天` : k > 0 ? `还有 ${k} 天` : k === 0 ? '今天' : `过了 ${-k} 天`);

function useImg(c) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!c || (!c.fid && !c.url)) { setSrc(''); return; }
    if (c.url) { setSrc(c.url); return; }
    (async () => { let u = await fileUrl(c.fid); if (!u) { const rec = await fetchAttachment(c.fid, { name: c.name, mime: c.mime }); if (rec) u = await fileUrl(c.fid); } if (alive) setSrc(u || ''); })();
    return () => { alive = false; };
  }, [c && c.fid, c && c.url]);
  return src;
}

export async function addCountdown(mode, cat = '') {
  const title = await askPrompt(mode === 'up' ? '从哪一天开始数？先起个名字' : '倒数到什么事？', '', { title: mode === 'up' ? '新的正计时' : '新的倒计时', placeholder: mode === 'up' ? '比如：和 TA 在一起' : '比如：论文 deadline' });
  if (title == null || !title.trim()) return;
  const date = await askDate(mode === 'up' ? '从哪一天开始' : '哪一天截止', mode === 'up' ? todayStr() : '', { title: title.trim() });
  if (!date) return;
  setList((l) => [{ id: uid(), title: title.trim().slice(0, 40), date, mode, fit: 'cover', cat, bg: '' }, ...l]);
}

// 一个文件选择框，全页共用：pickImage(id) 选好图就存到那一项上
let fileEl = null, fileFor = '';
function pickImage(id) {
  if (!fileEl) {
    fileEl = document.createElement('input'); fileEl.type = 'file'; fileEl.accept = 'image/*'; fileEl.style.display = 'none'; document.body.appendChild(fileEl);
    fileEl.addEventListener('change', async () => { const f = fileEl.files && fileEl.files[0]; fileEl.value = ''; if (f) await useImage(f, fileFor); });
  }
  fileFor = id; fileEl.click();
}
async function useImage(f, id) { if (!f || !/^image\//.test(f.type) || !id) return; const rec = await saveFile(f); patch(id, { fid: rec.id, name: rec.name, mime: rec.type, url: '' }); }

// 右键菜单：和「图片」小卡同一种写法——先是这一项的编辑，再是外观（背景 / 图片），然后分类，最后新建 / 删除
export function cdMenu(e, c, items, { cats = [] } = {}) {
  ctxMenu(e, [
    c && { label: '改名字', icon: 'edit', onClick: async () => { const v = await askPrompt('名字', c.title, { title: '改名字' }); if (v != null && v.trim()) patch(c.id, { title: v.trim().slice(0, 40) }); } },
    c && { label: c.mode === 'up' ? '改开始的日子' : '改截止日期', icon: 'calendar', hint: fmtShort(c.date), onClick: async () => { const v = await askDate(c.mode === 'up' ? '从哪一天开始' : '哪一天截止', c.date, { title: c.title }); if (v) patch(c.id, { date: v }); } },
    c && { label: c.mode === 'up' ? '改成倒计时' : '改成正计时', icon: 'refresh', hint: c.mode === 'up' ? '数还剩几天' : '数过了多久', onClick: () => patch(c.id, { mode: c.mode === 'up' ? 'down' : 'up' }) },
    c && items.indexOf(c) > 0 && { label: '放到最上面', icon: 'up', hint: '总览上显示这个', onClick: () => setList((l) => [c, ...l.filter((x) => x.id !== c.id)]) },
    c && 'sep',
    c && { label: '背景', icon: 'layers', sub: [...CD_BG.map(([k, n]) => ({ label: n, icon: (c.bg || '') === k && !(c.fid || c.url) ? 'check' : '', color: CD_BG_CSS[k] ? CD_BG_CSS[k].match(/#[0-9a-f]{6}/i)[0] : undefined, onClick: () => patch(c.id, { bg: k, fid: '', url: '' }) })), 'sep', { label: c.fid || c.url ? '换一张图' : '用一张图', icon: 'image', onClick: () => pickImage(c.id) }, { label: '用图片链接', icon: 'link', onClick: async () => { const v = await askPrompt('贴一张图片的链接（https 开头）', c.url || '', { title: '用链接', placeholder: 'https://…' }); if (v == null) return; const u = v.trim(); if (/^https:\/\/\S+$/i.test(u)) patch(c.id, { url: u, fid: '' }); } }, (c.fid || c.url) && { label: c.fit === 'contain' ? '铺满卡片' : '完整显示', icon: 'maximize', onClick: () => patch(c.id, { fit: c.fit === 'contain' ? 'cover' : 'contain' }) }].filter(Boolean) },
    c && { label: '分类', icon: 'tag', hint: c.cat || '', sub: [...cats.map((k) => ({ label: k, icon: c.cat === k ? 'check' : 'tag', onClick: () => patch(c.id, { cat: k }) })), cats.length && 'sep', { label: '新分类…', icon: 'plus', onClick: async () => { const v = await askPrompt('分类名，比如：学习 / 工作 / 纪念日', '', { title: '新分类' }); if (v && v.trim()) patch(c.id, { cat: v.trim().slice(0, 12) }); } }, c.cat && { label: '不分类', icon: 'x', onClick: () => patch(c.id, { cat: '' }) }].filter(Boolean) },
    'sep',
    { label: '新的倒计时', icon: 'clock', onClick: () => addCountdown('down', c ? c.cat || '' : '') },
    { label: '新的正计时', icon: 'sparkle', hint: '比如在一起多久了', onClick: () => addCountdown('up', c ? c.cat || '' : '') },
    c && 'sep',
    c && { label: '删除', icon: 'trash', danger: true, onClick: async () => { if (await askConfirm(`「${c.title}」会被删掉。`, { title: '删除这个计时？', ok: '删除' })) setList((l) => l.filter((x) => x.id !== c.id)); } },
  ].filter(Boolean), c ? c.title : '倒计时');
}
const catsOf = (items) => [...new Set(items.map((x) => x.cat).filter(Boolean))];

// 卡片的正面：背景（图 / 渐变）+ 大数字
function Face({ c, today, children }) {
  const src = useImg(c); const n = countOf(c, today); const up = c.mode === 'up';
  const big = up ? n : Math.abs(n);
  const lead = up ? `${c.title} 已经` : n > 0 ? `距离 ${c.title} 还有` : n === 0 ? c.title : `${c.title} 已经过了`;
  const sub = up ? (n > 1 ? `${fmtShort(c.date)} 起 · ${ymd(c.date, today) || '今天开始'}` : `${fmtShort(c.date)} 开始`) : `${c.date.slice(0, 4) !== today.slice(0, 4) ? c.date.slice(0, 4) + ' 年 ' : ''}${fmtShort(c.date)} 周${wd(c.date)}`;
  const dark = !!src || !!CD_BG_CSS[c.bg];
  return html`<div class=${'cd-face ' + (dark ? 'ink ' : '') + (!up && n < 0 ? 'past ' : '') + (!up && n >= 0 && n <= 7 ? 'soon' : '')} style=${!src && CD_BG_CSS[c.bg] ? `background:${CD_BG_CSS[c.bg]}` : ''}>
    ${src && html`<img class=${'cd-img ' + (c.fit === 'contain' ? 'contain' : '')} src=${src} alt="" draggable="false" />`}
    <div class="cd-main">
      ${c.cat && html`<span class="cd-cat">${c.cat}</span>`}
      <div class="cd-lead">${lead}</div>
      <div class="cd-num">${n === 0 && !up ? html`<b class="cd-today">就是今天</b>` : html`<b>${big}</b><span>天</span>`}</div>
      <div class="cd-sub">${sub}</div>
    </div>
    ${children}
  </div>`;
}
function dropImage(id, setOver) {
  return {
    onDragOver: (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) useImage(f, id); },
  };
}

/* ---------- 总览小卡 ---------- */
export function CountdownWidget() {
  const s = useStore(); const items = list(s); const today = todayStr(); const cats = catsOf(items);
  const [over, setOver] = useState(false);
  const top = items[0];
  if (!top) return html`<${Card} class="cd-card empty" onContextMenu=${(e) => cdMenu(e, null, items)}>
    <div class="cd-empty">
      <span class="ph-ic"><${Icon} name="clock" size=${20} /></span>
      <b>倒计时 / 正计时</b>
      <small>数到 deadline 还剩几天，或者某件事过了多久</small>
      <div class="ph-row"><button class="btn sm" onClick=${() => addCountdown('down')}>倒计时</button><button class="btn sm ghost" onClick=${() => addCountdown('up')}>正计时</button></div>
    </div>
  <//>`;
  return html`<${Card} class=${'cd-card ' + (over ? 'over' : '')} pad=${false} onContextMenu=${(e) => cdMenu(e, top, items, { cats })} ...${dropImage(top.id, setOver)}>
    <${Face} c=${top} today=${today}>
      ${items.length > 1 && html`<div class="cd-more">${items.slice(1, 4).map((c) => html`<button type="button" key=${c.id} class="cd-row" title="点一下放到最上面；右键编辑" onClick=${() => setList((l) => [c, ...l.filter((x) => x.id !== c.id)])} onContextMenu=${(e) => { e.stopPropagation(); cdMenu(e, c, items, { cats }); }}><span>${c.title}</span><b>${shortCount(c, countOf(c, today))}</b></button>`)}${items.length > 4 && html`<a class="cd-n" href="#/countdown">全部 ${items.length} 个 →</a>`}</div>`}
    <//>
    <div class="ph-acts"><a class="ph-btn" href="#/countdown" title="倒计时页"><${Icon} name="right" size=${14} /></a><button class="ph-btn" title="更多（也可以右键）" onClick=${(e) => cdMenu(e, top, items, { cats })}><${Icon} name="dots" size=${14} /></button></div>
  <//>`;
}

/* ---------- 侧栏的「倒计时」页 ---------- */
function PageCard({ c, items, cats, today }) {
  const [over, setOver] = useState(false);
  return html`<div class=${'cd-tile ' + (over ? 'over' : '')} onContextMenu=${(e) => cdMenu(e, c, items, { cats })} ...${dropImage(c.id, setOver)}>
    <${Face} c=${c} today=${today} />
    <button class="ph-btn cd-dots" title="编辑（也可以右键）" onClick=${(e) => cdMenu(e, c, items, { cats })}><${Icon} name="dots" size=${14} /></button>
  </div>`;
}
export function CountdownPage() {
  const s = useStore(); const items = list(s); const today = todayStr(); const cats = catsOf(items);
  const [cat, setCatS] = useState(() => lsGet('ytos.cd.cat', ''));
  const setCat = (v) => { setCatS(v); lsSet('ytos.cd.cat', v); };
  const cur = cat && !cats.includes(cat) ? '' : cat;
  const shown = cur ? items.filter((c) => c.cat === cur) : items;
  const downs = shown.filter((c) => c.mode !== 'up' && countOf(c, today) >= 0).sort((a, b) => countOf(a, today) - countOf(b, today));
  const ups = shown.filter((c) => c.mode === 'up');
  const past = shown.filter((c) => c.mode !== 'up' && countOf(c, today) < 0);
  const sec = (title, arr) => arr.length > 0 && html`<section class="cd-sec"><h4>${title}<span>${arr.length}</span></h4><div class="cd-grid">${arr.map((c) => html`<${PageCard} key=${c.id} c=${c} items=${items} cats=${cats} today=${today} />`)}</div></section>`;
  return html`<div class="cd-page">
    <div class="cd-top">
      <div class="cd-chips">
        <button type="button" class=${!cur ? 'on' : ''} onClick=${() => setCat('')}>全部<small>${items.length}</small></button>
        ${cats.map((k) => html`<button type="button" key=${k} class=${cur === k ? 'on' : ''} onClick=${() => setCat(k)} onContextMenu=${(e) => ctxMenu(e, [{ label: '重命名分类', icon: 'edit', onClick: async () => { const v = await askPrompt('分类名', k, { title: '重命名分类' }); if (v && v.trim()) { setList((l) => l.map((x) => (x.cat === k ? { ...x, cat: v.trim().slice(0, 12) } : x))); if (cur === k) setCat(v.trim().slice(0, 12)); } } }, { label: '取消这个分类', icon: 'x', hint: '计时还在', onClick: () => { setList((l) => l.map((x) => (x.cat === k ? { ...x, cat: '' } : x))); if (cur === k) setCat(''); } }], k)}>${k}<small>${items.filter((x) => x.cat === k).length}</small></button>`)}
      </div>
      <span class="flex1"></span>
      <button type="button" class="btn sm" onClick=${() => addCountdown('down', cur)}><${Icon} name="clock" size=${13} />倒计时</button>
      <button type="button" class="btn sm" onClick=${() => addCountdown('up', cur)}><${Icon} name="sparkle" size=${13} />正计时</button>
    </div>
    ${shown.length === 0 ? html`<div class="cd-card empty cd-page-empty"><div class="cd-empty"><span class="ph-ic"><${Icon} name="clock" size=${20} /></span><b>${cur ? `「${cur}」里还没有` : '还没有倒计时'}</b><small>倒数到 deadline，或者正着数在一起多久了；右键可以换背景、分类</small><div class="ph-row"><button class="btn sm" onClick=${() => addCountdown('down', cur)}>倒计时</button><button class="btn sm ghost" onClick=${() => addCountdown('up', cur)}>正计时</button></div></div></div>`
      : html`${sec('倒数', downs)}${sec('正计时', ups)}${sec('已经过去的', past)}`}
  </div>`;
}
