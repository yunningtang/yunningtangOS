import { html, useState, useEffect } from '../../vendor/preact.js';
import { useStore, update, replace, exportJSON, blank } from '../store.js';
import { Icon, Btn, Card, Field, Seg, confirmDel } from '../ui.js';
import { download, readFile, todayStr, pickFile, imageToSquare } from '../util.js';
import { push, pull, smartSync, loginState, detectLogin, status as syncStatus } from '../sync.js';
import { seed } from '../seed.js';
import { toast } from '../nav.js';
import { askConfirm, askPrompt } from '../confirm.js';
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

export default function Settings() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [login, setLogin] = useState(loginState());
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
              <${Field} label="头像"><div class="row" style="gap:6px;flex-wrap:wrap"><${Btn} small icon="image" onClick=${() => uploadAvatar()}>上传照片<//><${Btn} small kind="ghost" onClick=${avatarFromUrl}>用链接<//>${s.profile.avatar && html`<${Btn} small kind="ghost" onClick=${() => setP('avatar', '')}>移除<//>`}</div><//>
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
      <${Card} title="同步" sub=${login && login.user ? '已登录，数据会自动同步到你的仓库。' : login && login.configured ? '登录后自动同步，不用贴 token。' : '把整份数据存为仓库里的一个 JSON 文件；每次同步都是一次提交，可回滚。'}>
        <div class="form">
          ${login && login.user ? html`
            <div class="row" style="gap:12px">
              <div class="avatar" style="width:40px;height:40px">${login.user.avatar ? html`<img src=${login.user.avatar} alt="" />` : login.user.login[0]}</div>
              <div class="flex1"><b>${login.user.login}</b><div class="small muted">${login.target.repo} · ${login.target.branch} · ${login.target.path}</div></div>
              <a class="btn sm" href="/api/auth/logout">退出登录</a>
            </div>
            <div class="row wrap">
              <${Btn} kind="primary" disabled=${busy} onClick=${() => run(smartSync)}>立即同步<//>
              <${Btn} disabled=${busy} onClick=${() => run(push, '已推送')}>推送（本地覆盖远端）<//>
              <${Btn} disabled=${busy} onClick=${async () => { if (await askConfirm('本地未同步的改动会丢失。', { title: '用远端数据覆盖本地？', ok: '拉取' })) run(pull, '已拉取'); }}>拉取（远端覆盖本地）<//>
            </div>
            <p class="small muted">打开页面时会自动拉取较新的一方；编辑后几秒自动推送；切换标签页或关闭前也会推送。</p>`
          : login && login.configured ? html`
            <div class="row wrap">
              <a class="btn primary" href="/api/auth/login">用 GitHub 登录</a>
              ${authMsg && authMsg !== 'ok' && html`<span class="small" style="color:var(--red)">登录失败：${authMsg}</span>`}
            </div>
            <p class="small muted">登录后 token 只存在加密的 httpOnly cookie 里，浏览器脚本拿不到；数据写入 ${login.target ? login.target.repo : '你配置的仓库'}。</p>`
          : html`
            <p class="small muted">当前是纯静态部署。要「登录即同步」，把仓库部署到 Vercel 并配置 OAuth（见 README）。现在可以先用 token 方式：</p>
            <div class="grid2">
              <${Field} label="仓库 owner/name"><input type="text" value=${s.settings.sync.repo} placeholder="yunningtang/yunningtangOS" onInput=${(e) => setSync('repo', e.target.value.trim())} /><//>
              <${Field} label="分支"><input type="text" value=${s.settings.sync.branch} onInput=${(e) => setSync('branch', e.target.value.trim())} /><//>
            </div>
            <div class="grid2">
              <${Field} label="文件路径"><input type="text" value=${s.settings.sync.path} onInput=${(e) => setSync('path', e.target.value.trim())} /><//>
              <${Field} label="Fine-grained token" hint="只给这个仓库的 Contents 读写权限。token 只保存在本机浏览器。"><input type="password" value=${s.settings.sync.token} placeholder="github_pat_…" onInput=${(e) => setSync('token', e.target.value.trim())} /><//>
            </div>
            <div class="row wrap">
              <${Btn} kind="primary" disabled=${busy} onClick=${() => run(smartSync)}>智能同步<//>
              <${Btn} disabled=${busy} onClick=${() => run(push, '已推送')}>推送（本地覆盖远端）<//>
              <${Btn} disabled=${busy} onClick=${async () => { if (await askConfirm('本地未同步的改动会丢失。', { title: '用远端数据覆盖本地？', ok: '拉取' })) run(pull, '已拉取'); }}>拉取（远端覆盖本地）<//>
            </div>`}
          <div class="sync-status"><span class=${'dot ' + (err ? 'err' : s.settings.lastSync ? 'ok' : '')}></span>${err || (s.settings.lastSync ? `上次同步 ${new Date(s.settings.lastSync).toLocaleString('zh-CN', { hour12: false })}` : '尚未同步')}</div>
          <p class="small muted">如果仓库是公开的，数据文件也会是公开的。私人内容请用私有仓库。</p>
        </div>
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
          <${Field} label="显示海豹"><${Seg} options=${[{ v: 'on', label: '显示' }, { v: 'off', label: '隐藏' }]} value=${s.settings.seal === false ? 'off' : 'on'} onChange=${(v) => update((d) => { d.settings.seal = v === 'on'; })} /><//>
          ${login && login.ai
            ? html`<p class="small muted">每次只把你说的那句话和少量上下文（今天的日期、本子名、常用标签、今日待办标题）发给模型；拆出来的内容你确认后才写入。在随手记里也可以点「问汤圆」。</p>`
            : login && login.configured
              ? html`<p class="small muted">要接入 AI：在 Vercel 项目的环境变量里添加 <code class="mono">ANTHROPIC_API_KEY</code>（可选 <code class="mono">AGENT_MODEL</code>，默认 claude-opus-5-5），重新部署后登录即可。密钥只放在 Vercel 环境变量里，不要贴到这里或任何对话中。没有 AI 时汤圆按随手记的本地语法理解。</p>`
              : html`<p class="small muted">纯静态部署时汤圆只能按本地语法理解；部署到 Vercel 并配置 <code class="mono">ANTHROPIC_API_KEY</code> 后可用 AI 拆解。</p>`}
        </div>
      <//>
      <${Card} title="快捷键">
        <div class="small" style="line-height:2"><kbd class="mono">⌘/Ctrl K</kbd> 全局搜索 · <kbd class="mono">⌘/Ctrl ⇧ K</kbd> 记一下（快速捕获） · 笔记里 <kbd class="mono">/</kbd> 插入块、<kbd class="mono">[[</kbd> 链接页面、<kbd class="mono">@</kbd> 引用 · 画布 <kbd class="mono">V / T / P / E</kbd> 切换工具<br/>待办快速添加语法：<code class="mono">@明天</code> <code class="mono">@2026-11-01</code> <code class="mono">14:00</code> <code class="mono">!0</code>–<code class="mono">!3</code> 优先级 <code class="mono">#标签</code></div>
      <//>
    </div>
  </div>`;
}
