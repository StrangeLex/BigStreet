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

  registerMode: () => ipcRenderer.invoke('bs:register-mode'),
  registerCode: (email, name) => ipcRenderer.invoke('bs:register-code', { email, name }),
  register: form => ipcRenderer.invoke('bs:register', form),

  // Connexion sans mot de passe (code reçu par e-mail)
  loginCode: email => ipcRenderer.invoke('bs:login-code', email),
  loginEmail: (email, code) => ipcRenderer.invoke('bs:login-email', { email, code }),

  // Google / Twitch : l'autorisation s'ouvre dans le navigateur, le site rend
  // la main au launcher, et le résultat arrive par onAuth().
  oauthAvailable: () => ipcRenderer.invoke('bs:oauth-available'),
  oauth: provider => ipcRenderer.invoke('bs:oauth', provider),
  oauthFinish: form => ipcRenderer.invoke('bs:oauth-finish', form),
  onAuth: cb => ipcRenderer.on('bs:auth', (_e, payload) => cb(payload)),

  currentAccount: () => ipcRenderer.invoke('bs:account'),
  play: () => ipcRenderer.invoke('bs:play'),

  notes: () => ipcRenderer.invoke('bs:notes'),
  settings: () => ipcRenderer.invoke('bs:settings'),
  saveSettings: s => ipcRenderer.invoke('bs:save-settings', s),
  version: () => ipcRenderer.invoke('bs:version'),
  uninstall: () => ipcRenderer.invoke('bs:uninstall'),
});
