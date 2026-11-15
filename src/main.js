/**
 * Big Street — launcher.
 *
 * Le launcher n'embarque PAS le jeu : il ouvre playbigstreet.com. Le contenu du
 * jeu se met donc à jour tout seul, côté serveur, sans rien réinstaller.
 * Seule la coquille (cette application) se met à jour, via les releases GitHub.
 */
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('node:path');

const GAME_URL = process.env.BIGSTREET_URL || 'https://playbigstreet.com/';
// Seuls ces domaines s'ouvrent DANS le launcher ; tout le reste part au navigateur.
const ALLOWED = ['playbigstreet.com', 'www.playbigstreet.com'];

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let win = null;
let splash = null;

/** Une seule fenêtre de jeu à la fois : un double-clic sur l'icône réactive l'existante. */
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b0f17', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,   // le jeu continue de tourner en arrière-plan
    },
  });

  Menu.setApplicationMenu(null);     // pas de barre de menu Electron

  win.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.destroy();
    win.show();
  });

  // Les liens externes (réseaux sociaux, support…) s'ouvrent dans le navigateur
  const external = url => {
    try { return !ALLOWED.includes(new URL(url).hostname); } catch { return true; }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (external(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Serveur injoignable : on le dit clairement au lieu d'une page blanche
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    log.warn(`chargement échoué (${code} ${desc}) : ${url}`);
    win.loadFile(path.join(__dirname, 'offline.html'));
  });

  win.loadURL(GAME_URL);
}

// ---- Mise à jour automatique du launcher (releases GitHub) ----
function setupUpdates() {
  if (!app.isPackaged) return log.info('mode développement : pas de mise à jour');

  autoUpdater.on('update-available', i => log.info(`mise à jour disponible : ${i.version}`));
  autoUpdater.on('update-not-available', () => log.info('launcher déjà à jour'));
  autoUpdater.on('error', e => log.error('mise à jour : ' + (e?.message || e)));
  autoUpdater.on('download-progress', p => log.info(`téléchargement ${Math.round(p.percent)} %`));

  autoUpdater.on('update-downloaded', async info => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0, cancelId: 1,
      title: 'Mise à jour de Big Street',
      message: `La version ${info.version} est prête.`,
      detail: 'Le launcher va redémarrer pour l’installer. Ta partie n’est pas affectée : le jeu vit sur le serveur.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch(e => log.error('vérification : ' + e));
  // Puis une vérification toutes les 6 heures, pour les sessions qui durent
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createSplash();
  createWindow();
  setupUpdates();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
