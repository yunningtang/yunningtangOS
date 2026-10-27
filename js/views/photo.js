// 总览里的「图片」小卡：放一张自己喜欢的图（上传 / 拖进来 / 粘贴链接），可以配一句话。
// 图存成附件（跟笔记里的图片一样会同步到云端），卡片只记 { fid | url, fit, caption } 在 settings.photo 里。
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { Icon, Card } from '../ui.js';
import { ctxMenu } from '../ctx.js';
import { askPrompt } from '../confirm.js';
import { saveFile, fileUrl } from '../files.js';
import { fetchAttachment } from '../sync.js';

const setPhoto = (patch) => update((d) => { d.settings.photo = patch === null ? null : { ...(d.settings.photo || {}), ...patch }; });

export function PhotoWidget() {
  const s = useStore();
  const p = s.settings.photo || null;
  const [src, setSrc] = useState('');
  const [state, setState] = useState(''); // '' | 'loading' | 'missing'
  const [over, setOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    let alive = true;
    if (!p) { setSrc(''); setState(''); return; }
    if (p.url) { setSrc(p.url); setState(''); return; }
    if (!p.fid) return;
    (async () => {
      setState('loading');
      let u = await fileUrl(p.fid);
      if (!u) { const rec = await fetchAttachment(p.fid, { name: p.name, mime: p.mime }); if (rec) u = await fileUrl(p.fid); }
      if (!alive) return;
      setSrc(u || ''); setState(u ? '' : 'missing');
    })();
    return () => { alive = false; };
  }, [p && p.fid, p && p.url]);

  const useFile = async (f) => {
    if (!f || !/^image\//.test(f.type)) return;
    const rec = await saveFile(f);
    setPhoto({ fid: rec.id, name: rec.name, mime: rec.type, url: '' });
  };
  const pick = () => fileRef.current && fileRef.current.click();
  const fromLink = async () => {
    const v = await askPrompt('贴一张图片的链接（https 开头）', p && p.url ? p.url : '', { title: '用链接', placeholder: 'https://…' });
    if (v == null) return; const u = v.trim();
    if (/^https:\/\/\S+$/i.test(u)) setPhoto({ url: u, fid: '' });
  };
  const editCaption = async () => {
    const v = await askPrompt('写一句话，显示在图片左下角（留空就不显示）', (p && p.caption) || '', { title: '配一句话' });
    if (v != null) setPhoto({ caption: v.trim().slice(0, 80) });
  };
  const menu = (e) => ctxMenu(e, [
    { label: '换一张', icon: 'image', onClick: pick },
    { label: '用链接', icon: 'link', onClick: fromLink },
    p && { label: (p.caption ? '改' : '配') + '一句话', icon: 'edit', onClick: editCaption },
    p && { label: p.fit === 'contain' ? '铺满卡片' : '完整显示', icon: 'maximize', onClick: () => setPhoto({ fit: p.fit === 'contain' ? 'cover' : 'contain' }) },
    p && 'sep',
    p && { label: '移除图片', icon: 'trash', danger: true, onClick: () => setPhoto(null) },
  ], '图片');
  const drop = (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) useFile(f); };
  const dragOver = (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } };

  return html`<${Card} class=${'photo-card ' + (src ? 'has' : 'empty') + (over ? ' over' : '')} pad=${false} onContextMenu=${menu} onDragOver=${dragOver} onDragLeave=${() => setOver(false)} onDrop=${drop}>
    <input type="file" accept="image/*" ref=${fileRef} style="display:none" onChange=${(e) => { useFile(e.target.files[0]); e.target.value = ''; }} />
    ${src ? html`
      <img class=${'ph-img ' + (p.fit === 'contain' ? 'contain' : '')} src=${src} alt=${p.caption || ''} draggable="false" onError=${() => setState('missing')} />
      ${p.caption && html`<div class="ph-cap">${p.caption}</div>`}
      <div class="ph-acts">
        <button class="ph-btn" title="换一张" onClick=${pick}><${Icon} name="image" size=${14} /></button>
        <button class="ph-btn" title="更多" onClick=${menu}><${Icon} name="dots" size=${14} /></button>
      </div>`
    : html`<div class="ph-empty">
        <span class="ph-ic"><${Icon} name="image" size=${20} /></span>
        <b>${state === 'loading' ? '正在取图…' : state === 'missing' ? '这台设备上还没有这张图' : '放一张喜欢的图'}</b>
        <small>拖进来，或者</small>
        <div class="ph-row"><button class="btn sm" onClick=${pick}>上传</button><button class="btn sm ghost" onClick=${fromLink}>用链接</button></div>
      </div>`}
  <//>`;
}
