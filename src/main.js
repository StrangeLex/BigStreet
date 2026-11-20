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
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog, net, safeStorage, Notification, Tray } = require('electron');
const crypto = require('node:crypto');
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
// Connexion Google/Twitch en attente de retour. Conserve dans les reglages :
// le joueur peut fermer le launcher pendant qu'il est dans son navigateur.
const getNonce = () => { const n = readSettings().authNonce; return n && n.value && n.exp > Date.now() ? n : null; };
const setNonce = n => writeSettings({ authNonce: n });

// Connexion Google / Twitch : elle s'ouvre dans le vrai navigateur (Google
// refuse les fenetres embarquees), et le site nous rend la main par un lien
// « bigstreet://auth#... ». Il faut donc que Windows sache a qui l'adresser.
const PROTOCOL = 'bigstreet';
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else app.setAsDefaultProtocolClient(PROTOCOL);
const authLinkIn = argv => (argv || []).find(a => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`)) || null;
// Notifications Windows : rattachees a l'application installee (meme identifiant
// que le raccourci du menu Demarrer pose par l'installeur), sinon elles n'apparaissent pas.
if (process.platform === 'win32') app.setAppUserModelId('com.strangelex.bigstreet');
// Un lien « bigstreet:// » : retour de connexion, ou bouton d'une notification de demande d'ami.
const handleLink = url => (/^bigstreet:\/\/friend\?/i.test(String(url)) ? handleFriendLink(url) : handleAuthLink(url));

// ------------------------------------------------------------- Réglages
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const TOTAL_MB = Math.round(os.totalmem() / 1048576);

// Le jeton de session vaut un mot de passe : on le chiffre avec le coffre du
// systeme (DPAPI sous Windows) quand il est disponible. L'ancien reglage en
// clair reste lu une fois, puis reecrit chiffre.
const sealToken = t => {
  if (!t) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(t).toString('base64'); }
  catch (e) { log.warn('coffre indisponible : ' + e); }
  return t;
};
const openToken = v => {
  if (typeof v !== 'string' || !v) return '';
  if (!v.startsWith('enc:')) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); }
  catch (e) { log.warn('jeton illisible : ' + e); return ''; }
};

function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch {}
  // Par défaut, le jeu peut utiliser la moitié de la mémoire de la machine.
  const pct = Math.min(90, Math.max(10, Number(s.ramPercent) || 50));
  return { ramPercent: pct, token: openToken(s.token),
    installDir: typeof s.installDir === 'string' ? s.installDir : '',
    authNonce: s.authNonce && typeof s.authNonce.value === 'string' ? s.authNonce : null,
    // (demarrage avec Windows, en arriere-plan : oui par defaut, decochable dans Options)
    autoStart: s.autoStart !== false, trayHint: !!s.trayHint,
    // (fenetre de jeu : fenetre ou plein ecran sans bordure)
    displayMode: s.displayMode === 'fullscreen' ? 'fullscreen' : 'windowed',
    // (demandes d'amis deja notifiees : pseudo -> jeton de la notification)
    friendNotified: Object.fromEntries(Object.entries(s.friendNotified && typeof s.friendNotified === 'object' ? s.friendNotified : {})
      .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && /^[0-9a-f]{32}$/.test(v))) };
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify({ ...next, token: sealToken(next.token) }, null, 2), { mode: 0o600 });
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

// Carte graphique : sur un PC portable a deux circuits (Intel/AMD integre +
// NVIDIA), Chromium prend par defaut le petit circuit integre. On demande la
// carte dediee, pour le rendu du jeu comme pour les pilotes NVIDIA.
app.commandLine.appendSwitch('force_high_performance_gpu');

/**
 * Windows : inscrit Big Street dans « Paramètres graphiques » en mode « Hautes
 * performances » (le meme reglage que Parametres > Affichage > Graphiques),
 * une seule fois, sans ecraser un choix que le joueur aurait fait lui-meme.
 */
function preferDedicatedGpu() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const { execFile } = require('node:child_process');
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', exe = process.execPath;
  execFile('reg', ['query', key, '/v', exe], { windowsHide: true }, err => {
    if (!err) return;                       // (deja regle, par nous ou par le joueur)
    execFile('reg', ['add', key, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true },
      e => log.info(e ? 'préférence GPU : ' + e.message : 'préférence GPU : hautes performances'));
  });
}

// ------------------------------------------------------------- Appels au site
async function api(route, { method = 'GET', body, token } = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  // Le site refuse les POST sans en-tete Origin (protection anti-CSRF des
  // navigateurs). fetch() cote Node n'en envoie pas : on le pose nous-memes,
  // sinon connexion, inscription et deconnexion repondent « Origine refusee ».
  if (method !== 'GET') headers['Origin'] = SITE;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Sans delai maximal, un serveur qui ne repond pas laisse l'interface
  // bloquee sur « Connexion… » indefiniment.
  const res = await fetch(`${SITE}/api/${route}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

let account = null;   // compte connecté, en mémoire seulement

/**
 * Ouverture dans le navigateur : uniquement http(s). Une page compromise
 * pourrait sinon faire ouvrir « file:// » ou un autre protocole de la machine.
 */
async function openExternal(url, hosts = null) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { log.warn('adresse refusée : ' + url); return false; }
  if (hosts && !hosts.includes(u.hostname)) { log.warn('hôte refusé : ' + u.hostname); return false; }
  try { await shell.openExternal(u.href); return true; } catch (e) { log.error('ouverture : ' + e); return false; }
}

// --------------------------------------------------------------- Fenêtres
if (!app.requestSingleInstanceLock()) {
  // Deuxieme lancement : la premiere fenetre reprend la main (second-instance),
  // celui-ci s'arrete tout de suite — sans quoi il continuait a construire ses
  // fenetres pendant que la fermeture se faisait.
  app.exit(0);
}
app.on('second-instance', (_e, argv) => {
  showMain();
  const link = authLinkIn(argv);
  if (link) handleLink(link);
});
app.on('open-url', (e, url) => { e.preventDefault(); handleLink(url); });   // (macOS)

// Lien cliqué alors que le launcher était fermé : Windows démarre l'application
// avec l'adresse en argument — « second-instance » ne se déclenche pas.
const startupLink = authLinkIn(process.argv);

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

