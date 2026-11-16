/**
 * Pont minimal entre la page du jeu et le launcher.
 * Une seule capacité exposée : recharger le jeu. Rien d'autre n'est accessible
 * depuis la page — pas de système de fichiers, pas de réseau privilégié.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__bsRefresh', () => ipcRenderer.invoke('bs:refresh-game'));

// Le jeu peut détecter qu'il tourne dans le launcher (pour masquer un éventuel
// bouton « télécharger le launcher » sur le site, par exemple).
contextBridge.exposeInMainWorld('__bsLauncher', {
  version: process.env.npm_package_version || null,
  isLauncher: true,
});
