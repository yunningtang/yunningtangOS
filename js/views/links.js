import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, upsert, remove, update } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, TagInput, confirmDel } from '../ui.js';
import { uid, todayStr, hostOf, sortBy } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { toast } from '../nav.js';

export function LinkModal({ open, link, onClose }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open) setF(link ? { ...link } : { id: uid(), url: '', title: '', note: '', tags: [], fav: false, read: false, created: todayStr() }); }, [open, link]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    let url = f.url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    upsert('links', { ...f, url, host: hostOf(url), title: f.title.trim() || hostOf(url) });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${link ? '编辑收藏' : '收藏链接'} foot=${html`
    ${link && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { if (confirmDel()) { remove('links', link.id); onClose(); } }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="URL"><input type="url" autofocus value=${f.url} placeholder="https://…" onInput=${(e) => set('url', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <${Field} label="标题"><input type="text" value=${f.title} placeholder="留空则用域名" onInput=${(e) => set('title', e.target.value)} /><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="为什么收藏 / 摘要"><textarea rows="3" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
      <label class="row small"><input type="checkbox" checked=${f.read} onChange=${(e) => set('read', e.target.checked)} /> 已读</label>
    </div>
  <//>`;
}

export default function Links() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [tagF, setTagF] = useState('');
  const [view, setView] = useState('all');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [quick, setQuick] = useState('');
  const links = useMemo(() => {
    let l = s.links;
    if (view === 'fav') l = l.filter((x) => x.fav);
    if (view === 'unread') l = l.filter((x) => !x.read);
    if (tagF) l = l.filter((x) => x.tags.includes(tagF));
    if (q) { const k = q.toLowerCase(); l = l.filter((x) => (x.title + x.url + x.note + x.tags.join(' ')).toLowerCase().includes(k)); }
    return sortBy(l, '-created');
  }, [s.links, view, tagF, q]);
  const tags = useMemo(() => { const m = new Map(); s.links.forEach((l) => l.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [s.links]);
  const quickAdd = () => {
    let url = quick.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    upsert('links', { id: uid(), url, host: hostOf(url), title: hostOf(url), note: '', tags: tagF ? [tagF] : [], fav: false, read: false, created: todayStr() });
    setQuick('');
  };
  const groups = useMemo(() => {
    const g = new Map();
    links.forEach((l) => { const k = l.created.slice(0, 7); if (!g.has(k)) g.set(k, []); g.get(k).push(l); });
    return [...g.entries()];
  }, [links]);

  return html`<div>
    <div class="page-h">
      <div><div class="kicker">Links</div><h1>收藏</h1><div class="desc">${s.links.length} 条 · ${s.links.filter((l) => !l.read).length} 条待读</div></div>
      <div class="acts">
        <${Seg} options=${[{ v: 'all', label: '全部' }, { v: 'unread', label: '待读' }, { v: 'fav', label: '最爱' }]} value=${view} onChange=${setView} />
        <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>收藏<//>
      </div>
    </div>
    <${Card}>
      <div class="quickadd"><${Icon} name="link" size=${15} class="muted" /><input class="flex1" type="text" value=${quick} placeholder="粘贴链接，回车快速收藏" onInput=${(e) => setQuick(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && quickAdd()} /><input type="search" value=${q} placeholder="搜索…" style="width:160px" onInput=${(e) => setQ(e.target.value)} /></div>
      ${tags.length > 0 && html`<div class="filters">${tags.map(([t, n]) => html`<${Tag} class="click" color=${tagF === t ? 'var(--teal)' : undefined} onClick=${() => setTagF(tagF === t ? '' : t)}>${t} <span class="muted">${n}</span><//>`)}</div>`}
      ${links.length === 0 ? html`<${Empty} icon="link" text="没有匹配的收藏。" />` : groups.map(([mon, list]) => html`
        <div class="group-h">${mon}<i></i><span>${list.length}</span></div>
        <div class="links">${list.map((l) => html`<div class="lk" key=${l.id} onContextMenu=${(e) => ctxMenu(e, [{ label: '打开', icon: 'external', onClick: () => { window.open(l.url, '_blank', 'noopener'); upsert('links', { id: l.id, read: true }); } }, { label: '复制链接', icon: 'link', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(l.url); toast('已复制'); } }, { label: '编辑', icon: 'edit', onClick: () => { setEditing(l); setModal(true); } }, 'sep', { label: l.read ? '标为待读' : '标为已读', icon: 'eye', onClick: () => upsert('links', { id: l.id, read: !l.read }) }, { label: l.fav ? '取消最爱' : '最爱', icon: 'heart', onClick: () => upsert('links', { id: l.id, fav: !l.fav }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => remove('links', l.id) }], l.title)}>
                    <a class="fav" href=${l.url} target="_blank" rel="noopener" title=${l.host}><img src=${`https://www.google.com/s2/favicons?domain=${l.host}&sz=32`} alt="" onError=${(e) => { e.target.replaceWith(document.createTextNode((l.host || '?')[0])); }} /></a>
          <div class="li">
            <a href=${l.url} target="_blank" rel="noopener" style="text-decoration:none" onClick=${() => !l.read && upsert('links', { id: l.id, read: true })}><b>${l.title}</b></a>
            <span class="host">${l.host} · ${l.created}${l.read ? '' : ' · 待读'}</span>
            ${l.note && html`<p>${l.note}</p>`}
            ${l.tags.length > 0 && html`<div class="tags">${l.tags.map((t) => html`<${Tag} class="click" onClick=${() => setTagF(t)}>${t}<//>`)}</div>`}
          </div>
          <button class=${'ibtn heart ' + (l.fav ? 'on' : '')} title="最爱" onClick=${() => upsert('links', { id: l.id, fav: !l.fav })}><${Icon} name="heart" size=${14} /></button>
          <div class="acts"><${IconBtn} icon="edit" title="编辑" size=${13} onClick=${() => { setEditing(l); setModal(true); }} /></div>
        </div>`)}</div>`)}
    <//>
    <${LinkModal} open=${modal} link=${editing} onClose=${() => setModal(false)} />
  </div>`;
}