let revealLauncher = () => {};
ipcMain.handle('bs:ui-ready', () => { revealLauncher(); });
function createLauncher() {
  launcher = new BrowserWindow({
    width: 880, height: 580, minWidth: 880, minHeight: 580,
    frame: false, resizable: true, center: true,
    backgroundColor: shellBg(), show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'launcher-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  launcher.loadFile(path.join(__dirname, 'launcher.html'));
  // (une seule fois : le filet des 17 s ne doit pas rouvrir le launcher par-dessus
  // une partie deja lancee, ni apres que le joueur l'a range)
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (splash && !splash.isDestroyed()) splash.destroy();
    if (HIDDEN_START) return;               // (demarrage avec Windows : il reste dans les icones cachees)
    if (game && !game.isDestroyed()) return;
    if (launcher && !launcher.isDestroyed() && !launcher.isVisible()) launcher.show();
  };
  // La fenetre n'apparait que quand l'interface sait si le joueur est connecte
  // (« bs:ui-ready ») : sinon l'ecran « Non connecte » clignote une fraction de
  // seconde avant le bon. D'ici la, c'est l'ecran de chargement qui reste.
  revealLauncher = reveal;
  // Filet : si la page ne repond jamais, l'ecran de chargement ne doit pas
  // rester seul a l'ecran indefiniment (la verification du compte abandonne a 15 s).
  setTimeout(reveal, 17000);
  launcher.webContents.on('render-process-gone', (_e, d) => {
    log.error('interface interrompue : ' + d.reason);
    if (splash && !splash.isDestroyed()) splash.destroy();
    if (!revealed) reveal();
  });
  // Fermer la fenetre la range dans les icones cachees : le launcher continue de
  // veiller aux demandes d'amis. « Quitter » (clic droit sur l'icone) l'arrete vraiment.
  launcher.on('close', e => { if (!quitting) { e.preventDefault(); hideToTray(); } });
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
    fullscreen: readSettings().displayMode === 'fullscreen',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
      additionalArguments: [`--bs-version=${app.getVersion()}`],
    },
  });

  // Mode d'affichage : retenu quand il change (option du jeu, F11, ou sortie du
  // plein ecran par Windows), reapplique a la prochaine ouverture.
  let closing = false;
  game.on('close', () => { closing = true; });   // (fermer en plein ecran ne doit pas faire oublier le choix)
  game.on('enter-full-screen', () => writeSettings({ displayMode: 'fullscreen' }));
  game.on('leave-full-screen', () => { if (!closing) writeSettings({ displayMode: 'windowed' }); });
  game.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) { e.preventDefault(); game.setFullScreen(!game.isFullScreen()); }
  });

  // Le titre de la fenetre reste le nom du jeu, quoi qu'annonce la page web.
  game.setTitle('Big Street');
  game.on('page-title-updated', e => e.preventDefault());

  serveLocalAssets(game.webContents.session);
  studio.watchGame(game);   // (un record en cours est referme si la fenetre se ferme ou se recharge)

  // A chaque lancement du jeu : cache vide (cache HTTP, service worker et ses fichiers, code et shaders compiles) — le jeu
  // repart toujours de la derniere version publiee. La connexion (localStorage, cookies) et les ressources installees restent.
  try {
    const ses = game.webContents.session;
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage', 'shadercache'] });
    await ses.clearCodeCaches({}).catch(() => {});
    log.info('cache du jeu vidé');
  } catch (e) { log.warn('vidage du cache impossible : ' + e); }

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
    if (external(url)) { openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  game.webContents.on('will-navigate', (e, url) => {
    if (external(url)) { e.preventDefault(); openExternal(url); }
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
    if (quitting) return;
    if (launcher && !launcher.isDestroyed()) launcher.show();   // et revient à la fermeture
    else app.quit();
  });
}

/**
 * Retour de Google / Twitch, via « bigstreet://auth#... ».
 *  - session=<jeton>        : le compte existait, on est connecte
 *  - google=<jeton>&name=.. : premiere venue, il reste a choisir un pseudo
 *  - ...Error=<message>     : refus ou annulation
 */
async function handleAuthLink(raw) {
  // N'importe quelle page web peut faire ouvrir « bigstreet://... ». Sans
  // controle, elle pourrait y glisser SA session et connecter le joueur sur un
  // compte qui n'est pas le sien. On n'accepte donc un retour que s'il porte le
  // jeton a usage unique tire juste avant, pour la connexion qu'on a lancee.
  const url = String(raw);
  if (!/^bigstreet:\/\/auth(\/|#|$)/i.test(url)) { log.warn('lien ignoré : ' + url.slice(0, 40)); return; }
  const q = new URLSearchParams(url.split('#')[1] || '');
  const want = getNonce();
  if (!want || (q.get('app') || '') !== want.value) {
    log.warn('retour de connexion non sollicité : ignoré');
    return;
  }
  setNonce(null);                         // a usage unique
  const send = payload => {
    if (!launcher || launcher.isDestroyed()) return;
    if (launcher.isMinimized()) launcher.restore();
    launcher.show(); launcher.focus();
    launcher.webContents.send('bs:auth', payload);
  };
  const err = q.get('googleError') || q.get('twitchError');
  if (err) return send({ ok: false, error: err });

  const session = q.get('session');
  if (session) {
    // On valide la session aupres du site AVANT de l'ecrire : un jeton refuse
    // n'a rien a faire dans les reglages.
    try { const me = await api('me', { token: session }); account = me?.account || null; } catch { account = null; }
    if (!account) return send({ ok: false, error: 'Session refusée par le site.' });
    writeSettings({ token: session });
    return send({ ok: true, account });
  }
  for (const provider of ['google', 'twitch']) {
    const pending = q.get(provider);
    if (pending) return send({ ok: true, provider, pending, suggest: q.get('name') || '' });
  }
  send({ ok: false, error: 'Reponse inattendue du site.' });
}

// ---------------------------------------------- Icones cachees et demarrage
// Lance par Windows a l'ouverture de session (« --hidden ») : ni ecran de
// chargement ni fenetre, seulement l'icone pres de l'horloge.
const HIDDEN_START = process.argv.includes('--hidden');
let tray = null, quitting = false;
function quitApp() { quitting = true; app.quit(); }
app.on('before-quit', () => { quitting = true; });

/** Demarrage avec Windows : une entree « Big Street » dans les applications de demarrage (Gestionnaire des taches). */
function setAutoStart(on) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: ['--hidden'], name: 'Big Street' }); }
  catch (e) { log.warn('démarrage avec Windows : ' + e); }
}
function showMain() {
  const w = (game && !game.isDestroyed()) ? game : launcher;
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show(); w.focus();
}
function hideToTray() {
  if (launcher && !launcher.isDestroyed()) launcher.hide();
  // (la premiere fois seulement : dire ou il est passe)
  if (!readSettings().trayHint && Notification.isSupported()) {
    writeSettings({ trayHint: true });
    new Notification({ title: 'Big Street', body: 'Big Street reste dans les icônes cachées, près de l’horloge. Clic droit sur l’icône > Quitter pour l’arrêter.' }).show();
  }
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Ouvrir Big Street', click: showMain },
    { label: 'Amis', click: () => { showMain(); showFriends(); } },
    { label: 'Studio', click: () => studio.openStudio() },   // (les records se relisent sans connexion, donc sans passer par l'ecran de lancement)
    { type: 'separator' },
    { label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: readSettings().autoStart,
      enabled: process.platform === 'win32' && app.isPackaged,
      click: i => { writeSettings({ autoStart: i.checked }); setAutoStart(i.checked); } },
    { type: 'separator' },
    { label: 'Quitter Big Street', click: quitApp },
  ]);
}
function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'tray.png'));
  tray.setToolTip('Big Street');
  tray.on('click', showMain);
  // (menu reconstruit a chaque ouverture : la case suit le reglage)
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  if (process.platform !== 'win32') tray.setContextMenu(trayMenu());
}

