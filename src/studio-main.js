/**
 * Studio — côté processus principal.
 *
 *  1. Enregistrement : la page du jeu envoie des morceaux de record (pont « __bsStudio » de preload.js) ; c'est ici
 *     qu'ils sont écrits, dans un fichier « .bsrec » dont le launcher choisit seul le nom et l'emplacement (dossier
 *     Documents/Big Street/Studio). La page ne donne jamais de chemin, un seul record est ouvert à la fois, sa taille
 *     et sa durée sont plafonnées, et il est refermé d'ici si la fenêtre du jeu se ferme ou se recharge.
 *  2. La fenêtre « Big Street Studio » : une application à part du jeu, qui relit ces records. Elle n'a pas accès au
 *     réseau : tout ce qu'elle demande passe par le relais ci-dessous, qui ne sert que l'interface du Studio (src/studio),
 *     les records, et une copie locale du moteur de rendu du jeu (scripts d'affichage, modèles, plan de la ville) —
 *     prise sur le site quand il répond, relue sur le disque sinon. Le Studio fonctionne donc hors ligne.
 *  3. Le compte et l'assistant IA : la page du Studio n'a ni réseau ni jeton de session. C'est ce processus qui demande au site
 *     qui est connecté (pseudo, admin, VIP, skins possédés — gardés en copie pour le hors-ligne) et qui relaie les échanges de
 *     l'assistant vers POST /api/studio/ai (réservé aux comptes VIP par le site). Le jeton ne passe jamais dans la page.
 */
