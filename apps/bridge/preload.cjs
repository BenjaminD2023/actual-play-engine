'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getSettings: () => ipcRenderer.invoke('bridge:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('bridge:set-settings', settings),
});
