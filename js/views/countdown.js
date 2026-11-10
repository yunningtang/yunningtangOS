// 总览里的「倒计时」小卡：倒数到某一天（deadline），或者正着数从某一天起过了多久（比如在一起多久了）。
// 可以有好几个，最上面那个大大地显示，其余排在下面；每个都可以配一张图。
// 存在 settings.countdowns（跟着账号同步）；图片和「图片」小卡一样存成附件。右键编辑，菜单和「图片」小卡同一种写法。
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { Icon, Card } from '../ui.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt, askDate, askConfirm } from '../confirm.js';
import { saveFile, fileUrl } from '../files.js';
import { fetchAttachment } from '../sync.js';
import { uid, todayStr, fmtShort } from '../util.js';

const list = (s) => (Array.isArray(s.settings.countdowns) ? s.settings.countdowns : []);
const setList = (fn) => update((d) => { d.settings.countdowns = fn(Array.isArray(d.settings.countdowns) ? d.settings.countdowns : []); });
const patch = (id, p) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
const DAY = 864e5;
const parse = (d) => new Date(d.replace(/-/g, '/')).getTime();

// 天数：倒计时 = 离那天还有几天（0 = 就是今天，负数 = 已经过了）；正计时 = 从那天到今天第几天（那天本身算第 1 天）
export function countOf(c, today = todayStr()) {
  const diff = Math.round((parse(c.date) - parse(today)) / DAY);
  return c.mode === 'up' ? -diff + 1 : diff;
}
// 正计时再拆成「几年几个月几天」
function ymd(from, to) {
  const a = new Date(from.replace(/-/g, '/')), b = new Date(to.replace(/-/g, '/'));
  let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate();
  if (d < 0) { m -= 1; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return [y && `${y} 年`, m && `${m} 个月`, d && `${d} 天`].filter(Boolean).join(' ');
}
const wd = (d) => '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];

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

async function addOne(mode) {
  const title = await askPrompt(mode === 'up' ? '从哪一天开始数？先起个名字' : '倒数到什么事？', '', { title: mode === 'up' ? '新的正计时' : '新的倒计时', placeholder: mode === 'up' ? '比如：和 TA 在一起' : '比如：论文 deadline' });
  if (title == null || !title.trim()) return;
  const date = await askDate(mode === 'up' ? '从哪一天开始' : '哪一天截止', mode === 'up' ? todayStr() : '', { title: title.trim() });
  if (!date) return;
  setList((l) => [{ id: uid(), title: title.trim().slice(0, 40), date, mode, fit: 'cover' }, ...l]);
}

export function CountdownWidget() {
  const s = useStore(); const items = list(s); const today = todayStr();
  const fileRef = useRef(); const target = useRef('');
  const [over, setOver] = useState(false);
  const top = items[0]; const src = useImg(top);
  const useFile = async (f, id) => { if (!f || !/^image\//.test(f.type) || !id) return; const rec = await saveFile(f); patch(id, { fid: rec.id, name: rec.name, mime: rec.type, url: '' }); };
  const pick = (id) => { target.current = id; fileRef.current && fileRef.current.click(); };
  const fromLink = async (c) => { const v = await askPrompt('贴一张图片的链接（https 开头）', c.url || '', { title: '用链接', placeholder: 'https://…' }); if (v == null) return; const u = v.trim(); if (/^https:\/\/\S+$/i.test(u)) patch(c.id, { url: u, fid: '' }); };
  // 右键菜单：和「图片」小卡同一种写法——先是这一项的编辑，再是图片，最后新建 / 删除
  const menu = (e, c) => ctxMenu(e, [
    c && { label: '改名字', icon: 'edit', onClick: async () => { const v = await askPrompt('名字', c.title, { title: '改名字' }); if (v != null && v.trim()) patch(c.id, { title: v.trim().slice(0, 40) }); } },
    c && { label: c.mode === 'up' ? '改开始的日子' : '改截止日期', icon: 'calendar', hint: fmtShort(c.date), onClick: async () => { const v = await askDate(c.mode === 'up' ? '从哪一天开始' : '哪一天截止', c.date, { title: c.title }); if (v) patch(c.id, { date: v }); } },
    c && { label: c.mode === 'up' ? '改成倒计时' : '改成正计时', icon: 'refresh', hint: c.mode === 'up' ? '数还剩几天' : '数过了多久', onClick: () => patch(c.id, { mode: c.mode === 'up' ? 'down' : 'up' }) },
    c && items.indexOf(c) > 0 && { label: '放到最上面', icon: 'up', onClick: () => setList((l) => [c, ...l.filter((x) => x.id !== c.id)]) },
    c && 'sep',
    c && { label: c.fid || c.url ? '换一张图' : '配一张图', icon: 'image', onClick: () => pick(c.id) },
    c && { label: '用链接', icon: 'link', onClick: () => fromLink(c) },
    c && (c.fid || c.url) && { label: c.fit === 'contain' ? '铺满卡片' : '完整显示', icon: 'maximize', onClick: () => patch(c.id, { fit: c.fit === 'contain' ? 'cover' : 'contain' }) },
    c && (c.fid || c.url) && { label: '移除图片', icon: 'x', onClick: () => patch(c.id, { fid: '', url: '', name: '', mime: '' }) },
    'sep',
    { label: '新的倒计时', icon: 'clock', onClick: () => addOne('down') },
    { label: '新的正计时', icon: 'sparkle', hint: '比如在一起多久了', onClick: () => addOne('up') },
    c && 'sep',
    c && { label: '删除', icon: 'trash', danger: true, onClick: async () => { if (await askConfirm(`「${c.title}」会从总览上去掉。`, { title: '删除这个计时？', ok: '删除' })) setList((l) => l.filter((x) => x.id !== c.id)); } },
  ].filter(Boolean), c ? c.title : '倒计时');

  const drop = (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && top) useFile(f, top.id); };
  const dragOver = (e) => { if (top && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } };
  const fileInput = html`<input type="file" accept="image/*" ref=${fileRef} style="display:none" onChange=${(e) => { useFile(e.target.files[0], target.current); e.target.value = ''; }} />`;

  if (!top) return html`<${Card} class="cd-card empty" onContextMenu=${(e) => menu(e, null)}>
    ${fileInput}
    <div class="cd-empty">
      <span class="ph-ic"><${Icon} name="clock" size=${20} /></span>
      <b>倒计时 / 正计时</b>
      <small>数到 deadline 还剩几天，或者某件事过了多久</small>
      <div class="ph-row"><button class="btn sm" onClick=${() => addOne('down')}>倒计时</button><button class="btn sm ghost" onClick=${() => addOne('up')}>正计时</button></div>
    </div>
  <//>`;

  const n = countOf(top, today); const up = top.mode === 'up';
  const big = up ? n : Math.abs(n);
  const lead = up ? `${top.title} 已经` : n > 0 ? `距离 ${top.title} 还有` : n === 0 ? top.title : `${top.title} 已经过了`;
  const unit = up || n !== 0 ? '天' : '';
  const sub = up ? (n > 1 ? `${fmtShort(top.date)} 起 · ${ymd(top.date, today) || '今天开始'}` : `${fmtShort(top.date)} 开始`) : `${top.date.slice(0, 4) !== today.slice(0, 4) ? top.date.slice(0, 4) + ' 年 ' : ''}${fmtShort(top.date)} 周${wd(top.date)}`;
  return html`<${Card} class=${'cd-card ' + (src ? 'has-img ' : '') + (over ? 'over ' : '') + (!up && n < 0 ? 'past ' : '') + (!up && n >= 0 && n <= 7 ? 'soon' : '')} pad=${false} onContextMenu=${(e) => menu(e, top)} onDragOver=${dragOver} onDragLeave=${() => setOver(false)} onDrop=${drop}>
    ${fileInput}
    ${src && html`<img class=${'cd-img ' + (top.fit === 'contain' ? 'contain' : '')} src=${src} alt="" draggable="false" />`}
    <div class="cd-main">
      <div class="cd-lead">${lead}</div>
      <div class="cd-num">${n === 0 && !up ? html`<b class="cd-today">就是今天</b>` : html`<b>${big}</b><span>${unit}</span>`}</div>
      <div class="cd-sub">${sub}</div>
    </div>
    ${items.length > 1 && html`<div class="cd-more">${items.slice(1, 4).map((c) => { const k = countOf(c, today); return html`<button type="button" key=${c.id} class="cd-row" title="点一下放到最上面；右键编辑" onClick=${() => setList((l) => [c, ...l.filter((x) => x.id !== c.id)])} onContextMenu=${(e) => { e.stopPropagation(); menu(e, c); }}><span>${c.title}</span><b>${c.mode === 'up' ? `${k} 天` : k > 0 ? `还有 ${k} 天` : k === 0 ? '今天' : `过了 ${-k} 天`}</b></button>`; })}${items.length > 4 && html`<small class="cd-n">还有 ${items.length - 4} 个，右键管理</small>`}</div>`}
    <div class="ph-acts"><button class="ph-btn" title="更多（也可以右键）" onClick=${(e) => menu(e, top)}><${Icon} name="dots" size=${14} /></button></div>
  <//>`;
}
