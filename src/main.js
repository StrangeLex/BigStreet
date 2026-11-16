/**
 * Big Street — launcher.
 *
 * Déroulé : écran de chargement → mise à jour silencieuse du launcher →
 * interface du launcher (connexion, nouveautés, options) → fenêtre de jeu.
 *
 * Deux mises à jour, deux comportements voulus :
 *  - LE LAUNCHER se met à jour TOUT SEUL au démarrage, sans rien demander ni
 *    afficher de bouton. Jamais en pleine partie.
 *  - LE JEU se recharge à la demande, via le bouton ⟳ dans la fenêtre de jeu.
 *
 * Le launcher n'embarque pas le jeu : il ouvre playbigstreet.com. Le contenu
 * se met donc à jour côté serveur, sans rien réinstaller.
 */
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SITE = (process.env.BIGSTREET_URL || 'https://playbigstreet.com').replace(/\/+$/, '');
const ALLOWED = ['playbigstreet.com', 'www.playbigstreet.com'];
const REPO = 'StrangeLex/BigStreet';
const UPDATE_TIMEOUT = 12000;

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let splash = null, launcher = null, game = null;

// ------------------------------------------------------------- Réglages
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const TOTAL_MB = Math.round(os.totalmem() / 1048576);

function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch {}
  // Par défaut, le jeu peut utiliser la moitié de la mémoire de la machine.
  const pct = Math.min(90, Math.max(10, Number(s.ramPercent) || 50));
  return { ramPercent: pct, token: typeof s.token === 'string' ? s.token : '' };
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2));
  } catch (e) { log.error('réglages : ' + e); }
  return next;
}

