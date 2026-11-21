/**
 * Pont de la fenêtre « Big Street Studio ». Elle ne peut que : lister, relire et supprimer les records du dossier
 * Studio, enregistrer le projet de cinématique d'un record, y déposer une vidéo exportée, demander qui est connecté (pseudo, VIP,
 * skins possédés) et parler à l'assistant IA — le jeton de session reste dans le processus principal ; quand l'assistant sert, le
 * record ouvert est envoyé une fois au site avec son identifiant (studio-upload.js, cf. TRANSPARENCE.md). Les noms de fichiers
 * sont vérifiés par le processus principal (src/studio-main.js) : rien d'autre sur le disque n'est accessible.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bsStudio', {
  info: () => ipcRenderer.invoke('bs:studio-info'),
  list: () => ipcRenderer.invoke('bs:studio-list'),
  remove: name => ipcRenderer.invoke('bs:studio-delete', name),
  reveal: name => ipcRenderer.invoke('bs:studio-reveal', name),
  openFolder: () => ipcRenderer.invoke('bs:rec-folder'),
  loadProject: name => ipcRenderer.invoke('bs:studio-project-load', name),
  saveProject: (name, json) => ipcRenderer.invoke('bs:studio-project-save', name, json),
  exportStart: name => ipcRenderer.invoke('bs:studio-export-start', name),
  exportChunk: bytes => ipcRenderer.send('bs:studio-export-chunk', bytes),
  exportEnd: () => ipcRenderer.invoke('bs:studio-export-end'),
  // (page « Exporter » : un nom de fichier, jamais un chemin ; octets écrits à une position — cf. studio-export-main.js)
  xport: {
    info: () => ipcRenderer.invoke('bs:studio-xport-info'),
    pick: (name, ext) => ipcRenderer.invoke('bs:studio-xport-pick', name, ext),
    open: o => ipcRenderer.invoke('bs:studio-xport-open', o),
    write: (pos, bytes) => ipcRenderer.send('bs:studio-xport-write', pos, bytes),
    finish: (cancel, reveal) => ipcRenderer.invoke('bs:studio-xport-finish', !!cancel, reveal !== false),
    reveal: () => ipcRenderer.invoke('bs:studio-xport-reveal'),
  },
  // (le record ouvert : l'assistant IA l'envoie une fois au site, avec son identifiant — cf. studio-upload.js)
  current: name => ipcRenderer.invoke('bs:studio-current', name || null),
  account: () => ipcRenderer.invoke('bs:studio-account'),
  ai: body => ipcRenderer.invoke('bs:studio-ai', body),
  openShop: () => ipcRenderer.invoke('bs:studio-shop'),
  onChanged: cb => ipcRenderer.on('bs:studio-changed', () => cb()),
});