// ------------------------------------------- Notifications de demandes d'amis
/**
 * Tant que le launcher est ouvert et que le joueur n'est pas en jeu, une demande
 * d'ami recue declenche une notification Windows : Accepter, Refuser, Ignorer.
 * En jeu, c'est le jeu qui la montre : pas de doublon.
 *
 * Chaque notification porte un jeton tire au hasard, garde dans les reglages :
 * une page web peut faire ouvrir « bigstreet://friend?... », mais sans ce jeton
 * le lien est ignore — elle ne peut donc pas accepter un ami a ta place.
 * Une demande deja notifiee ne l'est plus (« Ignorer » la laisse en attente,
 * dans l'onglet Amis).
 */
const xmlEsc = t => String(t).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function notifyFriend(name) {
  const k = crypto.randomBytes(16).toString('hex');
  if (!Notification.isSupported()) return k;
  const link = act => xmlEsc(`${PROTOCOL}://friend?do=${act}&name=${encodeURIComponent(name)}&k=${k}`);
  const opts = { title: 'Demande d’ami', body: `${name} veut être ton ami sur Big Street.` };
  if (process.platform === 'win32') {
    opts.toastXml = `<toast launch="${link('open')}" activationType="protocol">
  <visual><binding template="ToastGeneric">
    <text>Demande d’ami</text>
    <text>${xmlEsc(name)} veut être ton ami sur Big Street.</text>
  </binding></visual>
  <actions>
    <action content="Accepter" activationType="protocol" arguments="${link('accept')}"/>
    <action content="Refuser" activationType="protocol" arguments="${link('refuse')}"/>
    <action content="Ignorer" activationType="system" arguments="dismiss"/>
  </actions>
</toast>`;
  }
  const n = new Notification(opts);
  n.on('click', () => showFriends());          // (hors Windows : un clic ouvre l'onglet Amis)
  n.show();
  log.info('notification : demande d’ami de ' + name);
  return k;
}
function showFriends() {
  if (!launcher || launcher.isDestroyed()) return;
  if (launcher.isMinimized()) launcher.restore();
  launcher.show(); launcher.focus();
  launcher.webContents.send('bs:show-friends');
}
async function friendWatch() {
  try {
    const { token, friendNotified = {} } = readSettings();
    if (!token || (game && !game.isDestroyed())) return;
    const v = await api('friends', { token });
    if (!Array.isArray(v?.requests) || v.inGame) return;   // (en jeu depuis un navigateur : le jeu la montre)
    const keep = {}; let fresh = false;
    for (const n of v.requests) {
      const key = String(n).toLowerCase();
      if (friendNotified[key]) keep[key] = friendNotified[key];
      else { keep[key] = notifyFriend(n); fresh = true; }
    }
    if (fresh || Object.keys(keep).length !== Object.keys(friendNotified).length) writeSettings({ friendNotified: keep });
    if (fresh && launcher && !launcher.isDestroyed()) launcher.webContents.send('bs:friends-changed');
  } catch (e) { log.warn('demandes d’amis : ' + e); }
}
async function handleFriendLink(raw) {
  let u; try { u = new URL(String(raw)); } catch { return; }
  const name = u.searchParams.get('name') || '', act = u.searchParams.get('do'), key = name.toLowerCase();
  const { token, friendNotified = {} } = readSettings();
  if (!name || !friendNotified[key] || u.searchParams.get('k') !== friendNotified[key]) { log.warn('lien d’ami non sollicité : ignoré'); return; }
  if (act === 'open') return showFriends();
  if ((act !== 'accept' && act !== 'refuse') || !token) return;
  const { [key]: _, ...rest } = friendNotified;
  writeSettings({ friendNotified: rest });     // (a usage unique)
  let r;
  try { r = await api('friends/respond', { method: 'POST', body: { name, accept: act === 'accept' }, token }); }
  catch (e) { r = { error: 'Serveur injoignable.' }; log.error('amis : ' + e); }
  if (Notification.isSupported()) {
    new Notification(r?.error ? { title: 'Demande d’ami', body: `${name} : ${r.error}` }
      : { title: 'Big Street', body: act === 'accept' ? `${name} et toi, vous êtes maintenant amis.` : `Demande de ${name} refusée.` }).show();
  }
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('bs:friends-changed');
}

// ------------------------------------------------- Installation des ressources
/**
 * « Installer le jeu » = telecharger ses ressources (modeles 3D et donnees,
 * ~69 Mo) sur le disque choisi. Le jeu lui-meme reste servi par le site : ce
 * qu'on installe, ce sont les fichiers lourds qu'il allait chercher a chaque
 * partie. Ils sont ensuite servis depuis le disque (voir serveLocalAssets).
 */
const defaultInstallDir = () => path.join(app.getPath('userData'), 'jeu');
const installDir = () => readSettings().installDir || defaultInstallDir();
const manifestFile = dir => path.join(dir, 'manifest.json');

// Le manifeste est relu a chaque requete du jeu : on le garde en memoire tant
// que le fichier n'a pas change, sinon on reparserait 1 700 entrees par image.
let manCache = { path: '', mtime: 0, data: null };
function readManifest(dir = installDir()) {
  const file = manifestFile(dir);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (manCache.path === file && manCache.mtime === mtime) return manCache.data;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    manCache = { path: file, mtime, data: m && m.files ? m : null };
    return manCache.data;
  } catch {
    if (manCache.path === file) manCache = { path: '', mtime: 0, data: null };
    return null;
  }
}

// Etat du telechargement, lu par la page « Telechargement » (debit, reste, etc.)
const freshDl = () => ({ state: 'idle', done: 0, total: 0, files: 0, count: 0,
  skipped: 0, speed: 0, maxSpeed: 0, eta: 0, error: '' });
