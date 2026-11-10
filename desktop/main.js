// Sealonote 桌面版
// 主窗口直接打开线上网站（www.sealonote.com），所以登录同一个账号就是同一份数据，网站更新了这里也跟着更新。
// 另外有一个「便签」窗口：无边框、小小的、可以置顶，打开的是网站的 #/sticky 页面。
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');

const SITE = process.env.SEALONOTE_URL || 'https://www.sealonote.com';
const ORIGIN = new URL(SITE).origin;
const PARTITION = 'persist:sealonote';
// 允许留在应用里打开的地址：网站本身 + 登录要经过的页面（Supabase / Google 登录）
const AUTH_HOSTS = [/\.supabase\.co$/, /^accounts\.google\.com$/, /^accounts\.youtube\.com$/, /(^|\.)google\.[a-z.]+$/];

let main = null, sticky = null, tray = null, quitting = false;
const TB_H = 40; // 标题栏按钮的高度（网页顶栏 52px，按钮放在上半部分）

// ---- 设置（窗口位置、便签是否置顶 / 是否开着、开机启动）----
const cfgFile = () => path.join(app.getPath('userData'), 'window-state.json');
let cfg = {};
function loadCfg() { try { cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { cfg = {}; } }
let saveT = null;
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch {} }, 300); }
// 记下来的位置要还在某个屏幕上，不然（拔了外接屏）就用默认位置
function onScreen(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y >= w.y - 10 && b.y < w.y + w.height - 40);
}
function trackBounds(win, key) {
  const save = () => { if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) { cfg[key] = win.getBounds(); saveCfg(); } };
  win.on('resize', save); win.on('move', save);
  if (key === 'main') { win.on('maximize', () => { cfg.mainMax = true; saveCfg(); }); win.on('unmaximize', () => { cfg.mainMax = false; saveCfg(); }); }
}

function isAppUrl(u) { try { return new URL(u).origin === ORIGIN; } catch { return false; } }
function isAuthUrl(u) { try { const h = new URL(u).hostname; return AUTH_HOSTS.some((r) => r.test(h)); } catch { return false; } }

// 链接：网站内的留在窗口里；登录页留在窗口里；别的（外部链接、附件下载页）交给系统浏览器
function guard(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url) && /#\/sticky/.test(url)) { showSticky(); return { action: 'deny' }; }
    if (isAppUrl(url)) { showMain(url.slice(url.indexOf('#')) || ''); return { action: 'deny' }; }
    if (isAuthUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, parent: win, modal: false, webPreferences: { partition: PARTITION } } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url) || isAuthUrl(url)) return;
    e.preventDefault(); if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });
}

function webPrefs() {
  return { partition: PARTITION, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}

function createMain() {
  const b = onScreen(cfg.main) ? cfg.main : { width: 1280, height: 820 };
  // Windows / Linux：去掉系统标题栏，网页顶栏当标题栏；右上角留系统的最小化 / 最大化 / 关闭，颜色由网页按主题传过来
  const chrome = process.platform === 'darwin' ? {} : { titleBarStyle: 'hidden', titleBarOverlay: { color: cfg.tbColor || '#f7f7f5', symbolColor: cfg.tbSymbol || '#5f5e5b', height: TB_H } };
  main = new BrowserWindow({ ...b, minWidth: 380, minHeight: 500, show: false, title: 'Sealonote', backgroundColor: cfg.tbColor || '#f7f7f5', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, ...chrome, webPreferences: webPrefs() });
  if (cfg.mainMax) main.maximize();
  trackBounds(main, 'main'); guard(main);
  main.once('ready-to-show', () => main.show());
  // 关掉主窗口：便签还开着就只是藏起来（托盘里能再打开）；便签也没开就退出（macOS 照惯例留在 Dock）
  main.on('close', (e) => {
    if (quitting) return;
    if ((sticky && !sticky.isDestroyed() && sticky.isVisible()) || process.platform === 'darwin') { e.preventDefault(); main.hide(); }
  });
  main.on('closed', () => { main = null; });
  main.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3) offline(main, url); });
  main.loadURL(SITE + '/');
}

