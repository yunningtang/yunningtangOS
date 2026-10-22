import { html, render, useEffect, useState, useMemo } from '../vendor/preact.js';
import { useStore, update, get } from './store.js';
import { Icon, IconBtn, Modal } from './ui.js';
import { todayStr, weekKey } from './util.js';
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
import { SearchPalette } from './search.js';
import { PageTree, useTreeState, newNote, newNotebook, ancestors, noteTitle, notebookMenu } from './views/notes.js';
import { go, toast } from './nav.js';
import { initLiquid } from './liquid.js';
import { ctxMenu } from './ctx.js';
import { detectLogin, autoSync } from './sync.js';
import { subscribe } from './store.js';
export { go, toast };

export const ROUTES = [
  { path: 'home', name: '总览', icon: 'home', view: Dashboard },
  { sep: '每一天' },
  { path: 'todos', name: '待办', icon: 'checksq', view: Todos, count: (s) => s.todos.filter((t) => !t.done).length },
  { path: 'plan', name: '计划', icon: 'calendar', view: Planner },
  { sep: '输入与输出' },
  { path: 'reading', name: '阅读', icon: 'book', view: Reading, count: (s) => s.books.filter((b) => b.status === 'reading').length },
  { path: 'links', name: '收藏', icon: 'link', view: Links },
  { path: 'notes', name: '笔记', icon: 'note', view: Notes },
  { sep: '远方' },
  { path: 'vision', name: '愿景', icon: 'sparkle', view: Vision },
  { path: 'explore', name: '探索', icon: 'globe', view: Explore },
  { sep: '' },
  { path: 'settings', name: '设置', icon: 'settings', view: Settings },
];

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, ...rest] = h.split('/');
  const [sub, q] = rest.join('/').split('?');
  return { path: path || 'home', sub: sub || '', query: Object.fromEntries(new URLSearchParams(q || '')) };
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

export function applyTheme(t) {
  const real = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = real;
}

