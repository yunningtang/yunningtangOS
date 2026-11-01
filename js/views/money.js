// 钱包：概览 / 记账 / 订阅 / 资产 / 宇宙支票，加一个「AI 录入」。计算都在 ../money.js。
import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, upsert, removeUndo, get } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, Progress, Select, DateInput } from '../ui.js';
import { uid, todayStr, addDays, pickFile, imageToDataUrl, fmtShort, relDay } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { go, toast } from '../nav.js';
import { askPrompt, askConfirm } from '../confirm.js';
import { saveFile, fileUrl } from '../files.js';
import { fetchAttachment } from '../sync.js';
import * as M from '../money.js';

const TABS = [['', '概览', 'home'], ['txns', '记账', 'receipt'], ['subs', '订阅', 'repeat'], ['assets', '资产', 'box'], ['cheque', '宇宙支票', 'sparkle']];
const srcName = (v) => (M.SOURCES.find(([k]) => k === v) || ['', '其他'])[1];
const cycName = (v) => M.cycleOf(v)[1];
const dd = (d) => { const n = M.daysBetween(todayStr(), d); return n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '后天' : n < 0 ? `${-n} 天前` : `${n} 天后`; };
const ymLabel = (k) => `${+k.slice(0, 4)} 年 ${+k.slice(5, 7)} 月`;
const shiftYm = (k, n) => { const [y, m] = k.split('-').map(Number); const t = new Date(y, m - 1 + n, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };

export default function Money({ route }) {
  const s = useStore(); const c = M.cfg(s);
  const tab = TABS.some(([k]) => k === route.sub) ? route.sub : '';
  const [ai, setAi] = useState(null); // AI 录入：{ tab, drafts }
  const [edit, setEdit] = useState(null); // { kind: 'txn'|'sub'|'asset'|'cheque', item }
  const [setOpen, setSetOpen] = useState(false);
  const due = M.dueSoon(s);
  return html`<div class="money">
    <div class="page-h">
      <div class="seg mo-tabs" data-liquid="button"><span class="liq"></span>${TABS.map(([k, l, ic]) => html`<button type="button" key=${k} class=${tab === k ? 'on' : ''} onClick=${() => go('money' + (k ? '/' + k : ''))}><${Icon} name=${ic} size=${13} />${l}${k === 'subs' && due.length > 0 && html`<i class="mo-dot" title=${`${due.length} 个订阅快扣费了`}></i>`}</button>`)}</div>
      <div class="acts">
        <${Btn} icon="sparkle" onClick=${() => setAi({ tab: 'text', drafts: [] })}>AI 录入<//>
        <${Btn} kind="primary" icon="plus" onClick=${() => setEdit({ kind: tab === 'subs' ? 'sub' : tab === 'assets' ? 'asset' : tab === 'cheque' ? 'cheque' : 'txn', item: null })}>${tab === 'subs' ? '加订阅' : tab === 'assets' ? '加资产' : tab === 'cheque' ? '开支票' : '记一笔'}<//>
        <${IconBtn} icon="settings" title="币种、汇率、分类、提醒" onClick=${() => setSetOpen(true)} />
      </div>
    </div>
    ${(tab === '' || tab === 'txns') && html`<${QuickBar} s=${s} onDrafts=${(drafts, t) => setAi({ tab: 'text', drafts, text: t })} />`}
    ${tab === '' && html`<${Overview} s=${s} c=${c} onEdit=${setEdit} />`}
    ${tab === 'txns' && html`<${Txns} s=${s} c=${c} onEdit=${setEdit} />`}
    ${tab === 'subs' && html`<${Subs} s=${s} c=${c} onEdit=${setEdit} onScan=${() => setAi({ tab: 'mail', drafts: [] })} />`}
    ${tab === 'assets' && html`<${Assets} s=${s} c=${c} onEdit=${setEdit} />`}
    ${tab === 'cheque' && html`<${Cheque} s=${s} c=${c} onEdit=${setEdit} />`}
    ${edit && edit.kind === 'txn' && html`<${TxnModal} s=${s} c=${c} item=${edit.item} onClose=${() => setEdit(null)} />`}
    ${edit && edit.kind === 'sub' && html`<${SubModal} c=${c} item=${edit.item} onClose=${() => setEdit(null)} />`}
    ${edit && edit.kind === 'asset' && html`<${AssetModal} c=${c} item=${edit.item} onClose=${() => setEdit(null)} />`}
    ${edit && edit.kind === 'cheque' && html`<${ChequeModal} c=${c} item=${edit.item} onClose=${() => setEdit(null)} />`}
    ${ai && html`<${AiPanel} s=${s} c=${c} init=${ai} onClose=${() => setAi(null)} />`}
    ${setOpen && html`<${MoneySettings} c=${c} onClose=${() => setSetOpen(false)} />`}
  </div>`;
}

/* ---------------- 一句话记账 ---------------- */
function QuickBar({ s, onDrafts }) {
  const [t, setT] = useState(''); const [busy, setBusy] = useState(false);
  const go1 = async () => {
    const text = t.trim(); if (!text || busy) return;
    // 一句话里有好几个金额（「午饭 15 晚饭 22」）、或本地没认出来：交给汤圆；否则本地规则就够了，不花 AI 用量
    const many = (text.match(/\d+(?:\.\d+)?/g) || []).length > 1 && /[,，、;；和]|\s.+\d.*\s/.test(text);
    const local = M.quickParse(text, s);
    if (local && !(many && M.aiReady())) { onDrafts(M.makeDrafts({ txns: [local] }, s), text); setT(''); return; }
    if (!M.aiReady()) { if (local) { onDrafts(M.makeDrafts({ txns: [local] }, s), text); setT(''); } else toast('没认出金额。试试「昨天星巴克 6.5 刀」这样的写法'); return; }
    setBusy(true);
    try { const r = await M.aiExtract({ text }, s); if (!r.txns.length && !r.subs.length) { toast(r.reply || '汤圆没认出记录'); return; } onDrafts(M.makeDrafts(r, s), text); setT(''); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return html`<${Card} class="mo-quick"><div class="quickadd"><${Icon} name="receipt" size=${15} class="muted" /><input class="flex1" type="text" value=${t} placeholder="一句话记账：昨天星巴克 6.5 刀 / 午饭 15 晚饭 22 / 奖学金到账 1500" onInput=${(e) => setT(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) go1(); }} />${busy ? html`<span class="muted small">汤圆在认…</span>` : html`<button class="btn ghost sm" disabled=${!t.trim()} onClick=${go1}>识别</button>`}</div><//>`;
}

/* ---------------- 概览 ---------------- */
function Overview({ s, c, onEdit }) {
  const today = todayStr(); const k = today.slice(0, 7);
  const spent = M.spentIn(s, k, c); const subsM = M.subsMonthly(s, c);
  const assetsDaily = (s.assets || []).filter((a) => a.status === 'use').reduce((n, a) => n + M.conv(M.assetDaily(a), a.cur || c.base, c.base, c.rates), 0);
  const ch = M.activeCheque(s); const inc = ch ? M.chequeIncome(s, ch) : null;
  const upcoming = M.dueSoon(s, 14); const recent = [...(s.txns || [])].sort((a, b) => (b.date + (b.created || '')).localeCompare(a.date + (a.created || ''))).slice(0, 6);
  const st = M.streak(s); const tr = M.dailyTrend(s); const saved = M.savedThisYear(s);
  return html`<div class="mo-ov">
    <div class="mo-stats">
      <${Stat} label="本月已花" value=${M.fmt(spent, c.base, { int: spent >= 1000 })} sub=${`日均 ${M.fmt(tr.now, c.base)}`} onClick=${() => go('money/txns')} />
      <${Stat} label="订阅月均" value=${M.fmt(subsM, c.base)} sub=${`${M.activeSubs(s).length} 个订阅 · 一年 ${M.fmt(subsM * 12, c.base, { int: true })}`} onClick=${() => go('money/subs')} />
      <${Stat} label="资产日均" value=${M.fmt(assetsDaily, c.base)} sub=${`${(s.assets || []).filter((a) => a.status === 'use').length} 件在用`} onClick=${() => go('money/assets')} />
      <${Stat} label="宇宙支票" value=${ch ? Math.round(Math.min(999, (inc.total / (+ch.target || 1)) * 100)) + '%' : '—'} sub=${ch ? `${M.fmt(inc.total, ch.cur, { int: true })} / ${M.fmt(ch.target, ch.cur, { int: true })}` : '还没开支票'} onClick=${() => go('money/cheque')} bar=${ch ? (inc.total / (+ch.target || 1)) * 100 : null} />
    </div>
    <div class="mo-feed">
      ${st > 0 && html`<span class="mo-chip"><${Icon} name="zap" size=${12} />连续记账 <b>${st}</b> 天</span>`}
      ${tr.before > 0 && tr.down > 0.02 && +todayStr().slice(8, 10) >= 7 && html`<span class="mo-chip good"><${Icon} name="down" size=${12} />日均比上月少 <b>${Math.round(tr.down * 100)}%</b></span>`}
      ${tr.before > 0 && tr.down < -0.1 && +todayStr().slice(8, 10) >= 7 && html`<span class="mo-chip warn"><${Icon} name="up" size=${12} />日均比上月多 <b>${Math.round(-tr.down * 100)}%</b></span>`}
      ${saved.year > 0 && html`<span class="mo-chip good"><${Icon} name="sparkle" size=${12} />今年取消订阅已省 <b>${M.fmt(saved.sofar, c.base)}</b>，到年底共 ${M.fmt(saved.year, c.base, { int: true })}</span>`}
    </div>
    <div class="mo-two">
      <${Card} title="即将扣费" sub="未来 14 天" action=${html`<a class="ibtn" href="#/money/subs" title="所有订阅"><${Icon} name="right" size=${14} /></a>`}>
        ${upcoming.length ? html`<div class="mo-list">${upcoming.map(({ sub, due }) => html`<div class=${'mo-row ' + (M.daysBetween(todayStr(), due) <= c.remindDays ? 'hot' : '')} key=${sub.id} onClick=${() => onEdit({ kind: 'sub', item: sub })}><b>${sub.name}</b><span class="muted">${dd(due)} · ${due.slice(5).replace('-', '/')}${sub.card ? ' · ' + sub.card : ''}</span><span class="mo-amt">${M.fmt(sub.amount, sub.cur || c.base)}</span></div>`)}</div>` : html`<p class="muted small">两周内没有要扣费的订阅。</p>`}
      <//>
      <${Card} title="最近记账" action=${html`<a class="ibtn" href="#/money/txns" title="全部"><${Icon} name="right" size=${14} /></a>`}>
        ${recent.length ? html`<div class="mo-list">${recent.map((t) => html`<${TxnRow} key=${t.id} t=${t} c=${c} onEdit=${onEdit} compact />`)}</div>` : html`<p class="muted small">还没有记录。上面输入一句话就能记，比如「昨天星巴克 6.5 刀」。</p>`}
      <//>
    </div>
  </div>`;
}
function Stat({ label, value, sub, onClick, bar }) {
  return html`<button type="button" class="card mo-stat" onClick=${onClick}><span class="mo-sl">${label}</span><b class="mo-sv">${value}</b>${bar != null && html`<${Progress} value=${bar} />`}<span class="mo-ss">${sub}</span></button>`;
}

/* ---------------- 记账 ---------------- */
function TxnRow({ t, c, onEdit, compact }) {
  const menu = (e) => ctxMenu(e, [{ label: '编辑', icon: 'edit', onClick: () => onEdit({ kind: 'txn', item: t }) }, { label: '复制一笔到今天', icon: 'copy', onClick: () => upsert('txns', { ...t, id: uid(), date: todayStr(), created: new Date().toISOString() }) }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('txns', t.id, t.note || '这笔') }], M.fmt(t.amount, t.cur || c.base));
  return html`<div class=${'mo-row txn ' + t.kind} onClick=${() => onEdit({ kind: 'txn', item: t })} onContextMenu=${menu}>
    <span class="mo-cat">${t.kind === 'in' ? srcName(t.source) : t.cat || '未分类'}</span>
    <span class="mo-note">${t.note || t.merchant || (t.kind === 'in' ? '收入' : '支出')}${t.project && html`<${Tag} plain>${t.project}<//>`}${compact ? html`<small class="muted"> · ${relDay(t.date)}</small>` : ''}</span>
    <span class="mo-amt">${t.kind === 'in' ? '+' : '−'}${M.fmt(t.amount, t.cur || c.base).replace('−', '')}${(t.cur || c.base) !== c.base && html`<small class="muted">≈${M.fmt(M.inBase(t, c), c.base)}</small>`}</span>
  </div>`;
}
function Txns({ s, c, onEdit }) {
  const [k, setK] = useState(todayStr().slice(0, 7)); const [proj, setProj] = useState(''); const [kind, setKind] = useState('all');
  const all = s.txns || [];
  const list = useMemo(() => all.filter((t) => (proj ? t.project === proj : t.date.slice(0, 7) === k) && (kind === 'all' || t.kind === kind)).sort((a, b) => (b.date + (b.created || '')).localeCompare(a.date + (a.created || ''))), [all, k, proj, kind]);
  const out = list.filter((t) => t.kind !== 'in').reduce((n, t) => n + M.inBase(t, c), 0), inc = list.filter((t) => t.kind === 'in').reduce((n, t) => n + M.inBase(t, c), 0);
  const byCat = {}; list.filter((t) => t.kind !== 'in').forEach((t) => { byCat[t.cat || '未分类'] = (byCat[t.cat || '未分类'] || 0) + M.inBase(t, c); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]); const max = cats.length ? cats[0][1] : 1;
  const days = []; list.forEach((t) => { const g = days[days.length - 1]; if (g && g[0] === t.date) g[1].push(t); else days.push([t.date, [t]]); });
  const projects = M.projectsOf(s).map((p) => { const l = all.filter((t) => t.project === p && t.kind !== 'in'); return { p, n: l.length, total: l.reduce((n, t) => n + M.inBase(t, c), 0), from: l.map((t) => t.date).sort()[0] || '', to: l.map((t) => t.date).sort().pop() || '' }; });
  return html`<div class="mo-txns">
    <div class="mo-bar">
      ${proj ? html`<button class="btn ghost sm" onClick=${() => setProj('')}><${Icon} name="left" size=${13} />按月看</button><b class="mo-period">项目：${proj}</b>` : html`<button class="ibtn" onClick=${() => setK(shiftYm(k, -1))}><${Icon} name="left" size=${14} /></button><b class="mo-period">${ymLabel(k)}</b><button class="ibtn" disabled=${k >= todayStr().slice(0, 7)} onClick=${() => setK(shiftYm(k, 1))}><${Icon} name="right" size=${14} /></button>`}
      <span class="flex1"></span>
      <${Seg} options=${[{ v: 'all', label: '全部' }, { v: 'out', label: '支出' }, { v: 'in', label: '收入' }]} value=${kind} onChange=${setKind} />
    </div>
    <div class="mo-two wide-left">
      <${Card}>
        <div class="mo-sum"><span>支出 <b>${M.fmt(out, c.base)}</b></span><span>收入 <b class="pos">${M.fmt(inc, c.base)}</b></span><span class="muted small">${list.length} 笔</span></div>
        ${days.length ? days.map(([d, l]) => html`<div key=${d}><div class="group-h">${d.slice(5).replace('-', '/')} ${relDay(d)}<i></i><span>${M.fmt(l.filter((t) => t.kind !== 'in').reduce((n, t) => n + M.inBase(t, c), 0), c.base)}</span></div><div class="mo-list">${l.map((t) => html`<${TxnRow} key=${t.id} t=${t} c=${c} onEdit=${onEdit} />`)}</div></div>`) : html`<${Empty} icon="receipt" text=${proj ? '这个项目还没有记录。' : '这个月还没有记录。'} />`}
      <//>
      <div class="mo-side">
        <${Card} title="分类">${cats.length ? html`<div class="mo-cats">${cats.map(([n, v]) => html`<div class="mo-catrow" key=${n}><span>${n}</span><i style=${`--w:${(v / max) * 100}%`}></i><b>${M.fmt(v, c.base, { int: v >= 100 })}</b></div>`)}</div>` : html`<p class="muted small">没有支出。</p>`}<//>
        <${Card} title="项目" sub="记账时填「项目」就会归到这里">${projects.length ? html`<div class="mo-list">${projects.map((x) => html`<div class=${'mo-row ' + (proj === x.p ? 'on' : '')} key=${x.p} onClick=${() => setProj(proj === x.p ? '' : x.p)}><b>${x.p}</b><span class="muted">${x.n} 笔${x.from ? ` · ${x.from.slice(2).replace(/-/g, '/')}–${x.to.slice(5).replace('-', '/')}` : ''}</span><span class="mo-amt">${M.fmt(x.total, c.base, { int: x.total >= 1000 })}</span></div>`)}</div>` : html`<p class="muted small">比如「大学·2026秋」：学费、教材、房租都记到这个项目里，就能单独看总花费。</p>`}<//>
      </div>
    </div>
  </div>`;
}
function TxnModal({ s, c, item, onClose }) {
  const [t, setT] = useState(() => item ? { ...item } : { id: uid(), date: todayStr(), amount: '', cur: c.base, kind: 'out', cat: c.cats[0], note: '', project: '', source: 'other' });
  const set = (p) => setT((x) => ({ ...x, ...p }));
  const save = () => { const a = Math.round(Math.abs(+t.amount) * 100) / 100; if (!(a > 0)) { toast('填一下金额'); return; } upsert('txns', { ...t, amount: a, cat: t.kind === 'in' ? '' : t.cat, source: t.kind === 'in' ? t.source || 'other' : '', ...(item ? {} : { created: new Date().toISOString(), via: 'hand' }) }); onClose(); };
  const projects = M.projectsOf(s);
  return html`<${Modal} open=${true} onClose=${onClose} title=${item ? '编辑记录' : '记一笔'} foot=${html`${item && html`<${Btn} kind="ghost" onClick=${() => { removeUndo('txns', item.id, item.note); onClose(); }}>删除<//>`}<span class="flex1"></span><${Btn} onClick=${onClose}>取消<//><${Btn} kind="primary" onClick=${save}>保存<//>`}>
    <div class="mo-form">
      <${Seg} options=${[{ v: 'out', label: '支出' }, { v: 'in', label: '收入' }]} value=${t.kind} onChange=${(v) => set({ kind: v })} />
      <div class="row" style="gap:8px"><${Field} label="金额" class="flex1"><input type="number" inputmode="decimal" step="0.01" autofocus value=${t.amount} onInput=${(e) => set({ amount: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && save()} /><//><${Field} label="币种"><${Select} value=${t.cur} options=${M.CURS} onChange=${(v) => set({ cur: v })} /><//></div>
      <div class="row" style="gap:8px">${t.kind === 'in' ? html`<${Field} label="来源" class="flex1"><${Select} value=${t.source || 'other'} options=${M.SOURCES.map(([v, l]) => ({ v, label: l }))} onChange=${(v) => set({ source: v })} /><//>` : html`<${Field} label="分类" class="flex1"><${Select} value=${t.cat} options=${c.cats} onChange=${(v) => set({ cat: v })} /><//>`}<${Field} label="日期"><${DateInput} value=${t.date} onChange=${(v) => set({ date: v })} clearable=${false} /><//></div>
      <${Field} label="备注"><input type="text" value=${t.note} placeholder="星巴克 · 拿铁" onInput=${(e) => set({ note: e.target.value })} /><//>
      <${Field} label="项目（可选）" hint="同一个项目的花费会单独汇总，比如「大学·2026秋」"><input type="text" list="mo-projects" value=${t.project || ''} placeholder="不属于项目就空着" onInput=${(e) => set({ project: e.target.value })} /><datalist id="mo-projects">${projects.map((p) => html`<option value=${p} />`)}</datalist><//>
    </div>
  <//>`;
}

/* ---------------- 订阅 ---------------- */
function Subs({ s, c, onEdit, onScan }) {
  const [showOff, setShowOff] = useState(false);
  const act = M.activeSubs(s).map((x) => ({ x, due: M.nextDue(x) })).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const off = (s.subs || []).filter((x) => x.status === 'cancelled').sort((a, b) => (b.cancelledAt || '').localeCompare(a.cancelledAt || ''));
  const monthly = M.subsMonthly(s, c); const saved = M.savedThisYear(s); const idle = act.filter(({ x }) => M.isIdle(x, c));
  const cancel = async (x) => { if (!(await askConfirm(`「${x.name}」标记为已取消，之后不再算进月均。记得也去对方网站真的取消。`, { title: '取消这个订阅？', ok: '已取消', danger: false }))) return; upsert('subs', { id: x.id, status: 'cancelled', cancelledAt: todayStr() }); toast(`已取消，按月均每月省 ${M.fmt(M.conv(M.monthlyOf(x), x.cur || c.base, c.base, c.rates), c.base)}`); };
  const menu = (e, x) => ctxMenu(e, [
    { label: '今天用过', icon: 'check', hint: '更新「最后使用」', onClick: () => upsert('subs', { id: x.id, lastUsed: todayStr(), consider: false }) },
    { label: x.consider ? '不考虑取消了' : '标记「考虑取消」', icon: 'flag', onClick: () => upsert('subs', { id: x.id, consider: !x.consider }) },
    { label: '编辑', icon: 'edit', onClick: () => onEdit({ kind: 'sub', item: x }) },
    'sep',
    x.status === 'cancelled' ? { label: '恢复订阅', icon: 'undo', onClick: () => upsert('subs', { id: x.id, status: 'active', cancelledAt: '' }) } : { label: '取消订阅', icon: 'x', onClick: () => cancel(x) },
    { label: '删除记录', icon: 'trash', danger: true, onClick: () => removeUndo('subs', x.id, x.name) },
  ], x.name);
  return html`<div class="mo-subs">
    <div class="mo-stats three">
      <div class="card mo-stat"><span class="mo-sl">订阅月均</span><b class="mo-sv">${M.fmt(monthly, c.base)}</b><span class="mo-ss">一年约 ${M.fmt(monthly * 12, c.base, { int: true })}</span></div>
      <div class="card mo-stat"><span class="mo-sl">考虑取消</span><b class="mo-sv">${idle.length}</b><span class="mo-ss">${idle.length ? `都取消每月省 ${M.fmt(idle.reduce((n, { x }) => n + M.conv(M.monthlyOf(x), x.cur || c.base, c.base, c.rates), 0), c.base)}` : `超过 ${c.idleDays} 天没用会标出来`}</span></div>
      <div class="card mo-stat"><span class="mo-sl">今年取消已省</span><b class="mo-sv pos">${M.fmt(saved.sofar, c.base)}</b><span class="mo-ss">到年底共 ${M.fmt(saved.year, c.base, { int: true })}</span></div>
    </div>
    <${Card} title="订阅" sub=${`${act.length} 个在扣费 · 扣费前 ${c.remindDays} 天提醒`} action=${html`<button class="btn ghost sm" onClick=${onScan}><${Icon} name="sparkle" size=${13} />从邮件收据补全</button>`}>
      ${act.length ? html`<div class="mo-list">${act.map(({ x, due }) => { const n = due ? M.daysBetween(todayStr(), due) : null; const isIdle = M.isIdle(x, c); return html`<div class=${'mo-row sub ' + (n != null && n <= c.remindDays ? 'hot' : '')} key=${x.id} onClick=${() => onEdit({ kind: 'sub', item: x })} onContextMenu=${(e) => menu(e, x)}>
          <b>${x.name}${isIdle && html` <span class="mo-badge warn">考虑取消</span>`}</b>
          <span class="muted">${due ? `${dd(due)}扣费 · ${due.slice(5).replace('-', '/')}` : '没填扣费日'}${x.card ? ' · ' + x.card : ''}${x.lastUsed ? ` · 上次用 ${relDay(x.lastUsed)}` : ''}</span>
          <span class="mo-amt">${M.fmt(x.amount, x.cur || c.base)}<small class="muted"> / ${cycName(x.cycle).replace('每', '')}</small></span>
          <span class="mo-acts" onClick=${(e) => e.stopPropagation()}><button class="btn ghost sm" title="更新「最后使用」为今天" onClick=${() => { upsert('subs', { id: x.id, lastUsed: todayStr(), consider: false }); toast('记下了：今天用过'); }}>用过</button><${IconBtn} icon="dots" title="更多" size=${13} onClick=${(e) => menu(e, x)} /></span>
        </div>`; })}</div>` : html`<${Empty} icon="repeat" text="还没有订阅。点右上「加订阅」，或者「从邮件收据补全」。" />`}
      ${off.length > 0 && html`<button class="btn ghost sm mo-more" onClick=${() => setShowOff(!showOff)}><${Icon} name=${showOff ? 'down' : 'right'} size=${12} />已取消 ${off.length}</button>`}
      ${showOff && html`<div class="mo-list off">${off.map((x) => html`<div class="mo-row sub" key=${x.id} onContextMenu=${(e) => menu(e, x)} onClick=${() => onEdit({ kind: 'sub', item: x })}><b>${x.name}</b><span class="muted">${x.cancelledAt ? x.cancelledAt + ' 取消' : '已取消'}</span><span class="mo-amt muted">${M.fmt(x.amount, x.cur || c.base)} / ${cycName(x.cycle).replace('每', '')}</span></div>`)}</div>`}
    <//>
  </div>`;
}
function SubModal({ c, item, onClose }) {
  const [x, setX] = useState(() => item ? { ...item } : { id: uid(), name: '', amount: '', cur: c.base, cycle: 'month', next: '', card: '', status: 'active', lastUsed: todayStr(), consider: false, note: '' });
  const set = (p) => setX((v) => ({ ...v, ...p }));
  const save = () => { if (!x.name.trim()) { toast('填一下名字'); return; } const a = Math.round(Math.abs(+x.amount) * 100) / 100; if (!(a > 0)) { toast('填一下金额'); return; } upsert('subs', { ...x, name: x.name.trim(), amount: a, ...(item ? {} : { created: new Date().toISOString() }) }); onClose(); };
  return html`<${Modal} open=${true} onClose=${onClose} title=${item ? '编辑订阅' : '加订阅'} foot=${html`${item && html`<${Btn} kind="ghost" onClick=${() => { removeUndo('subs', item.id, item.name); onClose(); }}>删除<//>`}<span class="flex1"></span><${Btn} onClick=${onClose}>取消<//><${Btn} kind="primary" onClick=${save}>保存<//>`}>
    <div class="mo-form">
      <${Field} label="名字"><input type="text" autofocus value=${x.name} placeholder="Vercel Pro / Spotify / iCloud" onInput=${(e) => set({ name: e.target.value })} /><//>
      <div class="row" style="gap:8px"><${Field} label="金额" class="flex1"><input type="number" step="0.01" value=${x.amount} onInput=${(e) => set({ amount: e.target.value })} /><//><${Field} label="币种"><${Select} value=${x.cur} options=${M.CURS} onChange=${(v) => set({ cur: v })} /><//><${Field} label="周期"><${Select} value=${x.cycle} options=${M.CYCLES.map(([v, l]) => ({ v, label: l }))} onChange=${(v) => set({ cycle: v })} /><//></div>
      <div class="row" style="gap:8px"><${Field} label="下次扣费日" class="flex1"><${DateInput} value=${x.next} onChange=${(v) => set({ next: v })} /><//><${Field} label="扣费卡" class="flex1"><input type="text" value=${x.card} placeholder="Visa 1234" onInput=${(e) => set({ card: e.target.value })} /><//></div>
      <div class="row" style="gap:8px"><${Field} label="最后一次用" class="flex1" hint=${`超过 ${c.idleDays} 天没用会标「考虑取消」`}><${DateInput} value=${x.lastUsed} onChange=${(v) => set({ lastUsed: v })} /><//><label class="mo-check"><input type="checkbox" checked=${!!x.consider} onChange=${(e) => set({ consider: e.target.checked })} />考虑取消</label></div>
      ${x.amount > 0 && html`<p class="muted small">折合每月 ${M.fmt(M.monthlyOf({ ...x, amount: +x.amount }), x.cur)}，一年 ${M.fmt(M.monthlyOf({ ...x, amount: +x.amount }) * 12, x.cur)}。下次扣费日过了会自动按周期往后推。</p>`}
    </div>
  <//>`;
}

/* ---------------- 资产 ---------------- */
function AssetImg({ fid, name }) {
  const [u, setU] = useState(null);
  useEffect(() => { let alive = true; setU(null); (async () => { if (!fid) return; let url = await fileUrl(fid); if (!url) { const r = await fetchAttachment(fid, { name }); if (r) url = await fileUrl(fid); } if (alive) setU(url); })(); return () => { alive = false; }; }, [fid]);
  return u ? html`<img src=${u} alt="" loading="lazy" />` : html`<span class="as-ph">${(name || '?').slice(0, 2)}</span>`;
}
function Assets({ s, c, onEdit }) {
  const [f, setF] = useState('use');
  const all = s.assets || []; const list = all.filter((a) => f === 'all' || a.status === f).sort((a, b) => (b.bought || '').localeCompare(a.bought || ''));
  const inUse = all.filter((a) => a.status === 'use');
  const daily = inUse.reduce((n, a) => n + M.conv(M.assetDaily(a), a.cur || c.base, c.base, c.rates), 0);
  const net = all.reduce((n, a) => n + M.conv(M.assetNet(a), a.cur || c.base, c.base, c.rates), 0);
  const sold = all.filter((a) => a.status === 'sold').reduce((n, a) => n + M.conv(+a.soldPrice || 0, a.cur || c.base, c.base, c.rates), 0);
  const sell = async (a) => { const v = await askPrompt(`「${a.name}」卖了多少（${a.cur || c.base}）？`, '', { title: '卖掉了', placeholder: '比如 300' }); if (v == null) return; const n = Math.max(0, +v || 0); upsert('assets', { id: a.id, status: 'sold', soldAt: todayStr(), soldPrice: n }); toast(`回血 ${M.fmt(n, a.cur || c.base)}，净成本 ${M.fmt(Math.max(0, (+a.price || 0) - n), a.cur || c.base)}`); };
  const menu = (e, a) => ctxMenu(e, [
    { label: '编辑', icon: 'edit', onClick: () => onEdit({ kind: 'asset', item: a }) },
    a.status !== 'use' && { label: '恢复使用中', icon: 'undo', onClick: () => upsert('assets', { id: a.id, status: 'use', retiredAt: '', soldAt: '', soldPrice: 0 }) },
    a.status === 'use' && { label: '退役', icon: 'archive', hint: '日均成本停在今天', onClick: () => upsert('assets', { id: a.id, status: 'retired', retiredAt: todayStr() }) },
    a.status !== 'sold' && { label: '卖掉了…', icon: 'wallet', hint: '填回血金额', onClick: () => sell(a) },
    'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('assets', a.id, a.name) },
  ].filter(Boolean), a.name);
  return html`<div class="mo-assets">
    <div class="mo-stats three">
      <div class="card mo-stat"><span class="mo-sl">在用资产日均</span><b class="mo-sv">${M.fmt(daily, c.base)}</b><span class="mo-ss">${inUse.length} 件 · 每月约 ${M.fmt(daily * 30.44, c.base, { int: true })}</span></div>
      <div class="card mo-stat"><span class="mo-sl">总净成本</span><b class="mo-sv">${M.fmt(net, c.base, { int: true })}</b><span class="mo-ss">${all.length} 件（买价 − 卖出回血）</span></div>
      <div class="card mo-stat"><span class="mo-sl">卖出回血</span><b class="mo-sv pos">${M.fmt(sold, c.base, { int: true })}</b><span class="mo-ss">${all.filter((a) => a.status === 'sold').length} 件已售出</span></div>
    </div>
    <div class="mo-bar"><${Seg} options=${[{ v: 'use', label: '使用中' }, { v: 'retired', label: '退役' }, { v: 'sold', label: '已售出' }, { v: 'all', label: '全部' }]} value=${f} onChange=${setF} /></div>
    ${list.length ? html`<div class="as-grid">${list.map((a) => { const cur = a.cur || c.base; const days = M.assetDays(a); return html`<div class=${'card as-card ' + a.status} key=${a.id} onClick=${() => onEdit({ kind: 'asset', item: a })} onContextMenu=${(e) => menu(e, a)}>
        <div class="as-img"><${AssetImg} fid=${a.img} name=${a.name} />${a.status !== 'use' && html`<span class="mo-badge">${a.status === 'sold' ? '已售出' : '退役'}</span>`}</div>
        <div class="as-b"><b>${a.name}</b>
          <div class="as-daily"><span>${M.fmt(M.assetDaily(a), cur)}</span><small>/ 天</small></div>
          <small class="muted">${M.fmt(a.price, cur)} · ${a.bought ? a.bought.replace(/-/g, '/') : ''} · ${a.status === 'use' ? '已用' : '用了'} ${days} 天${a.status === 'sold' ? ` · 回血 ${M.fmt(a.soldPrice || 0, cur)}` : ''}</small>
        </div>
        <${IconBtn} icon="dots" class="ibtn as-more" title="更多" size=${13} onClick=${(e) => { e.stopPropagation(); menu(e, a); }} />
      </div>`; })}</div>` : html`<${Card}><${Empty} icon="box" text=${f === 'use' ? '还没有在用的资产。买了电脑、相机、耳机这些，记下来就能看到每天花多少。' : '这里还没有东西。'} /><//>`}
  </div>`;
}
async function pickImage() {
  const f = await pickFile('image/*'); if (!f) return null;
  const url = await imageToDataUrl(f, 900, 0.85); const blob = await (await fetch(url)).blob();
  const rec = await saveFile(new File([blob], (f.name || 'asset').replace(/\.\w+$/, '') + '.jpg', { type: blob.type || 'image/jpeg' }));
  return rec.id;
}
function AssetModal({ c, item, onClose }) {
  const [a, setA] = useState(() => item ? { ...item } : { id: uid(), name: '', price: '', cur: c.base, bought: todayStr(), img: '', status: 'use', note: '' });
  const set = (p) => setA((v) => ({ ...v, ...p }));
  const save = () => { if (!a.name.trim()) { toast('填一下名字'); return; } const p = Math.round(Math.abs(+a.price) * 100) / 100; if (!(p >= 0)) { toast('填一下价格'); return; } upsert('assets', { ...a, name: a.name.trim(), price: p, soldPrice: +a.soldPrice || 0, ...(item ? {} : { created: new Date().toISOString() }) }); onClose(); };
  const preview = a.price > 0 ? M.assetDaily({ ...a, price: +a.price, soldPrice: +a.soldPrice || 0 }) : 0;
  return html`<${Modal} open=${true} onClose=${onClose} title=${item ? '编辑资产' : '加资产'} foot=${html`${item && html`<${Btn} kind="ghost" onClick=${() => { removeUndo('assets', item.id, item.name); onClose(); }}>删除<//>`}<span class="flex1"></span><${Btn} onClick=${onClose}>取消<//><${Btn} kind="primary" onClick=${save}>保存<//>`}>
    <div class="mo-form">
      <div class="row" style="gap:12px;align-items:flex-start">
        <button type="button" class="as-pick" title="选一张图片" onClick=${async () => { try { const id = await pickImage(); if (id) set({ img: id }); } catch (e) { toast(e.message || '图片读取失败'); } }}><${AssetImg} fid=${a.img} name=${a.name || '图片'} /><span>${a.img ? '换图' : '加图'}</span></button>
        <div class="flex1 mo-form">
          <${Field} label="名字"><input type="text" autofocus value=${a.name} placeholder="MacBook Air / AirPods" onInput=${(e) => set({ name: e.target.value })} /><//>
          <div class="row" style="gap:8px"><${Field} label="价格" class="flex1"><input type="number" step="0.01" value=${a.price} onInput=${(e) => set({ price: e.target.value })} /><//><${Field} label="币种"><${Select} value=${a.cur} options=${M.CURS} onChange=${(v) => set({ cur: v })} /><//><${Field} label="购买日期"><${DateInput} value=${a.bought} onChange=${(v) => set({ bought: v })} clearable=${false} /><//></div>
        </div>
      </div>
      <${Field} label="状态"><${Seg} options=${M.ASSET_STATUS.map(([v, l]) => ({ v, label: l }))} value=${a.status} onChange=${(v) => set({ status: v, ...(v === 'retired' && !a.retiredAt ? { retiredAt: todayStr() } : {}), ...(v === 'sold' && !a.soldAt ? { soldAt: todayStr() } : {}) })} /><//>
      ${a.status === 'retired' && html`<${Field} label="退役日期"><${DateInput} value=${a.retiredAt} onChange=${(v) => set({ retiredAt: v })} clearable=${false} /><//>`}
      ${a.status === 'sold' && html`<div class="row" style="gap:8px"><${Field} label="卖了多少（回血）" class="flex1"><input type="number" step="0.01" value=${a.soldPrice || ''} onInput=${(e) => set({ soldPrice: e.target.value })} /><//><${Field} label="卖出日期"><${DateInput} value=${a.soldAt} onChange=${(v) => set({ soldAt: v })} clearable=${false} /><//></div>`}
      ${preview > 0 && html`<p class="muted small">日均成本 <b>${M.fmt(preview, a.cur)}</b>（净成本 ${M.fmt(M.assetNet({ ...a, price: +a.price, soldPrice: +a.soldPrice || 0 }), a.cur)} ÷ ${M.assetDays(a)} 天）。用得越久越便宜。</p>`}
    </div>
  <//>`;
}

/* ---------------- 宇宙支票 ---------------- */
const MONTH_STATUS = { done: ['已兑现', 'good'], near: ['接近', 'near'], miss: ['未达', 'miss'], now: ['进行中', 'now'], future: ['', 'future'] };
function Cheque({ s, c, onEdit }) {
  const all = [...(s.cheques || [])].sort((a, b) => (b.opened || '').localeCompare(a.opened || ''));
  const [sel, setSel] = useState(() => (M.activeCheque(s) || {}).id || '');
  const ch = all.find((x) => x.id === sel) || M.activeCheque(s);
  const [month, setMonth] = useState(null);
  if (!ch) return html`<${Card}><div class="cq-empty"><div class="cq-paper ghost"><b>宇宙银行</b><span>PAY TO THE ORDER OF ____</span><span>一年后的自己</span></div><p>开一张给自己的年度支票：写下目标金额和一句愿望，收入会自动记到每个月里，看着它一点点兑现。</p><${Btn} kind="primary" icon="plus" onClick=${() => onEdit({ kind: 'cheque', item: null })}>开第一张支票<//></div><//>`;
  const cur = ch.cur || c.base; const inc = M.chequeIncome(s, ch); const months = M.chequeMonths(ch);
  const pct = (inc.total / (+ch.target || 1)) * 100; const plan = ch.plan || {};
  const name = s.profile && s.profile.name || '我';
  return html`<div class="mo-cheque">
    ${all.length > 1 && html`<div class="mo-bar"><${Select} value=${ch.id} options=${all.map((x) => ({ v: x.id, label: `${(x.opened || '').slice(0, 4)} · ${M.fmt(x.target, x.cur || c.base, { int: true })}` }))} onChange=${setSel} /></div>`}
    <div class="cq-paper" onClick=${() => onEdit({ kind: 'cheque', item: ch })} title="点一下编辑">
      <div class="cq-top"><b>宇宙银行 · THE UNIVERSE BANK</b><span>开票日 ${ch.opened || ''}</span></div>
      <div class="cq-line"><span class="cq-k">付给</span><span class="cq-v">${name}</span><span class="cq-amt">${M.fmt(ch.target, cur, { int: true })}</span></div>
      <div class="cq-line"><span class="cq-k">愿望</span><span class="cq-v wish">${ch.wish || '——'}</span></div>
      <div class="cq-bot"><span>兑现日 ${ch.cash || ''}</span><span class="cq-sign">宇宙</span></div>
      <div class="cq-prog"><${Progress} value=${pct} /><span>已到账 <b>${M.fmt(inc.total, cur, { int: true })}</b> · ${Math.round(pct)}%${ch.cash && ch.cash >= todayStr() ? ` · 还有 ${M.daysBetween(todayStr(), ch.cash)} 天` : ''}</span></div>
    </div>
    <div class="mo-two wide-left">
      <${Card} title="每个月" sub="按权重拆出的月目标；收入记账后自动算进来">
        <div class="cq-months">${months.map((k) => { const t = M.monthTarget(ch, k); const got = inc.byMonth[k] || 0; const stt = M.monthStatus(got, t, k); const [lab, cls] = MONTH_STATUS[stt]; return html`<button type="button" key=${k} class=${'cq-m ' + cls} onClick=${() => setMonth(k)}>
            <span class="cq-mn">${+k.slice(5, 7)} 月</span><span class="cq-mv">${M.fmt(got, cur, { int: true })}</span><small>/ ${M.fmt(t, cur, { int: true })}</small>
            <i style=${`--w:${Math.min(100, t > 0 ? (got / t) * 100 : 0)}%`}></i>${lab && html`<em>${lab}</em>`}
          </button>`; })}</div>
      <//>
      <${Card} title="按来源" sub="计划 vs 已到账">
        <div class="cq-src">${M.SOURCES.map(([k, l]) => { const p = +plan[k] || 0, got = inc.bySource[k] || 0; if (!p && !got) return null; return html`<div class="cq-srow" key=${k}><span>${l}</span><div class="cq-sbar"><i style=${`--w:${Math.min(100, p > 0 ? (got / p) * 100 : 100)}%`}></i></div><b>${M.fmt(got, cur, { int: true })}</b><small class="muted">${p ? '/ ' + M.fmt(p, cur, { int: true }) : '计划外'}</small></div>`; })}</div>
        ${!Object.values(plan).some((v) => +v > 0) && html`<p class="muted small">编辑支票时可以填各来源计划拿多少（工资 / 奖学金 / 副业 / 意外之财）。</p>`}
      <//>
    </div>
    ${month && html`<${Modal} open=${true} onClose=${() => setMonth(null)} title=${`${ymLabel(month)} 到账明细`}>
      ${(() => { const l = inc.list.filter((t) => t.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date)); const t = M.monthTarget(ch, month); const got = inc.byMonth[month] || 0; return html`<p class="muted small" style="margin-bottom:8px">目标 ${M.fmt(t, cur)} · 到账 ${M.fmt(got, cur)}${t > 0 ? ` · ${Math.round((got / t) * 100)}%` : ''}</p>${l.length ? html`<div class="mo-list">${l.map((x) => html`<${TxnRow} key=${x.id} t=${x} c=${c} onEdit=${() => {}} />`)}</div>` : html`<p class="muted">这个月还没有收入记录。记一笔收入（选来源）就会算进来。</p>`}`; })()}
    <//>`}
  </div>`;
}
function ChequeModal({ c, item, onClose }) {
  const y = new Date().getFullYear();
  const [x, setX] = useState(() => item ? { ...item, weights: { ...(item.weights || {}) }, plan: { ...(item.plan || {}) } } : { id: uid(), target: '', cur: c.base, opened: todayStr(), cash: `${y}-12-31`, wish: '', weights: {}, plan: {} });
  const set = (p) => setX((v) => ({ ...v, ...p }));
  const months = x.opened && x.cash && x.cash >= x.opened ? M.chequeMonths(x) : [];
  const save = () => { const t = Math.round(Math.abs(+x.target) * 100) / 100; if (!(t > 0)) { toast('填一下目标金额'); return; } if (!(x.cash >= x.opened)) { toast('兑现日要在开票日之后'); return; } const w = Object.fromEntries(Object.entries(x.weights).filter(([k, v]) => months.includes(k) && +v !== 1).map(([k, v]) => [k, Math.max(0, +v || 0)])); const plan = Object.fromEntries(Object.entries(x.plan).filter(([, v]) => +v > 0).map(([k, v]) => [k, +v])); upsert('cheques', { ...x, target: t, weights: w, plan, ...(item ? {} : { created: new Date().toISOString() }) }); onClose(); };
  const planSum = Object.values(x.plan).reduce((n, v) => n + (+v || 0), 0);
  return html`<${Modal} open=${true} onClose=${onClose} title=${item ? '编辑宇宙支票' : '开一张宇宙支票'} wide foot=${html`${item && html`<${Btn} kind="ghost" onClick=${() => { removeUndo('cheques', item.id, '支票'); onClose(); }}>删除<//>`}<span class="flex1"></span><${Btn} onClick=${onClose}>取消<//><${Btn} kind="primary" onClick=${save}>${item ? '保存' : '开票'}<//>`}>
    <div class="mo-form">
      <div class="row" style="gap:8px"><${Field} label="目标金额" class="flex1"><input type="number" autofocus value=${x.target} placeholder="比如 30000" onInput=${(e) => set({ target: e.target.value })} /><//><${Field} label="币种"><${Select} value=${x.cur} options=${M.CURS} onChange=${(v) => set({ cur: v })} /><//><${Field} label="开票日"><${DateInput} value=${x.opened} onChange=${(v) => set({ opened: v })} clearable=${false} /><//><${Field} label="兑现日"><${DateInput} value=${x.cash} onChange=${(v) => set({ cash: v })} clearable=${false} /><//></div>
      <${Field} label="一句愿望"><input type="text" value=${x.wish} placeholder="我已经轻松地收到了这一年的丰盛" onInput=${(e) => set({ wish: e.target.value })} /><//>
      ${months.length > 0 && html`<${Field} label="每月权重" hint=${`默认每个月一样（1）。比如暑假打工多的月份填 2，就会分到两倍的目标。共 ${months.length} 个月`}>
        <div class="cq-weights">${months.map((k) => { const w = x.weights[k] != null ? x.weights[k] : 1; const sum = months.reduce((n, m) => n + (x.weights[m] != null ? Math.max(0, +x.weights[m] || 0) : 1), 0) || 1; return html`<label key=${k}><span>${+k.slice(5, 7)} 月</span><input type="number" min="0" step="0.5" value=${w} onInput=${(e) => setX((v) => ({ ...v, weights: { ...v.weights, [k]: e.target.value } }))} /><small>${x.target > 0 ? M.fmt((+x.target * Math.max(0, +w || 0)) / sum, x.cur, { int: true }) : ''}</small></label>`; })}</div>
      <//>`}
      <${Field} label="按来源计划（可选）" hint=${x.target > 0 && planSum > 0 ? `合计 ${M.fmt(planSum, x.cur, { int: true })}，占目标 ${Math.round((planSum / x.target) * 100)}%` : '各来源计划拿多少；收入记账时选来源，就会分别统计'}>
        <div class="cq-weights src">${M.SOURCES.filter(([k]) => k !== 'other').map(([k, l]) => html`<label key=${k}><span>${l}</span><input type="number" min="0" value=${x.plan[k] || ''} placeholder="0" onInput=${(e) => setX((v) => ({ ...v, plan: { ...v.plan, [k]: e.target.value } }))} /></label>`)}</div>
      <//>
    </div>
  <//>`;
}

/* ---------------- AI 录入：一句话 / 截图 / CSV / 邮件收据 → 草稿 → 确认保存 ---------------- */
function AiPanel({ s, c, init, onClose }) {
  const [tab, setTab] = useState(init.tab || 'text');
  const [text, setText] = useState(init.text && !init.drafts.length ? init.text : '');
  const [drafts, setDrafts] = useState(init.drafts || []);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(init.drafts && init.drafts.length ? '确认下面的草稿，勾上的才会保存。' : '');
  const fileRef = useRef();
  const run = async (fn) => { setBusy('识别中…'); setMsg(''); try { const r = await fn(); if (r) { const d = M.makeDrafts(r, s); setDrafts(d); const dup = d.filter((x) => x.dup).length; setMsg(`${r.reply || r.note || ''}${d.length ? `　共 ${d.length} 条草稿${dup ? `，其中 ${dup} 条可能重复（默认不勾）` : ''}` : '　没认出记录'}`.trim()); } } catch (e) { setMsg(e.message || '识别失败'); } finally { setBusy(''); } };
  const doText = () => run(async () => {
    const t = text.trim(); if (!t) return null;
    if (M.aiReady()) return M.aiExtract({ text: t }, s);
    const lines = t.split(/\n+/).map((l) => M.quickParse(l, s)).filter(Boolean); return { txns: lines, subs: [], note: '（没开 AI，用本地规则一行一笔识别）' };
  });
  const doImage = (files) => run(async () => {
    const out = { txns: [], subs: [], reply: '' };
    for (const f of files) {
      if (M.canSeeImages()) { setBusy(`汤圆在看图（${f.name}）…`); const img = await M.imagePayload(f); const r = await M.aiExtract({ text: '这是一张收据 / 账单 / 订阅页面的截图，把里面的记录找出来', image: img, sourceKind: '截图' }, s); out.txns.push(...r.txns); out.subs.push(...r.subs); out.reply = r.reply; continue; }
      // 看不了图片的模型（DeepSeek）：先在浏览器里认出文字，再交给汤圆
      setBusy(`正在认图里的字（${f.name}）…`); const { ocrImage } = await import('../ocr.js'); const txt = await ocrImage(f, (p) => setBusy(`正在认图里的字 ${Math.round(p * 100)}%`));
      if (!txt.trim()) throw new Error('图片里没认出文字，换一张清楚点的');
      if (!M.aiReady()) { out.txns.push(...txt.split(/\n+/).map((l) => M.quickParse(l, s)).filter(Boolean)); out.reply = '（没开 AI，用本地规则一行一笔识别，可能不准）'; continue; }
      setBusy('汤圆在整理…'); const r = await M.aiExtract({ text: txt, sourceKind: '截图里认出的文字' }, s); out.txns.push(...r.txns); out.subs.push(...r.subs); out.reply = r.reply;
    }
    return out;
  });
  const doCsv = (files) => run(async () => { const txt = (await Promise.all(files.map((f) => f.text()))).join('\n'); const r = M.csvToTxns(txt, s); if (!r.txns.length && M.aiReady()) { setBusy('表头没认出来，交给汤圆…'); return M.aiExtract({ text: txt.slice(0, 20000), sourceKind: '银行导出的 CSV' }, s); } return { txns: r.txns, subs: [], note: r.note }; });
  const doMail = (files) => run(async () => {
    const parts = files ? await Promise.all(files.map(async (f) => M.emlToText(await f.text()))) : [M.emlToText(text)];
    const body = parts.filter(Boolean).map((p, i) => `--- 邮件 ${i + 1} ---\n${p}`).join('\n\n').slice(0, 20000); if (!body.trim()) return null;
    return M.aiExtract({ text: body, focus: 'subs', sourceKind: '邮件收据' }, s);
  });
  const onFiles = (list) => { const files = [...(list || [])]; if (!files.length) return; if (tab === 'image') doImage(files.filter((f) => /^image\//.test(f.type))); else if (tab === 'csv') doCsv(files); else if (tab === 'mail') doMail(files); };
  const setD = (id, p) => setDrafts((l) => l.map((d) => (d.id === id ? { ...d, ...p, data: p.data ? { ...d.data, ...p.data } : d.data } : d)));
  const flip = () => setDrafts((l) => l.map((d) => (d.k === 'txn' ? { ...d, data: { ...d.data, kind: d.data.kind === 'in' ? 'out' : 'in', cat: d.data.kind === 'in' ? M.guessCat(d.data.note, c.cats) : '', source: d.data.kind === 'in' ? '' : 'other' } } : d)));
  const save = () => { const r = M.saveDrafts(drafts, tab === 'csv' ? 'csv' : tab === 'image' ? 'image' : tab === 'mail' ? 'mail' : 'ai'); toast(`保存了 ${[r.nT && r.nT + ' 笔记账', r.nS && r.nS + ' 个订阅'].filter(Boolean).join('、') || '0 条'}`); onClose(); };
  const on = drafts.filter((d) => d.on).length;
  const TABS2 = [['text', '一句话 / 一段话', 'chat'], ['image', '截图 / 收据', 'image'], ['csv', '银行 CSV', 'file'], ['mail', '邮件收据', 'receipt']];
  const hints = { text: M.aiReady() ? '可以一次说好几笔：「昨天星巴克 6.5 刀，今天午饭 15，奖学金到账 1500 加币」' : '没开 AI 时每行算一笔：「昨天星巴克 6.5 刀」', image: M.canSeeImages() ? '收据、账单、App 里的订阅页面截图都行，可以一次选多张' : '会先在浏览器里认出图里的文字（中英文），再交给汤圆整理', csv: '网银 / 信用卡导出的 CSV：自动认日期、金额、说明列；正负号反了可以一键对调', mail: '把收据邮件另存为 .eml 拖进来（可以一次多封），或者把邮件内容粘贴到下面。主要用来补全订阅列表' };
  return html`<${Modal} open=${true} onClose=${onClose} title="AI 录入" wide foot=${drafts.length ? html`<span class="muted small">${on} / ${drafts.length} 条会保存</span><span class="flex1"></span>${drafts.some((d) => d.k === 'txn') && html`<${Btn} kind="ghost" onClick=${flip}>收支对调<//>`}<${Btn} onClick=${() => { setDrafts([]); setMsg(''); }}>清空<//><${Btn} kind="primary" disabled=${!on} onClick=${save}>保存 ${on} 条<//>` : null}>
    <div class="mo-ai">
      <${Seg} options=${TABS2.map(([v, l]) => ({ v, label: l }))} value=${tab} onChange=${(v) => { setTab(v); setMsg(''); }} />
      <p class="muted small">${hints[tab]}</p>
      ${(tab === 'text' || tab === 'mail') && html`<textarea rows=${tab === 'mail' ? 6 : 3} value=${text} placeholder=${tab === 'mail' ? '把收据邮件的内容粘贴到这里（可以多封）' : '昨天星巴克 6.5 刀'} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (tab === 'text' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doText(); }}></textarea>`}
      ${tab !== 'text' && html`<div class="mo-drop" onDragOver=${(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave=${(e) => e.currentTarget.classList.remove('over')} onDrop=${(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFiles(e.dataTransfer.files); }} onClick=${() => fileRef.current && fileRef.current.click()}>
        <${Icon} name="upload" size=${18} /><span>${tab === 'image' ? '拖图片进来，或点这里选' : tab === 'csv' ? '拖 CSV 进来，或点这里选' : '拖 .eml 邮件文件进来，或点这里选'}</span>
        <input ref=${fileRef} type="file" hidden multiple accept=${tab === 'image' ? 'image/*' : tab === 'csv' ? '.csv,.tsv,.txt,text/csv' : '.eml,.txt,.html,message/rfc822'} onChange=${(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>`}
      ${(tab === 'text' || tab === 'mail') && html`<div class="row" style="justify-content:flex-end"><${Btn} kind="primary" icon="sparkle" disabled=${!!busy || !text.trim()} onClick=${() => (tab === 'text' ? doText() : doMail(null))}>${busy ? '识别中…' : '识别'}<//></div>`}
      ${tab === 'mail' && html`<p class="muted small">想直接扫 Gmail？网站读邮箱需要 Google 的受限权限审核，暂时做不了；导出 .eml 或粘贴内容效果一样。</p>`}
      ${(busy || msg) && html`<p class=${'mo-msg ' + (busy ? 'busy' : '')}>${busy || msg}</p>`}
      <datalist id="mo-projects-d">${M.projectsOf(s).map((p) => html`<option value=${p} />`)}</datalist>
      ${drafts.length > 0 && html`<div class="mo-drafts">${drafts.map((d) => html`<${DraftRow} key=${d.id} d=${d} c=${c} onChange=${(p) => setD(d.id, p)} />`)}</div>`}
    </div>
  <//>`;
}
function DraftRow({ d, c, onChange }) {
  const x = d.data; const set = (p) => onChange({ data: p });
  return html`<div class=${'mo-draft ' + (d.on ? 'on' : '') + (d.dup ? ' dup' : '')}>
    <input type="checkbox" checked=${d.on} onChange=${(e) => onChange({ on: e.target.checked })} />
    ${d.k === 'txn' ? html`
      <button type="button" class=${'mo-kind ' + x.kind} title="点一下切换收支" onClick=${() => set({ kind: x.kind === 'in' ? 'out' : 'in', cat: x.kind === 'in' ? M.guessCat(x.note, c.cats) : '', source: x.kind === 'in' ? '' : 'other' })}>${x.kind === 'in' ? '收' : '支'}</button>
      <input class="d-date" type="date" value=${x.date} onInput=${(e) => set({ date: e.target.value })} />
      <input class="d-amt" type="number" step="0.01" value=${x.amount} onInput=${(e) => set({ amount: +e.target.value })} />
      <select class="d-cur" value=${x.cur} onChange=${(e) => set({ cur: e.target.value })}>${M.CURS.map((k) => html`<option value=${k}>${k}</option>`)}</select>
      ${x.kind === 'in' ? html`<select class="d-cat" value=${x.source || 'other'} onChange=${(e) => set({ source: e.target.value })}>${M.SOURCES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>` : html`<select class="d-cat" value=${x.cat} onChange=${(e) => set({ cat: e.target.value })}>${c.cats.map((k) => html`<option value=${k}>${k}</option>`)}</select>`}
      <input class="d-note" type="text" value=${x.note} placeholder="备注" onInput=${(e) => set({ note: e.target.value })} />
      <input class="d-proj" type="text" list="mo-projects-d" value=${x.project || ''} placeholder="项目" onInput=${(e) => set({ project: e.target.value })} />`
    : html`
      <span class="mo-kind sub">订阅</span>
      <input class="d-note" type="text" value=${x.name} onInput=${(e) => set({ name: e.target.value })} />
      <input class="d-amt" type="number" step="0.01" value=${x.amount} onInput=${(e) => set({ amount: +e.target.value })} />
      <select class="d-cur" value=${x.cur} onChange=${(e) => set({ cur: e.target.value })}>${M.CURS.map((k) => html`<option value=${k}>${k}</option>`)}</select>
      <select class="d-cat" value=${x.cycle} onChange=${(e) => set({ cycle: e.target.value })}>${M.CYCLES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <input class="d-date" type="date" value=${x.next || ''} title="下次扣费日" onInput=${(e) => set({ next: e.target.value })} />
      <input class="d-proj" type="text" value=${x.card || ''} placeholder="扣费卡" onInput=${(e) => set({ card: e.target.value })} />`}
    ${d.dup && html`<span class="mo-dup">${d.dup}</span>`}
  </div>`;
}

/* ---------------- 设置 ---------------- */
function MoneySettings({ c, onClose }) {
  const [rates, setRates] = useState({ USD: c.rates.USD, CNY: c.rates.CNY }); const [cats, setCats] = useState(c.cats.join('、'));
  const [busy, setBusy] = useState(false);
  const save = () => { const list = cats.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean); M.setCfg({ rates: { USD: +rates.USD || c.rates.USD, CNY: +rates.CNY || c.rates.CNY }, cats: list.length ? [...new Set(list)] : M.DEFAULT_CATS }); onClose(); };
  const refresh = async () => { setBusy(true); try { const r = await M.refreshRates(); setRates(r); toast('汇率已更新'); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  return html`<${Modal} open=${true} onClose=${onClose} title="钱包 · 设置" foot=${html`<span class="flex1"></span><${Btn} onClick=${onClose}>取消<//><${Btn} kind="primary" onClick=${save}>保存<//>`}>
    <div class="mo-form">
      <${Field} label="主币种" hint="概览、汇总都换算成这个币种"><${Seg} options=${M.CURS.map((v) => ({ v, label: v }))} value=${c.base} onChange=${(v) => M.setCfg({ base: v })} /><//>
      <${Field} label="汇率（1 单位 = 多少加币）" hint=${c.ratesAt ? `上次更新 ${c.ratesAt}（欧洲央行数据）` : '默认是大概值，可以联网更新或手动填'}>
        <div class="row" style="gap:8px;align-items:center"><span class="muted small">USD</span><input type="number" step="0.0001" style="width:110px" value=${rates.USD} onInput=${(e) => setRates({ ...rates, USD: e.target.value })} /><span class="muted small">CNY</span><input type="number" step="0.0001" style="width:110px" value=${rates.CNY} onInput=${(e) => setRates({ ...rates, CNY: e.target.value })} /><${Btn} small kind="ghost" icon="refresh" disabled=${busy} onClick=${refresh}>${busy ? '更新中…' : '联网更新'}<//></div>
      <//>
      <${Field} label="支出分类" hint="用顿号或逗号隔开"><input type="text" value=${cats} onInput=${(e) => setCats(e.target.value)} /><//>
      <div class="row" style="gap:12px">
        <${Field} label="扣费前几天提醒" class="flex1"><${Select} value=${String(c.remindDays)} options=${['0', '1', '2', '3', '5', '7'].map((v) => ({ v, label: v === '0' ? '当天' : v + ' 天' }))} onChange=${(v) => M.setCfg({ remindDays: +v })} /><//>
        <${Field} label="多久没用算「考虑取消」" class="flex1"><${Select} value=${String(c.idleDays)} options=${['30', '45', '60', '90'].map((v) => ({ v, label: v + ' 天' }))} onChange=${(v) => M.setCfg({ idleDays: +v })} /><//>
      </div>
    </div>
  <//>`;
}

/* ---------------- 总览上的小卡片 ---------------- */
export function MoneyWidget({ s }) {
  const c = M.cfg(s); const spent = M.spentIn(s, todayStr().slice(0, 7), c); const subsM = M.subsMonthly(s, c); const due = M.dueSoon(s, 7); const st = M.streak(s);
  return html`<${Card} class="mo-w">
    <div class="card-h"><h3><a href="#/money">钱包</a></h3><div class="card-act"><a class="ibtn" href="#/money" title="打开"><${Icon} name="right" size=${14} /></a></div></div>
    <div class="mo-w-stats"><div><small>本月已花</small><b>${M.fmt(spent, c.base, { int: spent >= 1000 })}</b></div><div><small>订阅月均</small><b>${M.fmt(subsM, c.base)}</b></div></div>
    ${due.length ? html`<div class="mo-list">${due.slice(0, 3).map(({ sub, due: d }) => html`<a class="mo-row hot" key=${sub.id} href="#/money/subs"><b>${sub.name}</b><span class="muted">${dd(d)}</span><span class="mo-amt">${M.fmt(sub.amount, sub.cur || c.base)}</span></a>`)}</div>` : html`<p class="muted small">一周内没有订阅扣费${st ? ` · 已连续记账 ${st} 天` : ''}</p>`}
  <//>`;
}
