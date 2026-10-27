import { html, useState, useEffect } from '../../vendor/preact.js';
import { useStore, update, replace, exportJSON, blank } from '../store.js';
import { WIDGETS, normLayout, toggleWidget } from '../widgets.js';
import { Icon, Btn, Card, Field, Seg, confirmDel } from '../ui.js';
import { download, readFile, todayStr, pickFile, imageToSquare } from '../util.js';
import { push, pull, smartSync, guarded, loginState, detectLogin, status as syncStatus } from '../sync.js';
import { seed } from '../seed.js';
import { toast } from '../nav.js';
import { askConfirm, askPrompt } from '../confirm.js';
import { aiConfig, setAiConfig, aiHeaders, usageOf, clearUsage, estimateCost } from '../ai.js';
import { ctxMenu } from '../ctx.js';
import { trashPages } from './notes.js';
import { PROMPT_VARS, newPrompt, fillVars } from '../prompts.js';

export async function uploadAvatar(file) {
  try {
    const f = file || await pickFile('image/*'); if (!f) return;
    const data = await imageToSquare(f, 320);
    update((d) => { d.profile.avatar = data; }); toast('头像已更新');
  } catch (x) { toast(x.message || '上传失败'); }
}
export async function avatarFromUrl() {
  const v = await askPrompt('粘贴图片链接', '', { title: '用链接设置头像', placeholder: 'https://…' });
  if (v == null) return; update((d) => { d.profile.avatar = v.trim(); });
}
export function avatarMenu(e, s) {
  ctxMenu(e, [{ label: '上传照片', icon: 'image', onClick: () => uploadAvatar() }, { label: '用链接', icon: 'link', onClick: avatarFromUrl }, ...(s.profile.avatar ? ['sep', { label: '移除头像', icon: 'trash', danger: true, onClick: () => update((d) => { d.profile.avatar = ''; }) }] : [])], '头像');
}
// Clickable avatar: click to upload, drop an image onto it, right-click for options.
export function AvatarPicker({ size = 60, class: cls = '' }) {
  const s = useStore();
  const [over, setOver] = useState(false);
  return html`<button type="button" class=${'avatar-pick ' + (over ? 'over ' : '') + cls} style=${`width:${size}px;height:${size}px`} title="点击更换头像" onClick=${() => uploadAvatar()} onContextMenu=${(e) => avatarMenu(e, s)}
    onDragOver=${(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); uploadAvatar(f); } }}>
    ${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : html`<span>${(s.profile.name || '?')[0]}</span>`}
    <i class="ap-hint"><${Icon} name="image" size=${Math.round(size * .3)} /></i>
  </button>`;
}

const GOOGLE_SVG = '<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.7 5.2-4.8 7.3l7.4 5.7c4.4-4.1 7.2-10.1 7.2-16.6z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.7-4.1-13.6-9.9l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>';

