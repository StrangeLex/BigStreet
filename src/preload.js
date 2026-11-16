/**
 * Pont minimal entre la page du jeu et le launcher.
 * Une seule capacité exposée : recharger le jeu. Rien d'autre n'est accessible
 * depuis la page — pas de système de fichiers, pas de réseau privilégié.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__bsRefresh', () => ipcRenderer.invoke('bs:refresh-game'));

// Le jeu peut détecter qu'il tourne dans le launcher (pour masquer un éventuel
// bouton « télécharger le launcher » sur le site, par exemple).
// La version est passee en argument de la fenetre (« --bs-version=… ») :
// npm_package_version n'existe que lance depuis npm, donc jamais en production.
const arg = process.argv.find(a => a.startsWith('--bs-version=')) || '';
contextBridge.exposeInMainWorld('__bsLauncher', {
  version: arg.slice('--bs-version='.length) || null,
  isLauncher: true,
});

// Mode d'affichage de la fenêtre de jeu (onglet Options > Graphismes du jeu) :
// « windowed » (fenêtré) ou « fullscreen » (plein écran sans bordure). Rien d'autre.
contextBridge.exposeInMainWorld('__bsDisplay', {
  get: () => ipcRenderer.invoke('bs:display-get'),
  set: mode => ipcRenderer.invoke('bs:display-set', mode),
});
