import {contextBridge, ipcRenderer} from 'electron';
import type {API, AppEvent} from '../shared/types';

const api: API = {
  state: () => ipcRenderer.invoke('fp:state'),
  create: brief => ipcRenderer.invoke('fp:create', brief),
  open: () => ipcRenderer.invoke('fp:open'),
  save: brief => ipcRenderer.invoke('fp:save', brief),
  importAsset: (kind, note, relevant) => ipcRenderer.invoke('fp:import', kind, note, relevant),
  send: text => ipcRenderer.invoke('fp:send', text),
  stop: () => ipcRenderer.invoke('fp:stop'),
  resetSession: () => ipcRenderer.invoke('fp:reset'),
  preview: () => ipcRenderer.invoke('fp:preview'),
  install: () => ipcRenderer.invoke('fp:install'),
  render: () => ipcRenderer.invoke('fp:render'),
  reveal: () => ipcRenderer.invoke('fp:reveal'),
  settings: settings => ipcRenderer.invoke('fp:settings', settings),
  check: () => ipcRenderer.invoke('fp:check'),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, event: AppEvent) => callback(event);
    ipcRenderer.on('fp:event', listener);
    return () => ipcRenderer.removeListener('fp:event', listener);
  }
};
contextBridge.exposeInMainWorld('framepilot', api);