// 我的提示词：存常用的话，输入框「提示词」里一点就填进去；{{变量}} 发出前换成当下的值。跟着数据一起同步
function PromptsCard({ s }) {
  const list = s.settings.prompts || [];
  const save = (fn) => update((d) => { d.settings.prompts = d.settings.prompts || []; fn(d.settings.prompts); });
  const patch = (id, p) => save((arr) => { const it = arr.find((x) => x.id === id); if (it) Object.assign(it, p); });
  const add = () => { const p = { ...newPrompt(), title: '', text: '' }; save((arr) => arr.push(p)); setTimeout(() => { const el = document.querySelector(`[data-pid="${p.id}"] input`); el && el.focus(); }, 50); };
  const ins = (id, k) => { const el = document.querySelector(`[data-pid="${id}"] textarea`); const it = list.find((x) => x.id === id); if (!it) return; const at = el ? el.selectionStart : it.text.length; patch(id, { text: it.text.slice(0, at) + `{{${k}}}` + it.text.slice(at) }); };
  return html`<div>
    <div class="pr-list">
      ${list.map((p) => html`<div class="pr-row" key=${p.id} data-pid=${p.id}>
        <div class="row" style="gap:8px;align-items:center">
          <input class="pr-title" value=${p.title} placeholder="名字，比如：周五复盘" onInput=${(e) => patch(p.id, { title: e.target.value })} />
          <${Seg} options=${[{ v: '', label: '记录' }, { v: 'breakdown', label: '拆解' }, { v: 'plan', label: '规划' }]} value=${p.mode || ''} onChange=${(v) => patch(p.id, { mode: v })} />
          <span class="flex1"></span>
          <button class="ibtn" title="删除" onClick=${() => save((arr) => { const i = arr.findIndex((x) => x.id === p.id); if (i >= 0) arr.splice(i, 1); })}><${Icon} name="trash" size=${14} /></button>
        </div>
        <textarea class="pr-text" rows="2" value=${p.text} placeholder="比如：看我这周 {{本周}} 的时间线和待办，帮我复盘：完成了什么、拖延了什么、下周怎么调" onInput=${(e) => patch(p.id, { text: e.target.value })}></textarea>
        <div class="pr-vars">${PROMPT_VARS.map(([k, d]) => html`<button type="button" key=${k} title=${d} onClick=${() => ins(p.id, k)}>{{${k}}}</button>`)}</div>
        ${/\{\{/.test(p.text) && html`<p class="small muted pr-prev">现在会变成：${fillVars(p.text, { s })}</p>`}
      </div>`)}
    </div>
    <div class="row" style="gap:8px;margin-top:10px"><${Btn} small icon="plus" onClick=${add}>新建提示词<//>${list.length === 0 && html`<${Btn} small kind="ghost" onClick=${() => save((arr) => arr.push({ ...newPrompt(), title: '周五复盘', mode: '', text: '看我这周（{{本周}}）的时间线和完成的待办，帮我复盘：完成了什么、拖延了什么、下周怎么调' }, { ...newPrompt(), title: '明天怎么过', mode: 'plan', text: '看我明天（{{明天}}）的待办和已有安排，帮我排一下明天' }, { ...newPrompt(), title: '这页写成待办', mode: '', text: '把「{{当前页}}」里要做的事整理成待办' }))}>放几条示例<//>`}</div>
  </div>`;
}

// 设置页：左边分组导航，右边一次一页（大标题 + 一行说明，下面是一组组的「名字 | 控件」）
function Page({ title, sub, children }) {
  return html`<div class="sx-page"><header class="sx-top"><h1>${title}</h1>${sub && html`<p>${sub}</p>`}</header>${children}</div>`;
}
function Group({ title, children }) {
  return html`<section class="sx-group">${title && html`<h3>${title}</h3>`}<div class="sx-list">${children}</div></section>`;
}
function Row({ label, hint, stack, children }) {
  return html`<div class=${'sx-row' + (stack ? ' stack' : '')}>
    <div class="sx-l"><b>${label}</b>${hint && html`<small>${hint}</small>`}</div>
    <div class="sx-c">${children}</div>
  </div>`;
}
function Switch({ on, onChange, label }) {
  return html`<button type="button" role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${label} class=${'sx-sw ' + (on ? 'on' : '')} onClick=${() => onChange(!on)}><i></i></button>`;
}
const NAV = [
  ['帐号', [['account', '', '']]],
  ['偏好', [['look', '外观', 'sun'], ['dash', '总览', 'grid']]],
  ['汤圆', [['seal', '汤圆', 'sparkle'], ['ai', 'AI', 'zap'], ['prompts', '提示词', 'quote']]],
  ['其他', [['data', '数据', 'archive'], ['keys', '快捷键', 'key']]],
];
const ALIAS = { sync: 'account', profile: 'account', look: 'look', seal: 'seal', prompts: 'prompts', data: 'data', keys: 'keys', dash: 'dash', ai: 'ai' };

const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `出错了（${r.status}）`), j); return j; };
const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.reload(); };

// 登录：Google 一键，或邮箱 + 6 位验证码；第一次注册要邀请码
function SignIn() {
  const [step, setStep] = useState('email'); const [email, setEmail] = useState(''); const [invite, setInvite] = useState(''); const [code, setCode] = useState('');
  const [needInv, setNeedInv] = useState(() => /[?&]auth=need-invite/.test(location.hash)); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [wait, setWait] = useState(0);
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = async (e) => { e && e.preventDefault(); setBusy(true); setMsg(''); try { await post('/api/auth/email', { email, invite }); setStep('code'); setCode(''); setWait(60); } catch (er) { if (er.needInvite) setNeedInv(true); setMsg(er.message); } setBusy(false); };
  const verify = async (e) => { e.preventDefault(); setBusy(true); setMsg(''); try { await post('/api/auth/verify', { email, code }); location.hash = '#/settings'; location.reload(); } catch (er) { setMsg(er.message); setBusy(false); } };
  const google = () => { location.href = '/api/auth/google' + (invite ? '?invite=' + encodeURIComponent(invite) : ''); };
  return html`<div class="signin">
    ${step === 'email' ? html`
      <button type="button" class="si-btn" onClick=${google}><span class="g-ic" dangerouslySetInnerHTML=${{ __html: GOOGLE_SVG }}></span>用 Google 继续</button>
      <div class="mail-or"><span>或</span></div>
      <form class="si-form" onSubmit=${send}>
        <input type="email" required autocomplete="email" placeholder="邮箱地址" value=${email} onInput=${(e) => setEmail(e.target.value.trim())} />
        ${needInv && html`<input type="text" autocomplete="off" placeholder="邀请码" value=${invite} onInput=${(e) => setInvite(e.target.value.trim())} />`}
        <button class="si-btn primary" disabled=${busy || !email}>${busy ? '发送中…' : '用邮箱继续'}</button>
      </form>
      ${!needInv && html`<button type="button" class="si-link" onClick=${() => setNeedInv(true)}>有邀请码</button>`}`
    : html`
      <p class="si-tip">验证码已发到 <b>${email}</b></p>
      <form class="si-form" onSubmit=${verify}>
        <input class="si-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000" value=${code} onInput=${(e) => setCode(e.target.value.replace(/\D/g, ''))} autofocus />
        <button class="si-btn primary" disabled=${busy || code.length < 6}>${busy ? '登录中…' : '登录'}</button>
      </form>
      <div class="si-foot"><button type="button" class="si-link" onClick=${() => { setStep('email'); setCode(''); setMsg(''); }}>换个邮箱</button><button type="button" class="si-link" disabled=${wait > 0 || busy} onClick=${() => send()}>${wait > 0 ? `${wait}s 后重发` : '重新发送'}</button></div>`}
    ${msg && html`<p class="si-msg">${msg}</p>`}
  </div>`;
}

export default function Settings() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [login, setLogin] = useState(loginState());
  const [tokOpen, setTokOpen] = useState(false);
  const [ai, setAi] = useState(aiConfig());
  const [aiMsg, setAiMsg] = useState('');
  const [bal, setBal] = useState(null);
  const [q, setQ] = useState('');
  const [tab, setTabRaw] = useState(() => { const m = location.hash.match(/[?&]sec=(\w+)/); return (m && ALIAS[m[1]]) || 'account'; });
  const setTab = (t) => { setTabRaw(t); try { history.replaceState(null, '', '#/settings?sec=' + t); } catch {} window.scrollTo(0, 0); };
  const [, bump] = useState(0);
  const saveAi = (patch) => { setAi(setAiConfig(patch)); setAiMsg(''); setBal(null); };
  const testAi = async () => {
    setAiMsg('测试中…');
    try { const r = await fetch('/api/agent', { headers: aiHeaders(), cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setAiMsg(`已连接 · ${j.model}`); } catch (e) { setAiMsg('失败：' + e.message); }
  };
  const checkBal = async () => {
    setBal({ loading: true });
    try { const r = await fetch('/api/agent?balance=1', { headers: aiHeaders(), cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setBal(j.balance); } catch (e) { setBal({ error: e.message }); }
  };
  const usage = usageOf(); const cost = estimateCost(usage);
  useEffect(() => { detectLogin().then(setLogin); const f = () => setErr(syncStatus.error || ''); syncStatus.listeners.add(f); return () => syncStatus.listeners.delete(f); }, []);
  const authMsg = new URLSearchParams((location.hash.split('?')[1] || '')).get('auth');
  const setP = (k, v) => update((d) => { d.profile[k] = v; });
  const setSync = (k, v) => update((d) => { d.settings.sync[k] = v; });
  const run = async (fn, okMsg) => {
    setBusy(true); setErr('');
    try { const r = await guarded(fn); if (r === undefined) { toast('正在同步，稍等一下'); return; } toast(okMsg || (r === 'pulled' ? '已拉取最新数据' : r === 'same' ? '已是最新' : r === 'merged' ? '两边的改动已合并' : '已同步')); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const importFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await readFile(f)); if (!j || typeof j !== 'object' || !Array.isArray(j.todos)) throw new Error('不是有效的备份文件');
      const now = s; const n = (k) => (Array.isArray(j[k]) ? j[k].length : 0);
      const ok = await askConfirm(`备份：待办 ${n('todos')}、笔记 ${n('notes')}、书 ${n('books')}、收藏 ${n('links')}。\n现在：待办 ${now.todos.length}、笔记 ${now.notes.length}、书 ${now.books.length}、收藏 ${now.links.length}。\n会整份替换现在的数据，导入后可以撤销。`, { title: '导入这份备份？', ok: '替换导入' });
      if (!ok) return;
      try { localStorage.setItem('ytos.v1.prev', exportJSON()); } catch {}
      replace(j); toast('已导入', { label: '撤销', onClick: () => { try { const prev = localStorage.getItem('ytos.v1.prev'); if (prev) { replace(JSON.parse(prev)); toast('已恢复导入前的数据'); } } catch {} } });
    } catch (x) { toast(x.message); }
    e.target.value = '';
  };

  const connected = !!(login && login.user);
  const cloudUser = connected && login.cloud && login.user.email;
  const tokenMode = !connected && !(login && login.configured) && !!(s.settings.sync.repo && s.settings.sync.token);
  const synced = s.settings.lastSync ? new Date(s.settings.lastSync).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const name = s.profile.name || (connected ? login.user.login : '') || '未命名';
  const dash = normLayout(s.settings.dash);
  const skins = [
    { v: 'notion', n: '笔记', bg: '#ffffff', card: '#ffffff', ac: '#2383e2', line: 'rgba(55,53,47,.16)' },
    { v: 'glass', n: '暖白', bg: '#f7f7f5', card: '#ffffff', ac: '#37352f', line: 'rgba(55,53,47,.09)' },
    { v: 'claude', n: 'Claude', bg: '#f4f1ea', card: '#faf9f5', ac: '#c96442', line: 'rgba(60,50,30,.14)' },
    { v: 'steam', n: 'Steam', bg: '#1b2838', card: '#2a475e', ac: '#66c0f4', line: 'rgba(0,0,0,.4)' },
    { v: 'xp', n: 'Windows XP', bg: 'linear-gradient(180deg,#3f7fd8,#8fc0f0 60%,#6fb24c)', card: '#ece9d8', ac: '#0a5fd6', line: '#0831d9' },
  ];
  const syncRow = (connected || tokenMode) && html`<${Row} label="同步" hint=${err ? html`<span class="sx-err">同步出错：${err}</span>` : synced ? `上次 ${synced}` : '还没同步过'}>
    <button class="sx-btn" disabled=${busy} onClick=${() => run(smartSync)}>${busy ? '同步中…' : '立即同步'}</button>
  <//>`;
  const ghRows = html`
    <${Row} label="GitHub" hint=${connected ? `${login.target.repo} · ${login.target.branch}` : '同步到自己的私人仓库'}>
      ${connected ? html`<button class="sx-btn" onClick=${logout}>断开</button>` : login && login.configured ? html`<a class="sx-btn" href="/api/auth/login">连接</a>` : html`<button class="sx-btn" onClick=${() => setTokOpen((v) => !v)}>${tokOpen ? '收起' : '配置'}</button>`}
    <//>
    ${!connected && !(login && login.configured) && tokOpen && html`<div class="sx-sub">
      <input class="sx-input" type="text" value=${s.settings.sync.repo} placeholder="仓库 owner/name" onInput=${(e) => setSync('repo', e.target.value.trim())} />
      <input class="sx-input" type="text" value=${s.settings.sync.branch} placeholder="分支" onInput=${(e) => setSync('branch', e.target.value.trim())} />
      <input class="sx-input" type="text" value=${s.settings.sync.path} placeholder="文件路径" onInput=${(e) => setSync('path', e.target.value.trim())} />
      <input class="sx-input" type="password" value=${s.settings.sync.token} placeholder="github_pat_…" onInput=${(e) => setSync('token', e.target.value.trim())} />
    </div>`}`;

  const pages = {
    account: () => html`<${Page} title="帐号" sub="档案、登录和同步">
      <${Group} title="档案">
        <div class="sx-profile">
          <${AvatarPicker} size=${64} />
          <div class="sx-pf">
            <label><span>名字</span><input class="sx-input" type="text" value=${s.profile.name} onInput=${(e) => setP('name', e.target.value)} /></label>
            <label><span>座右铭</span><input class="sx-input" type="text" value=${s.profile.motto} onInput=${(e) => setP('motto', e.target.value)} /></label>
          </div>
        </div>
      <//>
      <${Group} title="登录与同步">
        ${cloudUser ? html`
          <${Row} label="邮件地址" hint=${login.user.email}><button class="sx-btn" onClick=${logout}>退出登录</button><//>
          ${syncRow}
          ${login.aiQuota != null && html`<${Row} label="AI 额度" hint="内置 AI 每月免费次数"><span class="sx-val">${login.aiQuota} 次 / 月</span><//>`}`
        : connected ? html`${ghRows}${syncRow}`
        : html`
          <${Row} label="还没有登录" hint="数据只存在这台设备上" stack>${login && login.cloud ? html`<${SignIn} />` : ''}<//>
          ${login && login.cloud ? html`<details class="sx-more"><summary>其他方式</summary>${ghRows}</details>` : ghRows}
          ${syncRow}`}
        ${authMsg && authMsg !== 'ok' && html`<p class="sx-err block">${authMsg === 'need-invite' ? '这个 Google 帐号还没注册，先填邀请码再继续。' : '登录失败：' + authMsg}</p>`}
      <//>
    <//>`,
    look: () => html`<${Page} title="外观" sub="颜色、主题和质感">
      <${Group}>
        <${Row} label="深浅色"><${Seg} options=${[{ v: 'auto', label: '跟随系统' }, { v: 'light', label: '浅色' }, { v: 'dark', label: '深色' }]} value=${s.settings.theme} onChange=${(v) => update((d) => { d.settings.theme = v; })} /><//>
        <${Row} label="主题" stack>
          <div class="skin-pick">${skins.map((k) => html`<button type="button" key=${k.v} class=${'skin-opt ' + ((s.settings.skin || 'notion') === k.v ? 'on' : '')} onClick=${() => update((d) => { d.settings.skin = k.v; })}>
            <span class="skin-prev" style=${`background:${k.bg}`}><i style=${`left:6px;top:6px;width:18px;height:40px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:30px;top:6px;width:52px;height:17px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:30px;top:29px;width:52px;height:17px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:88px;top:6px;right:6px;height:40px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:92px;top:12px;width:22px;height:6px;border-radius:3px;background:${k.ac}`}></i></span>
            <b>${k.n}</b></button>`)}</div>
        <//>
        <${Row} label="毛玻璃" hint="老电脑上可能会卡"><${Switch} label="毛玻璃" on=${s.settings.fx === 'full'} onChange=${(v) => update((d) => { d.settings.fx = v ? 'full' : 'lite'; })} /><//>
      <//>
    <//>`,
    dash: () => html`<${Page} title="总览" sub="选择总览上显示哪些卡片">
      <${Group}>
        ${WIDGETS.map(([id, label]) => html`<${Row} key=${id} label=${label}><${Switch} label=${label} on=${!dash.hidden.includes(id)} onChange=${(v) => update((d) => { d.settings.dash = toggleWidget(d.settings.dash, id, v); })} /><//>`)}
      <//>
      <p class="sx-foot">顺序和大小在总览右上角「自定义」里拖动调整。</p>
    <//>`,
    seal: () => html`<${Page} title="汤圆" sub="角落里的小海豹">
      <${Group}>
        <${Row} label="显示汤圆"><${Switch} label="显示汤圆" on=${s.settings.seal !== false} onChange=${(v) => update((d) => { d.settings.seal = v; })} /><//>
        <${Row} label="闲时贴边" hint="没人理时缩到屏幕边"><${Switch} label="闲时贴边" on=${s.settings.sealTuck === true} onChange=${(v) => update((d) => { d.settings.sealTuck = v; })} /><//>
        <${Row} label="光效"><${Switch} label="光效" on=${s.settings.sealGlow !== false} onChange=${(v) => update((d) => { d.settings.sealGlow = v; })} /><//>
        <${Row} label="强调色"><${Seg} options=${[{ v: 'none', label: '黑白' }, { v: 'ice', label: '冰蓝' }, { v: 'teal', label: '青绿' }]} value=${s.settings.sealAccent || 'none'} onChange=${(v) => update((d) => { d.settings.sealAccent = v; })} /><//>
      <//>
    <//>`,
    ai: () => html`<${Page} title="AI" sub=${login && login.ai ? `当前模型 ${login.aiModel || '服务器配置'}` : '汤圆用来理解你说的话'}>
      <${Group}>
        <${Row} label="来源" hint=${ai.provider === 'deepseek' || ai.provider === 'anthropic' ? '密钥只存在这台浏览器里' : ''}><${Seg} options=${[{ v: 'server', label: '内置' }, { v: 'deepseek', label: 'DeepSeek' }, { v: 'anthropic', label: 'Claude' }, { v: 'local', label: '不用' }]} value=${ai.provider} onChange=${(v) => saveAi({ provider: v })} /><//>
        ${(ai.provider === 'deepseek' || ai.provider === 'anthropic') && html`
          <${Row} label="密钥"><input class="sx-input" type="password" value=${ai.key} placeholder=${ai.provider === 'deepseek' ? 'sk-…' : 'sk-ant-…'} autocomplete="off" onInput=${(e) => saveAi({ key: e.target.value.trim() })} /><//>
          <${Row} label="模型"><input class="sx-input" type="text" value=${ai.model} placeholder=${ai.provider === 'deepseek' ? 'deepseek-chat' : 'claude-opus-5-5'} onInput=${(e) => saveAi({ model: e.target.value.trim() })} /><//>`}
        ${ai.provider !== 'local' && html`<${Row} label="测试连接" hint=${aiMsg || (connected ? '' : '登录后可用')}><button class="sx-btn" onClick=${testAi} disabled=${!connected}>测试</button><//>`}
        <${Row} label="本月用量" hint=${bal ? (bal.loading ? '查询中…' : bal.error ? '查余额失败' : bal.supported === false ? '这家没有余额接口' : `余额 ${bal.currency === 'USD' ? '$' : '¥'}${bal.total.toFixed(2)}`) : `${usage.calls} 次 · 约 ${cost.text}`}>
          ${(ai.provider === 'deepseek' || (ai.provider === 'server' && login && /deepseek/i.test(login.aiModel || ''))) && html`<button class="sx-btn" onClick=${checkBal} disabled=${!connected}>查余额</button>`}
          ${usage.calls > 0 && html`<button class="sx-btn" onClick=${() => { clearUsage(); bump((x) => x + 1); }}>清零</button>`}
        <//>
      <//>
    <//>`,
    prompts: () => html`<${Page} title="提示词" sub="常用的话，在汤圆输入框里一点就填进去">
      <${PromptsCard} s=${s} />
    <//>`,
    data: () => html`<${Page} title="数据" sub=${`待办 ${s.todos.length} · 笔记 ${s.notes.length} · 书 ${s.books.length} · 收藏 ${s.links.length}`}>
      <${Group} title="备份">
        <${Row} label="导出" hint="不含密钥"><button class="sx-btn" onClick=${() => download(`sealonote-${todayStr()}.json`, exportJSON())}>导出 JSON</button><//>
        <${Row} label="导入" hint="会替换现在的数据"><label class="sx-btn">选择文件<input type="file" accept="application/json" style="display:none" onChange=${importFile} /></label><//>
        ${!s.settings.seeded && html`<${Row} label="示例数据"><button class="sx-btn" onClick=${() => { seed(); toast('已载入示例数据'); }}>载入</button><//>`}
      <//>
      ${(connected || tokenMode) && html`<${Group} title="手动同步">
        <${Row} label="本机覆盖云端"><button class="sx-btn" disabled=${busy} onClick=${() => run(push, '已用本机数据覆盖云端')}>覆盖</button><//>
        <${Row} label="云端覆盖本机"><button class="sx-btn" disabled=${busy} onClick=${async () => { if (await askConfirm('本机还没同步上去的改动会丢失。', { title: '用云端数据覆盖本机？', ok: '覆盖本机' })) run(pull, '已用云端数据覆盖本机'); }}>覆盖</button><//>
      <//>`}
      <${Group} title="危险操作">
        <${Row} label="清空笔记" hint="30 天内可在最近删除里恢复"><button class="sx-btn danger" disabled=${!s.notes.length} onClick=${async () => { const n = s.notes.length; if (await askConfirm(`${n} 页会移到「最近删除」，30 天内可以恢复。`, { title: '清空所有笔记？', ok: '清空笔记' })) { trashPages(s.notes.map((x) => x.id)); toast(`清了 ${n} 页`); } }}>清空</button><//>
        <${Row} label="清空全部数据"><button class="sx-btn danger" onClick=${async () => { if (await askConfirm('所有待办、笔记、书、收藏、足迹都会被清除。建议先导出。', { title: '清空全部数据？', ok: '清空' })) { const b = blank(); b.settings.seeded = true; replace(b); } }}>清空</button><//>
      <//>
    <//>`,
    keys: () => html`<${Page} title="快捷键">
      <div class="keys">
        ${[['全局', [['⌘/Ctrl K', '全局搜索'], ['⌘/Ctrl ⇧ K', '汤圆记一下'], ['Esc', '关闭弹窗']]],
           ['笔记', [['/', '插入块或模板'], ['[[', '链接页面'], ['@', '引用待办 / 书 / 目标'], ['⌘B · I · U · E · K', '粗体 · 斜体 · 下划线 · 代码 · 链接'], ['⌘⇧H', '荧光标记'], ['⌥↑ / ⌥↓', '上移 / 下移块'], ['⌘⇧. / ⌘⇧,', '放大 / 缩小字号'], ['⌘⇧V', '按 Markdown 粘贴']]],
           ['画布', [['V · T · P · E', '选择 · 文字 · 画笔 · 橡皮'], ['Tab / Enter', '新建子节点 / 同级节点'], ['双击空白', '新建文字']]],
           ['待办语法', [['@明天', '日期'], ['14:00', '时间'], ['!0 – !3', '优先级'], ['#标签', '标签']]],
         ].map(([g, rows]) => html`<div class="keys-g" key=${g}><div class="keys-h">${g}</div>${rows.map(([k, d]) => html`<div class="keys-r" key=${k}><kbd class="mono">${k}</kbd><span>${d}</span></div>`)}</div>`)}
      </div>
    <//>`,
  };
  const ql = q.trim().toLowerCase();
  const hit = (label, id) => !ql || label.toLowerCase().includes(ql) || ({ account: '帐号账号登录同步邮箱名字头像', look: '主题深浅暗色毛玻璃', dash: '卡片图片小组件', seal: '海豹光效强调色', ai: '模型密钥deepseekclaude用量', prompts: '提示词', data: '备份导入导出清空', keys: '快捷键' }[id] || '').includes(ql);

  return html`<div class="sx">
    <aside class="sx-nav">
      <label class="sx-search"><${Icon} name="search" size=${14} /><input type="text" placeholder="搜索设置" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
      ${NAV.map(([g, items]) => { const vis = items.filter(([id, label]) => hit(id === 'account' ? name + ' 帐号' : label, id)); return vis.length > 0 && html`<div class="sx-ng" key=${g}>
        <div class="sx-gh">${g}</div>
        ${vis.map(([id, label, ic]) => html`<button type="button" key=${id} class=${'sx-ni ' + (tab === id ? 'on' : '')} onClick=${() => setTab(id)}>
          ${id === 'account' ? html`<span class="sx-av">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : name[0]}</span>${name}` : html`<${Icon} name=${ic} size=${15} />${label}`}
        </button>`)}
      </div>`; })}
    </aside>
    <main class="sx-main">${pages[tab] ? pages[tab]() : pages.account()}</main>
  </div>`;
}