// La limite mémoire se pose au lancement du processus : elle ne peut pas
// changer à chaud, d'où le message « au prochain démarrage » dans l'interface.
{
  const { ramPercent } = readSettings();
  const capMb = Math.max(512, Math.round(TOTAL_MB * ramPercent / 100));
  app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${capMb}`);
  log.info(`mémoire : ${ramPercent} % de ${TOTAL_MB} Mo → ${capMb} Mo`);
}

// ------------------------------------------------------------- Appels au site
async function api(route, { method = 'GET', body, token } = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${SITE}/api/${route}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let account = null;   // compte connecté, en mémoire seulement

// --------------------------------------------------------------- Fenêtres
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const w = game || launcher;
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

function createSplash() {
  splash = new BrowserWindow({
    width: 420, height: 260, frame: false, resizable: false, center: true,
    backgroundColor: '#0b0f17', show: true, alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
}
function splashSay(text) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(
    `document.querySelector('.sub') && (document.querySelector('.sub').textContent = ${JSON.stringify(String(text))});`
  ).catch(() => {});
}

/** Fond de fenetre aligne sur le theme de Windows (evite un flash blanc). */
const shellBg = () => (nativeTheme.shouldUseDarkColors ? '#14171d' : '#ffffff');

function createLauncher() {
  launcher = new BrowserWindow({
    width: 880, height: 580, frame: false, resizable: false, center: true,
    backgroundColor: shellBg(), show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'launcher-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  launcher.loadFile(path.join(__dirname, 'launcher.html'));
  launcher.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.destroy();
    launcher.show();
  });
  launcher.on('closed', () => { launcher = null; });
  // Le joueur bascule Windows en clair/sombre pendant que le launcher est
  // ouvert : la CSS suit toute seule, le fond de fenetre non.
  nativeTheme.on('updated', () => {
    if (launcher && !launcher.isDestroyed()) launcher.setBackgroundColor(shellBg());
  });
}

/** Bouton discret, injecté dans la page, pour recharger le JEU à la demande. */
const GAME_REFRESH_BUTTON = `(() => {
  if (document.getElementById('bsLauncherRefresh')) return;
  const b = document.createElement('button');
  b.id = 'bsLauncherRefresh'; b.title = 'Mettre à jour le jeu'; b.textContent = '⟳';
  b.style.cssText = ['position:fixed','right:14px','bottom:14px','z-index:2147483647',
    'width:38px','height:38px','border-radius:50%','border:none','cursor:pointer',
    'font-size:19px','line-height:1','color:#0b0f17','opacity:.35',
    'background:linear-gradient(135deg,#22d3ee,#ff24b6)',
    'box-shadow:0 2px 10px rgba(0,0,0,.4)','transition:opacity .2s'].join(';');
  b.onmouseenter = () => b.style.opacity = '1';
  b.onmouseleave = () => b.style.opacity = '.35';
  b.onclick = () => { b.textContent = '…'; window.__bsRefresh && window.__bsRefresh(); };
  document.body.appendChild(b);
})();`;

async function openGame() {
  if (game && !game.isDestroyed()) { game.focus(); return; }

  game = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b0f17', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Le jeton obtenu dans le launcher est déposé là où le client web le lit,
  // avant tout chargement : le joueur arrive déjà connecté.
  // On pose le jeton AVANT le premier rendu du document : le client web le lit
  // au demarrage, le joueur arrive donc deja connecte. (Charger puis recharger
  // ferait clignoter le menu de connexion.)
  const { token } = readSettings();
  if (token) {
    game.webContents.on('did-start-navigation', (_e, _url, _inPage, isMain) => {
      if (!isMain) return;
      game.webContents.executeJavaScript(
        `try { localStorage.setItem('cubik.session', ${JSON.stringify(token)}); } catch {}`,
        true
      ).catch(() => {});
    });
  }
  game.loadURL(`${SITE}/`);

  const external = url => { try { return !ALLOWED.includes(new URL(url).hostname); } catch { return true; } };
  game.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  game.webContents.on('will-navigate', (e, url) => {
    if (external(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  game.webContents.on('did-finish-load', () => {
    game.webContents.executeJavaScript(GAME_REFRESH_BUTTON).catch(() => {});
  });
  game.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    log.warn(`chargement échoué (${code} ${desc}) : ${url}`);
    game.loadFile(path.join(__dirname, 'offline.html'));
  });

  game.once('ready-to-show', () => {
    game.show();
    if (launcher && !launcher.isDestroyed()) launcher.hide();   // le launcher s'efface
  });
  game.on('closed', () => {
    game = null;
    if (launcher && !launcher.isDestroyed()) launcher.show();   // et revient à la fermeture
    else app.quit();
  });
}

// ------------------------------------------------------------------- Ponts
ipcMain.handle('bs:minimize', () => { (game || launcher)?.minimize(); });
ipcMain.handle('bs:close', () => { app.quit(); });

ipcMain.handle('bs:login', async (_e, { name, password }) => {
  try {
    const r = await api('login', { method: 'POST', body: { name, password } });
    if (r?.error) return { ok: false, error: r.error };
    if (!r?.token) return { ok: false, error: 'Réponse inattendue du serveur.' };
    account = r.account || { name };
    writeSettings({ token: r.token });
    return { ok: true, account };
  } catch (e) {
    log.error('connexion : ' + e);
    return { ok: false, error: 'Serveur injoignable. Vérifie ta connexion.' };
  }
});

ipcMain.handle('bs:logout', async () => {
  const { token } = readSettings();
  try { if (token) await api('logout', { method: 'POST', token }); } catch {}
  account = null;
  writeSettings({ token: '' });
  return { ok: true };
});

// Session déjà ouverte au démarrage précédent ? On la revalide auprès du site.
ipcMain.handle('bs:account', async () => {
  if (account) return account;
  const { token } = readSettings();
  if (!token) return null;
  try {
    // /api/me repond { account: {...} } — et { account: null } si la session
    // n'est plus valable (expiree, revoquee, serveur reinitialise).
    const me = await api('me', { token });
    const a = me?.account;
    if (!a?.name) { writeSettings({ token: '' }); return null; }
    account = a;
    return account;
  } catch { return null; }
});

ipcMain.handle('bs:play', async () => {
  try { await openGame(); return { ok: true }; }
  catch (e) { log.error('lancement : ' + e); return { ok: false, error: String(e?.message || e) }; }
});

// Bouton de la fenetre de jeu : vide le cache puis recharge, pour etre certain
// de recuperer les derniers modeles et donnees et non une version en cache.
ipcMain.handle('bs:refresh-game', async () => {
  if (!game || game.isDestroyed()) return { ok: false };
  try { await game.webContents.session.clearCache(); } catch {}
  game.loadURL(`${SITE}/`);
  return { ok: true };
});

ipcMain.handle('bs:settings', () => ({ ...readSettings(), totalMb: TOTAL_MB, token: undefined }));
ipcMain.handle('bs:save-settings', (_e, s) => {
  const pct = Math.min(90, Math.max(10, Number(s?.ramPercent) || 50));
  writeSettings({ ramPercent: pct });
  return { ok: true };
});

/** Notes de version : les releases publiques du launcher. */
ipcMain.handle('bs:notes', async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=6`,
      { headers: { Accept: 'application/vnd.github+json' } });
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list.filter(r => !r.draft).map(r => ({
      title: r.name || r.tag_name,
      date: new Date(r.published_at).toLocaleDateString('fr-FR'),
      body: (r.body || '').trim().slice(0, 1200),
    }));
  } catch (e) { log.error('notes : ' + e); return []; }
});

// --------------------------------------------------------- Mise à jour
function updateThenStart() {
  if (!app.isPackaged) { log.info('développement : pas de mise à jour'); return Promise.resolve(false); }
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { log.warn('vérification trop longue'); finish(false); }, UPDATE_TIMEOUT);

    autoUpdater.on('update-not-available', () => { clearTimeout(timer); finish(false); });
    autoUpdater.on('error', e => { log.error('mise à jour : ' + (e?.message || e)); clearTimeout(timer); finish(false); });
    autoUpdater.on('update-available', i => {
      clearTimeout(timer);
      log.info(`mise à jour ${i.version}`);
      splashSay('Mise à jour du launcher…');
    });
    autoUpdater.on('download-progress', p => splashSay(`Mise à jour du launcher… ${Math.round(p.percent)} %`));
    autoUpdater.on('update-downloaded', () => {
      splashSay('Redémarrage…');
      finish(true);
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 400);
    });
    autoUpdater.checkForUpdates().catch(e => { log.error(e); clearTimeout(timer); finish(false); });
  });
}

app.whenReady().then(async () => {
  createSplash();
  if (await updateThenStart()) return;   // l'application redémarre
  createLauncher();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
