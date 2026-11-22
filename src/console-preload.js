/**
 * Pont de la fenêtre « Console » (F10). Elle peut seulement : relire le journal, envoyer une ligne de commande (le processus
 * principal décide de ce qu'elle fait : cf. console-main.js), copier du texte dans le presse-papiers et se ranger.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bsCon', {
  init: () => ipcRenderer.invoke('bs:con-init'),
  exec: line => ipcRenderer.invoke('bs:con-exec', String(line || '')),
  copy: text => ipcRenderer.invoke('bs:con-copy', String(text || '')),
  hide: () => ipcRenderer.invoke('bs:con-hide'),
  onLines: cb => ipcRenderer.on('bs:con-lines', (_e, l) => cb(l)),
  onStats: cb => ipcRenderer.on('bs:con-stats', (_e, s) => cb(s)),
  onCmds: cb => ipcRenderer.on('bs:con-cmds', (_e, c) => cb(c)),
  onClear: cb => ipcRenderer.on('bs:con-clear', () => cb()),
});
