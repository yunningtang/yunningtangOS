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
import { PageTree, useTreeState, newNote, ancestors, noteTitle } from './views/notes.js';
import { go, toast } from './nav.js';
import { initLiquid } from './liquid.js';
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
  const [navOpen, setNavOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('ytos.nav') || '{"notes":true}'); } catch { return { notes: true }; } });
  const toggleNav = (k) => setNavOpen((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem('ytos.nav', JSON.stringify(n)); } catch {} return n; });
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

  return html`<div class="shell">
    ${menu && html`<div class="side-bg" onClick=${() => setMenu(false)}></div>`}
    <aside class=${'side ' + (menu ? 'open' : '')}>
      <a class="brand" href="#/home"><b>yunningtang OS</b><small>${weekKey(todayStr())}</small></a>
      <nav class="nav" data-liquid=".nav > a, .pt-row"><span class="liq"></span>
        ${ROUTES.map((r) => r.sep !== undefined
          ? html`<div class="sep">${r.sep}</div>`
          : html`<a href=${'#/' + r.path} class=${route.path === r.path ? 'active' : ''}>${r.name}${r.count && r.count(s) > 0 && html`<span class="cnt">${r.count(s)}</span>`}${r.path === 'notes' && html`<button class="nav-tg" title="展开页面" onClick=${(e) => { e.preventDefault(); toggleNav('notes'); }}><${Icon} name=${navOpen.notes ? 'down' : 'right'} size=${12} /></button>`}</a>
            ${r.path === 'notes' && navOpen.notes && html`<div class="nav-tree"><${PageTree} notes=${s.notes} activeId=${route.sub} open=${tree.open} toggle=${tree.toggle} onCreate=${(parent) => { const n = newNote({ parent }); if (parent) tree.openPath([parent]); go('notes/' + n.id); }} max=${12} /><button class="pt-row flat new" onClick=${() => { const n = newNote(); go('notes/' + n.id); }}><span class="pt-ic"><${Icon} name="plus" size=${12} /></span><span class="pt-t">新页面</span></button></div>`}`)}
      </nav>
      <div class="side-foot"><b>${s.profile.motto}</b><br/>${s.settings.lastSync ? '上次同步 ' + new Date(s.settings.lastSync).toLocaleString('zh-CN', { hour12: false }) : '本地存储 · 可在设置中同步到 GitHub'}</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <${IconBtn} class="ibtn hamb" icon="menu" title="菜单" onClick=${() => setMenu(true)} />
        <div class="ttl crumb-top">${curNote ? html`<a href="#/notes">笔记</a>${ancestors(s.notes, curNote).map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${noteTitle(curNote)}</b>` : route.path === 'plan' ? html`<a href="#/plan">计划</a><span>/</span><b>${{ week: '周计划', day: '每日时间线', month: '月度目标' }[route.sub] || '周计划'}</b>` : html`<b>${active.name}</b>`}</div>
        <div class="sp"></div>
        <div class="searchbox" onClick=${() => setSearch(true)}><span>搜索</span><kbd>⌘K</kbd></div>
        <button class="theme-glass" onClick=${toggleTheme} title="切换主题"><span class="im">亮</span><span class="is">暗</span></button>
      </header>
      <main key=${route.path} class="fi"><${View} route=${route} /></main>
    </div>
    <${SearchPalette} open=${search} onClose=${() => setSearch(false)} />
  </div>`;
}

seedIfEmpty();
initLiquid();
render(html`<${App} />`, document.getElementById('app'));
