import { html, useState, useEffect } from '../../vendor/preact.js';
import { useStore, update, replace, exportJSON, blank } from '../store.js';
import { Icon, Btn, Card, Field, Seg, confirmDel } from '../ui.js';
import { download, readFile, todayStr } from '../util.js';
import { push, pull, smartSync, loginState, detectLogin, status as syncStatus } from '../sync.js';
import { seed } from '../seed.js';
import { toast } from '../nav.js';
import { askConfirm } from '../confirm.js';

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
    try { const r = await fn(); toast(okMsg || (r === 'pulled' ? '已从 GitHub 拉取' : r === 'same' ? '已是最新' : '已推送到 GitHub')); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const importFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await readFile(f)); if (!j.todos) throw new Error('不是有效的备份文件'); replace(j); toast('已导入'); } catch (x) { alert(x.message); }
    e.target.value = '';
  };
  const counts = [['待办', s.todos.length], ['时间块', s.blocks.length], ['书', s.books.length], ['收藏', s.links.length], ['笔记', s.notes.length], ['足迹', s.trips.length]];

  return html`<div>
    <div class="page-h"><div><div class="kicker">Settings</div><h1>设置</h1><div class="desc">数据存在这台设备的浏览器里，可随时导出，也可以同步到你的 GitHub 仓库。</div></div></div>
    <div class="settings">
      <${Card} title="个人">
        <div class="row" style="gap:16px;align-items:flex-start">
          <div class="avatar">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || '?')[0]}</div>
          <div class="form flex1">
            <div class="grid2">
              <${Field} label="名字"><input type="text" value=${s.profile.name} onInput=${(e) => setP('name', e.target.value)} /><//>
              <${Field} label="头像 URL"><input type="url" value=${s.profile.avatar} onInput=${(e) => setP('avatar', e.target.value)} /><//>
            </div>
            <${Field} label="座右铭"><input type="text" value=${s.profile.motto} onInput=${(e) => setP('motto', e.target.value)} /><//>
            <${Field} label="主题"><${Seg} options=${[{ v: 'auto', label: '跟随系统' }, { v: 'light', label: '浅色' }, { v: 'dark', label: '深色' }]} value=${s.settings.theme} onChange=${(v) => update((d) => { d.settings.theme = v; })} /><//>
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
      <${Card} title="快捷键">
        <div class="small" style="line-height:2"><kbd class="mono">⌘/Ctrl K</kbd> 全局搜索 · 待办快速添加语法：<code class="mono">@明天</code> <code class="mono">@2026-11-01</code> <code class="mono">14:00</code> <code class="mono">!0</code>–<code class="mono">!3</code> 优先级 <code class="mono">#标签</code></div>
      <//>
    </div>
  </div>`;
}
