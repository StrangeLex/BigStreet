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
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog, net } = require('electron');
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

// Connexion Google / Twitch : elle s'ouvre dans le vrai navigateur (Google
// refuse les fenetres embarquees), et le site nous rend la main par un lien
// « bigstreet://auth#... ». Il faut donc que Windows sache a qui l'adresser.
const PROTOCOL = 'bigstreet';
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else app.setAsDefaultProtocolClient(PROTOCOL);
const authLinkIn = argv => (argv || []).find(a => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`)) || null;

// ------------------------------------------------------------- Réglages
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const TOTAL_MB = Math.round(os.totalmem() / 1048576);

function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch {}
  // Par défaut, le jeu peut utiliser la moitié de la mémoire de la machine.
  const pct = Math.min(90, Math.max(10, Number(s.ramPercent) || 50));
  return { ramPercent: pct, token: typeof s.token === 'string' ? s.token : '',
    installDir: typeof s.installDir === 'string' ? s.installDir : '' };
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
  // Le site refuse les POST sans en-tete Origin (protection anti-CSRF des
  // navigateurs). fetch() cote Node n'en envoie pas : on le pose nous-memes,
  // sinon connexion, inscription et deconnexion repondent « Origine refusee ».
  if (method !== 'GET') headers['Origin'] = SITE;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${SITE}/api/${route}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let account = null;   // compte connecté, en mémoire seulement

// --------------------------------------------------------------- Fenêtres
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const w = game || launcher;
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  const link = authLinkIn(argv);
  if (link) handleAuthLink(link);
});
app.on('open-url', (e, url) => { e.preventDefault(); handleAuthLink(url); });   // (macOS)

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

  serveLocalAssets(game.webContents.session);

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

/**
 * Retour de Google / Twitch, via « bigstreet://auth#... ».
 *  - session=<jeton>        : le compte existait, on est connecte
 *  - google=<jeton>&name=.. : premiere venue, il reste a choisir un pseudo
 *  - ...Error=<message>     : refus ou annulation
 */
async function handleAuthLink(raw) {
  const q = new URLSearchParams(String(raw).split('#')[1] || '');
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
    writeSettings({ token: session });
    try { const me = await api('me', { token: session }); account = me?.account || null; } catch { account = null; }
    return send(account ? { ok: true, account } : { ok: false, error: 'Session refusee par le site.' });
  }
  for (const provider of ['google', 'twitch']) {
    const pending = q.get(provider);
    if (pending) return send({ ok: true, provider, pending, suggest: q.get('name') || '' });
  }
  send({ ok: false, error: 'Reponse inattendue du site.' });
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

function readManifest(dir = installDir()) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile(dir), 'utf8'));
    return m && m.files ? m : null;
  } catch { return null; }
}

// Etat du telechargement, lu par la page « Telechargement » (debit, reste, etc.)
let dl = { state: 'idle', done: 0, total: 0, files: 0, count: 0, speed: 0, maxSpeed: 0, eta: 0, error: '' };
const MIME = { '.json': 'application/json', '.bbmodel': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

async function runInstall(dir) {
  dl = { state: 'list', done: 0, total: 0, files: 0, count: 0, speed: 0, maxSpeed: 0, eta: 0, error: '' };
  try {
    const list = await api('assets');
    if (!Array.isArray(list?.files) || !list.files.length) throw new Error('liste de ressources vide');
    dl.total = list.total; dl.count = list.files.length; dl.state = 'download';

    fs.mkdirSync(dir, { recursive: true });
    const versions = {};
    // Debit : mesure sur une fenetre glissante d'environ 3 s, pour une valeur
    // stable a l'affichage sans lisser au point de ne plus rien dire.
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

    const queue = list.files.slice();
    const worker = async () => {
      while (queue.length) {
        if (dl.state === 'cancel') return;
        const f = queue.shift();
        const dest = path.join(dir, f.p.replace(/^\//, ''));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const url = `${SITE}${f.p}${f.v ? `?v=${encodeURIComponent(f.v)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${f.p} : ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);
        versions[f.p] = f.v || '';
        dl.files++; bump(buf.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (dl.state === 'cancel') { dl.state = 'idle'; return; }

    fs.writeFileSync(manifestFile(dir), JSON.stringify({ at: Date.now(), site: SITE, files: versions }));
    writeSettings({ installDir: dir });
    dl.state = 'done'; dl.speed = 0; dl.eta = 0;
    log.info(`ressources installees dans ${dir} (${dl.files} fichiers)`);
  } catch (e) {
    log.error('installation : ' + e);
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
  const man = readManifest();
  if (!man || session.__bsAssets) return;
  session.__bsAssets = true;
  const dir = installDir();
  session.protocol.handle('https', req => {
    try {
      const u = new URL(req.url);
      if (`${u.protocol}//${u.host}` === SITE && req.method === 'GET') {
        const v = man.files[u.pathname];
        const want = u.searchParams.get('v') || '';
        if (v !== undefined && (!want || want === v)) {
          const file = path.join(dir, u.pathname.replace(/^\//, ''));
          if (fs.existsSync(file)) {
            return new Response(fs.readFileSync(file), {
              headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' },
            });
          }
        }
      }
    } catch { /* au moindre doute : le reseau */ }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  log.info(`ressources locales servies depuis ${dir}`);
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
    const r = await api(`auth/${provider}/start`, { method: 'POST', body: { app: true } });
    if (r?.error) return { ok: false, error: r.error };
    if (!r?.url) return { ok: false, error: 'Reponse inattendue du serveur.' };
    await shell.openExternal(r.url);
    return { ok: true };
  } catch (e) {
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
  const win = launcher && !launcher.isDestroyed() ? launcher : undefined;
  const r = await dialog.showOpenDialog(win, {
    title: 'Ou installer les ressources de Big Street ?',
    defaultPath: installDir(),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Installer ici',
  });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false };
  const dir = path.join(r.filePaths[0], 'Big Street');
  writeSettings({ installDir: dir });
  return { ok: true, dir };
});

ipcMain.handle('bs:install-start', async (_e, dir) => {
  if (dl.state === 'list' || dl.state === 'download') return { ok: false, error: 'Telechargement deja en cours.' };
  const target = dir || installDir();
  runInstall(target);               // (en tache de fond : l'interface suit l'etat)
  return { ok: true, dir: target };
});
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
    // Une release sans texte n'apprend rien au joueur : on ne l'affiche pas.
    return list.filter(r => !r.draft && (r.body || '').trim()).map(r => ({
      title: r.name || r.tag_name,
      date: new Date(r.published_at).toLocaleDateString('fr-FR'),
      body: r.body.trim().slice(0, 1200),
    }));
  } catch (e) { log.error('notes : ' + e); return []; }
});

/** Version installee, derniere version publiee, et si l'une vaut l'autre. */
ipcMain.handle('bs:version', async () => {
  const current = app.getVersion();
  let latest = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } });
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
    require('node:child_process').spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 600);
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
