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
import { go, toast } from './nav.js';
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

  return html`<div class="shell">
    ${menu && html`<div class="side-bg" onClick=${() => setMenu(false)}></div>`}
    <aside class=${'side ' + (menu ? 'open' : '')}>
      <a class="brand" href="#/home"><span class="logo"><${Icon} name="compass" size=${18} /></span><span><b>yunningtang OS</b><small>个人操作系统 · ${weekKey(todayStr())}</small></span></a>
      <nav class="nav">
        ${ROUTES.map((r) => r.sep !== undefined
          ? html`<div class="sep">${r.sep}</div>`
          : html`<a href=${'#/' + r.path} class=${route.path === r.path ? 'active' : ''}><${Icon} name=${r.icon} size=${16} />${r.name}${r.count && r.count(s) > 0 && html`<span class="cnt">${r.count(s)}</span>`}</a>`)}
      </nav>
      <div class="side-foot"><b>${s.profile.motto}</b><br/>${s.settings.lastSync ? '上次同步 ' + new Date(s.settings.lastSync).toLocaleString('zh-CN', { hour12: false }) : '本地存储 · 可在设置中同步到 GitHub'}</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <${IconBtn} class="ibtn hamb" icon="menu" title="菜单" onClick=${() => setMenu(true)} />
        <div class="ttl"><b>${active.name}</b></div>
        <div class="sp"></div>
        <div class="searchbox" onClick=${() => setSearch(true)}><${Icon} name="search" size=${14} /><span>搜索待办、笔记、书、链接…</span><kbd>⌘K</kbd></div>
        <button class="theme-glass" onClick=${toggleTheme} title="切换主题"><${Icon} name="moon" class="im" size=${15} /><${Icon} name="sun" class="is" size=${15} /></button>
      </header>
      <main key=${route.path} class="fi"><${View} route=${route} /></main>
    </div>
    <${SearchPalette} open=${search} onClose=${() => setSearch(false)} />
  </div>`;
}

seedIfEmpty();
render(html`<${App} />`, document.getElementById('app'));