let dl = freshDl();
const MIME = { '.json': 'application/json', '.bbmodel': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.js': 'text/javascript' };

/**
 * Chemin de ressource accepte : « /models/... », « /data/... » ou le seul
 * dossier de RNNoise (suppression de bruit du micro), sans remontee de
 * dossier. La liste vient du site, mais un serveur compromis ne doit pas
 * pouvoir faire ecrire le launcher n'importe ou sur le disque, ni lui faire
 * servir d'autres scripts que ceux-la.
 */
const SAFE_ASSET = /^\/(models|data|js\/vendor\/rnnoise)\/[A-Za-z0-9._\-/]+$/;
function safeDest(dir, rel) {
  if (!SAFE_ASSET.test(rel) || rel.includes('..')) return null;
  const dest = path.resolve(dir, rel.replace(/^\//, ''));
  return dest.startsWith(path.resolve(dir) + path.sep) ? dest : null;
}

/** Telechargement d'un fichier, avec deux reprises : un 502 passager ne doit pas tout arreter. */
async function fetchAsset(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`HTTP ${res.status}`);
      if (res.status === 404) break;            // inutile d'insister
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  throw last || new Error('échec');
}

async function runInstall(dir) {
  dl = freshDl();
  dl.state = 'list';
  let failed = null, keepRef = null;
  try {
    const list = await api('assets');
    if (!Array.isArray(list?.files) || !list.files.length) throw new Error('liste de ressources vide');

    // Reprise : ce qui est deja la, a la bonne version et a la bonne taille,
    // n'est pas retelecharge. Sert aussi de « verifier et reparer ».
    const have = readManifest(dir)?.files || {};
    const todo = [], keep = {};
    keepRef = keep;
    let total = 0;
    for (const f of list.files) {
      if (!safeDest(dir, f.p)) { log.warn('ressource au chemin refusé : ' + f.p); continue; }
      const dest = safeDest(dir, f.p);
      let ok = have[f.p] !== undefined && have[f.p] === (f.v || '');
      if (ok) { try { ok = fs.statSync(dest).size === f.s; } catch { ok = false; } }
      if (ok) { keep[f.p] = f.v || ''; dl.skipped++; } else { todo.push(f); total += f.s; }
    }
    dl.total = total; dl.count = todo.length; dl.state = 'download';
    if (!todo.length) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(manifestFile(dir), JSON.stringify({ at: Date.now(), site: SITE, files: keep }));
      dl.state = 'done';
      log.info(`ressources déjà complètes (${dl.skipped} fichiers)`);
      return;
    }

    // Place disponible : mieux vaut le dire avant qu'au 1 500e fichier.
    try {
      fs.mkdirSync(dir, { recursive: true });
      const st = fs.statfsSync(dir);
      const free = st.bavail * st.bsize;
      if (free < total * 1.15) throw new Error(`place insuffisante sur le disque (${Math.round(free / 1048576)} Mo libres, ${Math.round(total / 1048576)} Mo nécessaires)`);
    } catch (e) { if (/place insuffisante/.test(e.message)) throw e; }

    // Debit : fenetre glissante d'environ 3 s — stable a l'affichage sans
    // lisser au point de ne plus rien dire.
    let windowBytes = 0, windowStart = Date.now();
    const bump = n => {
      dl.done += n; windowBytes += n;
      const dt = (Date.now() - windowStart) / 1000;
      if (dt >= 0.5) {
        dl.speed = windowBytes / dt;
        dl.maxSpeed = Math.max(dl.maxSpeed, dl.speed);
        if (dt > 3) { windowBytes = 0; windowStart = Date.now(); }
        dl.eta = dl.speed > 0 ? Math.max(0, Math.round((dl.total - dl.done) / dl.speed)) : 0;
      }
    };

    // Un fichier qui resiste ne doit pas faire echouer les 1 672 autres : il est
    // mis de cote, et on repasse le ramasser a la fin. Sur une connexion qui
    // trebuche, c'est la difference entre « installe » et « a recommencer ».
    let queue = todo.slice();
    const worker = async () => {
      while (queue.length) {
        if (dl.state === 'cancel') return;
        const f = queue.shift();
        const dest = safeDest(dir, f.p);
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const url = `${SITE}${f.p}${f.v ? `?v=${encodeURIComponent(f.v)}` : ''}`;
          const buf = await fetchAsset(url);
          fs.writeFileSync(dest, buf);
          keep[f.p] = f.v || '';
          dl.files++; bump(buf.length);
        } catch (e) { reste.push(f); derniere = `${f.p} : ${e.message}`; }
      }
    };
    let reste = [], derniere = '';
    for (let passe = 0; passe < 3; passe++) {
      await Promise.all(Array.from({ length: 6 }, worker));
      if (dl.state === 'cancel' || !reste.length) break;
      log.warn(`${reste.length} fichier(s) à reprendre (passe ${passe + 1})`);
      queue = reste; reste = [];
      await new Promise(r => setTimeout(r, 1500));
    }
    if (reste.length) failed = new Error(`${reste.length} fichier(s) non téléchargés (${derniere})`);
    if (failed) throw failed;
    if (dl.state === 'cancel') {
      // Ce qui est deja descendu est conserve : la reprise repartira de la.
      fs.writeFileSync(manifestFile(dir), JSON.stringify({ at: Date.now(), site: SITE, files: keep }));
      dl.state = 'idle';
      return;
    }

    fs.writeFileSync(manifestFile(dir), JSON.stringify({ at: Date.now(), site: SITE, files: keep }));
    writeSettings({ installDir: dir });
    dl.state = 'done'; dl.speed = 0; dl.eta = 0;
    log.info(`ressources installées dans ${dir} (${dl.files} téléchargés, ${dl.skipped} déjà présents)`);
  } catch (e) {
    log.error('installation : ' + e);
    // Ce qui est descendu reste utilisable : une nouvelle tentative ne
    // retelechargera que ce qui manque.
    try {
      if (keepRef) fs.writeFileSync(manifestFile(dir), JSON.stringify({ at: Date.now(), site: SITE, files: keepRef }));
    } catch { /* tant pis */ }
    dl.state = 'error'; dl.error = String(e?.message || e);
  }
}

/**
 * Sert les ressources deja telechargees a la fenetre de jeu. Un fichier n'est
 * servi localement que si son empreinte correspond a celle demandee : des que
 * le site publie une nouvelle version, c'est le reseau qui repond, et la copie
 * locale ne peut pas faire jouer avec un vieux contenu.
 */
