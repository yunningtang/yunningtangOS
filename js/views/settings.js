import { html, useState, useEffect } from '../../vendor/preact.js';
import { useStore, update, replace, exportJSON, blank } from '../store.js';
import { Icon, Btn, Card, Field, Seg, confirmDel } from '../ui.js';
import { download, readFile, todayStr, pickFile, imageToSquare } from '../util.js';
import { push, pull, smartSync, loginState, detectLogin, status as syncStatus } from '../sync.js';
import { seed } from '../seed.js';
import { toast } from '../nav.js';
import { askConfirm, askPrompt } from '../confirm.js';
import { aiConfig, setAiConfig, aiHeaders, usageOf, clearUsage, estimateCost } from '../ai.js';
import { ctxMenu } from '../ctx.js';

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

export default function Settings() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [login, setLogin] = useState(loginState());
  const [tokOpen, setTokOpen] = useState(false);
  const [ai, setAi] = useState(aiConfig());
  const [aiMsg, setAiMsg] = useState('');
  const [bal, setBal] = useState(null);
  const [, bump] = useState(0);
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
    try { const r = await fn(); toast(okMsg || (r === 'pulled' ? '已从 GitHub 拉取' : r === 'same' ? '已是最新' : r === 'merged' ? '两边的改动已合并并推送' : '已推送到 GitHub')); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const importFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await readFile(f)); if (!j.todos) throw new Error('不是有效的备份文件'); replace(j); toast('已导入'); } catch (x) { toast(x.message); }
    e.target.value = '';
  };
  const counts = [['待办', s.todos.length], ['时间块', s.blocks.length], ['书', s.books.length], ['收藏', s.links.length], ['笔记', s.notes.length], ['足迹', s.trips.length]];

  return html`<div>
    <div class="settings">
      <${Card} title="个人">
        <div class="row" style="gap:16px;align-items:flex-start">
          <${AvatarPicker} size=${72} />
          <div class="form flex1">
            <div class="grid2">
              <${Field} label="名字"><input type="text" value=${s.profile.name} onInput=${(e) => setP('name', e.target.value)} /><//>
              <${Field} label="头像"><div class="row" style="gap:6px;flex-wrap:wrap"><${Btn} small icon="image" onClick=${() => uploadAvatar()}>上传照片<//><${Btn} small kind="ghost" onClick=${avatarFromUrl}>用链接<//>${login && login.user && login.user.avatar && s.profile.avatar !== login.user.avatar && html`<${Btn} small kind="ghost" icon="github" onClick=${() => setP('avatar', login.user.avatar)}>用 GitHub 头像<//>`}${s.profile.avatar && html`<${Btn} small kind="ghost" onClick=${() => setP('avatar', '')}>移除<//>`}</div><//>
            </div>
            <${Field} label="座右铭"><input type="text" value=${s.profile.motto} onInput=${(e) => setP('motto', e.target.value)} /><//>
            <${Field} label="主题"><${Seg} options=${[{ v: 'auto', label: '跟随系统' }, { v: 'light', label: '浅色' }, { v: 'dark', label: '深色' }]} value=${s.settings.theme} onChange=${(v) => update((d) => { d.settings.theme = v; })} /><//>
            <${Field} label="风格"><div class="skin-pick">${[
              { v: 'glass', n: '玻璃', d: '半透明卡片，柔和光晕', bg: 'linear-gradient(135deg,#eef2fb,#f6f3f8)', card: 'rgba(255,255,255,.7)', ac: '#4f7cf5', line: 'rgba(255,255,255,.9)' },
              { v: 'notion', n: 'Notion', d: '纯白、细线、方正', bg: '#ffffff', card: '#ffffff', ac: '#2383e2', line: 'rgba(55,53,47,.16)' },
              { v: 'claude', n: 'Claude', d: '米色暖底，赤陶色点缀，衬线标题', bg: '#f4f1ea', card: '#faf9f5', ac: '#c96442', line: 'rgba(60,50,30,.14)' },
              { v: 'steam', n: 'Steam', d: '深蓝灰底，青蓝与绿按钮', bg: '#1b2838', card: '#2a475e', ac: '#66c0f4', line: 'rgba(0,0,0,.4)' },
              { v: 'xp', n: 'Windows XP', d: '蓝天绿地，Luna 蓝色标题栏', bg: 'linear-gradient(180deg,#3f7fd8,#8fc0f0 60%,#6fb24c)', card: '#ece9d8', ac: '#0a5fd6', line: '#0831d9' },
            ].map((k) => html`<button type="button" key=${k.v} class=${'skin-opt ' + ((s.settings.skin || 'glass') === k.v ? 'on' : '')} onClick=${() => update((d) => { d.settings.skin = k.v; })}>
              <span class="skin-prev" style=${`background:${k.bg}`}><i style=${`left:6px;top:6px;width:18px;height:40px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:30px;top:6px;width:52px;height:17px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:30px;top:29px;width:52px;height:17px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:88px;top:6px;right:6px;height:40px;background:${k.card};box-shadow:0 0 0 1px ${k.line}`}></i><i style=${`left:92px;top:12px;width:22px;height:6px;border-radius:3px;background:${k.ac}`}></i></span>
              <b>${k.n}</b><small>${k.d}</small></button>`)}</div><//>
          </div>
        </div>
      <//>
      <${Card} title="云端同步" sub="在不同设备间访问同一份数据。">
        ${(() => {
          const connected = !!(login && login.user);
          const tokenMode = !connected && !(login && login.configured) && !!(s.settings.sync.repo && s.settings.sync.token);
          const stState = err ? 'err' : connected || tokenMode ? (s.settings.lastSync ? 'ok' : 'warn') : '';
          const stText = err ? err : connected || tokenMode ? (s.settings.lastSync ? `已连接 · 上次同步 ${new Date(s.settings.lastSync).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '已连接 · 尚未同步') : '未连接 · 连接账号以启用同步';
          return html`
          <div class=${'sync-head ' + stState}><span class="dot"></span><span class="flex1">${stText}</span>${(connected || tokenMode) && html`<button class="btn sm" disabled=${busy} onClick=${() => run(smartSync)}>${busy ? '同步中…' : '立即同步'}</button>`}</div>
          <div class="int-list">
            <div class="int-row">
              <span class="int-ic gh"><${Icon} name="github" size=${16} /></span>
              <div class="int-b"><b>GitHub</b><small>${connected ? html`${login.user.login} · ${login.target.repo} · ${login.target.branch}` : login && login.configured ? '同步到你的私人仓库' : '静态部署：用 token 直连仓库'}</small></div>
              ${connected ? html`<span class="int-tag on">已连接</span><a class="btn sm ghost" href="/api/auth/logout">断开</a>`
                : login && login.configured ? html`<a class="btn sm primary" href="/api/auth/login">连接</a>`
                : html`<button class="btn sm" onClick=${() => setTokOpen((v) => !v)}>${tokOpen ? '收起' : tokenMode ? '设置' : '配置'}</button>`}
            </div>
            ${!connected && !(login && login.configured) && tokOpen && html`<div class="int-sub">
              <p class="small muted">要「登录即同步」，把仓库部署到 Vercel 并配置 OAuth（见 README）。现在先用 token：</p>
              <div class="grid2">
                <${Field} label="仓库 owner/name"><input type="text" value=${s.settings.sync.repo} placeholder="yunningtang/dataOS" onInput=${(e) => setSync('repo', e.target.value.trim())} /><//>
                <${Field} label="分支"><input type="text" value=${s.settings.sync.branch} onInput=${(e) => setSync('branch', e.target.value.trim())} /><//>
              </div>
              <div class="grid2">
                <${Field} label="文件路径"><input type="text" value=${s.settings.sync.path} onInput=${(e) => setSync('path', e.target.value.trim())} /><//>
                <${Field} label="Fine-grained token" hint="只给这个仓库的 Contents 读写权限，只保存在本机浏览器。"><input type="password" value=${s.settings.sync.token} placeholder="github_pat_…" onInput=${(e) => setSync('token', e.target.value.trim())} /><//>
              </div>
            </div>`}
            <div class="int-row off">
              <span class="int-ic" dangerouslySetInnerHTML=${{ __html: GOOGLE_SVG }}></span>
              <div class="int-b"><b>Google</b><small>即将支持</small></div>
              <span class="int-tag">Coming soon</span>
            </div>
          </div>
          ${authMsg && authMsg !== 'ok' && html`<p class="small" style="color:var(--red)">登录失败：${authMsg}</p>`}
          ${(connected || tokenMode) && html`<div class="sync-acts">
            <button class="btn sm ghost" disabled=${busy} onClick=${() => run(push, '已推送')}>推送（本地覆盖远端）</button>
            <button class="btn sm ghost" disabled=${busy} onClick=${async () => { if (await askConfirm('本地未同步的改动会丢失。', { title: '用远端数据覆盖本地？', ok: '拉取' })) run(pull, '已拉取'); }}>拉取（远端覆盖本地）</button>
          </div>`}
          <details class="sync-how">
            <summary>同步如何工作？</summary>
            <ul>
              <li><b>数据存在哪里</b>：整份数据是你仓库里的一个 JSON 文件（${login && login.target ? login.target.path : s.settings.sync.path || 'data/os.json'}），附件在旁边的 assets 目录。每次同步是一次提交，可以回滚到任何一天。</li>
              <li><b>什么时候同步</b>：打开页面自动拉取较新的一方；编辑后几秒自动推送；切换标签页或关闭前也会推送。</li>
              <li><b>安全</b>：登录凭据只存在加密的 httpOnly cookie 里，浏览器脚本拿不到；token 方式的 token 只存在本机，不会被写进数据文件。</li>
              <li><b>注意</b>：仓库如果是公开的，数据文件也是公开的。私人内容请用私有仓库。</li>
            </ul>
          </details>`;
        })()}
      <//>
      <${Card} title="备份" sub=${counts.map(([k, n]) => `${k} ${n}`).join(' · ')}>
        <div class="row wrap">
          <${Btn} icon="download" onClick=${() => download(`ytos-${todayStr()}.json`, exportJSON())}>导出 JSON<//>
          <label class="btn"><${Icon} name="upload" size=${15} /> 导入 JSON<input type="file" accept="application/json" style="display:none" onChange=${importFile} /></label>
          ${!s.settings.seeded && html`<${Btn} kind="ghost" icon="sparkle" onClick=${() => { seed(); toast('已载入示例数据'); }}>载入示例数据<//>`}
          <${Btn} kind="ghost danger" icon="trash" onClick=${async () => { if (await askConfirm('所有待办、笔记、书、收藏、足迹都会被清除。建议先导出 JSON。', { title: '清空全部数据？', ok: '清空' })) { const b = blank(); b.settings.seeded = true; replace(b); } }}>清空全部<//>
        </div>
      <//>
      <${Card} title="汤圆助手" sub=${login && login.ai ? `AI 已接入（${login.aiModel || '模型由 AGENT_MODEL 决定'}）。` : '角落里的小海豹。说一句话，拆成待办 / 时间块 / 笔记，预览后再保存。'}>
        <div class="form">
          <div class="grid2">
            <${Field} label="显示海豹" hint="拖到任意卡片上松手，它会趴在卡片上沿跟着页面滚；拖到空白处就吸到屏幕边。右键有更多选项。"><${Seg} options=${[{ v: 'on', label: '显示' }, { v: 'off', label: '隐藏' }]} value=${s.settings.seal === false ? 'off' : 'on'} onChange=${(v) => update((d) => { d.settings.seal = v === 'on'; })} /><//>
            <${Field} label="闲时贴边" hint="几秒没人理，就缩到屏幕边上只露一截，不压在内容上；鼠标靠近就出来。"><${Seg} options=${[{ v: 'on', label: '开' }, { v: 'off', label: '关' }]} value=${s.settings.sealTuck === true ? 'on' : 'off'} onChange=${(v) => update((d) => { d.settings.sealTuck = v === 'on'; })} /><//>
          </div>
          <${Field} label="AI 密钥" hint="服务器配置 = 用 Vercel 环境变量里的密钥。选 DeepSeek / Claude 可以直接在这里填自己的密钥：只存在这台浏览器里，不进同步数据和备份，每次请求发给你自己的后端转发。">
            <div class="row wrap" style="gap:8px;align-items:center">
              <${Seg} options=${[{ v: 'server', label: '服务器配置' }, { v: 'deepseek', label: 'DeepSeek' }, { v: 'anthropic', label: 'Claude' }]} value=${ai.provider} onChange=${(v) => saveAi({ provider: v })} />
              ${ai.provider !== 'server' && html`<input type="password" style="flex:1;min-width:200px" value=${ai.key} placeholder=${ai.provider === 'deepseek' ? 'sk-…（platform.deepseek.com）' : 'sk-ant-…'} autocomplete="off" onInput=${(e) => saveAi({ key: e.target.value.trim() })} />`}
              ${ai.provider !== 'server' && html`<input type="text" style="width:150px" value=${ai.model} placeholder=${ai.provider === 'deepseek' ? '模型，默认 deepseek-chat' : '模型，默认 claude-opus-5-5'} onInput=${(e) => saveAi({ model: e.target.value.trim() })} />`}
              <${Btn} small onClick=${testAi} disabled=${!(login && login.user)}>测试连接<//>
            </div>
            ${aiMsg && html`<p class=${'small ' + (aiMsg.startsWith('失败') ? '' : 'muted')} style=${aiMsg.startsWith('失败') ? 'color:var(--red);margin-top:6px' : 'margin-top:6px'}>${aiMsg}</p>`}
            ${!(login && login.user) && html`<p class="small muted" style="margin-top:6px">先用 GitHub 登录，汤圆只给登录用户用。</p>`}
          <//>
          <${Field} label="本月用量" hint="本机统计，刷新或换设备不累计；费用按公开单价估算，以平台账单为准。">
            <div class="row wrap" style="gap:14px;align-items:center">
              <span class="small">${usage.calls} 次 · 输入 ${(usage.in / 1000).toFixed(1)}k · 输出 ${(usage.out / 1000).toFixed(1)}k token · 约 ${cost.text}${usage.modes && usage.modes.breakdown ? ` · 其中拆解 ${usage.modes.breakdown} 次` : ''}</span>
              ${(ai.provider === 'deepseek' || (ai.provider === 'server' && login && /deepseek/i.test(login.aiModel || ''))) && html`<${Btn} small kind="ghost" onClick=${checkBal} disabled=${!(login && login.user)}>查余额<//>`}
              ${usage.calls > 0 && html`<${Btn} small kind="ghost" onClick=${() => { clearUsage(); bump((x) => x + 1); }}>清零<//>`}
            </div>
            ${bal && html`<p class="small muted" style="margin-top:6px">${bal.loading ? '查询中…' : bal.error ? '查余额失败：' + bal.error : bal.supported === false ? '这家没有余额接口，去控制台看。' : `DeepSeek 余额 ${bal.currency === 'USD' ? '$' : '¥'}${bal.total.toFixed(2)}${bal.granted ? `（赠送 ${bal.granted.toFixed(2)}）` : ''}${bal.available ? '' : ' · 账户不可用'}`}</p>`}
          <//>
          <p class="small muted">每次只把你说的那句话和少量上下文（今天的日期、本子名、常用标签、今日待办标题）发给模型，拆出来的内容你确认后才写入。待办右键「拆解成步骤」会把一件大事拆成 3–7 步写进它的关联页面。</p>
        </div>
      <//>
      <${Card} title="快捷键">
        <div class="small" style="line-height:2"><kbd class="mono">⌘/Ctrl K</kbd> 全局搜索 · <kbd class="mono">⌘/Ctrl ⇧ K</kbd> 记一下（快速捕获） · 笔记里 <kbd class="mono">/</kbd> 插入块、<kbd class="mono">[[</kbd> 链接页面、<kbd class="mono">@</kbd> 引用 · 画布 <kbd class="mono">V / T / P / E</kbd> 切换工具<br/>待办快速添加语法：<code class="mono">@明天</code> <code class="mono">@2026-11-01</code> <code class="mono">14:00</code> <code class="mono">!0</code>–<code class="mono">!3</code> 优先级 <code class="mono">#标签</code></div>
      <//>
    </div>
  </div>`;
}
