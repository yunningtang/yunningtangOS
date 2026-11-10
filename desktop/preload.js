// 只给网页开几扇小门：窗口按钮、开关便签和汤圆窗口、置顶、透明度、回到主窗口。网页拿不到 Node，也拿不到文件系统。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sealonote', {
  desktop: true,
  version: 3,
  platform: process.platform,
  // 网页自己画的最小化 / 最大化 / 关闭
  win: {
    minimize: () => ipcRenderer.invoke('win:min'),
    toggleMax: () => ipcRenderer.invoke('win:max'),
    close: () => ipcRenderer.invoke('win:close'),
    isMax: () => ipcRenderer.invoke('win:isMax'),
    onMax: (cb) => { const h = (_e, v) => cb(!!v); ipcRenderer.on('win:max', h); return () => ipcRenderer.removeListener('win:max', h); },
    setDark: (dark) => ipcRenderer.invoke('win:theme', !!dark),
  },
  showSticky: () => ipcRenderer.invoke('sticky:show'),
  hideSticky: () => ipcRenderer.invoke('sticky:hide'),
  getPin: () => ipcRenderer.invoke('sticky:getPin'),
  setPin: (on) => ipcRenderer.invoke('sticky:setPin', !!on),
  getOpacity: () => ipcRenderer.invoke('sticky:getOpacity'),
  setOpacity: (v) => ipcRenderer.invoke('sticky:setOpacity', Number(v)),
  popNote: (id, at) => ipcRenderer.invoke('note:pop', String(id || ''), at && { x: Number(at.x), y: Number(at.y) }),
  showAI: () => ipcRenderer.invoke('ai:show'),
  getAIPin: () => ipcRenderer.invoke('ai:getPin'),
  setAIPin: (on) => ipcRenderer.invoke('ai:setPin', !!on),
  setTitleBar: () => Promise.resolve(),
  openMain: (hash) => ipcRenderer.invoke('main:open', String(hash || '')),
});
