/**
 * Console développeur du jeu (touche F10), dans une fenêtre à part — façon console de Source Engine.
 *
 *  - Journal en direct : messages du jeu, erreurs et avertissements JavaScript de la page (relevés ici, sans l'aide de la page),
 *    connexions, changements de salle, avertissements réseau ; gardé ici (3000 lignes) : il survit à un rechargement du jeu et
 *    se lit en entier quand la console s'ouvre tard.
 *  - Infos en direct publiées par la page (images/s, ping, salle, position…) complétées ici (mémoire du processus, versions).
 *  - Commandes : celles du launcher (help, clear, echo, reload, screenshot, quit, version, history) sont faites ici ; les autres
 *    partent à la page en texte brut, qui les interprète avec sa propre table (public/js/devconsole.js). Les commandes
 *    d'administration y sont envoyées au serveur, qui accepte ou refuse : le launcher ne donne aucun droit.
 *
 * Ponts : la page du jeu (preload.js, window.__bsConsole) et la fenêtre de la console (console-preload.js, window.bsCon) ;
 * chaque canal vérifie qui l'appelle. Taille, position et historique : <userData>/console.json.
 */
const { app, BrowserWindow, ipcMain, screen, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const MAX_LINES = 3000;
const LEVELS = new Set(['out', 'info', 'warn', 'error', 'net', 'room', 'game', 'chat', 'js', 'cmd', 'launcher']);

module.exports = function createConsole({ log, getGame, refreshGame, quitGame }) {
  const FILE = () => path.join(app.getPath('userData'), 'console.json');
  const readState = () => {
    try {
      const s = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
      const b = s.bounds && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(s.bounds[k])) ? s.bounds : null;
      return { bounds: b, history: Array.isArray(s.history) ? s.history.filter(x => typeof x === 'string').slice(-100) : [] };
    } catch { return { bounds: null, history: [] }; }
  };
  let state = readState();
  const saveState = () => { try { fs.mkdirSync(path.dirname(FILE()), { recursive: true }); fs.writeFileSync(FILE(), JSON.stringify(state)); } catch (e) { log.warn('console : ' + e); } };

  const lines = [];
  let win = null, stats = null, gameCmds = [], gameReady = false, appQuitting = false, metricsAt = 0, gameMem = null;
  app.on('before-quit', () => { appQuitting = true; });

  // ------------------------------------------------------------ journal (envoyé à la fenêtre par paquets, 10 fois par seconde)
  let outQ = [], outT = null;
  const flush = () => { outT = null; const q = outQ; outQ = []; if (win && !win.isDestroyed() && q.length) win.webContents.send('bs:con-lines', q); };
  function push(lvl, text, src = '') {
    const e = { t: Date.now(), lvl: LEVELS.has(lvl) ? lvl : 'info', text: String(text ?? '').slice(0, 8000), src: String(src || '').slice(0, 120) };
    lines.push(e); if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    if (win && !win.isDestroyed()) { outQ.push(e); outT ??= setTimeout(flush, 100); }
  }
  // (débit de la page bornée : 200 lignes/s, rafales de 400 ; le surplus est compté puis signalé)
  let bucket = 400, dropped = 0, lastFill = Date.now();
  const allow = () => {
    const now = Date.now(); bucket = Math.min(400, bucket + (now - lastFill) * 0.2); lastFill = now;
    if (bucket < 1) { dropped++; return false; }
    if (dropped) { push('warn', `(${dropped} lignes ignorées : trop de messages d’un coup)`); dropped = 0; }
    bucket--; return true;
  };

  // ------------------------------------------------------------ la fenêtre
  const visibleOn = b => screen.getAllDisplays().some(d => { const a = d.workArea; return b.x + b.width - 80 > a.x && b.x + 80 < a.x + a.width && b.y + 40 > a.y && b.y + 20 < a.y + a.height; });
  function bounds() {
    if (state.bounds && visibleOn(state.bounds)) return state.bounds;
    const g = getGame(), a = (g && !g.isDestroyed() ? screen.getDisplayMatching(g.getBounds()) : screen.getPrimaryDisplay()).workArea;
    const width = Math.min(980, a.width - 40), height = Math.min(560, a.height - 40);
    return { x: a.x + Math.round((a.width - width) / 2), y: a.y + 30, width, height };
  }
  let saveT = null;
  const keepBounds = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (win && !win.isDestroyed() && !win.isMinimized()) { state.bounds = win.getBounds(); saveState(); } }, 400); };
  function create() {
    const g = getGame();
    win = new BrowserWindow({
      ...bounds(), minWidth: 560, minHeight: 300, title: 'Console — Big Street',
      backgroundColor: '#0e1013', show: false, autoHideMenuBar: true,
      // (rattachée au jeu : elle reste devant lui, même en plein écran, et se ferme avec lui)
      ...(g && !g.isDestroyed() ? { parent: g } : {}),
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'console-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    });
    win.setMenuBarVisibility(false);
    win.on('page-title-updated', e => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F10' && !input.isAutoRepeat) { e.preventDefault(); hide(); }
    });
    win.on('moved', keepBounds); win.on('resized', keepBounds);
    // (la croix range la console ; elle n'est détruite qu'avec le jeu, ou à la fermeture du launcher)
    win.on('close', e => { if (!appQuitting && getGame() && !getGame().isDestroyed()) { e.preventDefault(); hide(); } });
    win.on('closed', () => { win = null; outQ = []; });
    win.loadFile(path.join(__dirname, 'console', 'console.html'));
    return win;
  }
  const isOpen = () => !!(win && !win.isDestroyed() && win.isVisible());
  const tellGame = on => { const g = getGame(); if (g && !g.isDestroyed()) g.webContents.send('bs:con-open', on); };
  function show() {
    if (!win || win.isDestroyed()) { create(); win.once('ready-to-show', () => { if (!win) return; win.show(); win.focus(); tellGame(true); }); return win; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus(); tellGame(true);
    return win;
  }
  function hide() {
    if (!win || win.isDestroyed()) return;
    if (!win.isMinimized()) { state.bounds = win.getBounds(); saveState(); }
    win.hide(); tellGame(false);
    const g = getGame(); if (g && !g.isDestroyed()) g.focus();
  }
  const toggle = () => (isOpen() ? hide() : show());

  // ------------------------------------------------------------ branchement sur la fenêtre du jeu (appelé par openGame)
  function attachGame(g) {
    const wc = g.webContents;
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F10' && !input.isAutoRepeat) { e.preventDefault(); toggle(); }
    });
    // (erreurs et messages JavaScript de la page, sans son aide : une page ancienne ou cassée est aussi visible)
    wc.on('console-message', (_e, level, message, line, sourceId) => {
      if (level < 1 || !allow()) return;
      const where = sourceId ? `${String(sourceId).replace(/^.*\//, '').replace(/\?.*$/, '')}:${line}` : '';
      push(level >= 3 ? 'error' : level === 2 ? 'warn' : 'js', message, where);
    });
    wc.on('did-start-navigation', (_e, url, inPage, isMain) => { if (isMain && !inPage) { gameReady = false; gameCmds = []; push('launcher', `Chargement de la page : ${url}`); sendCmds(); } });
    wc.on('did-finish-load', () => push('launcher', 'Page chargée.'));
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain) push('error', `Chargement échoué (${code} ${desc}) : ${url}`); });
    wc.on('render-process-gone', (_e, d) => push('error', `Processus du jeu interrompu : ${d.reason} (code ${d.exitCode})`));
    wc.on('unresponsive', () => push('warn', 'Le jeu ne répond plus…'));
    wc.on('responsive', () => push('launcher', 'Le jeu répond de nouveau.'));
    g.on('closed', () => { gameReady = false; gameCmds = []; stats = null; if (win && !win.isDestroyed()) win.destroy(); win = null; });
    push('launcher', `Fenêtre du jeu ouverte (launcher ${app.getVersion()}).`);
  }

  // ------------------------------------------------------------ commandes du launcher
  const LCMDS = [
    { name: 'help', args: '[commande]', help: 'liste des commandes' },
    { name: 'clear', help: 'vider le journal' },
    { name: 'echo', args: '<texte>', help: 'écrire dans le journal' },
    { name: 'version', help: 'versions du launcher, du moteur et du jeu' },
    { name: 'history', help: 'dernières commandes tapées' },
    { name: 'reload', help: 'recharger le jeu (cache vidé)' },
    { name: 'screenshot', help: 'capture du jeu dans Images/Big Street' },
    { name: 'quit', help: 'fermer le jeu (le launcher reste)' },
  ].map(c => ({ ...c, src: 'launcher' }));
  const allCmds = () => [...LCMDS, ...gameCmds.map(c => ({ ...c, src: 'jeu' }))];
  const sendCmds = () => { if (win && !win.isDestroyed()) win.webContents.send('bs:con-cmds', allCmds()); };
  const cleanCmds = j => {
    let a; try { a = JSON.parse(j); } catch { return []; }
    if (!Array.isArray(a)) return [];
    return a.slice(0, 200).filter(c => c && typeof c.name === 'string' && /^[a-z_][a-z0-9_]{0,31}$/.test(c.name) && !LCMDS.some(l => l.name === c.name))
      .map(c => ({ name: c.name, args: String(c.args || '').slice(0, 80), help: String(c.help || '').slice(0, 160), admin: !!c.admin,
        opts: Array.isArray(c.opts) ? c.opts.filter(o => typeof o === 'string').slice(0, 50).map(o => o.slice(0, 40)) : undefined }));
  };
  const say = t => push('out', t);
  async function exec(raw) {
    const line = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
    if (!line) return;
    if (state.history.at(-1) !== line) { state.history.push(line); state.history = state.history.slice(-100); saveState(); }
    push('cmd', line);
    const [name0, ...args] = line.split(/\s+/), name = name0.toLowerCase(), g = getGame();
    switch (name) {
      case 'help': {
        const list = allCmds(), q = (args[0] || '').toLowerCase();
        if (q) { const c = list.find(x => x.name === q); return say(c ? `${c.name} ${c.args || ''}\n  ${c.help || ''}${c.admin ? ' (administrateur : le serveur vérifie)' : ''}` : `Commande inconnue : ${q}`); }
        const row = c => `  ${(c.name + ' ' + (c.args || '')).padEnd(34)} ${c.help || ''}`;
        const L = list.filter(c => c.src === 'launcher'), J = list.filter(c => c.src === 'jeu' && !c.admin), A = list.filter(c => c.admin);
        return say(['Launcher :', ...L.map(row), ...(J.length ? ['Jeu :', ...J.map(row)] : [g ? '(commandes du jeu : la page n’est pas encore prête)' : '(commandes du jeu : lance d’abord le jeu)']),
          ...(A.length ? ['Administration (le serveur vérifie tes droits) :', ...A.map(row)] : []), 'Tab : compléter · ↑ ↓ : historique · F10 : ouvrir / fermer'].join('\n'));
      }
      case 'clear': lines.length = 0; outQ = []; if (win && !win.isDestroyed()) win.webContents.send('bs:con-clear'); return;
      case 'echo': return say(args.join(' '));
      case 'version': return say(`launcher ${app.getVersion()} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome}${stats?.game ? ` · jeu ${stats.game}` : ''}`);
      case 'history': return say(state.history.slice(-20).map((h, i, a) => `  ${String(state.history.length - a.length + i + 1).padStart(3)}  ${h}`).join('\n') || '(vide)');
      case 'reload': if (!g || g.isDestroyed()) return say('Le jeu n’est pas ouvert.'); say('Rechargement du jeu…'); return refreshGame();
      case 'quit': if (!g || g.isDestroyed()) return say('Le jeu n’est pas ouvert.'); return quitGame();
      case 'screenshot': {
        if (!g || g.isDestroyed()) return say('Le jeu n’est pas ouvert.');
        try {
          const img = await g.webContents.capturePage();
          const dir = path.join(app.getPath('pictures'), 'Big Street'), d = new Date(), p2 = n => String(n).padStart(2, '0');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `capture-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`);
          fs.writeFileSync(file, img.toPNG());
          return say(`Capture enregistrée : ${file}`);
        } catch (e) { return push('error', 'Capture impossible : ' + (e?.message || e)); }
      }
    }
    if (!g || g.isDestroyed()) return say('Le jeu n’est pas ouvert.');
    if (!gameReady) return push('warn', 'Le jeu ne répond pas encore aux commandes (page en cours de chargement, ou version du jeu sans console).');
    g.webContents.send('bs:con-run', { line });
  }

  // ------------------------------------------------------------ ponts
  const fromGame = e => { const g = getGame(); return !!(g && !g.isDestroyed() && e.sender === g.webContents); };
  const fromCon = e => !!(win && !win.isDestroyed() && e.sender === win.webContents);
  ipcMain.on('bs:con-log', (e, lvl, text) => { if (fromGame(e) && allow()) push(['cmd', 'launcher', 'js'].includes(lvl) ? 'info' : lvl, text); });
  ipcMain.on('bs:con-stats', (e, j) => {
    if (!fromGame(e) || typeof j !== 'string' || j.length > 8000) return;
    try { stats = JSON.parse(j); } catch { return; }
    const now = Date.now(), g = getGame();
    if (now - metricsAt > 2000 && g) {
      metricsAt = now;
      try { const pid = g.webContents.getOSProcessId(), m = app.getAppMetrics().find(x => x.pid === pid); gameMem = m ? Math.round(m.memory.workingSetSize / 1024) : null; } catch { gameMem = null; }
    }
    if (win && !win.isDestroyed()) win.webContents.send('bs:con-stats', { ...stats, procMem: gameMem, launcher: app.getVersion() });
  });
  ipcMain.on('bs:con-cmds', (e, j) => { if (!fromGame(e)) return; gameCmds = cleanCmds(j); sendCmds(); });
  ipcMain.handle('bs:con-hello', (e, j) => { if (!fromGame(e)) return null; gameReady = true; gameCmds = cleanCmds(j); sendCmds(); push('launcher', 'Console reliée au jeu.'); return { open: isOpen() }; });
  ipcMain.handle('bs:con-init', e => (fromCon(e) ? { lines, cmds: allCmds(), history: state.history, stats: stats ? { ...stats, procMem: gameMem, launcher: app.getVersion() } : { launcher: app.getVersion() } } : null));
  ipcMain.handle('bs:con-exec', (e, line) => (fromCon(e) ? exec(line).then(() => true, err => { push('error', String(err?.message || err)); return false; }) : false));
  ipcMain.handle('bs:con-copy', (e, text) => { if (!fromCon(e) || typeof text !== 'string') return false; clipboard.writeText(text.slice(0, 2e6)); return true; });
  ipcMain.handle('bs:con-hide', e => { if (fromCon(e)) hide(); return true; });

  return { attachGame, show, hide, toggle, isOpen, exec, push, window: () => win, lines: () => lines, ready: () => gameReady };
};
