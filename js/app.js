import { html, render, useEffect, useState, useMemo, useRef } from '../vendor/preact.js';
import { useStore, update, get } from './store.js';
import { Icon, IconBtn, Modal } from './ui.js';
import { todayStr, weekKey, setExtraKinds , setTagOverrides } from './util.js';
import { seedIfEmpty } from './seed.js';
import Dashboard from './views/dashboard.js';
import Todos from './views/todos.js';
import Planner from './views/planner.js';
import Reading from './views/reading.js';
import Links from './views/links.js';
import Notes from './views/notes.js';
import Vision from './views/vision.js';
import Explore from './views/explore.js';
import Settings from './views/settings.js';
import Focus, { MiniPomo } from './views/focus.js';
import { SearchPalette } from './search.js';
import { PageTree, useTreeState, newNote, newNotebook, ancestors, noteTitle, notebookMenu, movePage } from './views/notes.js';
import { dragProps, dropProps } from './dnd.js';
import { go, toast } from './nav.js';
import { initLiquid } from './liquid.js';
import { ctxMenu } from './ctx.js';
import { askPrompt } from './confirm.js';
import { Splitter, applySizes } from './resize.js';
import { detectLogin, autoSync } from './sync.js';
import { injectFontCss } from './fonts.js';
injectFontCss();
import { subscribe } from './store.js';
export { go, toast };

import { Capture } from './capture.js';
import { Seal } from './seal.js';
import { dueCount } from './review.js';

export const ROUTES = [
  { path: 'home', name: '总览', icon: 'home', view: Dashboard },
  { sep: '每一天' },
  { path: 'todos', name: '待办', icon: 'checksq', view: Todos, count: (s) => s.todos.filter((t) => !t.done).length },
  { path: 'plan', href: 'plan/day', name: '今天', icon: 'sun', nav: true, match: (r) => r.path === 'plan' && r.sub === 'day' },
  { path: 'plan', name: '计划', icon: 'calendar', view: Planner, match: (r) => r.path === 'plan' && r.sub !== 'day' },
  { path: 'focus', name: '专注', icon: 'clock', view: Focus },
  { sep: '输入与输出' },
  { path: 'reading', name: '阅读', icon: 'book', view: Reading, count: (s) => s.books.filter((b) => b.status === 'reading').length },
  { path: 'links', name: '收藏', icon: 'link', view: Links },
  { path: 'notes', name: '笔记', icon: 'note', view: Notes, match: (r) => r.path === 'notes' && !(r.sub || '').startsWith('canvas'), count: (s) => dueCount(s.notes) },
  { path: 'notes', href: 'notes/canvas', name: '画布', icon: 'frame', match: (r) => r.path === 'notes' && (r.sub || '').startsWith('canvas') },
  { sep: '远方' },
  { path: 'vision', name: '愿景', icon: 'sparkle', view: Vision },
  { path: 'explore', name: '探索', icon: 'globe', view: Explore },
  { path: 'settings', name: '设置', icon: 'settings', view: Settings, hidden: true },
];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [h, q] = raw.split('?');
  const [path, ...rest] = h.split('/');
  return { path: path || 'home', sub: rest.join('/') || '', query: Object.fromEntries(new URLSearchParams(q || '')) };
}