function serveLocalAssets(session) {
  if (session.__bsAssets) return;
  session.__bsAssets = true;
  session.protocol.handle('https', async req => {
    try {
      const u = new URL(req.url);
      // Le dossier et le manifeste sont relus a chaque fois : le joueur peut
      // installer, changer de disque ou effacer pendant que le jeu tourne.
      if (`${u.protocol}//${u.host}` === SITE && req.method === 'GET') {
        const dir = installDir(), man = readManifest(dir);
        const v = man?.files?.[u.pathname];
        const want = u.searchParams.get('v') || '';
        // (seulement une adresse versionnée, à la même version : un fichier demandé sans version — versions.json… — peut
        // changer à tout moment, c'est toujours le réseau qui le donne)
        if (v !== undefined && want && want === v) {
          const file = safeDest(dir, u.pathname);
          // Lecture asynchrone : le processus principal fait aussi tourner
          // l'interface, et le jeu demande ses modeles par centaines.
          if (file) {
            try {
              const buf = await fs.promises.readFile(file);
              return new Response(buf, {
                headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' },
              });
            } catch { /* absent ou illisible : le reseau prend le relais */ }
          }
        }
      }
    } catch { /* au moindre doute : le reseau */ }
    // Relais d'un envoi (POST…) : net.fetch perd l'en-tete Origin, et le site
    // refuse alors la requete (« Origine refusee », sa protection anti-CSRF).
    // On le remet pour un envoi vers le site. Il ne peut venir que du site : la
    // fenetre de jeu ne navigue que sur lui (will-navigate), et sa politique de
    // securite (default-src 'self') interdit tout cadre tiers. (Le referent ne
    // peut pas servir de preuve : le site l'efface, « no-referrer ».)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        if (new URL(req.url).origin === SITE && !req.headers.has('origin')) {
          const headers = new Headers(req.headers);
          headers.set('Origin', SITE);
          return net.fetch(req.url, { method: req.method, headers, body: req.body, duplex: 'half', bypassCustomProtocolHandlers: true });
        }
      } catch { /* adresse illisible : relais ordinaire */ }
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  log.info('ressources locales actives');
}

// ------------------------------------------------------------------ Studio
// Records du jeu (pont « __bsStudio » de la fenetre de jeu) et fenetre « Big Street Studio » : cf. studio-main.js
const studio = require('./studio-main.js')({ SITE, log, getGame: () => game, getLauncher: () => launcher, installDir, readManifest, safeDest });

// ------------------------------------------------------------------- Ponts
ipcMain.handle('bs:minimize', () => { (game || launcher)?.minimize(); });
ipcMain.handle('bs:close', () => { hideToTray(); });
ipcMain.handle('bs:quit', () => { log.info('quitter (bouton du jeu)'); quitApp(); });

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

// Inscription. Le site exige une adresse e-mail verifiee par code uniquement
// quand un service d'envoi est configure : le launcher demande l'etat au site
// plutot que de le supposer.
ipcMain.handle('bs:register-mode', async () => {
  try { const r = await api('register/email'); return { emailRequired: !!r?.required }; }
  catch { return { emailRequired: false }; }
});

ipcMain.handle('bs:register-code', async (_e, { email, name }) => {
  try {
    const r = await api('register/code', { method: 'POST', body: { email, name } });
    if (r?.error) return { ok: false, error: r.error };
    return { ok: true, info: r?.info || 'Code envoye.' };
  } catch (e) {
    log.error('code e-mail : ' + e);
    return { ok: false, error: 'Serveur injoignable. Verifie ta connexion.' };
  }
});

ipcMain.handle('bs:register', async (_e, { name, password, email, code, ref, look }) => {
  try {
    const r = await api('register', { method: 'POST', body: { name, password, email, code, ref, look } });
    if (r?.error) return { ok: false, error: r.error };
    if (!r?.token) return { ok: false, error: 'Reponse inattendue du serveur.' };
    account = r.account || { name };
    writeSettings({ token: r.token });
    return { ok: true, account };
  } catch (e) {
    log.error('inscription : ' + e);
    return { ok: false, error: 'Serveur injoignable. Verifie ta connexion.' };
  }
});

// Connexion / inscription par Google ou Twitch. Le site n'ouvre ces chemins que
// s'il a les identifiants du fournisseur : on le lui demande.
ipcMain.handle('bs:oauth-available', async () => {
  const one = async p => { try { return !!(await api(`auth/${p}`))?.available; } catch { return false; } };
  const [google, twitch] = await Promise.all([one('google'), one('twitch')]);
  return { google, twitch };
});

// `app: true` : le site renverra vers sa page de retour au launcher, et non vers le jeu.
ipcMain.handle('bs:oauth', async (_e, provider) => {
  if (provider !== 'google' && provider !== 'twitch') return { ok: false, error: 'Fournisseur inconnu.' };
  try {
    // Jeton a usage unique, valable 10 min : le site le renverra dans l'adresse
    // de retour, et seul ce retour-la sera accepte (voir handleAuthLink).
    const nonce = crypto.randomBytes(18).toString('hex');
    setNonce({ value: nonce, exp: Date.now() + 10 * 60000 });
    const r = await api(`auth/${provider}/start`, { method: 'POST', body: { app: true, nonce } });
    if (r?.error) { setNonce(null); return { ok: false, error: r.error }; }
    if (!r?.url) { setNonce(null); return { ok: false, error: 'Reponse inattendue du serveur.' }; }
    if (!await openExternal(r.url, ['accounts.google.com', 'id.twitch.tv'])) {
      setNonce(null);
      return { ok: false, error: 'Adresse de connexion refusée.' };
    }
    return { ok: true };
  } catch (e) {
    setNonce(null);
    log.error('oauth : ' + e);
    return { ok: false, error: 'Serveur injoignable. Verifie ta connexion.' };
  }
});

// Premiere venue par Google / Twitch : le joueur choisit son pseudo, le compte est cree.
ipcMain.handle('bs:oauth-finish', async (_e, { provider, pending, name }) => {
  if (provider !== 'google' && provider !== 'twitch') return { ok: false, error: 'Fournisseur inconnu.' };
  try {
    const r = await api(`auth/${provider}/finish`, { method: 'POST', body: { pending, name } });
    if (r?.error) return { ok: false, error: r.error };
    if (!r?.token) return { ok: false, error: 'Reponse inattendue du serveur.' };
    account = r.account || { name };
    writeSettings({ token: r.token });
    return { ok: true, account };
  } catch (e) {
    log.error('oauth finish : ' + e);
    return { ok: false, error: 'Serveur injoignable. Verifie ta connexion.' };
  }
});

