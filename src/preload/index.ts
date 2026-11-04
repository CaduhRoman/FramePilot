import {contextBridge, ipcRenderer, webUtils} from 'electron';
import type {API, AppEvent} from '../shared/types';

const api: API = {
  state: () => ipcRenderer.invoke('fp:state'),
  create: brief => ipcRenderer.invoke('fp:create', brief),
  open: root => ipcRenderer.invoke('fp:open', root),
  close: () => ipcRenderer.invoke('fp:close'),
  showLibrary: () => ipcRenderer.invoke('fp:library'),
  save: brief => ipcRenderer.invoke('fp:save', brief),
  importAsset: (kind, note) => ipcRenderer.invoke('fp:import', kind, note),
  pickFiles: () => ipcRenderer.invoke('fp:pickFiles'),
  importFiles: (kind, note, paths) => ipcRenderer.invoke('fp:importFiles', kind, note, paths),
  pathForFile: file => webUtils.getPathForFile(file),
  queueAsset: (id, pending) => ipcRenderer.invoke('fp:queueAsset', id, pending),
  essentialAsset: (id, essential) => ipcRenderer.invoke('fp:essentialAsset', id, essential),
  updateAsset: (id, patch) => ipcRenderer.invoke('fp:updateAsset', id, patch),
  removeAsset: id => ipcRenderer.invoke('fp:removeAsset', id),
  moveAsset: (id, delta) => ipcRenderer.invoke('fp:moveAsset', id, delta),
  assetDuration: (id, duration) => ipcRenderer.invoke('fp:assetDuration', id, duration),
  send: text => ipcRenderer.invoke('fp:send', text),
  stop: () => ipcRenderer.invoke('fp:stop'),
  resetSession: () => ipcRenderer.invoke('fp:reset'),
  preview: () => ipcRenderer.invoke('fp:preview'),
  install: () => ipcRenderer.invoke('fp:install'),
  render: () => ipcRenderer.invoke('fp:render'),
  reveal: () => ipcRenderer.invoke('fp:reveal'),
  openRender: () => ipcRenderer.invoke('fp:openRender'),
  settings: settings => ipcRenderer.invoke('fp:settings', settings),
  claudePreference: (model, effort) => ipcRenderer.invoke('fp:claudePreference', model, effort),
  claudeOptions: () => ipcRenderer.invoke('fp:claudeOptions'),
  check: () => ipcRenderer.invoke('fp:check'),
  ptyStart: (cols, rows) => ipcRenderer.invoke('fp:ptyStart', cols, rows),
  ptyWrite: data => ipcRenderer.invoke('fp:ptyWrite', data),
  ptyResize: (cols, rows) => ipcRenderer.invoke('fp:ptyResize', cols, rows),
  ptyRestart: () => ipcRenderer.invoke('fp:ptyRestart'),
  commandOutput: id => ipcRenderer.invoke('fp:commandOutput', id),
  stopCommand: id => ipcRenderer.invoke('fp:stopCommand', id),
  clearCommands: () => ipcRenderer.invoke('fp:clearCommands'),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, event: AppEvent) => callback(event);
    ipcRenderer.on('fp:event', listener);
    return () => ipcRenderer.removeListener('fp:event', listener);
  }
};
contextBridge.exposeInMainWorld('framepilot', api);
