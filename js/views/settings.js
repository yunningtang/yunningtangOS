import { html, useState, useEffect } from '../../vendor/preact.js';
import { useStore, update, replace, exportJSON, blank } from '../store.js';
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
  return html`<${Sec} id="prompts" title="我的提示词" sub=${list.length ? `${list.length} 条 · 在汤圆输入框的「提示词」里最上面` : '存几句常用的话，汤圆输入框「提示词」里一点就填进去'}>
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
  <//>`;
}

// 设置页的骨架：左边分区导航，右边一节一节；每一项是「左边说明、右边控件」的一行
function Sec({ id, title, sub, children }) {
  return html`<section class="st-sec" id=${'set-' + id}>
    <header class="st-h"><h2>${title}</h2>${sub && html`<p>${sub}</p>`}</header>
    <div class="st-body">${children}</div>
  </section>`;
}
function Row({ label, hint, stack, children }) {
  return html`<div class=${'st-row' + (stack ? ' stack' : '')}>
    <div class="st-l"><b>${label}</b>${hint && html`<small>${hint}</small>`}</div>
    <div class="st-c">${children}</div>
  </div>`;
}
const SECTIONS = [['sync', '账号与同步', 'cloud'], ['profile', '个人', 'heart'], ['look', '外观', 'sun'], ['seal', '汤圆', 'sparkle'], ['prompts', '提示词', 'quote'], ['data', '数据', 'archive'], ['keys', '快捷键', 'key']];

const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `出错了（${r.status}）`), j); return j; };
const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.reload(); };