// Connexion sans mot de passe : code a 6 chiffres envoye a l'adresse du compte.
ipcMain.handle('bs:login-code', async (_e, email) => {
  try {
    const r = await api('login/code', { method: 'POST', body: { email } });
    if (r?.error) return { ok: false, error: r.error };
    return { ok: true, info: r?.info || 'Code envoye.' };
  } catch (e) {
    log.error('code de connexion : ' + e);
    return { ok: false, error: 'Serveur injoignable. Verifie ta connexion.' };
  }
});

ipcMain.handle('bs:login-email', async (_e, { email, code }) => {
  try {
    const r = await api('login/email', { method: 'POST', body: { email, code } });
    if (r?.error) return { ok: false, error: r.error };
    if (!r?.token) return { ok: false, error: 'Reponse inattendue du serveur.' };
    account = r.account || null;
    writeSettings({ token: r.token });
    return { ok: true, account };
  } catch (e) {
    log.error('connexion par code : ' + e);
    return { ok: false, error: 'Serveur injoignable. Verifie ta connexion.' };
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
  } catch (e) {
    // Site injoignable : la session est peut-etre tres bien. On ne l'efface
    // surtout pas, et on le dit a l'interface au lieu de faire croire a une
    // deconnexion.
    log.warn('vérification de session impossible : ' + e);
    return { offline: true };
  }
});

// Mode d'affichage demande par la page du jeu (Options > Graphismes).
ipcMain.handle('bs:display-get', () => (game && !game.isDestroyed() ? (game.isFullScreen() ? 'fullscreen' : 'windowed') : readSettings().displayMode));
ipcMain.handle('bs:display-set', (_e, mode) => {
  const full = mode === 'fullscreen';
  writeSettings({ displayMode: full ? 'fullscreen' : 'windowed' });
  if (game && !game.isDestroyed()) game.setFullScreen(full);
  return full ? 'fullscreen' : 'windowed';
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

// --- installation du jeu ---
ipcMain.handle('bs:install-info', () => {
  const dir = installDir();
  const man = readManifest(dir);
  return {
    dir, custom: !!readSettings().installDir, defaultDir: defaultInstallDir(),
    installed: !!man, files: man ? Object.keys(man.files).length : 0,
    at: man?.at || 0,
  };
});

// Choix du disque / dossier : c'est l'explorateur de Windows qui s'ouvre, le
// launcher n'ecrit que la ou le joueur a dit.
ipcMain.handle('bs:pick-dir', async () => {
  if (dl.state === 'list' || dl.state === 'download') return { ok: false, error: 'Téléchargement en cours : arrête-le avant de changer de dossier.' };
  const win = launcher && !launcher.isDestroyed() ? launcher : undefined;
  const r = await dialog.showOpenDialog(win, {
    title: 'Ou installer les ressources de Big Street ?',
    defaultPath: installDir(),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Installer ici',
  });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false };
  const dir = path.join(r.filePaths[0], 'Big Street');
  const before = installDir(), had = !!readManifest(before);
  writeSettings({ installDir: dir });
  manCache = { path: '', mtime: 0, data: null };
  dl = freshDl();
  // Les fichiers de l'ancien dossier ne sont pas effaces d'office : on le dit,
  // le joueur decide.
  return { ok: true, dir, previous: had && before !== dir ? before : '' };
});

// Le dossier vient toujours des reglages, jamais de l'interface : le processus
// principal ne doit pas ecrire a une adresse dictee par la page.
ipcMain.handle('bs:install-start', async () => {
  if (dl.state === 'list' || dl.state === 'download') return { ok: false, error: 'Téléchargement déjà en cours.' };
  const target = installDir();
  runInstall(target);               // (en tache de fond : l'interface suit l'etat)
  return { ok: true, dir: target };
});

// Supprime les ressources installees : le jeu repassera simplement par le reseau.
ipcMain.handle('bs:install-remove', async () => {
  if (dl.state === 'list' || dl.state === 'download') return { ok: false, error: 'Téléchargement en cours.' };
  const dir = installDir();
  try {
    for (const sub of ['models', 'data', 'js']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
    fs.rmSync(manifestFile(dir), { force: true });
    manCache = { path: '', mtime: 0, data: null };
    dl = freshDl();
    log.info('ressources supprimées : ' + dir);
    return { ok: true };
  } catch (e) {
    log.error('suppression : ' + e);
    return { ok: false, error: String(e?.message || e) };
  }
});
// --- disques : lesquels, combien de place, SSD ou disque dur ---
// PowerShell (inclus dans Windows 10 et 11) : volumes fixes avec une lettre,
// relies a leur disque physique pour savoir s'il s'agit d'un SSD (ou NVMe) ou
// d'un disque dur. Rien n'est ecrit, c'est une lecture.
const DRIVES_PS = `$ErrorActionPreference='SilentlyContinue'
$pd = @(Get-PhysicalDisk)
@(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object {
  $v = $_; $media = ''; $bus = ''; $spin = $null
  $p = Get-Partition -DriveLetter $v.DriveLetter | Select-Object -First 1
  if ($p) { $d = $pd | Where-Object { $_.DeviceId -eq [string]$p.DiskNumber } | Select-Object -First 1
    if ($d) { $media = [string]$d.MediaType; $bus = [string]$d.BusType; $spin = $d.SpindleSpeed } }
  [pscustomobject]@{ letter = [string]$v.DriveLetter; label = $v.FileSystemLabel; size = [double]$v.Size; free = [double]$v.SizeRemaining; media = $media; bus = $bus; spin = $spin }
}) | ConvertTo-Json -Compress`;
function driveKind(d) {
  if (d.media === 'SSD' || d.bus === 'NVMe' || d.spin === 0) return 'ssd';
  if (d.media === 'HDD' || d.spin > 0) return 'hdd';
  return '';
}
function listDrives() {
  const sys = (process.env.SystemDrive || 'C:').slice(0, 1).toUpperCase();
  const cur = path.parse(path.resolve(installDir())).root.slice(0, 1).toUpperCase();
  const finish = list => list
    .map(d => ({ ...d, kind: d.kind ?? driveKind(d), system: d.letter === sys, current: d.letter === cur }))
    .filter(d => d.size > 0)
    // (SSD d'abord, puis inconnus, puis disques durs ; a type egal, le plus de place libre)
    .sort((a, b) => ({ ssd: 0, '': 1, hdd: 2 }[a.kind] - { ssd: 0, '': 1, hdd: 2 }[b.kind]) || b.free - a.free);
  if (process.platform !== 'win32') {
    // (hors Windows, pour les essais : le disque du dossier personnel)
    try { const st = fs.statfsSync(os.homedir()); return Promise.resolve(finish([{ letter: cur || '/', label: os.homedir(), size: st.blocks * st.bsize, free: st.bavail * st.bsize, kind: '' }])); }
    catch { return Promise.resolve([]); }
  }
  return new Promise(resolve => {
    require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DRIVES_PS],
      { windowsHide: true, timeout: 12000, maxBuffer: 1 << 20 }, (err, out) => {
        let list = [];
        try { const j = JSON.parse(String(out || '').trim() || '[]'); list = (Array.isArray(j) ? j : [j]).filter(d => /^[A-Z]$/i.test(d?.letter || '')).map(d => ({ ...d, letter: d.letter.toUpperCase(), label: String(d.label || '') })); }
        catch (e) { log.warn('disques (PowerShell) : ' + (err?.message || e)); }
        if (!list.length) {
          // (PowerShell indisponible : les lettres qui repondent, sans le type)
          for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
            try { const st = fs.statfsSync(`${L}:\\`); if (st.blocks > 0) list.push({ letter: L, label: '', size: st.blocks * st.bsize, free: st.bavail * st.bsize, kind: '' }); } catch { /* absente */ }
          }
        }
        resolve(finish(list));
      });
  });
}
ipcMain.handle('bs:drives', () => listDrives());