function App() {
  const s = useStore();
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const tree = useTreeState();
  const [navOpen, setNavOpen] = useState(() => { try { return { notes: true, ...JSON.parse(localStorage.getItem('ytos.nav') || '{}') }; } catch { return { notes: true }; } });
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('ytos.side') === 'mini'; } catch { return false; } });
  const toggleMini = () => setMini((m) => { try { localStorage.setItem('ytos.side', m ? 'full' : 'mini'); } catch {} return !m; });
  const toggleNav = (k) => setNavOpen((o) => { const n = { ...o, [k]: o[k] === false }; try { localStorage.setItem('ytos.nav', JSON.stringify(n)); } catch {} return n; });
  const curNote = route.path === 'notes' ? s.notes.find((n) => n.id === route.sub) : null;
  const active = ROUTES.find((r) => r.path === route.path) || ROUTES[0];
  const View = active.view;

  useEffect(() => {
    applyTheme(s.settings.theme);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => s.settings.theme === 'auto' && applyTheme('auto');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [s.settings.theme]);

  useEffect(() => {
    const h = (e) => {
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
          if (section && navOpen['s:' + section] === false && !mini) return null;
          return html`<a href=${'#/' + r.path} class=${route.path === r.path ? 'active' : ''} data-tip=${r.name} onContextMenu=${(e) => ctxMenu(e, [{ label: '在新标签页打开', icon: 'external', onClick: () => window.open('#/' + r.path, '_blank') }, { label: mini ? '展开侧栏' : '收起侧栏', icon: mini ? 'right' : 'left', onClick: toggleMini }, r.path === 'notes' && { label: navOpen.notes ? '收起页面树' : '展开页面树', icon: 'layers', onClick: () => toggleNav('notes') }], r.name)}><${Icon} name=${r.icon} size=${16} /><span class="nl">${r.name}</span>${r.count && r.count(s) > 0 && html`<span class="cnt">${r.count(s)}</span>`}${r.path === 'notes' && html`<button class="nav-tg" title=${navOpen.notes ? '收起页面' : '展开页面'} onClick=${(e) => { e.preventDefault(); toggleNav('notes'); }}><${Icon} name=${navOpen.notes ? 'down' : 'right'} size=${12} /></button>`}</a>
            ${r.path === 'notes' && navOpen.notes && !mini && html`<div class="nav-tree">
              ${[...s.notebooks].sort((a, b) => a.order - b.order).map((b) => html`<div key=${b.id}>
                <div class=${'pt-row nb-row ' + (navOpen['nb:' + b.id] === false ? 'closed' : '')} onContextMenu=${(e) => ctxMenu(e, notebookMenu(b, s, () => { const v = prompt('本子名称', b.name); if (v && v.trim()) update((d) => { d.notebooks.find((x) => x.id === b.id).name = v.trim(); }); }), b.name)}>
                  <button class="pt-tg" onClick=${() => toggleNav('nb:' + b.id)}><${Icon} name=${navOpen['nb:' + b.id] === false ? 'right' : 'down'} size=${11} /></button>
                  <a class="pt-link" href="#/notes" onClick=${() => { try { localStorage.setItem('ytos.nb', b.id); } catch {} }}><i class="nb-dot" style=${`background:${b.color}`}></i><span class="pt-t">${b.name}</span></a>
                  <button class="pt-add" title="新建页面" onClick=${() => { const n = newNote({ nb: b.id }); go('notes/' + n.id); }}><${Icon} name="plus" size=${11} /></button>
                </div>
                ${navOpen['nb:' + b.id] !== false && html`<div class="nb-pages"><${PageTree} notes=${s.notes} nb=${b.id} activeId=${route.sub} open=${tree.open} toggle=${tree.toggle} onCreate=${(parent) => { const n = newNote({ parent }); if (parent) tree.openPath([parent]); go('notes/' + n.id); }} max=${200} openPath=${tree.openPath} /></div>`}
              </div>`)}
              <div class="tree-acts"><button class="pt-row flat new" onClick=${() => { const nb = newNotebook(); const v = prompt('本子名称', '新本子'); if (v && v.trim()) update((d) => { d.notebooks.find((x) => x.id === nb.id).name = v.trim(); }); }}><span class="pt-ic"><${Icon} name="plus" size=${12} /></span><span class="pt-t">新本子</span></button><button class="tree-mini" title="全部展开" onClick=${() => tree.openPath(s.notes.map((n) => n.id))}>展开</button><button class="tree-mini" title="全部收起" onClick=${() => tree.closeAll()}>收起</button></div>
            </div>`}`;
        }); })()}
      </nav>
      <a class="side-user" href="#/settings" data-tip=${s.profile.name}><span class="side-avatar">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || 'R')[0]}</span><span class="flex1 nl"><b>${s.profile.name}</b><small>${s.settings.lastSync ? '已同步 ' + new Date(s.settings.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '本地存储'}</small></span></a>
    </aside>
    <div class="main">
      <header class="topbar">
        <${IconBtn} class="ibtn hamb" icon="menu" title="菜单" onClick=${() => setMenu(true)} />
        <div class="ttl crumb-top">${curNote ? html`<a href="#/notes">笔记</a>${ancestors(s.notes, curNote).map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${noteTitle(curNote)}</b>` : route.path === 'plan' ? html`<a href="#/plan">计划</a><span>/</span><b>${{ week: '周计划', day: '每日时间线', month: '月度目标' }[route.sub] || '周计划'}</b>` : html`<b>${active.name}</b>`}</div>
        <div class="sp"></div>
        <div class="searchbox" onClick=${() => setSearch(true)}><${Icon} name="search" size=${14} /><span>搜索</span><kbd>⌘K</kbd></div>
        <button class="theme-glass" onClick=${toggleTheme} title="切换主题"><${Icon} name="moon" class="is" size=${15} /><${Icon} name="sun" class="im" size=${15} /></button>
      </header>
      <main key=${route.path} class="fi"><${View} route=${route} /></main>
    </div>
    <${SearchPalette} open=${search} onClose=${() => setSearch(false)} />
  </div>`;
}

seedIfEmpty();
initLiquid();
detectLogin().then(() => autoSync(subscribe));
render(html`<${App} />`, document.getElementById('app'));