export function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const h = () => setR(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export // 先下线的风格：样式还在，选择器里不显示，已选的人退回「玻璃」
const HIDDEN_SKINS = new Set(['liquid', 'mac']);
function applyTheme(t, skin, fx, glow, accent) {
  const real = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = real;
  // 质感：lite 不给卡片和侧栏加毛玻璃（backdrop-filter 很吃 GPU，鼠标一动就重算，是卡顿的主因）；full 才开
  if (fx !== undefined) document.documentElement.dataset.fx = fx === 'full' ? 'full' : 'lite';
  if (glow !== undefined) document.documentElement.dataset.glow = glow === false ? '0' : '1';
  if (accent !== undefined) document.documentElement.dataset.accent = accent || 'none';
  if (skin !== undefined) document.documentElement.dataset.skin = HIDDEN_SKINS.has(skin) ? 'glass' : (skin === 'win95' ? 'xp' : skin) || 'notion';
}

function App() {
  const s = useStore();
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [cap, setCap] = useState(false);
  const [search, setSearch] = useState(false);
  // 「记一下」并入汤圆：有汤圆就打开对话框，隐藏了汤圆才用本地规则的随手记
  const sealOn = useRef(true); sealOn.current = s.settings.seal !== false;
  const capture = () => { if (sealOn.current) window.dispatchEvent(new CustomEvent('seal:ask')); else setCap((v) => !v); };
  const tree = useTreeState();
  const [navOpen, setNavOpen] = useState(() => { try { return { notes: true, ...JSON.parse(localStorage.getItem('ytos.nav') || '{}') }; } catch { return { notes: true }; } });
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('ytos.side') === 'mini'; } catch { return false; } });
  const toggleMini = () => { if (matchMedia('(max-width:900px)').matches) { setMenu(false); return; } setMini((m) => { try { localStorage.setItem('ytos.side', m ? 'full' : 'mini'); } catch {} return !m; }); };
  const toggleNav = (k) => setNavOpen((o) => { const n = { ...o, [k]: o[k] === false }; try { localStorage.setItem('ytos.nav', JSON.stringify(n)); } catch {} return n; });
  const curNote = route.path === 'notes' ? s.notes.find((n) => n.id === route.sub) : null;
  const active = ROUTES.find((r) => r.path === route.path && r.view) || ROUTES[0];
  const View = active.view;

  useEffect(() => {
    applyTheme(s.settings.theme, s.settings.skin || 'notion', s.settings.fx || 'lite', s.settings.sealGlow !== false, s.settings.sealAccent || 'none');
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => s.settings.theme === 'auto' && applyTheme('auto');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [s.settings.theme, s.settings.skin, s.settings.fx]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); capture(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    setMenu(false);
    window.scrollTo({ top: 0 });
    document.title = `${active.name} · yunningtang OS`;
  }, [route.path, route.sub]);

  const toggleTheme = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    update((d) => { d.settings.theme = next; });
  };

  return html`<div class=${'shell ' + (mini ? 'shell-mini' : '')}>
    ${menu && html`<div class="side-bg" onClick=${() => setMenu(false)}></div>`}
    <aside class=${'side ' + (menu ? 'open ' : '') + (mini ? 'mini' : '')}>
      <div class="side-top">
        <span class="side-week">${weekKey(todayStr())}</span>
        <button class="ibtn side-tg" title=${mini ? '展开侧栏' : '收起侧栏'} onClick=${toggleMini}><${Icon} name=${mini ? 'right' : 'left'} size=${14} /></button>
      </div>
      <nav class="nav" data-liquid=".nav > a, .pt-row"><span class="liq"></span>
        ${(() => { let section = ''; return ROUTES.map((r) => {
          if (r.sep !== undefined) { section = r.sep; return r.sep ? html`<button class=${'sep ' + (navOpen['s:' + r.sep] === false ? 'closed' : '')} onClick=${() => toggleNav('s:' + r.sep)}><span>${r.sep}</span><${Icon} name="down" size=${11} /></button>` : html`<div class="sep"></div>`; }
          if (r.hidden) return null;
          if (section && navOpen['s:' + section] === false && !mini) return null;
          const isActive = r.match ? r.match(route) : route.path === r.path;
          return html`<a href=${'#/' + (r.href || r.path)} class=${isActive ? 'active' : ''} data-tip=${r.name} onContextMenu=${(e) => ctxMenu(e, [{ label: '在新标签页打开', icon: 'external', onClick: () => window.open('#/' + r.path, '_blank') }, { label: mini ? '展开侧栏' : '收起侧栏', icon: mini ? 'right' : 'left', onClick: toggleMini }, r.path === 'notes' && r.view && { label: navOpen.notes ? '收起页面树' : '展开页面树', icon: 'layers', onClick: () => toggleNav('notes') }], r.name)}><${Icon} name=${r.icon} size=${16} /><span class="nl">${r.name}</span>${r.count && r.count(s) > 0 && html`<span class="cnt">${r.count(s)}</span>`}${r.path === 'notes' && r.view && html`<button class="nav-tg" title=${navOpen.notes ? '收起页面' : '展开页面'} onClick=${(e) => { e.preventDefault(); toggleNav('notes'); }}><${Icon} name=${navOpen.notes ? 'down' : 'right'} size=${12} /></button>`}</a>
            ${r.path === 'notes' && r.view && navOpen.notes && !mini && html`<div class="nav-tree">
              ${[...s.notebooks].sort((a, b) => a.order - b.order).map((b) => html`<div key=${b.id}>
                <div class=${'pt-row nb-row ' + (navOpen['nb:' + b.id] === false ? 'closed' : '')} ...${dragProps('notebook', { id: b.id })} ...${dropProps(['page', 'notebook'], (d, { after }) => { if (d.id === b.id) return; if (s.notes.some((n) => n.id === d.id)) movePage(d.id, { nb: b.id, parent: null }); else update((dd) => { const list = dd.notebooks.sort((x, y) => x.order - y.order); const from = list.findIndex((x) => x.id === d.id); const [mv] = list.splice(from, 1); let to = list.findIndex((x) => x.id === b.id); if (after) to++; list.splice(to, 0, mv); list.forEach((x, i) => { x.order = i; }); }); }, { position: true })} onContextMenu=${(e) => ctxMenu(e, notebookMenu(b, s, async () => { const v = await askPrompt('本子名称', b.name, { title: '重命名本子' }); if (v && v.trim()) update((d) => { d.notebooks.find((x) => x.id === b.id).name = v.trim(); }); }), b.name)}>
                  <button class="pt-tg" onClick=${() => toggleNav('nb:' + b.id)}><${Icon} name=${navOpen['nb:' + b.id] === false ? 'right' : 'down'} size=${11} /></button>
                  <a class="pt-link" href="#/notes" onClick=${() => { try { localStorage.setItem('ytos.nb', b.id); } catch {} }}><i class="nb-dot" style=${`background:${b.color}`}></i><span class="pt-t">${b.name}</span></a>
                  <button class="pt-add" title="新建页面" onClick=${() => { const n = newNote({ nb: b.id }); go('notes/' + n.id); }}><${Icon} name="plus" size=${11} /></button>
                </div>
                ${navOpen['nb:' + b.id] !== false && html`<div class="nb-pages"><${PageTree} notes=${s.notes} nb=${b.id} activeId=${route.sub} open=${tree.open} toggle=${tree.toggle} onCreate=${(parent) => { const n = newNote({ parent }); if (parent) tree.openPath([parent]); go('notes/' + n.id); }} max=${200} openPath=${tree.openPath} /></div>`}
              </div>`)}
              <div class="tree-acts"><button class="pt-row flat new" onClick=${async () => { const v = await askPrompt('本子名称', '', { title: '新本子', placeholder: '比如：读书笔记' }); if (v && v.trim()) newNotebook(v.trim()); }}><span class="pt-ic"><${Icon} name="plus" size=${12} /></span><span class="pt-t">新本子</span></button><button class="tree-mini" title="全部展开" onClick=${() => tree.openPath(s.notes.map((n) => n.id))}>展开</button><button class="tree-mini" title="全部收起" onClick=${() => tree.closeAll()}>收起</button></div>
            </div>`}`;
        }); })()}
      </nav>
      ${s.settings.seal === false && html`<button class="side-ai" data-tip="汤圆" title="和汤圆聊聊（全屏）" onClick=${() => { setMenu(false); window.dispatchEvent(new CustomEvent('seal:open', { detail: { mode: 'full' } })); }}><span class="side-ai-ic"><${Icon} name="chat" size=${15} /></span><span class="nl">汤圆</span><kbd class="nl">⌘⇧K</kbd></button>`}
      <${MiniPomo} />
      <a class=${'side-user ' + (route.path === 'settings' ? 'active' : '')} href="#/settings" data-tip="设置" title="设置"><span class="side-avatar">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || 'R')[0]}</span><span class="flex1 nl"><b>${s.profile.name}</b><small>${s.settings.lastSync ? '已同步 ' + new Date(s.settings.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '本地存储'}</small></span><${Icon} name="settings" size=${15} class="su-gear nl" /></a>
    </aside>
    ${!mini && html`<${Splitter} varName="sidebar" min=${180} max=${420} class="sp-side" />`}
    <div class="main">
      <header class="topbar">
        <${IconBtn} class="ibtn hamb" icon="menu" title="菜单" onClick=${() => setMenu(true)} />
        <div class="ttl crumb-top">${curNote ? html`<a href="#/notes">笔记</a>${ancestors(s.notes, curNote).map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${noteTitle(curNote)}</b>` : route.path === 'notes' && route.sub && !curNote ? html`<a href="#/notes">笔记</a><span>/</span><b>${route.sub.startsWith('canvas') ? '画布' : { tasks: '行动', graph: '图谱', tags: '标签', files: '附件' }[route.sub] || '笔记'}</b>` : route.path === 'plan' ? html`<a href="#/plan">计划</a><span>/</span><b>${{ week: '周计划', day: '每日时间线', weektl: '周时间线', month: '月度目标' }[route.sub] || '周计划'}</b>` : html`<b>${active.name}</b>`}</div>
        <div class="sp"></div>
        <${IconBtn} class="ibtn" icon="search" title="搜索（⌘K）" onClick=${() => setSearch(true)} />
        <button class="theme-glass" onClick=${toggleTheme} title="切换主题"><${Icon} name="moon" class="is" size=${15} /><${Icon} name="sun" class="im" size=${15} /></button>
      </header>
      <main key=${route.path} class="fi"><${View} route=${route} /></main>
    </div>
    <${SearchPalette} open=${search} onClose=${() => setSearch(false)} />
    <${Capture} open=${cap} onClose=${() => setCap(false)} />
    <${Seal} key=${s.settings.seal === false ? 'ghost' : 'seal'} ghost=${s.settings.seal === false} />
    <nav class="tabbar">
      ${[['home', '总览', 'home', (r) => r.path === 'home'], ['todos', '待办', 'checksq', (r) => r.path === 'todos'], ['plan/day', '今天', 'sun', (r) => r.path === 'plan' && r.sub === 'day'], ['notes', '笔记', 'note', (r) => r.path === 'notes']].map(([h, n, ic, m]) => html`<a key=${h} href=${'#/' + h} class=${m(route) ? 'active' : ''}><${Icon} name=${ic} size=${20} /><span>${n}</span></a>`)}
      <button class="tab-cap" onClick=${capture} title="记一下（问汤圆）"><${Icon} name="plus" size=${22} /></button>
      <button onClick=${() => setMenu(true)}><${Icon} name="menu" size=${20} /><span>更多</span></button>
    </nav>
  </div>`;
}

