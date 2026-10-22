import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, confirmDel, AutoTextarea } from '../ui.js';
import { uid, todayStr, AREAS, pickFile, imageToDataUrl } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { Splitter } from '../resize.js';
import { askPrompt } from '../confirm.js';
import { dragProps, dropProps } from '../dnd.js';
import { toast } from '../nav.js';

const DEFAULT_AREAS = ['学习成长', '事业', '创作', '健康', '关系', '财务', '玩乐', '精神'];

function LifeWheel({ areas, onChange }) {
  const n = areas.length, R = 100, cx = 120, cy = 120;
  const pt = (i, r) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const poly = areas.map((a, i) => pt(i, (a.score / 10) * R).join(',')).join(' ');
  return html`<div class="wheel-wrap">
    <div class="wheel"><svg viewBox="0 0 240 240">
      ${[2, 4, 6, 8, 10].map((v) => html`<polygon points=${areas.map((_, i) => pt(i, (v / 10) * R).join(',')).join(' ')} fill="none" stroke="var(--line-2)" stroke-width="1" />`)}
      ${areas.map((_, i) => html`<line x1=${cx} y1=${cy} x2=${pt(i, R)[0]} y2=${pt(i, R)[1]} stroke="var(--line-2)" />`)}
      <polygon points=${poly} fill="rgba(var(--ac),.18)" stroke="var(--blue)" stroke-width="2" stroke-linejoin="round" />
      ${areas.map((a, i) => { const [x, y] = pt(i, (a.score / 10) * R); return html`<circle cx=${x} cy=${y} r="3.5" fill="var(--blue)" />`; })}
      ${areas.map((a, i) => { const [x, y] = pt(i, R + 16); return html`<text x=${x} y=${y} text-anchor="middle" dominant-baseline="middle" font-size="9" fill="var(--text-3)">${a.name}</text>`; })}
    </svg></div>
    <div class="wheel-ctl">${areas.map((a, i) => html`<div class="r"><span>${a.name}</span><input type="range" min="0" max="10" value=${a.score} onInput=${(e) => onChange(i, +e.target.value)} /><b>${a.score}</b></div>`)}</div>
  </div>`;
}

