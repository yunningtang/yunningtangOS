// Sealonote 桌面版
// 主窗口直接打开线上网站（www.sealonote.com），所以登录同一个账号就是同一份数据，网站更新了这里也跟着更新。
// 另外几种小窗口，打开的都是网站里没有侧栏的页面：
//  · 便签（#/sticky）：今天的焦点和安排 / 便利贴，可以置顶、调透明度
//  · 单张便利贴（#/sticky?note=<id>）：一页笔记贴在桌面上，可以开好几张，各自记位置和大小
//  · 汤圆（#/seal）：AI 对话单独一个窗口
// Windows / Linux 上所有窗口都没有系统标题栏：网页自己画标题栏和最小化 / 最大化 / 关闭按钮，和界面融在一起。
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');

const SITE = process.env.SEALONOTE_URL || 'https://www.sealonote.com';
const ORIGIN = new URL(SITE).origin;
const PARTITION = 'persist:sealonote';
const MAC = process.platform === 'darwin';
// 允许留在应用里打开的地址：网站本身 + 登录要经过的页面（Supabase / Google 登录）
const AUTH_HOSTS = [/\.supabase\.co$/, /^accounts\.google\.com$/, /^accounts\.youtube\.com$/, /(^|\.)google\.[a-z.]+$/];
const ICON = path.join(__dirname, 'icon.png');

// 汤圆是 3D 的（WebGL）：有些显卡在 Chromium 的黑名单里，默认会关掉 WebGL，汤圆就只剩一张平面图。打开它
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

let main = null, sticky = null, ai = null, tray = null, quitting = false;
const notes = new Map(); // noteId → BrowserWindow

// ---- 设置（窗口位置、便签是否置顶 / 是否开着、开机启动）----
const cfgFile = () => path.join(app.getPath('userData'), 'window-state.json');
let cfg = {};
function loadCfg() { try { cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { cfg = {}; } cfg.notes = cfg.notes || {}; }
let saveT = null;
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch {} }, 300); }
// 记下来的位置要还在某个屏幕上，不然（拔了外接屏）就用默认位置
function onScreen(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y >= w.y - 10 && b.y < w.y + w.height - 40);
}
function trackBounds(win, get, set) {
  const save = () => { if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) { set(win.getBounds()); saveCfg(); } };
  win.on('resize', save); win.on('move', save);
}
const keyed = (key) => [() => cfg[key], (b) => { cfg[key] = b; }];

function isAppUrl(u) { try { return new URL(u).origin === ORIGIN; } catch { return false; } }
function isAuthUrl(u) { try { const h = new URL(u).hostname; return AUTH_HOSTS.some((r) => r.test(h)); } catch { return false; } }

// 链接：网站内的留在窗口里；登录页留在窗口里；别的（外部链接、附件下载页）交给系统浏览器
function guard(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
      const m = hash.match(/^#\/sticky\?(?:.*&)?note=([\w-]+)/);
      if (m) showNote(m[1]); else if (/^#\/sticky/.test(hash)) showSticky(); else if (/^#\/seal/.test(hash)) showAI(); else showMain(hash);
      return { action: 'deny' };
    }
    if (isAuthUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, parent: win, modal: false, autoHideMenuBar: true, webPreferences: { partition: PARTITION } } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url) || isAuthUrl(url)) return;
    e.preventDefault(); if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });
  // 最大化 / 还原时告诉网页，换按钮图标
  const tell = () => { if (!wc.isDestroyed()) wc.send('win:max', win.isMaximized()); };
  win.on('maximize', tell); win.on('unmaximize', tell);
}