const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const REC = require('./records.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.bbmodel': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
// (ce que le Studio peut demander au site : de quoi dessiner le jeu, rien d'autre — ni compte, ni API)
const MIRROR = /^\/(js|vendor|models|data|css|fonts|img|lootbox)\/[A-Za-z0-9._\-/@+]+$/;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

module.exports = function setupStudio({ SITE, log, getGame, getLauncher, installDir, readManifest, safeDest, getToken = () => '' }) {
  // ------------------------------------------------------------ Dossiers
  let dirCache = null;
  /** Dossier des records : Documents/Big Street/Studio (à défaut, le dossier de l'application). */
  function recordsDir() {
    if (process.env.BS_STUDIO_DIR) { fs.mkdirSync(process.env.BS_STUDIO_DIR, { recursive: true }); return process.env.BS_STUDIO_DIR; }
    if (dirCache && fs.existsSync(dirCache)) return dirCache;
    for (const base of [() => app.getPath('documents'), () => app.getPath('userData')]) {
      try { const d = path.join(base(), 'Big Street', 'Studio'); fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return (dirCache = d); } catch { /* suivant */ }
    }
    throw new Error('aucun dossier accessible');
  }
  const cacheDir = () => path.join(process.env.BS_STUDIO_CACHE || app.getPath('userData'), 'studio-cache');

  // ------------------------------------------------------------ 1. Enregistrement
  let rec = null, studio = null;
  const fromGame = e => { const g = getGame(); return !!g && !g.isDestroyed() && e.sender === g.webContents; };
  const fromStudio = e => !!studio && !studio.isDestroyed() && e.sender === studio.webContents;
  const tellStudio = () => { if (studio && !studio.isDestroyed()) studio.webContents.send('bs:studio-changed'); };

  async function recClose(patch = {}) {
    const r = rec; rec = null; if (!r) return null;
    const file = await r.close(patch);
    log.info(`studio : record ${file ? 'gardé ' + path.basename(file) : 'écarté (trop court)'} — ${patch.reason || ''}`);
    tellStudio();
    return file;
  }
  ipcMain.handle('bs:rec-start', async (e, meta) => {
    if (!fromGame(e)) return { ok: false };
    await recClose({ reason: 'remplacé' });
    try {
      const dir = recordsDir(), clean = REC.cleanMeta({ ...meta, launcher: app.getVersion() });
      let file = path.join(dir, REC.fileName(clean));
      for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, REC.fileName(clean).replace(REC.EXT, `-${i}${REC.EXT}`));
      rec = REC.createWriter(file, clean);
      log.info('studio : record ouvert ' + path.basename(file));
      tellStudio();
      return { ok: true };
    } catch (err) { log.warn('studio : record impossible : ' + err); return { ok: false, error: 'dossier des records inaccessible.' }; }
  });
  ipcMain.on('bs:rec-chunk', (e, text) => { if (rec && fromGame(e) && !rec.write(text)) recClose({ reason: 'limite' }); });
  ipcMain.handle('bs:rec-stop', async (e, patch) => {
    if (!fromGame(e)) return { ok: false };
    const p = patch && typeof patch === 'object' ? patch : {};
    return { ok: true, kept: !!await recClose({ dur: p.dur, lines: p.lines, reason: p.reason }) };
  });
  ipcMain.handle('bs:rec-folder', e => { if (fromGame(e) || fromStudio(e)) { try { shell.openPath(recordsDir()); } catch { /* pas de dossier */ } } });

  /** À brancher sur chaque fenêtre de jeu : elle se ferme, se recharge ou plante — le record en cours est refermé. */
  function watchGame(win) {
    win.on('closed', () => { recClose({ reason: 'fermeture' }); });
    win.webContents.on('did-start-navigation', (_e, _url, inPage, isMain) => { if (isMain && !inPage) recClose({ reason: 'rechargement' }); });
    win.webContents.on('render-process-gone', () => { recClose({ reason: 'plantage' }); });
  }
  app.on('before-quit', () => { recClose({ reason: 'fermeture' }); });

  // ------------------------------------------------------------ 2. Le relais du Studio
  let idx = null, idxTimer = null, offlineUntil = process.env.BS_STUDIO_OFFLINE ? Infinity : 0;   // (BS_STUDIO_OFFLINE : essais hors ligne)
  const idxFile = () => path.join(cacheDir(), 'index.json');
  const index = () => { if (!idx) { try { idx = JSON.parse(fs.readFileSync(idxFile(), 'utf8')); } catch { idx = {}; } } return idx; };
  const indexSave = () => { clearTimeout(idxTimer); idxTimer = setTimeout(() => { try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(idxFile(), JSON.stringify(idx)); } catch { /* tant pis */ } }, 1500); };
  const reply = (body, file, status = 200, extra = {}) => new Response(body, { status, headers: { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', ...extra } });
  const none = (status = 404) => new Response('', { status });
  const cachePath = p => { const f = path.resolve(cacheDir(), 'files', p.replace(/^\//, '')); return f.startsWith(path.resolve(cacheDir(), 'files') + path.sep) ? f : null; };
  const readOr = async f => { try { return await fs.promises.readFile(f); } catch { return null; } };

  async function mirror(ses, u) {
    const p = u.pathname, want = u.searchParams.get('v') || '';
    if (!MIRROR.test(p) || p.includes('..')) return none();
    // (les ressources installées par le joueur : même copie que celle servie au jeu)
    const inst = /^\/(models|data)\//.test(p) ? (() => { const dir = installDir(), v = readManifest(dir)?.files?.[p]; return v === undefined ? null : { v, file: safeDest(dir, p) }; })() : null;
    if (inst?.file && want && want === inst.v) { const b = await readOr(inst.file); if (b) return reply(b, p); }
    const cf = cachePath(p);
    if (cf && want && index()[p] === want) { const b = await readOr(cf); if (b) return reply(b, p); }
    if (Date.now() > offlineUntil) {
      try {
        const r = await ses.fetch(SITE + p + u.search, { bypassCustomProtocolHandlers: true, cache: 'no-cache', signal: AbortSignal.timeout(20000) });
        if (r.ok) {
          const b = Buffer.from(await r.arrayBuffer());
          if (cf) { try { await fs.promises.mkdir(path.dirname(cf), { recursive: true }); await fs.promises.writeFile(cf + '.tmp', b); await fs.promises.rename(cf + '.tmp', cf); index()[p] = want || r.headers.get('etag') || '1'; indexSave(); } catch { /* disque plein : servi quand même */ } }
          return reply(b, p);
        }
        if (r.status === 404) return none();
      } catch { offlineUntil = Date.now() + 20000; log.info('studio : site injoignable, copie locale'); }
    }
    // (hors ligne : la copie locale, quelle que soit sa version)
    if (cf) { const b = await readOr(cf); if (b) return reply(b, p); }
    if (inst?.file) { const b = await readOr(inst.file); if (b) return reply(b, p); }
    log.info('studio : absent de la copie locale : ' + p);
    return none(504);
  }

  function serveStudio(ses) {
    if (ses.__bsStudio) return;
    ses.__bsStudio = true;
    ses.protocol.handle('https', async req => {
      try {
        const u = new URL(req.url);
        if (u.origin !== SITE || req.method !== 'GET') return none(403);
        if (u.pathname.startsWith('/__studio/rec/')) {
          const file = REC.safeFile(recordsDir(), decodeURIComponent(u.pathname.slice('/__studio/rec/'.length)));
          if (!file || !fs.existsSync(file)) return none();
          return new Response(REC.readBody(file), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        if (u.pathname.startsWith('/__studio/')) {
          const name = u.pathname.slice('/__studio/'.length);
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return none();
          const b = await readOr(path.join(__dirname, 'studio', name));
          return b ? reply(b, name, 200, name.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {}) : none();
        }
        return await mirror(ses, u);
      } catch (err) { log.warn('studio : relais : ' + err); return none(500); }
    });
    for (const scheme of ['http', 'ws', 'wss']) { try { ses.protocol.handle(scheme, () => none(403)); } catch { /* schéma non interceptable : la CSP l'interdit déjà */ } }
  }

  // ------------------------------------------------------------ La fenêtre
  function openStudio() {
    if (studio && !studio.isDestroyed()) { if (studio.isMinimized()) studio.restore(); studio.show(); studio.focus(); return studio; }
    const ses = session.fromPartition(process.env.BS_SELFTEST ? 'bs-studio-test' : 'persist:bs-studio');
    serveStudio(ses);
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'pointerLock' || perm === 'fullscreen'));
    studio = new BrowserWindow({
      width: 1440, height: 860, minWidth: 1040, minHeight: 640,
      backgroundColor: '#0b0f17', show: false, title: 'Big Street Studio',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'studio-preload.js'), session: ses,
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      },
    });
    studio.setMenuBarVisibility(false);
    studio.on('page-title-updated', e => e.preventDefault());
    studio.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    studio.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${SITE}/__studio/`)) e.preventDefault(); });
    studio.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) { e.preventDefault(); studio.setFullScreen(!studio.isFullScreen()); }
    });
    studio.once('ready-to-show', () => studio.show());
    studio.on('closed', () => {
      studio = null; exportEnd();
      const g = getGame(), l = getLauncher();
      if ((!g || g.isDestroyed()) && l && !l.isDestroyed() && !l.isVisible() && !process.env.BS_SELFTEST) l.show();
    });
    studio.loadURL(`${SITE}/__studio/studio.html`);
    log.info('studio : ouvert');
    return studio;
  }
  ipcMain.handle('bs:studio-open', e => { const l = getLauncher(); if (!l || l.isDestroyed() || e.sender !== l.webContents) return { ok: false }; openStudio(); return { ok: true }; });

  // ------------------------------------------------------------ Ce que la fenêtre du Studio peut demander
  const guard = fn => async (e, ...a) => { if (!fromStudio(e)) return null; try { return await fn(...a); } catch (err) { log.warn('studio : ' + err); return null; } };
  ipcMain.handle('bs:studio-info', guard(() => ({ version: app.getVersion(), dir: recordsDir() })));
  ipcMain.handle('bs:studio-list', guard(() => ({ dir: recordsDir(), recording: rec ? path.basename(rec.file) : null, records: REC.list(recordsDir(), rec?.file) })));
  ipcMain.handle('bs:studio-delete', guard(async name => {
    const file = REC.safeFile(recordsDir(), name); if (!file) return { ok: false };
    const r = await dialog.showMessageBox(studio, { type: 'warning', buttons: ['Supprimer', 'Annuler'], defaultId: 1, cancelId: 1, title: 'Big Street Studio',
      message: 'Supprimer ce record ?', detail: `${name}\nSa cinématique enregistrée sera supprimée avec lui.` });
    if (r.response !== 0) return { ok: false };
    for (const f of [file, REC.projectFile(file)]) { try { fs.unlinkSync(f); } catch { /* déjà parti */ } }
    return { ok: true };
  }));
  ipcMain.handle('bs:studio-reveal', guard(name => { const file = REC.safeFile(recordsDir(), name); if (file) shell.showItemInFolder(file); else shell.openPath(recordsDir()); return { ok: true }; }));
  ipcMain.handle('bs:studio-project-load', guard(name => {
    const file = REC.safeFile(recordsDir(), name); if (!file) return null;
    try { return fs.readFileSync(REC.projectFile(file), 'utf8'); } catch { return null; }
  }));
  ipcMain.handle('bs:studio-project-save', guard((name, json) => {
    const file = REC.safeFile(recordsDir(), name); if (!file || typeof json !== 'string' || json.length > 4e6) return { ok: false };
    JSON.parse(json);   // (un projet illisible n'écrase pas le précédent)
    fs.writeFileSync(REC.projectFile(file), json);
    return { ok: true };
  }));
  // Export vidéo : la page envoie le fichier .webm par morceaux ; il est écrit à côté du record
  let exp = null;
  function exportEnd() { const x = exp; exp = null; if (!x) return Promise.resolve(null); return new Promise(res => x.out.end(() => res(x.file))); }
  ipcMain.handle('bs:studio-export-start', guard(async name => {
    await exportEnd();
    const file = REC.safeFile(recordsDir(), name); if (!file) return { ok: false };
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const out = file.slice(0, -REC.EXT.length) + `_cinematique_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.webm`;
    exp = { file: out, out: fs.createWriteStream(out), size: 0 };
    exp.out.on('error', () => {});
    return { ok: true };
  }));
  ipcMain.on('bs:studio-export-chunk', (e, data) => {
    if (!exp || !fromStudio(e) || !(data instanceof Uint8Array) || exp.size + data.length > 8e9) return;
    exp.size += data.length; exp.out.write(Buffer.from(data.buffer, data.byteOffset, data.length));
  });
  ipcMain.handle('bs:studio-export-end', guard(async () => { const file = await exportEnd(); if (file) shell.showItemInFolder(file); return { ok: !!file, file: file ? path.basename(file) : null }; }));

  // ------------------------------------------------------------ 3. Compte (skins possédés, VIP) et assistant IA
  const accountFile = () => path.join(process.env.BS_STUDIO_CACHE || app.getPath('userData'), 'studio-account.json');
  const site = async (route, { method = 'GET', body, timeout = 12000 } = {}) => {
    const token = getToken(); if (!token) return { status: 401, json: null };
    const r = await fetch(`${SITE}/api/${route}`, { method, signal: AbortSignal.timeout(timeout),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(method !== 'GET' ? { Origin: SITE, 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* réponse vide */ }
    return { status: r.status, json };
  };
  const cleanAccount = (a, online) => ({ name: String(a.name || '').slice(0, 32), admin: !!a.admin, vip: !!(a.vip || a.admin), vipUntil: +a.vipUntil || 0,
    owned: Array.isArray(a.owned) ? a.owned.filter(k => typeof k === 'string' && k.length < 80).slice(0, 5000) : [], online, at: online ? Date.now() : +a.at || 0 });
  /** Le compte connecté au launcher : { name, admin, vip, owned, online } — demandé au site, sinon la dernière copie ; null : personne */
  async function studioAccount() {
    if (process.env.BS_STUDIO_ACCOUNT) { try { return cleanAccount(JSON.parse(process.env.BS_STUDIO_ACCOUNT), true); } catch { return null; } }   // (essais)
    if (!getToken()) return null;
    if (!process.env.BS_STUDIO_OFFLINE) {
      for (const route of ['me', 'studio/me']) {
        try {
          const r = await site(route); const a = r.json?.account || (r.json?.name ? r.json : null);
          if (r.status === 200 && r.json && 'account' in r.json && !r.json.account) return null;   // (session refusée par le site)
          if (a?.name) { const acc = cleanAccount(a, true); try { fs.mkdirSync(path.dirname(accountFile()), { recursive: true }); fs.writeFileSync(accountFile(), JSON.stringify(acc)); } catch { /* tant pis */ } return acc; }
        } catch { break; }   // (site injoignable : la copie)
      }
    }
    try { return cleanAccount(JSON.parse(fs.readFileSync(accountFile(), 'utf8')), false); } catch { return null; }
  }
  ipcMain.handle('bs:studio-account', guard(studioAccount));
  // (l'assistant : un échange à la fois, corps borné ; le site vérifie le VIP, le débit et choisit le modèle)
  let aiBusy = false;
  ipcMain.handle('bs:studio-ai', async (e, body) => {
    if (!fromStudio(e)) return { error: 'refusé' };
    if (!getToken()) return { error: 'Connecte-toi dans le launcher pour utiliser l’assistant.', login: true };
    if (aiBusy) return { error: 'Une demande est déjà en cours.' };
    let json; try { json = JSON.stringify(body); } catch { return { error: 'Demande illisible.' }; }
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || json.length > 400000) return { error: 'Demande trop longue : commence une nouvelle conversation.' };
    aiBusy = true;
    try {
      const r = await site('studio/ai', { method: 'POST', body: { messages: body.messages, tools: Array.isArray(body.tools) ? body.tools : undefined }, timeout: 90000 });
      if (r.status === 403 && r.json?.vip === false) return { error: r.json.error || 'Fonctionnalité Studio VIP', vip: false };
      if (r.status === 404) return { error: 'L’assistant n’est pas encore disponible sur le site.' };
      if (!r.json) return { error: `Le site n’a pas répondu (${r.status}).` };
      return r.json;
    } catch (err) { log.info('studio : assistant : ' + err); return { error: /timeout|aborted/i.test(String(err)) ? 'L’assistant met trop de temps à répondre : réessaie.' : 'Site injoignable : l’assistant a besoin d’Internet.' }; }
    finally { aiBusy = false; }
  });
  ipcMain.handle('bs:studio-shop', guard(() => { shell.openExternal(`${SITE}/?boutique=vip`); return { ok: true }; }));

  return { openStudio, watchGame, serveStudio, recordsDir, recClose, studioAccount, get window() { return studio; } };
};