// --- migration des ressources vers un autre disque ---
// Copie fichier par fichier (ceux du manifeste, rien d'autre), verifie les
// tailles, bascule le reglage, puis seulement efface l'ancienne copie : une
// coupure en plein milieu laisse l'ancienne installation intacte et utilisee.
let mig = { state: 'idle', done: 0, total: 0, error: '', dir: '' };
const dirOnDrive = letter => {
  const def = defaultInstallDir();
  if (path.parse(def).root.slice(0, 1).toUpperCase() === letter) return def;
  return process.platform === 'win32' ? `${letter}:\\Big Street` : path.join(os.homedir(), 'Big Street');
};
const migrateTo = letter => migrateDir(dirOnDrive(letter), `${letter}:`);
async function migrateDir(to, where = to) {
  const from = installDir(), man = readManifest(from);
  if (path.resolve(from) === path.resolve(to)) return { ok: false, error: 'Le jeu est déjà sur ce disque.' };
  if (!man) {
    // (rien d'installe : on retient seulement le nouvel emplacement)
    writeSettings({ installDir: to }); manCache = { path: '', mtime: 0, data: null }; dl = freshDl();
    return { ok: true, dir: to, moved: 0 };
  }
  const files = Object.keys(man.files).filter(p => safeDest(from, p));
  let total = 0;
  for (const p of files) { try { total += fs.statSync(safeDest(from, p)).size; } catch { /* manquant : ne sera pas copie */ } }
  try {
    fs.mkdirSync(to, { recursive: true });
    const st = fs.statfsSync(to), free = st.bavail * st.bsize;
    if (free < total * 1.05 + 50 * 1048576) return { ok: false, error: `Place insuffisante sur ${where} (${Math.round(free / 1048576)} Mo libres, ${Math.round(total / 1048576)} Mo nécessaires).` };
  } catch (e) { return { ok: false, error: `Impossible d'écrire sur ${where} (${e.code || e.message}).` }; }

  mig = { state: 'copy', done: 0, total, error: '', dir: to };
  (async () => {
    const copied = {};
    try {
      for (const p of files) {
        const src = safeDest(from, p), dst = safeDest(to, p);
        let size; try { size = fs.statSync(src).size; } catch { continue; }
        await fs.promises.mkdir(path.dirname(dst), { recursive: true });
        await fs.promises.copyFile(src, dst);
        if ((await fs.promises.stat(dst)).size !== size) throw new Error('copie incomplète : ' + p);
        copied[p] = man.files[p]; mig.done += size;
      }
      fs.writeFileSync(manifestFile(to), JSON.stringify({ ...man, files: copied }));
      writeSettings({ installDir: to });
      manCache = { path: '', mtime: 0, data: null }; dl = freshDl();
      mig.state = 'clean';
      for (const sub of ['models', 'data', 'js']) fs.rmSync(path.join(from, sub), { recursive: true, force: true });
      fs.rmSync(manifestFile(from), { force: true });
      try { fs.rmdirSync(from); } catch { /* pas vide : on le laisse */ }
      mig.state = 'done';
      log.info(`ressources migrées : ${from} → ${to} (${files.length} fichiers)`);
    } catch (e) {
      log.error('migration : ' + e);
      // (l'ancienne installation reste celle utilisee ; la copie partielle est retiree)
      for (const sub of ['models', 'data', 'js']) { try { fs.rmSync(path.join(to, sub), { recursive: true, force: true }); } catch { /* tant pis */ } }
      mig.state = 'error'; mig.error = String(e?.message || e);
    }
  })();
  return { ok: true, dir: to, moved: files.length };
}
ipcMain.handle('bs:migrate', async (_e, letter) => {
  if (dl.state === 'list' || dl.state === 'download') return { ok: false, error: 'Téléchargement en cours : attends la fin ou arrête-le.' };
  if (mig.state === 'copy' || mig.state === 'clean') return { ok: false, error: 'Déplacement déjà en cours.' };
  const L = String(letter || '').toUpperCase();
  const drives = await listDrives();
  if (!drives.some(d => d.letter === L)) return { ok: false, error: 'Disque introuvable.' };
  return migrateTo(L);
});
ipcMain.handle('bs:migrate-state', () => mig);
ipcMain.handle('bs:install-cancel', () => { if (dl.state === 'download') dl.state = 'cancel'; return { ok: true }; });
ipcMain.handle('bs:install-state', () => dl);

// --- amis ---
ipcMain.handle('bs:friends', async () => {
  const { token } = readSettings();
  if (!token) return { error: 'Connexion requise.' };
  try { return await api('friends', { token }); }
  catch (e) { log.error('amis : ' + e); return { error: 'Serveur injoignable.' }; }
});
ipcMain.handle('bs:friend-action', async (_e, { action, name }) => {
  const { token } = readSettings();
  if (!token) return { ok: false, error: 'Connexion requise.' };
  const route = { add: 'friends/request', respond: 'friends/respond', remove: 'friends/remove' }[action];
  if (!route) return { ok: false, error: 'Action inconnue.' };
  try {
    const body = action === 'respond' ? { name: name.name, accept: name.accept } : { name };
    const r = await api(route, { method: 'POST', body, token });
    if (r?.error) return { ok: false, error: r.error };
    return { ok: true, ...r };
  } catch (e) { log.error('amis : ' + e); return { ok: false, error: 'Serveur injoignable.' }; }
});