function webPrefs() {
  return { partition: PARTITION, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}
// 没有系统标题栏，但保留可以拖边缘改大小、Windows 的贴靠和圆角
const frameless = () => (MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { titleBarStyle: 'hidden' });
const bg = () => (cfg.dark ? '#16181d' : '#f7f7f5');

function offline(win, url) {
  const page = `<!doctype html><meta charset="utf-8"><title>Sealonote</title><body style="font:15px system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f6fa;color:#333;-webkit-app-region:drag"><div style="text-align:center"><p style="font-size:17px;font-weight:600">连不上 Sealonote</p><p style="color:#777">检查一下网络，连上以后点重试。</p><button onclick="location.href=${JSON.stringify(url || SITE + '/')}" style="-webkit-app-region:no-drag;font:inherit;padding:8px 18px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer">重试</button></div>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
}
function load(win, hash) {
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3) offline(win, url); });
  win.loadURL(SITE + '/' + (hash || ''));
}

/* ---------- 主窗口 ---------- */
function createMain() {
  const b = onScreen(cfg.main) ? cfg.main : { width: 1280, height: 820 };
  main = new BrowserWindow({ ...b, minWidth: 380, minHeight: 500, show: false, title: 'Sealonote', backgroundColor: bg(), icon: ICON, autoHideMenuBar: true, ...frameless(), webPreferences: webPrefs() });
  if (cfg.mainMax) main.maximize();
  trackBounds(main, ...keyed('main')); guard(main);
  main.on('maximize', () => { cfg.mainMax = true; saveCfg(); }); main.on('unmaximize', () => { cfg.mainMax = false; saveCfg(); });
  main.once('ready-to-show', () => main.show());
  // 关掉主窗口：还有便签 / 汤圆窗口开着就只是藏起来（托盘里能再打开）；都没开就退出（macOS 照惯例留在 Dock）
  main.on('close', (e) => {
    if (quitting) return;
    const others = [sticky, ai, ...notes.values()].some((w) => w && !w.isDestroyed() && w.isVisible());
    if (others || MAC) { e.preventDefault(); main.hide(); }
  });
  main.on('closed', () => { main = null; });
  load(main, '');
}
function showMain(hash) {
  if (!main || main.isDestroyed()) createMain();
  if (hash && /^#\//.test(hash)) main.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
}

/* ---------- 便签 ---------- */
function defaultStickyBounds() { const w = screen.getPrimaryDisplay().workArea; return { width: 320, height: 480, x: w.x + w.width - 340, y: w.y + 40 }; }
function smallWin(bounds, extra = {}) {
  return new BrowserWindow({
    ...bounds, minWidth: 220, minHeight: 160, frame: false, show: false, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, backgroundColor: bg(), roundedCorners: true, hasShadow: true, icon: ICON, webPreferences: webPrefs(), ...extra,
  });
}
function createSticky() {
  sticky = smallWin(onScreen(cfg.sticky) ? cfg.sticky : defaultStickyBounds(), { title: '便签 · Sealonote', minWidth: 260, minHeight: 220 });
  if (cfg.stickyPin !== false) sticky.setAlwaysOnTop(true, 'floating');
  if (cfg.stickyOpacity) sticky.setOpacity(cfg.stickyOpacity);
  sticky.setVisibleOnAllWorkspaces(!!cfg.stickyAllSpaces, { visibleOnFullScreen: false });
  trackBounds(sticky, ...keyed('sticky')); guard(sticky);
  sticky.once('ready-to-show', () => { if (cfg.stickyOpen !== false) sticky.showInactive(); });
  sticky.on('close', (e) => { if (!quitting) { e.preventDefault(); hideSticky(); } });
  sticky.on('closed', () => { sticky = null; });
  load(sticky, '#/sticky');
}
function showSticky() {
  cfg.stickyOpen = true; saveCfg();
  if (!sticky || sticky.isDestroyed()) { createSticky(); return; }
  sticky.show(); sticky.focus(); refreshTray();
}
function hideSticky() { if (sticky && !sticky.isDestroyed()) sticky.hide(); cfg.stickyOpen = false; saveCfg(); refreshTray(); }

/* ---------- 单张便利贴 ---------- */
function showNote(id) {
  if (!/^[\w-]{1,64}$/.test(id)) return;
  const old = notes.get(id); if (old && !old.isDestroyed()) { old.show(); old.focus(); return; }
  const n = cfg.notes[id] || {};
  const w = screen.getPrimaryDisplay().workArea; const k = notes.size;
  const b = onScreen(n.b) ? n.b : { width: 280, height: 300, x: w.x + w.width - 640 - k * 24, y: w.y + 60 + k * 24 };
  const win = smallWin(b, { title: '便利贴 · Sealonote', minWidth: 200, minHeight: 140 });
  if (n.pin !== false) win.setAlwaysOnTop(true, 'floating');
  if (n.op) win.setOpacity(n.op);
  trackBounds(win, () => (cfg.notes[id] || {}).b, (bb) => { cfg.notes[id] = { ...(cfg.notes[id] || {}), b: bb }; });
  guard(win);
  notes.set(id, win); cfg.notes[id] = { ...n, open: true }; saveCfg();
  win.once('ready-to-show', () => win.show());
  // 关掉这张：下次开机不再自动打开（位置大小还记着）
  win.on('close', () => { if (!quitting && cfg.notes[id]) { cfg.notes[id].open = false; saveCfg(); } });
  win.on('closed', () => { notes.delete(id); refreshTray(); });
  load(win, '#/sticky?note=' + id);
  refreshTray();
}
const noteOf = (e) => { for (const [id, w] of notes) if (w.webContents === e.sender) return id; return null; };

/* ---------- 汤圆（AI 对话）---------- */
function showAI() {
  if (ai && !ai.isDestroyed()) { if (ai.isMinimized()) ai.restore(); ai.show(); ai.focus(); return; }
  const w = screen.getPrimaryDisplay().workArea;
  const b = onScreen(cfg.ai) ? cfg.ai : { width: 560, height: Math.min(780, w.height - 80), x: w.x + Math.round((w.width - 560) / 2), y: w.y + 40 };
  ai = new BrowserWindow({ ...b, minWidth: 380, minHeight: 420, show: false, title: '汤圆 · Sealonote', backgroundColor: bg(), icon: ICON, autoHideMenuBar: true, ...frameless(), webPreferences: webPrefs() });
  if (cfg.aiPin) ai.setAlwaysOnTop(true, 'floating');
  trackBounds(ai, ...keyed('ai')); guard(ai);
  ai.once('ready-to-show', () => ai.show());
  ai.on('close', (e) => { if (!quitting) { e.preventDefault(); ai.hide(); refreshTray(); } });
  ai.on('closed', () => { ai = null; });
  load(ai, '#/seal');
  refreshTray();
}

function setPin(win, on) { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'floating'); }

function refreshTray() {
  if (!tray) return;
  const stickyShown = !!(sticky && !sticky.isDestroyed() && sticky.isVisible());
  const login = app.getLoginItemSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Sealonote', click: () => showMain() },
    { label: '汤圆（AI 对话）', click: () => showAI() },
    { label: stickyShown ? '收起便签' : '显示便签', click: () => (stickyShown ? hideSticky() : showSticky()) },
    { label: '便签置顶', type: 'checkbox', checked: cfg.stickyPin !== false, click: (i) => { cfg.stickyPin = i.checked; saveCfg(); setPin(sticky, i.checked); } },
    ...(MAC ? [{ label: '便签在所有桌面上都显示', type: 'checkbox', checked: !!cfg.stickyAllSpaces, click: (i) => { cfg.stickyAllSpaces = i.checked; saveCfg(); if (sticky && !sticky.isDestroyed()) sticky.setVisibleOnAllWorkspaces(i.checked); } }] : []),
    { type: 'separator' },
    { label: '开机时启动（只开便签）', type: 'checkbox', checked: !!login.openAtLogin, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--sticky-only'] }); refreshTray(); } },
    { label: '刷新', click: () => { [main, sticky, ai, ...notes.values()].forEach((w) => w && !w.isDestroyed() && w.webContents.reload()); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: MAC ? 18 : 16 }));
  tray.setToolTip('Sealonote');
  tray.on('click', () => { if (!MAC) showMain(); });
  refreshTray();
}

function appMenu() {
  if (!MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'togglefullscreen', label: '全屏' }, { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '实际大小' }] },
    { label: '窗口', submenu: [{ label: '汤圆（AI 对话）', accelerator: 'CmdOrCtrl+Shift+Y', click: () => showAI() }, { label: '显示 / 收起便签', accelerator: 'CmdOrCtrl+Shift+J', click: () => (sticky && sticky.isVisible() ? hideSticky() : showSticky()) }, { type: 'separator' }, { role: 'minimize' }, { role: 'close' }] },
  ]));
}

// ---- 启动 ----
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(() => {
    loadCfg();
    // Google 不让带「Electron」字样的浏览器登录：用和 Chrome 一样的 UA
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(ses.getUserAgent().replace(/\s*Electron\/[\d.]+/, '').replace(/\s*sealonote-desktop\/[\d.]+/, ''));
    // 网站要麦克风（语音输入）就给；别的权限一律不给
    ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(isAppUrl(details.requestingUrl || wc.getURL()) && ['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(perm)));

    const winOf = (e) => BrowserWindow.fromWebContents(e.sender);
    // 网页自己画的窗口按钮
    ipcMain.handle('win:min', (e) => { const w = winOf(e); if (w) w.minimize(); });
    ipcMain.handle('win:max', (e) => { const w = winOf(e); if (!w) return false; if (w.isMaximized()) w.unmaximize(); else w.maximize(); return w.isMaximized(); });
    ipcMain.handle('win:close', (e) => { const w = winOf(e); if (w) w.close(); });
    ipcMain.handle('win:isMax', (e) => { const w = winOf(e); return !!(w && w.isMaximized()); });
    ipcMain.handle('win:theme', (_e, dark) => { if (cfg.dark !== !!dark) { cfg.dark = !!dark; saveCfg(); } });
    // 便签窗口 / 单张便利贴：置顶、透明度（各窗口各记各的）
    ipcMain.handle('sticky:show', () => { showSticky(); });
    ipcMain.handle('sticky:hide', () => { hideSticky(); });
    ipcMain.handle('sticky:getPin', (e) => { const id = noteOf(e); return id ? (cfg.notes[id] || {}).pin !== false : cfg.stickyPin !== false; });
    ipcMain.handle('sticky:setPin', (e, on) => { const id = noteOf(e); if (id) { cfg.notes[id] = { ...(cfg.notes[id] || {}), pin: !!on }; } else cfg.stickyPin = !!on; saveCfg(); setPin(winOf(e), on); refreshTray(); return !!on; });
    ipcMain.handle('sticky:getOpacity', (e) => { const id = noteOf(e); return (id ? (cfg.notes[id] || {}).op : cfg.stickyOpacity) || 1; });
    ipcMain.handle('sticky:setOpacity', (e, v) => { const o = Math.max(0.3, Math.min(1, Number(v) || 1)); const id = noteOf(e); if (id) cfg.notes[id] = { ...(cfg.notes[id] || {}), op: o }; else cfg.stickyOpacity = o; saveCfg(); const w = winOf(e); if (w) w.setOpacity(o); return o; });
    ipcMain.handle('note:pop', (_e, id) => { showNote(String(id || '')); });
    ipcMain.handle('ai:show', () => { showAI(); });
    ipcMain.handle('ai:getPin', () => !!cfg.aiPin);
    ipcMain.handle('ai:setPin', (_e, on) => { cfg.aiPin = !!on; saveCfg(); setPin(ai, on); return !!on; });
    ipcMain.handle('main:open', (_e, hash) => { showMain(typeof hash === 'string' ? hash : ''); });
    ipcMain.handle('titlebar:set', () => {}); // 0.2 的网页还会调；现在按钮由网页自己画

    appMenu(); createTray();
    const stickyOnly = process.argv.includes('--sticky-only') || app.getLoginItemSettings().wasOpenedAtLogin;
    if (!stickyOnly) createMain();
    if (stickyOnly || cfg.stickyOpen !== false) createSticky();
    if (stickyOnly && cfg.stickyOpen === false) showSticky();
    Object.entries(cfg.notes).forEach(([id, n]) => { if (n && n.open) showNote(id); });
  });
  app.on('activate', () => showMain());
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!MAC) app.quit(); });
}
