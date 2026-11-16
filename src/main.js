/**
 * Big Street — launcher.
 *
 * Le launcher n'embarque PAS le jeu : il ouvre playbigstreet.com. Le contenu du
 * jeu se met donc à jour côté serveur, sans rien réinstaller.
 *
 * Deux mises à jour, deux comportements voulus :
 *  - LE LAUNCHER se met à jour TOUT SEUL au démarrage, sans rien demander.
 *    Aucun bouton, aucune boîte de dialogue : ça se passe pendant l'écran de
 *    chargement, avant que le jeu ne s'ouvre. Jamais en pleine partie.
 *  - LE JEU dispose d'un bouton de rafraîchissement, à la main du joueur.
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('node:path');

const GAME_URL = process.env.BIGSTREET_URL || 'https://playbigstreet.com/';
const ALLOWED = ['playbigstreet.com', 'www.playbigstreet.com'];
// Au-delà, on considère que la vérification a échoué et on lance le jeu :
// un serveur de mise à jour lent ne doit jamais empêcher de jouer.
const UPDATE_TIMEOUT = 12000;

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;   // filet : si une version arrive en
                                           // cours de partie, elle s'installe à
                                           // la fermeture, sans rien demander.

let win = null, splash = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createSplash() {
  splash = new BrowserWindow({
    width: 420, height: 260, frame: false, resizable: false, center: true,
    backgroundColor: '#0b0f17', show: true, alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
}
/** Met à jour la ligne d'état de l'écran de chargement. */
function splashSay(text) {
  if (!splash || splash.isDestroyed()) return;
  const safe = JSON.stringify(String(text));
  splash.webContents.executeJavaScript(
    `document.querySelector('.sub') && (document.querySelector('.sub').textContent = ${safe});`
  ).catch(() => {});
}

// ---------------------------------------------------------------- Mise à jour
/**
 * Vérifie et installe une mise à jour du launcher AVANT d'ouvrir le jeu.
 * Résout `true` si l'application va redémarrer (inutile de continuer),
 * `false` s'il faut poursuivre le démarrage normal.
 */
function updateThenStart() {
  if (!app.isPackaged) { log.info('développement : pas de mise à jour'); return Promise.resolve(false); }

  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    // Quoi qu'il arrive, on n'attend pas indéfiniment.
    const timer = setTimeout(() => { log.warn('vérification trop longue, on lance le jeu'); finish(false); }, UPDATE_TIMEOUT);

    autoUpdater.on('update-not-available', () => { clearTimeout(timer); finish(false); });
    autoUpdater.on('error', e => { log.error('mise à jour : ' + (e?.message || e)); clearTimeout(timer); finish(false); });

    autoUpdater.on('update-available', i => {
      clearTimeout(timer);                        // le téléchargement peut être long
      log.info(`mise à jour ${i.version} : téléchargement`);
      splashSay('Mise à jour du launcher…');
    });
    autoUpdater.on('download-progress', p => splashSay(`Mise à jour du launcher… ${Math.round(p.percent)} %`));

    autoUpdater.on('update-downloaded', () => {
      log.info('mise à jour prête : redémarrage automatique');
      splashSay('Redémarrage…');
      finish(true);
      // Silencieux : ni question, ni bouton. L'app redémarre, c'est tout.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 400);
    });

    autoUpdater.checkForUpdates().catch(e => { log.error(e); clearTimeout(timer); finish(false); });
  });
}

// ------------------------------------------------------------------- Fenêtre
/** Bouton discret, injecté dans la page, pour recharger le JEU à la demande. */
const GAME_REFRESH_BUTTON = `(() => {
  if (document.getElementById('bsLauncherRefresh')) return;
  const b = document.createElement('button');
  b.id = 'bsLauncherRefresh';
  b.title = 'Mettre à jour le jeu';
  b.textContent = '⟳';
  b.style.cssText = [
    'position:fixed','right:14px','bottom:14px','z-index:2147483647',
    'width:38px','height:38px','border-radius:50%','border:none','cursor:pointer',
    'font-size:19px','line-height:1','color:#0b0f17','opacity:.35',
    'background:linear-gradient(135deg,#22d3ee,#ff24b6)',
    'box-shadow:0 2px 10px rgba(0,0,0,.4)','transition:opacity .2s',
  ].join(';');
  b.onmouseenter = () => b.style.opacity = '1';
  b.onmouseleave = () => b.style.opacity = '.35';
  b.onclick = () => { b.textContent = '…'; window.__bsRefresh && window.__bsRefresh(); };
  document.body.appendChild(b);
})();`;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b0f17', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.destroy();
    win.show();
  });

  const external = url => { try { return !ALLOWED.includes(new URL(url).hostname); } catch { return true; } };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (external(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(GAME_REFRESH_BUTTON).catch(() => {});
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    log.warn(`chargement échoué (${code} ${desc}) : ${url}`);
    win.loadFile(path.join(__dirname, 'offline.html'));
  });

  // Rechargement du JEU demandé par le joueur : on vide le cache pour être sûr
  // de récupérer les derniers modèles et données, puis on recharge.
  const { ipcMain } = require('electron');
  ipcMain.handle('bs:refresh-game', async () => {
    try { await session.defaultSession.clearCache(); } catch {}
    win.loadURL(GAME_URL);
  });

  win.loadURL(GAME_URL);
}

app.whenReady().then(async () => {
  createSplash();
  const restarting = await updateThenStart();
  if (restarting) return;          // l'application redémarre : on n'ouvre rien
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