ipcMain.handle('bs:settings', () => ({ ...readSettings(), totalMb: TOTAL_MB, token: undefined, friendNotified: undefined, authNonce: undefined }));
ipcMain.handle('bs:save-settings', (_e, s) => {
  const pct = Math.min(90, Math.max(10, Number(s?.ramPercent) || 50));
  writeSettings({ ramPercent: pct });
  if (typeof s?.autoStart === 'boolean') { writeSettings({ autoStart: s.autoStart }); setAutoStart(s.autoStart); }
  return { ok: true };
});

/** Notes de version : les releases publiques du launcher. */
ipcMain.handle('bs:notes', async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=6`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    // Une release sans texte n'apprend rien au joueur : on ne l'affiche pas.
    // (sous « <!-- verification --> » : empreintes et provenance, pour qui veut
    // verifier sur GitHub, pas pour l'onglet Notes)
    const text = r => (r.body || '').split('<!-- verification -->')[0].trim();
    return list.filter(r => !r.draft && text(r)).map(r => ({
      title: r.name || r.tag_name,
      date: new Date(r.published_at).toLocaleDateString('fr-FR'),
      body: text(r).slice(0, 1200),
    }));
  } catch (e) { log.error('notes : ' + e); return []; }
});

/** Version installee, derniere version publiee, et si l'une vaut l'autre. */
ipcMain.handle('bs:version', async () => {
  const current = app.getVersion();
  let latest = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    latest = String((await res.json())?.tag_name || '').replace(/^v/, '');
  } catch (e) { log.error('version : ' + e); }
  return { current, latest, upToDate: !!latest && latest === current, packaged: app.isPackaged };
});

/**
 * Desinstallation : on lance le desinstalleur de Windows, celui qu'on trouve
 * dans le registre de l'utilisateur (NSIS l'y inscrit), sinon celui pose a cote
 * de l'executable. Le launcher se ferme ensuite : il ne peut pas s'effacer
 * lui-meme pendant qu'il tourne.
 */
function uninstallerPath() {
  try {
    const out = require('node:child_process')
      .execFileSync('reg', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${app.getName()}`,
        '/v', 'UninstallString'], { encoding: 'utf8', timeout: 4000 });
    const m = /UninstallString\s+REG_SZ\s+(.+)/.exec(out);
    const exe = m && m[1].trim().replace(/^"|"$/g, '');
    if (exe && fs.existsSync(exe)) return exe;
  } catch { /* pas dans le registre : on tente a cote de l'executable */ }
  try {
    const dir = path.dirname(app.getPath('exe'));
    for (const f of [`Uninstall ${app.getName()}.exe`, 'Uninstall Big Street.exe', 'Uninstall.exe']) {
      const full = path.join(dir, f);
      if (fs.existsSync(full)) return full;
    }
  } catch { /* rien trouve */ }
  return null;
}

ipcMain.handle('bs:uninstall', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'La desinstallation n\u2019est geree que sous Windows.' };
  if (!app.isPackaged) return { ok: false, error: 'Version de developpement : rien a desinstaller.' };
  const exe = uninstallerPath();
  if (!exe) return { ok: false, error: 'Desinstalleur introuvable. Passe par Parametres > Applications.' };
  try {
    setAutoStart(false);                   // (plus de demarrage avec Windows)
    require('node:child_process').spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(quitApp, 600);
    return { ok: true };
  } catch (e) {
    log.error('desinstallation : ' + e);
    return { ok: false, error: 'Lancement du desinstalleur impossible.' };
  }
});

// --------------------------------------------------------- Mise à jour
function updateThenStart() {
  if (!app.isPackaged) { log.info('développement : pas de mise à jour'); return Promise.resolve(false); }
  return new Promise(resolve => {
    let done = false, stall = null;
    const finish = v => { if (!done) { done = true; clearTimeout(stall); resolve(v); } };
    // Un telechargement de mise a jour qui se fige ne doit pas laisser le
    // joueur devant l'ecran de chargement : plus aucune progression pendant
    // 60 s et on demarre quand meme (elle s'installera a la fermeture).
    const timer = setTimeout(() => { log.warn('vérification trop longue'); finish(false); }, UPDATE_TIMEOUT);

    autoUpdater.on('update-not-available', () => { clearTimeout(timer); finish(false); });
    autoUpdater.on('error', e => { log.error('mise à jour : ' + (e?.message || e)); clearTimeout(timer); clearTimeout(stall); finish(false); });
    const watchStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        log.warn('téléchargement de la mise à jour figé : on démarre quand même');
        finish(false);
      }, 60000);
    };
    autoUpdater.on('update-available', i => {
      clearTimeout(timer);
      log.info(`mise à jour ${i.version}`);
      splashSay('Mise à jour du launcher…');
      watchStall();
    });
    autoUpdater.on('download-progress', p => {
      watchStall();
      splashSay(`Mise à jour du launcher… ${Math.round(p.percent)} %`);
    });
    autoUpdater.on('update-downloaded', () => {
      clearTimeout(stall);
      splashSay('Redémarrage…');
      finish(true);
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 400);
    });
    autoUpdater.checkForUpdates().catch(e => { log.error(e); clearTimeout(timer); finish(false); });
  });
}

// Controles automatiques (tools/selftest.mjs) : le module expose ses rouages
// et n'ouvre aucune fenetre.
if (process.env.BS_SELFTEST) {
  module.exports = { studio, openGame, serveLocalAssets, safeDest, runInstall, handleAuthLink, handleFriendLink, readSettings, writeSettings, installDir, migrateDir, listDrives, state: () => dl, migState: () => mig };
}

if (!process.env.BS_SELFTEST) app.whenReady().then(async () => {
  preferDedicatedGpu();
  createTray();
  setAutoStart(readSettings().autoStart);   // (reecrit a chaque lancement : suit le dossier d'installation)
  // Lien de connexion cliqué launcher fermé : on le traite une fois la fenêtre prête.
  if (startupLink) setTimeout(() => handleLink(startupLink), 1500);
  if (HIDDEN_START) {
    // (en arriere-plan : la mise a jour se telecharge sans rien montrer et s'installe a la fermeture)
    if (app.isPackaged) autoUpdater.checkForUpdates().catch(e => log.error(e));
  } else {
    createSplash();
    if (await updateThenStart()) return;   // l'application redémarre
  }
  createLauncher();
  // Demandes d'amis : un premier coup d'oeil peu apres l'ouverture, puis toutes les 30 s.
  setTimeout(friendWatch, 8000);
  setInterval(friendWatch, 30000);
});

// (toutes les fenetres fermees : il reste l'icone ; seul « Quitter » arrete l'application)
app.on('window-all-closed', () => { if (quitting) app.quit(); });
