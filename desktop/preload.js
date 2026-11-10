// 只给网页开几扇小门：开关便签、置顶、回到主窗口。网页拿不到 Node，也拿不到文件系统。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sealonote', {
  desktop: true,
  showSticky: () => ipcRenderer.invoke('sticky:show'),
  hideSticky: () => ipcRenderer.invoke('sticky:hide'),
  getPin: () => ipcRenderer.invoke('sticky:getPin'),
  setPin: (on) => ipcRenderer.invoke('sticky:setPin', !!on),
  getOpacity: () => ipcRenderer.invoke('sticky:getOpacity'),
  setOpacity: (v) => ipcRenderer.invoke('sticky:setOpacity', Number(v)),
  setTitleBar: (c) => ipcRenderer.invoke('titlebar:set', { color: String((c && c.color) || ''), symbolColor: String((c && c.symbolColor) || '') }),
  openMain: (hash) => ipcRenderer.invoke('main:open', String(hash || '')),
});