// 登录 sealonote：Google 一键，或者邮箱 + 6 位验证码；第一次注册要邀请码（站长除外）
function SignIn() {
  const [step, setStep] = useState('email'); const [email, setEmail] = useState(''); const [invite, setInvite] = useState(''); const [code, setCode] = useState('');
  const [needInv, setNeedInv] = useState(() => /[?&]auth=need-invite/.test(location.hash)); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [wait, setWait] = useState(0);
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = async (e) => { e && e.preventDefault(); setBusy(true); setMsg(''); try { await post('/api/auth/email', { email, invite }); setStep('code'); setCode(''); setWait(60); } catch (er) { if (er.needInvite) setNeedInv(true); setMsg(er.message); } setBusy(false); };
  const verify = async (e) => { e.preventDefault(); setBusy(true); setMsg(''); try { await post('/api/auth/verify', { email, code }); location.hash = '#/settings'; location.reload(); } catch (er) { setMsg(er.message); setBusy(false); } };
  const google = () => { location.href = '/api/auth/google' + (invite ? '?invite=' + encodeURIComponent(invite) : ''); };
  return html`<div class="signin">
    <div class="si-head"><b>${step === 'code' ? '输入验证码' : '登录 sealonote'}</b><small>${step === 'code' ? html`已发到 <span class="si-mail">${email}</span>，10 分钟内有效` : '每个人一份自己的数据，换一台设备登录也在。'}</small></div>
    ${step === 'email' ? html`
      <button type="button" class="si-btn si-google" onClick=${google}><span class="g-ic" dangerouslySetInnerHTML=${{ __html: GOOGLE_SVG }}></span>用 Google 继续</button>
      <div class="mail-or"><span>或用邮箱</span></div>
      <form class="si-form" onSubmit=${send}>
        <input type="email" required autocomplete="email" placeholder="you@example.com" value=${email} onInput=${(e) => setEmail(e.target.value.trim())} />
        ${needInv && html`<input type="text" autocomplete="off" placeholder="邀请码（第一次注册需要）" value=${invite} onInput=${(e) => setInvite(e.target.value.trim())} />`}
        <button class="si-btn primary" disabled=${busy || !email}>${busy ? '发送中…' : '发送验证码'}</button>
      </form>
      ${!needInv && html`<button type="button" class="si-link" onClick=${() => setNeedInv(true)}>第一次来？填邀请码</button>`}`
    : html`
      <form class="si-form" onSubmit=${verify}>
        <input class="si-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="······" value=${code} onInput=${(e) => setCode(e.target.value.replace(/\D/g, ''))} autofocus />
        <button class="si-btn primary" disabled=${busy || code.length < 6}>${busy ? '登录中…' : '登录'}</button>
      </form>
      <div class="si-foot"><button type="button" class="si-link" onClick=${() => { setStep('email'); setCode(''); setMsg(''); }}>换个邮箱</button><span>·</span><button type="button" class="si-link" disabled=${wait > 0 || busy} onClick=${() => send()}>${wait > 0 ? `${wait} 秒后可重发` : '重新发送'}</button></div>`}
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
  const [cur, setCur] = useState('sync');
  const [, bump] = useState(0);
  const go2 = (id, smooth = true) => { const el = document.getElementById('set-' + id); if (el) el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }); };
  useEffect(() => { const m = location.hash.match(/[?&]sec=(\w+)/); if (m) setTimeout(() => go2(m[1]), 120); }, []);
  // 滚动时高亮左边导航里当前那一节
  useEffect(() => {
    const f = () => { let at = SECTIONS[0][0]; for (const [id] of SECTIONS) { const el = document.getElementById('set-' + id); if (el && el.getBoundingClientRect().top < 140) at = id; } setCur(at); };
    window.addEventListener('scroll', f, { passive: true }); f(); return () => window.removeEventListener('scroll', f);
  }, []);
  const saveAi = (patch) => { setAi(setAiConfig(patch)); setAiMsg(''); setBal(null); };
  const testAi = async () => {
    setAiMsg('测试中…');
    try { const r = await fetch('/api/agent', { headers: aiHeaders(), cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setAiMsg(`连上了：${j.provider === 'deepseek' ? 'DeepSeek' : 'Claude'} · ${j.model}${j.fromHeader ? '（用的是本机密钥）' : '（用的是服务器配置）'}`); } catch (e) { setAiMsg('失败：' + e.message); }
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
      const ok = await askConfirm(`备份里有：待办 ${n('todos')}、笔记 ${n('notes')}、书 ${n('books')}、收藏 ${n('links')}、足迹 ${n('trips')}。\n当前有：待办 ${now.todos.length}、笔记 ${now.notes.length}、书 ${now.books.length}、收藏 ${now.links.length}、足迹 ${now.trips.length}。\n导入会整份替换当前数据（当前这份会先存一份在本机，设置里可以撤销）；开着云端同步的话，备份之后新建的内容会被当成删除同步出去。`, { title: '导入这份备份？', ok: '替换导入' });
      if (!ok) return;
      try { localStorage.setItem('ytos.v1.prev', exportJSON()); } catch {}
      replace(j); toast('已导入', { label: '撤销', onClick: () => { try { const prev = localStorage.getItem('ytos.v1.prev'); if (prev) { replace(JSON.parse(prev)); toast('已恢复导入前的数据'); } } catch {} } });
    } catch (x) { toast(x.message); }
    e.target.value = '';
  };
  const counts = [['待办', s.todos.length], ['时间块', s.blocks.length], ['书', s.books.length], ['收藏', s.links.length], ['笔记', s.notes.length], ['足迹', s.trips.length]];

  const connected = !!(login && login.user);
  const cloudUser = connected && login.cloud && login.user.email;
  const tokenMode = !connected && !(login && login.configured) && !!(s.settings.sync.repo && s.settings.sync.token);
  const synced = s.settings.lastSync ? new Date(s.settings.lastSync).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const syncRow = (connected || tokenMode) && html`<${Row} label="同步" hint=${err ? '' : '编辑后几秒自动同步，打开页面时自动拉取较新的一方。'}>
    <span class=${'st-status ' + (err ? 'err' : synced ? 'ok' : 'warn')}><i></i>${err ? err : synced ? `上次 ${synced}` : '还没同步过'}</span>
    <button class="btn sm" disabled=${busy} onClick=${() => run(smartSync)}>${busy ? '同步中…' : '立即同步'}</button>
  <//>`;
  const ghRows = html`
    <${Row} label="GitHub 仓库" hint=${connected ? `${login.user.login} · ${login.target.repo} · ${login.target.branch}` : login && login.configured ? '整份数据存成你私人仓库里的一个 JSON 文件，每次同步是一次提交。' : '静态部署时用 token 直连仓库。'}>
      ${connected ? html`<button class="btn sm ghost" onClick=${logout}>断开</button>` : login && login.configured ? html`<a class="btn sm" href="/api/auth/login"><${Icon} name="github" size=${14} /> 连接 GitHub</a>` : html`<button class="btn sm" onClick=${() => setTokOpen((v) => !v)}>${tokOpen ? '收起' : tokenMode ? '设置' : '配置'}</button>`}
    <//>
    ${!connected && !(login && login.configured) && tokOpen && html`<div class="st-sub">
      <div class="grid2">
        <${Field} label="仓库 owner/name"><input type="text" value=${s.settings.sync.repo} placeholder="yunningtang/dataOS" onInput=${(e) => setSync('repo', e.target.value.trim())} /><//>
        <${Field} label="分支"><input type="text" value=${s.settings.sync.branch} onInput=${(e) => setSync('branch', e.target.value.trim())} /><//>
      </div>
      <div class="grid2">
        <${Field} label="文件路径"><input type="text" value=${s.settings.sync.path} onInput=${(e) => setSync('path', e.target.value.trim())} /><//>
        <${Field} label="Fine-grained token" hint="只给这个仓库的 Contents 读写权限，只保存在本机浏览器。"><input type="password" value=${s.settings.sync.token} placeholder="github_pat_…" onInput=${(e) => setSync('token', e.target.value.trim())} /><//>
      </div>
    </div>`}`;
  const skins = [
    { v: 'notion', n: '笔记', d: '默认 · 纯白纸面、细线分隔', bg: '#ffffff', card: '#ffffff', ac: '#2383e2', line: 'rgba(55,53,47,.16)' },
    { v: 'glass', n: '暖白', d: '暖灰底、墨色主操作', bg: '#f7f7f5', card: '#ffffff', ac: '#37352f', line: 'rgba(55,53,47,.09)' },
    { v: 'claude', n: 'Claude', d: '米色暖底、衬线标题', bg: '#f4f1ea', card: '#faf9f5', ac: '#c96442', line: 'rgba(60,50,30,.14)' },
    { v: 'steam', n: 'Steam', d: '深蓝灰底、青蓝按钮', bg: '#1b2838', card: '#2a475e', ac: '#66c0f4', line: 'rgba(0,0,0,.4)' },
    { v: 'xp', n: 'Windows XP', d: '蓝天绿地', bg: 'linear-gradient(180deg,#3f7fd8,#8fc0f0 60%,#6fb24c)', card: '#ece9d8', ac: '#0a5fd6', line: '#0831d9' },
  ];

  return html`<div class="settings2">
    <nav class="st-nav" aria-label="设置分区">${SECTIONS.map(([id, label, ic]) => html`<button type="button" key=${id} class=${cur === id ? 'on' : ''} onClick=${() => go2(id)}><${Icon} name=${ic} size=${15} />${label}</button>`)}</nav>
    <div class="st-main">

      <${Sec} id="sync" title="账号与同步" sub=${cloudUser ? '登录后，数据存在 sealonote 云端，每个人一份，换设备也在。' : '不登录也能用，数据只存在这台设备的浏览器里。'}>
        ${cloudUser ? html`
          <div class="acct">
            <span class="acct-av">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || login.user.email)[0].toUpperCase()}</span>
            <div class="acct-b"><b>${s.profile.name || login.user.login}</b><small>${login.user.email}</small></div>
            <span class="acct-tag"><${Icon} name="cloud" size=${12} /> sealonote 云端</span>
            <button class="btn sm ghost" onClick=${logout}>退出登录</button>
          </div>
          ${syncRow}
          ${login.aiQuota != null && html`<${Row} label="汤圆额度" hint="用内置 AI 时每月的免费次数；在「汤圆」里填自己的密钥就不占额度。"><span class="st-val">每月 ${login.aiQuota} 次</span><//>`}`
        : connected ? html`
          <div class="acct">
            <span class="acct-av gh"><${Icon} name="github" size=${18} /></span>
            <div class="acct-b"><b>${login.user.login}</b><small>${login.target.repo} · ${login.target.branch}</small></div>
            <span class="acct-tag">GitHub</span>
            <button class="btn sm ghost" onClick=${logout}>断开</button>
          </div>
          ${syncRow}`
        : html`
          ${login && login.cloud ? html`<${SignIn} />` : ghRows}
          ${syncRow}`}
        ${authMsg && authMsg !== 'ok' && html`<p class="st-err">${authMsg === 'need-invite' ? '这个 Google 账号还没注册：先点「第一次来？填邀请码」，填好再点「用 Google 继续」。' : '登录失败：' + authMsg}</p>`}
        ${!connected && login && login.cloud && html`<details class="st-more"><summary>其他同步方式</summary>${ghRows}</details>`}
      <//>

      <${Sec} id="profile" title="个人" sub="名字和头像会出现在总览问候和侧栏。">
        <${Row} label="头像" hint="点头像上传，也可以把图片拖到头像上。">
          <${AvatarPicker} size=${44} />
          <button class="btn sm ghost" onClick=${avatarFromUrl}>用链接</button>
          ${s.profile.avatar && html`<button class="btn sm ghost" onClick=${() => setP('avatar', '')}>移除</button>`}
        <//>
        <${Row} label="名字"><input class="st-input" type="text" value=${s.profile.name} onInput=${(e) => setP('name', e.target.value)} /><//>
        <${Row} label="座右铭" hint="显示在总览问候下面。"><input class="st-input" type="text" value=${s.profile.motto} onInput=${(e) => setP('motto', e.target.value)} /><//>
      <//>

      <${Sec} id="look" title="外观">
        <${Row} label="深浅色" hint="选「跟随系统」会随电脑的深浅色切换。"><${Seg} options=${[{ v: 'auto', label: '跟随系统' }, { v: 'light', label: '浅色' }, { v: 'dark', label: '深色' }]} value=${s.settings.theme} onChange=${(v) => update((d) => { d.settings.theme = v; })} /><//>
        <${Row} label="主题" hint="决定卡片、边线和配色的整体质感。" stack>
          <div class="skin-pick">${skins.map((k) => html`<button type="button" key=${k.v} class=${'skin-opt ' + ((s.settings.skin || 'notion') === k.v ? 'on' : '')} onClick=${() => update((d) => { d.settings.skin = k.v; })}>
            <span class="skin-prev" style=${`background:${k.bg}`}><i style=${`left:6px;top:6px;width:18px;height:40px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:30px;top:6px;width:52px;height:17px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:30px;top:29px;width:52px;height:17px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:88px;top:6px;right:6px;height:40px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:92px;top:12px;width:22px;height:6px;border-radius:3px;background:${k.ac}`}></i></span>
            <b>${k.n}</b><small>${k.d}</small></button>`)}</div>
        <//>
        <${Row} label="质感" hint="「毛玻璃」给卡片加实时模糊，老一点的电脑会卡；「轻快」看起来差不多，更顺滑。"><${Seg} options=${[{ v: 'lite', label: '轻快' }, { v: 'full', label: '毛玻璃' }]} value=${s.settings.fx === 'full' ? 'full' : 'lite'} onChange=${(v) => update((d) => { d.settings.fx = v; })} /><//>
      <//>

      <${Sec} id="seal" title="汤圆" sub=${login && login.ai ? `AI 已接入（${login.aiModel || '服务器配置'}）。说一句话，汤圆拆成待办 / 时间块 / 笔记，你确认了才写入。` : '角落里的小海豹。说一句话，拆成待办 / 时间块 / 笔记，预览后再保存。'}>
        <${Row} label="显示汤圆" hint="拖到卡片上会趴在卡片上沿；拖到空白处就吸到屏幕边。"><${Seg} options=${[{ v: 'on', label: '显示' }, { v: 'off', label: '隐藏' }]} value=${s.settings.seal === false ? 'off' : 'on'} onChange=${(v) => update((d) => { d.settings.seal = v === 'on'; })} /><//>
        <${Row} label="闲时贴边" hint="几秒没人理就缩到屏幕边，鼠标靠近再出来。"><${Seg} options=${[{ v: 'on', label: '开' }, { v: 'off', label: '关' }]} value=${s.settings.sealTuck === true ? 'on' : 'off'} onChange=${(v) => update((d) => { d.settings.sealTuck = v === 'on'; })} /><//>
        <${Row} label="光效" hint="对话框里的光晕、输入框和按钮上流动的一圈光。"><${Seg} options=${[{ v: 'on', label: '开' }, { v: 'off', label: '关' }]} value=${s.settings.sealGlow === false ? 'off' : 'on'} onChange=${(v) => update((d) => { d.settings.sealGlow = v === 'on'; })} /><//>
        <${Row} label="强调色" hint="只用在发送键、保存键、状态点和光上。"><${Seg} options=${[{ v: 'none', label: '黑白' }, { v: 'ice', label: '冰蓝' }, { v: 'teal', label: '青绿' }]} value=${s.settings.sealAccent || 'none'} onChange=${(v) => update((d) => { d.settings.sealAccent = v; })} /><//>
        <${Row} label="AI" hint="「服务器配置」用站点自带的；也可以填自己的 DeepSeek / Claude 密钥，只存在这台浏览器里，不进同步和备份。" stack>
          <div class="row wrap" style="gap:8px;align-items:center">
            <${Seg} options=${[{ v: 'server', label: '服务器配置' }, { v: 'deepseek', label: 'DeepSeek' }, { v: 'anthropic', label: 'Claude' }, { v: 'local', label: '不用 AI' }]} value=${ai.provider} onChange=${(v) => saveAi({ provider: v })} />
            ${ai.provider !== 'local' && html`<${Btn} small kind="ghost" onClick=${testAi} disabled=${!connected}>测试连接<//>`}
          </div>
          ${(ai.provider === 'deepseek' || ai.provider === 'anthropic') && html`<div class="row wrap" style="gap:8px;margin-top:8px">
            <input class="st-input" type="password" style="flex:1;min-width:200px" value=${ai.key} placeholder=${ai.provider === 'deepseek' ? 'sk-…（platform.deepseek.com）' : 'sk-ant-…'} autocomplete="off" onInput=${(e) => saveAi({ key: e.target.value.trim() })} />
            <input class="st-input" type="text" style="width:180px" value=${ai.model} placeholder=${ai.provider === 'deepseek' ? '模型，默认 deepseek-chat' : '模型，默认 claude-opus-5-5'} onInput=${(e) => saveAi({ model: e.target.value.trim() })} />
          </div>`}
          ${aiMsg && html`<p class=${'small ' + (aiMsg.startsWith('失败') ? 'st-err' : 'muted')} style="margin-top:6px">${aiMsg}</p>`}
          ${!connected && html`<p class="small muted" style="margin-top:6px">登录之后才能用 AI。</p>`}
        <//>
        <${Row} label="本月用量" hint="本机统计；费用按公开单价估算，以平台账单为准。">
          <span class="st-val">${usage.calls} 次 · 约 ${cost.text}</span>
          ${(ai.provider === 'deepseek' || (ai.provider === 'server' && login && /deepseek/i.test(login.aiModel || ''))) && html`<button class="btn sm ghost" onClick=${checkBal} disabled=${!connected}>查余额</button>`}
          ${usage.calls > 0 && html`<button class="btn sm ghost" onClick=${() => { clearUsage(); bump((x) => x + 1); }}>清零</button>`}
        <//>
        ${bal && html`<p class="small muted st-note">${bal.loading ? '查询中…' : bal.error ? '查余额失败：' + bal.error : bal.supported === false ? '这家没有余额接口，去控制台看。' : `DeepSeek 余额 ${bal.currency === 'USD' ? '$' : '¥'}${bal.total.toFixed(2)}${bal.granted ? `（赠送 ${bal.granted.toFixed(2)}）` : ''}${bal.available ? '' : ' · 账户不可用'}`}</p>`}
      <//>

      <${PromptsCard} s=${s} />

      <${Sec} id="data" title="数据" sub=${counts.map(([k, n]) => `${k} ${n}`).join(' · ')}>
        <${Row} label="备份" hint="导出的文件不含 token 和 AI 密钥。">
          <button class="btn sm" onClick=${() => download(`sealonote-${todayStr()}.json`, exportJSON())}><${Icon} name="download" size=${14} /> 导出</button>
          <label class="btn sm"><${Icon} name="upload" size=${14} /> 导入<input type="file" accept="application/json" style="display:none" onChange=${importFile} /></label>
        <//>
        ${!s.settings.seeded && html`<${Row} label="示例数据" hint="放一些示例待办、笔记和时间块，先看看怎么用。"><button class="btn sm ghost" onClick=${() => { seed(); toast('已载入示例数据'); }}>载入</button><//>`}
        ${(connected || tokenMode) && html`<${Row} label="手动同步" hint="一般用不到：自动同步出问题时，可以强制用一边覆盖另一边。">
          <button class="btn sm ghost" disabled=${busy} onClick=${() => run(push, '已用本机数据覆盖云端')}>本机 → 云端</button>
          <button class="btn sm ghost" disabled=${busy} onClick=${async () => { if (await askConfirm('本机还没同步上去的改动会丢失。', { title: '用云端数据覆盖本机？', ok: '覆盖本机' })) run(pull, '已用云端数据覆盖本机'); }}>云端 → 本机</button>
        <//>`}
        <${Row} label="清空笔记" hint="所有页面进「最近删除」，30 天内可以恢复；本子、待办、书、收藏都不动。"><button class="btn sm ghost danger" disabled=${!s.notes.length} onClick=${async () => { const n = s.notes.length; if (await askConfirm(`${n} 页会移到「最近删除」，30 天内可以在笔记里恢复。`, { title: '清空所有笔记？', ok: '清空笔记' })) { trashPages(s.notes.map((x) => x.id)); toast(`清了 ${n} 页，在「最近删除」里能找回`); } }}>清空笔记</button><//>
        <${Row} label="清空全部" hint="清掉所有数据，从空白开始。建议先导出。"><button class="btn sm ghost danger" onClick=${async () => { if (await askConfirm('所有待办、笔记、书、收藏、足迹都会被清除。建议先导出备份。', { title: '清空全部数据？', ok: '清空' })) { const b = blank(); b.settings.seeded = true; replace(b); } }}>清空全部</button><//>
        <details class="st-more"><summary>同步是怎么工作的</summary><ul>
          <li><b>存在哪里</b>：登录 sealonote 后，数据在云端数据库里，每个人一份，别人看不到；附件放在只属于你的私有存储里。本机也留一份，断网照常用，联网后自动合并。</li>
          <li><b>什么时候同步</b>：打开页面自动拉取较新的一方；编辑后几秒自动推送；切换标签页或关闭前也会推送。</li>
          <li><b>安全</b>：登录凭据只在加密的 httpOnly cookie 里，网页脚本拿不到；AI 密钥和 token 只存在本机，不会写进数据。</li>
          <li><b>GitHub 方式</b>：整份数据是仓库里的一个 JSON 文件，附件在旁边的 assets 目录，每次同步是一次提交。仓库公开的话数据也公开，私人内容请用私有仓库。</li>
        </ul></details>
      <//>

      <${Sec} id="keys" title="快捷键">
        <div class="keys">
          ${[['全局', [['⌘/Ctrl K', '全局搜索'], ['⌘/Ctrl ⇧ K', '打开汤圆记一下（隐藏汤圆时是本地随手记）'], ['Esc', '关闭弹窗 / 退出专注写作']]],
             ['笔记', [['/', '插入块或模板'], ['[[', '链接页面，可直接新建'], ['@', '引用待办 / 书 / 足迹 / 目标'], ['⌘B · I · U · E · K', '粗体 · 斜体 · 下划线 · 代码 · 链接'], ['⌘⇧H', '荧光标记'], ['⌥↑ / ⌥↓', '光标所在块上移 / 下移（选中多块一起动）'], ['⌘⇧. / ⌘⇧,', '放大 / 缩小字号'], ['⌘⇧V', '按 Markdown 粘贴']]],
             ['画布', [['V · T · P · E', '选择 · 文字 · 画笔 · 橡皮'], ['Tab / Enter', '脑图：新建子节点 / 同级节点'], ['双击空白', '新建文字']]],
             ['待办语法', [['@明天 · @2026-11-01', '日期'], ['14:00', '时间'], ['!0 – !3', '优先级'], ['#标签', '标签']]],
           ].map(([g, rows]) => html`<div class="keys-g" key=${g}><div class="keys-h">${g}</div>${rows.map(([k, d]) => html`<div class="keys-r" key=${k}><kbd class="mono">${k}</kbd><span>${d}</span></div>`)}</div>`)}
        </div>
      <//>
    </div>
  </div>`;
}