seedIfEmpty();
// 本地数据载入失败 / 存不下：必须让人看见，不能悄悄丢
import('./store.js').then(({ loadError }) => { if (loadError) toast('本地数据没能读出来，已原样另存，本次不会写回。先导出或联系开发者排查：' + loadError.slice(0, 60), { sticky: true }); });
window.addEventListener('ytos:persist-error', (e) => toast(e.detail === 'quota' ? '浏览器本地存储已满，新的改动存不下！删掉几张粘贴的大图片，或先导出备份。' : '本地保存失败：' + e.detail, { sticky: true }));
(() => {
  // topbar: frosted once scrolled; slides away while scrolling down, comes back on the first scroll up or near the top
  let last = window.scrollY, hidden = false;
  const h = () => {
    const y = window.scrollY, dy = y - last; last = y;
    document.body.classList.toggle('scrolled', y > 6);
    const want = y > 120 && dy > 3 ? true : dy < -3 || y < 60 ? false : hidden;
    if (want !== hidden) { hidden = want; document.body.classList.toggle('tb-hide', hidden); }
  };
  window.addEventListener('scroll', h, { passive: true }); h();
  window.addEventListener('hashchange', () => { hidden = false; document.body.classList.remove('tb-hide'); });
  // nudging the mouse to the very top brings it back too
  window.addEventListener('pointermove', (e) => { if (hidden && e.clientY < 8) { hidden = false; document.body.classList.remove('tb-hide'); } }, { passive: true });
})();
setExtraKinds(get().settings.kinds); setTagOverrides(get().settings.tagColors);
subscribe(() => { setExtraKinds(get().settings.kinds); setTagOverrides(get().settings.tagColors); });
applySizes();
initLiquid();
detectLogin().then(async (login) => {
  // 换了账号（同一台电脑上另一个人登录）：先把上一个账号留在本机的数据备份起来，再从空白开始拉这个账号自己的云端数据，
  // 免得把上一个人的内容合并进新账号。第一次登录（本机还没记过账号）照常把本地数据带上去。
  if (login && login.user) {
    const id = login.user.email || 'gh:' + login.user.login; let prev = ''; try { prev = localStorage.getItem('ytos.account') || ''; } catch {}
    const migrating = prev.startsWith('gh:') && login.cloud && login.aiQuota === null; // 站长从 GitHub 登录换成邮箱登录：同一个人，数据照常带上去
    if (prev && prev !== id && !migrating) {
      try { const { kvSet } = await import('./files.js'); await kvSet('backup:' + prev, JSON.parse(JSON.stringify(get()))); await kvSet('sync-base', null); } catch {}
      const { replace, blank } = await import('./store.js'); const b = blank(); b.settings.seeded = true; replace(b);
      toast('换了账号：上一个账号在这台电脑上的数据已经备份在本机，现在显示的是 ' + (login.user.email || login.user.login) + ' 的数据');
    }
    try { localStorage.setItem('ytos.account', id); } catch {}
  }
  // 第一次登录、还没设过头像：直接用 GitHub 头像
  if (login && login.user && login.user.avatar && !get().profile.avatar) update((d) => { d.profile.avatar = login.user.avatar; });
  autoSync(subscribe);
});
render(html`<${App} />`, document.getElementById('app'));
