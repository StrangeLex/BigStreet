/**
 * Pont de l'interface du launcher. L'interface n'a aucun accès direct au
 * système, au réseau ou aux fichiers : elle ne peut appeler que ces fonctions.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bs', {
  minimize: () => ipcRenderer.invoke('bs:minimize'),
  close: () => ipcRenderer.invoke('bs:close'),
  uiReady: () => ipcRenderer.invoke('bs:ui-ready'),

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
  // Installation des ressources du jeu
  installInfo: () => ipcRenderer.invoke('bs:install-info'),
  pickDir: () => ipcRenderer.invoke('bs:pick-dir'),
  drives: () => ipcRenderer.invoke('bs:drives'),
  migrate: letter => ipcRenderer.invoke('bs:migrate', letter),
  migrateState: () => ipcRenderer.invoke('bs:migrate-state'),
  installStart: dir => ipcRenderer.invoke('bs:install-start', dir),
  installCancel: () => ipcRenderer.invoke('bs:install-cancel'),
  installRemove: () => ipcRenderer.invoke('bs:install-remove'),
  installState: () => ipcRenderer.invoke('bs:install-state'),

  // Amis
  friends: () => ipcRenderer.invoke('bs:friends'),
  friendAction: (action, name) => ipcRenderer.invoke('bs:friend-action', { action, name }),
  onFriendsChanged: cb => ipcRenderer.on('bs:friends-changed', () => cb()),
  onShowFriends: cb => ipcRenderer.on('bs:show-friends', () => cb()),

  version: () => ipcRenderer.invoke('bs:version'),
  uninstall: () => ipcRenderer.invoke('bs:uninstall'),
});
