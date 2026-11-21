/**
 * Pont minimal entre la page du jeu et le launcher.
 * Capacités exposées : recharger le jeu, le quitter, son mode d'affichage, et l'enregistrement du Studio
 * (la page envoie le contenu d'un record ; le launcher choisit seul le fichier, dans son dossier Studio).
 * Rien d'autre n'est accessible depuis la page — aucun chemin de fichier, pas de réseau privilégié.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__bsRefresh', () => ipcRenderer.invoke('bs:refresh-game'));

// Quitter le jeu (bouton ⏻ de la page, après confirmation) : ferme la fenêtre du jeu seulement ;
// le launcher reste ouvert et repasse au premier plan.
contextBridge.exposeInMainWorld('__bsQuit', () => ipcRenderer.invoke('bs:quit'));

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

// Studio : enregistrer ce que le jeu affiche autour du joueur (menu Échap > Studio). La page ne fait qu'ouvrir un
// record, envoyer des morceaux de texte et le refermer ; le nom et l'emplacement du fichier (« .bsrec », dans
// Documents/Big Street/Studio), sa taille et sa durée maximales sont décidés par le launcher (studio-main.js).
contextBridge.exposeInMainWorld('__bsStudio', {
  v: 1,
  start: meta => ipcRenderer.invoke('bs:rec-start', meta),
  chunk: text => { ipcRenderer.send('bs:rec-chunk', text); },
  stop: meta => ipcRenderer.invoke('bs:rec-stop', meta),
  openFolder: () => ipcRenderer.invoke('bs:rec-folder'),
});
