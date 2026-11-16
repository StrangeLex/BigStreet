/**
 * Pont de l'interface du launcher. L'interface n'a aucun accès direct au
 * système, au réseau ou aux fichiers : elle ne peut appeler que ces fonctions.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bs', {
  minimize: () => ipcRenderer.invoke('bs:minimize'),
  close: () => ipcRenderer.invoke('bs:close'),

  login: (name, password) => ipcRenderer.invoke('bs:login', { name, password }),
  logout: () => ipcRenderer.invoke('bs:logout'),
  currentAccount: () => ipcRenderer.invoke('bs:account'),
  play: () => ipcRenderer.invoke('bs:play'),

  notes: () => ipcRenderer.invoke('bs:notes'),
  settings: () => ipcRenderer.invoke('bs:settings'),
  saveSettings: s => ipcRenderer.invoke('bs:save-settings', s),
});