export default function Vision() {
  const s = useStore();
  const v = s.vision;
  const [txt, setTxt] = useState('');
  const [boardModal, setBoardModal] = useState(false);
  const [bf, setBf] = useState({ img: '', caption: '', text: '' });
  const [ltModal, setLtModal] = useState(false);
  const [lf, setLf] = useState({ title: '', by: '', area: '' });
  const [editAff, setEditAff] = useState(null);
  const areas = v.areas.length ? v.areas : DEFAULT_AREAS.map((name) => ({ id: uid(), name, score: 5 }));

  useEffect(() => { if (!v.areas.length) update((d) => { d.vision.areas = areas; }); }, []);

  const addStatement = () => {
    const t = txt.trim(); if (!t) return;
    update((d) => { d.vision.statements.push({ id: uid(), text: t, created: todayStr() }); });
    setTxt('');
  };
  const addBoard = () => {
    if (!bf.img.trim() && !bf.text.trim()) return;
    update((d) => { d.vision.board.unshift({ id: uid(), img: bf.img.trim(), caption: bf.caption.trim(), text: bf.text.trim() }); });
    setBf({ img: '', caption: '', text: '' }); setBoardModal(false);
  };
  const addLt = () => {
    if (!lf.title.trim()) return;
    update((d) => { d.vision.longterm.push({ id: uid(), ...lf, title: lf.title.trim(), done: false }); });
    setLf({ title: '', by: '', area: '' }); setLtModal(false);
  };
  const avg = (areas.reduce((n, a) => n + a.score, 0) / areas.length).toFixed(1);
  const delStatement = (st) => { update((d) => { d.vision.statements = d.vision.statements.filter((y) => y.id !== st.id); }); toast('已删除', { label: '撤销', onClick: () => update((d) => { d.vision.statements.push(st); }) }); };
  const affMenu = (st) => [{ label: '编辑', icon: 'edit', onClick: () => setEditAff(st.id) }, { label: '复制文字', icon: 'layers', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(st.text); toast('已复制'); } }, { label: '放到愿景板', icon: 'image', onClick: () => update((d) => { d.vision.board.unshift({ id: uid(), img: '', caption: '', text: st.text }); }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => delStatement(st) }];
  const uploadBoard = async () => { try { const f = await pickFile('image/*'); if (!f) return; const img = await imageToDataUrl(f, 1200); setBf((x) => ({ ...x, img })); } catch (x) { toast(x.message || '上传失败'); } };

  return html`<div>
    <div class="page-h">
      <div><div class="kicker">Vision</div><h1>愿景</h1><div class="desc">写下来，看见它，然后成为它。</div></div>
    </div>
    <div class="vision-grid">
      <div class="stack">
        <${Card} title="显化 · 肯定句" sub="用现在时写，像已经发生一样。总览页每天会轮换显示一条。">
          <div class=${'aff-write ' + (txt.trim() ? 'has' : '')}>
            <${AutoTextarea} value=${txt} placeholder="我正在…" rows="1" onInput=${(e) => setTxt(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addStatement(); } }} />
            <div class="aff-write-f"><span class="hint">Enter 写下 · Shift+Enter 换行</span><${Btn} small kind="primary" disabled=${!txt.trim()} onClick=${addStatement}>写下<//></div>
          </div>
          ${v.statements.length === 0 ? html`<${Empty} icon="sparkle" text="第一句写什么？试试：我每天都在变得更专注、更自由。" />` : html`<ol class="aff">${v.statements.map((st, idx) => html`<li key=${st.id} ...${dragProps('aff', { id: st.id })} ...${dropProps('aff', (d, { after }) => { if (d.id === st.id) return; update((dd) => { const l = dd.vision.statements; const from = l.findIndex((x) => x.id === d.id); const [mv] = l.splice(from, 1); let to = l.findIndex((x) => x.id === st.id); if (after) to++; l.splice(to, 0, mv); }); }, { position: true })} onContextMenu=${(e) => ctxMenu(e, affMenu(st), '肯定句')}>
            <span class="aff-n">${String(idx + 1).padStart(2, '0')}</span>
            ${editAff === st.id ? html`<${AutoTextarea} class="aff-edit" autofocus value=${st.text} onInput=${(e) => update((d) => { const x = d.vision.statements.find((y) => y.id === st.id); if (x) x.text = e.target.value; })} onBlur=${() => setEditAff(null)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape') e.target.blur(); }} />` : html`<span class="aff-t" onClick=${() => setEditAff(st.id)}>${st.text}</span>`}
            <div class="acts"><${IconBtn} icon="dots" size=${14} title="更多…" onClick=${(e) => ctxMenu(e, affMenu(st), '肯定句')} /></div>
          </li>`)}</ol>`}
        <//>
        <${Card} title="愿景板" sub="上传照片、贴图片链接，或只写一句话。" action=${html`<${Btn} small icon="plus" onClick=${() => setBoardModal(true)}>添加<//>`}>
          ${v.board.length === 0 ? html`<${Empty} icon="image" text="把想去的地方、想成为的样子贴上来。" />` : html`<div class="board">${v.board.map((b) => html`<div class=${'bi ' + (b.img ? '' : 'txt')} key=${b.id} ...${dragProps('board', { id: b.id })} ...${dropProps('board', (d, { after }) => { if (d.id === b.id) return; update((dd) => { const l = dd.vision.board; const from = l.findIndex((x) => x.id === d.id); const [mv] = l.splice(from, 1); let to = l.findIndex((x) => x.id === b.id); if (after) to++; l.splice(to, 0, mv); }); }, { position: true })} onContextMenu=${(e) => ctxMenu(e, [b.img && { label: '打开图片', icon: 'external', onClick: () => window.open(b.img, '_blank', 'noopener') }, { label: '改说明', icon: 'edit', onClick: async () => { const v2 = await askPrompt('说明 / 文字', b.img ? b.caption : b.text, { title: '愿景板' }); if (v2 !== null) update((d) => { const x = d.vision.board.find((y) => y.id === b.id); if (b.img) x.caption = v2; else x.text = v2; }); } }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => update((d) => { d.vision.board = d.vision.board.filter((y) => y.id !== b.id); }) }], '愿景板')}>
            ${b.img ? html`<img src=${b.img} alt=${b.caption} loading="lazy" />${b.caption && html`<div class="cap">${b.caption}</div>`}` : b.text}
            <button class="ibtn del" title="更多…" onClick=${(e) => e.currentTarget.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }))}><${Icon} name="dots" size=${13} /></button>
          </div>`)}</div>`}
        <//>
      </div>
      <${Splitter} varName="visside" min=${280} max=${640} dir=${-1} class="sp-col" />
      <div class="stack">
        <${Card} title="生命之轮" sub=${`此刻的平衡 · 平均 ${avg}/10`} action=${html`<${Btn} small kind="ghost" onClick=${async () => { const name = await askPrompt('领域名称', '', { title: '新领域', placeholder: '比如：创造力' }); if (name && name.trim()) update((d) => { d.vision.areas.push({ id: uid(), name: name.trim(), score: 5 }); }); }}>+ 领域<//>`}>
          <${LifeWheel} areas=${areas} onChange=${(i, score) => update((d) => { if (!d.vision.areas.length) d.vision.areas = areas; d.vision.areas[i].score = score; })} />
          <p class="small muted" style="margin-top:12px">每个月初回来拖一次，看看哪一块在被忽略。</p>
        <//>
        <${Card} title="长期目标" sub="一到三年内" action=${html`<${Btn} small icon="plus" onClick=${() => setLtModal(true)}>添加<//>`}>
          ${v.longterm.length === 0 ? html`<${Empty} icon="flag" text="三年后的你，在做什么？" />` : html`<div class="lt">${v.longterm.map((g) => html`<div class=${'li ' + (g.done ? 'done' : '')} key=${g.id} ...${dragProps('lt', { id: g.id })} ...${dropProps('lt', (d, { after }) => { if (d.id === g.id) return; update((dd) => { const l = dd.vision.longterm; const from = l.findIndex((x) => x.id === d.id); const [mv] = l.splice(from, 1); let to = l.findIndex((x) => x.id === g.id); if (after) to++; l.splice(to, 0, mv); }); }, { position: true })} onContextMenu=${(e) => ctxMenu(e, [{ label: g.done ? '标为未完成' : '标为完成', icon: 'check', onClick: () => update((d) => { const x = d.vision.longterm.find((y) => y.id === g.id); x.done = !x.done; }) }, { label: '改期限', icon: 'calendar', onClick: async () => { const v2 = await askPrompt('期限', g.by, { title: '改期限', placeholder: '2027 / 30 岁前' }); if (v2 !== null) update((d) => { d.vision.longterm.find((y) => y.id === g.id).by = v2; }); } }, { label: '拆成本月目标', icon: 'target', onClick: () => update((d) => { const mk = new Date().toISOString().slice(0, 7); d.goals[mk] = d.goals[mk] || []; d.goals[mk].push({ id: uid(), title: g.title, area: g.area || '', why: '长期目标的一步', progress: 0, krs: [] }); }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => { update((d) => { d.vision.longterm = d.vision.longterm.filter((y) => y.id !== g.id); }); toast(`已删除「${g.title}」`, { label: '撤销', onClick: () => update((d) => { d.vision.longterm.push(g); }) }); } }], g.title)}>
            <button class=${'cb ' + (g.done ? 'on' : '')} style=${`width:18px;height:18px;border-radius:6px;border:1.5px solid ${g.done ? 'var(--teal)' : 'var(--text-4)'};background:${g.done ? 'var(--teal)' : 'transparent'};color:#fff;display:grid;place-items:center`} onClick=${() => update((d) => { const x = d.vision.longterm.find((y) => y.id === g.id); x.done = !x.done; })}><${Icon} name="check" size=${11} /></button>
            <b>${g.title}</b>${g.area && html`<${Tag}>${g.area}<//>`}<span class="by">${g.by}</span>
            <${IconBtn} class="ibtn lt-more" icon="dots" size=${14} title="更多…" onClick=${(e) => e.currentTarget.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }))} />
          </div>`)}</div>`}
        <//>
      </div>
    </div>
    <${Modal} open=${boardModal} onClose=${() => setBoardModal(false)} title="添加到愿景板" foot=${html`<${Btn} kind="ghost" onClick=${() => setBoardModal(false)}>取消<//><${Btn} kind="primary" onClick=${addBoard}>添加<//>`}>
      <div class="form">
        <${Field} label="图片"><div class="row" style="gap:8px"><${Btn} small icon="image" onClick=${uploadBoard}>上传图片<//><input class="flex1" type="url" value=${bf.img.startsWith('data:') ? '' : bf.img} placeholder="或粘贴图片链接 https://…" onInput=${(e) => setBf({ ...bf, img: e.target.value })} /></div>${bf.img && html`<div class="board-prev"><img src=${bf.img} alt="" /><button class="ibtn" title="移除" onClick=${() => setBf({ ...bf, img: '' })}><${Icon} name="x" size=${12} /></button></div>`}<//>
        <${Field} label="说明"><input type="text" value=${bf.caption} onInput=${(e) => setBf({ ...bf, caption: e.target.value })} /><//>
        <${Field} label="或者只写一句话（没有图片时显示为文字卡）"><input type="text" value=${bf.text} onInput=${(e) => setBf({ ...bf, text: e.target.value })} /><//>
      </div>
    <//>
    <${Modal} open=${ltModal} onClose=${() => setLtModal(false)} title="长期目标" foot=${html`<${Btn} kind="ghost" onClick=${() => setLtModal(false)}>取消<//><${Btn} kind="primary" onClick=${addLt}>添加<//>`}>
      <div class="form">
        <${Field} label="目标"><input type="text" autofocus value=${lf.title} onInput=${(e) => setLf({ ...lf, title: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && addLt()} /><//>
        <div class="grid2">
          <${Field} label="期限"><input type="text" value=${lf.by} placeholder="2027 / 30 岁前" onInput=${(e) => setLf({ ...lf, by: e.target.value })} /><//>
          <${Field} label="领域"><select value=${lf.area} onChange=${(e) => setLf({ ...lf, area: e.target.value })}><option value="">—</option>${AREAS.map((a) => html`<option value=${a}>${a}</option>`)}</select><//>
        </div>
      </div>
    <//>
  </div>`;
}