function offline(win, url) {
  const page = `<!doctype html><meta charset="utf-8"><title>Sealonote</title><body style="font:15px system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f6fa;color:#333"><div style="text-align:center"><p style="font-size:17px;font-weight:600">连不上 Sealonote</p><p style="color:#777">检查一下网络，连上以后点重试。</p><button onclick="location.href=${JSON.stringify(url || SITE + '/')}" style="font:inherit;padding:8px 18px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer">重试</button></div>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
}

function showMain(hash) {
  if (!main || main.isDestroyed()) createMain();
  if (hash && /^#\//.test(hash)) main.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
}

function defaultStickyBounds() {
  const w = screen.getPrimaryDisplay().workArea;
  return { width: 320, height: 480, x: w.x + w.width - 340, y: w.y + 40 };
}
function createSticky() {
  const b = onScreen(cfg.sticky) ? cfg.sticky : defaultStickyBounds();
  sticky = new BrowserWindow({
    ...b, minWidth: 260, minHeight: 220, frame: false, show: false, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: cfg.stickyPin !== false, title: '便签 · Sealonote', backgroundColor: '#ffffff',
    roundedCorners: true, hasShadow: true, icon: path.join(__dirname, 'icon.png'), webPreferences: webPrefs(),
  });
  if (cfg.stickyPin !== false) sticky.setAlwaysOnTop(true, 'floating');
  if (cfg.stickyOpacity) sticky.setOpacity(cfg.stickyOpacity);
  sticky.setVisibleOnAllWorkspaces(!!cfg.stickyAllSpaces, { visibleOnFullScreen: false });
  trackBounds(sticky, 'sticky'); guard(sticky);
  sticky.once('ready-to-show', () => { if (cfg.stickyOpen !== false) sticky.showInactive(); });
  sticky.on('close', (e) => { if (!quitting) { e.preventDefault(); hideSticky(); } });
  sticky.on('closed', () => { sticky = null; });
  sticky.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3) offline(sticky, url); });
  sticky.loadURL(SITE + '/#/sticky');
}
function showSticky() {
  if (!sticky || sticky.isDestroyed()) { cfg.stickyOpen = true; saveCfg(); createSticky(); return; }
  sticky.show(); sticky.focus(); cfg.stickyOpen = true; saveCfg(); refreshTray();
}
function hideSticky() { if (sticky && !sticky.isDestroyed()) sticky.hide(); cfg.stickyOpen = false; saveCfg(); refreshTray(); }
function setPin(on) {
  cfg.stickyPin = !!on; saveCfg();
  if (sticky && !sticky.isDestroyed()) sticky.setAlwaysOnTop(!!on, 'floating');
  refreshTray(); return !!on;
}

function refreshTray() {
  if (!tray) return;
  const stickyShown = !!(sticky && !sticky.isDestroyed() && sticky.isVisible());
  const login = app.getLoginItemSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Sealonote', click: () => showMain() },
    { label: stickyShown ? '收起便签' : '显示便签', click: () => (stickyShown ? hideSticky() : showSticky()) },
    { label: '便签置顶', type: 'checkbox', checked: cfg.stickyPin !== false, click: (i) => setPin(i.checked) },
    ...(process.platform === 'darwin' ? [{ label: '便签在所有桌面上都显示', type: 'checkbox', checked: !!cfg.stickyAllSpaces, click: (i) => { cfg.stickyAllSpaces = i.checked; saveCfg(); if (sticky && !sticky.isDestroyed()) sticky.setVisibleOnAllWorkspaces(i.checked); } }] : []),
    { type: 'separator' },
    { label: '开机时启动（只开便签）', type: 'checkbox', checked: !!login.openAtLogin, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--sticky-only'] }); refreshTray(); } },
    { label: '刷新', click: () => { [main, sticky].forEach((w) => w && !w.isDestroyed() && w.webContents.reload()); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: process.platform === 'darwin' ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Sealonote');
  tray.on('click', () => { if (process.platform !== 'darwin') showMain(); });
  refreshTray();
}

function appMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'togglefullscreen', label: '全屏' }, { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '实际大小' }] },
    { label: '便签', submenu: [{ label: '显示 / 收起便签', accelerator: 'CmdOrCtrl+Shift+J', click: () => (sticky && sticky.isVisible() ? hideSticky() : showSticky()) }] },
    { role: 'windowMenu' },
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

    ipcMain.handle('sticky:show', () => { showSticky(); });
    ipcMain.handle('sticky:hide', () => { hideSticky(); });
    ipcMain.handle('sticky:getPin', () => cfg.stickyPin !== false);
    ipcMain.handle('sticky:setPin', (_e, on) => setPin(on));
    ipcMain.handle('sticky:getOpacity', () => cfg.stickyOpacity || 1);
    ipcMain.handle('sticky:setOpacity', (_e, v) => { const o = Math.max(0.3, Math.min(1, Number(v) || 1)); cfg.stickyOpacity = o; saveCfg(); if (sticky && !sticky.isDestroyed()) sticky.setOpacity(o); return o; });
    ipcMain.handle('titlebar:set', (e, c) => {
      const win = BrowserWindow.fromWebContents(e.sender); if (!win || win !== main || process.platform === 'darwin' || !c) return;
      const ok = (x) => typeof x === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(x.trim());
      if (!ok(c.color) || !ok(c.symbolColor)) return;
      // 半透明的颜色放到系统按钮上会发灰：去掉透明度
      const solid = (x) => x.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/, 'rgb($1,$2,$3)');
      cfg.tbColor = solid(c.color); cfg.tbSymbol = solid(c.symbolColor); saveCfg();
      try { win.setTitleBarOverlay({ color: cfg.tbColor, symbolColor: cfg.tbSymbol, height: TB_H }); win.setBackgroundColor(cfg.tbColor); } catch {}
    });
    ipcMain.handle('main:open', (_e, hash) => { showMain(typeof hash === 'string' ? hash : ''); });

    appMenu(); createTray();
    const stickyOnly = process.argv.includes('--sticky-only') || app.getLoginItemSettings().wasOpenedAtLogin;
    if (!stickyOnly) createMain();
    if (stickyOnly || cfg.stickyOpen !== false) createSticky();
    if (stickyOnly && cfg.stickyOpen === false) showSticky();
  });
  app.on('activate', () => showMain());
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
