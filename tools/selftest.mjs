/**
 * Contrôles automatiques du launcher. À lancer avant de poser un tag :
 *
 *     npx electron tools/selftest.mjs            (ou : npm run selftest)
 *
 * Ce qui est vérifié, dans l'ordre :
 *  1. identifiants référencés par launcher.js mais absents de launcher.html
 *     (c'est ce qui avait cassé le bouton « Lancer » en 1.4.0)
 *  2. aucun gestionnaire « on… » en dur dans le HTML (la CSP les refuse)
 *  3. chemins d'installation : pas de remontée de dossier possible
 *  4. installation complète, puis reprise (rien à retélécharger)
 *  5. réparation d'un fichier abîmé
 *  6. un lien « bigstreet:// » forgé sans jeton est ignoré (connexion, demande d'ami)
 *  7. Studio : format des records (écriture, relecture, fichier coupé net), noms de fichiers sûrs, fenêtre du
 *     Studio servie en local (interface, moteur du jeu) et fermée au reste du site
 *  8. Studio : caméras d'un projet (anciens formats relus, une piste d'images-clés par paramètre, parents, enchaînement)
 *
 * Le test écrit dans un dossier temporaire et le supprime à la fin ; il ne
 * touche ni aux réglages du joueur, ni au dossier d'installation réel.
 */
import { readFileSync, writeFileSync, statSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.BIGSTREET_URL || 'https://playbigstreet.com').replace(/\/+$/, '');
let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

// ---------------------------------------------------------------- 1 et 2 : interface
function checkMarkup() {
  const html = readFileSync(path.join(root, 'src/launcher.html'), 'utf8');
  const js = readFileSync(path.join(root, 'src/launcher.js'), 'utf8');
  const inHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(i => !inHtml.has(i));
  ok('identifiants de l’interface', missing.length === 0, missing.join(', '));
  const inline = html.match(/\son[a-z]+="/g) || [];
  ok('aucun gestionnaire en dur (CSP)', inline.length === 0, inline.join(' '));
  // (le Studio : mêmes contrôles sur sa page)
  const sHtml = readFileSync(path.join(root, 'src/studio/studio.html'), 'utf8'), sJs = ['studio.js', 'cams.js', 'fx.js', 'gizmo.js'].map(f => readFileSync(path.join(root, 'src/studio', f), 'utf8')).join('\n');
  const sIn = new Set([...sHtml.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const sMiss = [...new Set([...sJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))].filter(i => !sIn.has(i));
  ok('identifiants du Studio', sMiss.length === 0, sMiss.join(', '));
  const byId = [...new Set([...sJs.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))].filter(i => !sIn.has(i));
  ok('identifiants du Studio (par nom)', byId.length === 0, byId.join(', '));
  ok('Studio : ni gestionnaire ni script en dur (CSP)', !(sHtml.match(/\son[a-z]+="/g) || []).length && !/<script(?![^>]*\ssrc=)/.test(sHtml));
}

// ---------------------------------------------------------------- 8 : caméras du Studio (projet .bsproj, pistes, parents)
async function checkCams() {
  // (module de la page, sans dépendance : chargé tel quel)
  const C = await import('data:text/javascript;base64,' + readFileSync(path.join(root, 'src/studio/cams.js')).toString('base64'));
  const near = (a, b) => Math.abs(a - b) < 1e-6, pose = (x, fov = 60) => ({ x, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, fov });
  const v1 = C.loadProject({ v: 1, rate: 0.5, keys: [{ t: 4000, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, roll: 0, fov: 50, ease: 'doux' }, { t: 1000, x: 0, y: 2, z: 3, yaw: 6, pitch: 0, roll: 0, fov: 60 }] });
  ok('ancien projet (1.6.0) relu', v1.cams.length === 1 && v1.cams[0].name === 'Caméra 1' && C.CH.every(ch => v1.cams[0].tracks[ch].length === 2) && v1.cams[0].tracks.x[0].t === 1000 && v1.cams[0].tracks.fov[1].v === 50 && v1.cams[0].tracks.x[1].ease === 'doux' && v1.rate === 0.5);
  const v2 = C.loadProject({ v: 2, cams: [{ id: 'a', name: 'Large', filter: 'nuit', vignette: 0.4, parent: { kind: 'perso', id: 3, name: 'Nina' }, keys: [{ t: 0, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, roll: 0, fov: 40 }] }] });
  ok('projet à clés groupées relu (une piste par paramètre)', v2.cams[0].tracks.z[0].v === 3 && v2.cams[0].tracks.fov[0].v === 40 && v2.cams[0].filter === 'nuit' && v2.cams[0].vignette === 0.4 && v2.cams[0].parent.name === 'Nina' && v2.cams[0].tracks.vignette.length === 0);
  ok('projet illisible écarté', C.loadProject(null).cams.length === 0 && C.loadProject({ cams: [null, { keys: 'x' }, { tracks: { x: [{ t: 'a' }], y: 5 } }] }).cams.every(c => C.keyTimes(c).length === 0));
  const cams = [], a = C.newCam(cams, pose(0), 0); cams.push(a);
  for (const ch of C.CH) C.setKey(a, ch, 2000, ch === 'x' ? 10 : ch === 'fov' ? 40 : ch === 'y' ? 2 : 0);
  const mid = C.poseAt(a, 1000);
  ok('interpolation entre deux clés', near(mid.x, 5) && near(mid.fov, 50) && C.poseAt(a, -5).x === 0 && C.poseAt(a, 9999).x === 10);
  // chaque paramètre a ses propres clés : une clé de FOV à 500 ms ne touche pas la position
  C.setKey(a, 'fov', 500, 100);
  ok('clés indépendantes par paramètre', a.tracks.fov.length === 3 && a.tracks.x.length === 2 && near(C.poseAt(a, 500).fov, 100) && near(C.poseAt(a, 500).x, 2.5) && C.keyTimes(a).join() === '0,500,2000' && C.hasKey(a, 'fov', 510) && !C.hasKey(a, 'x', 500) && C.hasKey(a, null, 500));
  C.moveAt(a, 'fov', 500, 800); ok('clé d’un paramètre déplacée seule', a.tracks.fov[1].t === 800 && a.tracks.x[1].t === 2000);
  C.moveAt(a, null, 2000, 3000); ok('ligne résumé : toutes les clés de l’instant se déplacent', C.CH.every(ch => a.tracks[ch].at(-1).t === 3000));
  ok('clé d’un paramètre supprimée seule', C.delAt(a, 'fov', 800) === 1 && a.tracks.fov.length === 2 && a.tracks.x.length === 2);
  C.moveAt(a, null, 3000, 2000);
  C.easeAt(a, 'x', 0, 'fixe'); ok('plan fixe : pas de mouvement avant la clé suivante', C.poseAt(a, 1999).x === 0 && near(C.poseAt(a, 1000).fov, 50)); C.easeAt(a, 'x', 0, 'fluide');
  a.vignette = 0.3; const f0 = C.fxAt(a, 1000).vignette; C.setKey(a, 'vignette', 0, 0); C.setKey(a, 'vignette', 2000, 1);
  ok('réglage de filtre : fixe, puis animé par ses clés', f0 === 0.3 && near(C.fxAt(a, 1000).vignette, 0.5));
  const back = JSON.parse(C.saveProject('x.bsrec', 1, cams)), re = C.loadProject(back);
  ok('projet version 3 écrit et relu', back.v === 3 && re.cams[0].id === a.id && re.cams[0].tracks.vignette.length === 2 && re.cams[0].tracks.x.length === 2);
  // parent : aller-retour monde ↔ local, la caméra suit, regarde
  const P = { x: 100, y: 5, z: -20, yaw: 1.1 }, W = { x: 103, y: 7, z: -18, yaw: 0.4, pitch: -0.2, roll: 0.1, fov: 55 };
  for (const follow of [false, true]) { const r = C.toWorld(C.toLocal(W, P, follow), P, follow); ok(`parent : aller-retour ${follow ? 'avec' : 'sans'} rotation`, C.CH.every(c => near(r[c], W[c]))); }
  const frame = (p, t) => (p.id === 7 ? { x: P.x + t / 1000, y: P.y, z: P.z, yaw: P.yaw } : null);
  const b = C.newCam(cams, W, 0); cams.push(b);
  C.rebase(b, cams, frame, () => { b.parent = { kind: 'perso', id: 7, name: 'Nina' }; b.follow = true; });
  const w0 = C.worldPose(b, 0, cams, frame), w1 = C.worldPose(b, 3000, cams, frame);
  ok('attachée à un parent sans bouger, puis elle le suit', near(w0.x, W.x) && near(w0.z, W.z) && near(w0.yaw, W.yaw) && near(w1.x, W.x + 3) && near(w1.z, W.z) && !w0.lost);
  b.look = true; const wl = C.worldPose(b, 0, cams, frame);
  ok('la caméra regarde son parent', near(wl.yaw, Math.atan2(P.z - W.z, P.x - W.x)) && wl.pitch < 0);
  b.parent = { kind: 'perso', id: 99, name: 'Absent' }; ok('parent absent signalé', C.worldPose(b, 0, cams, frame).lost === true);
  b.parent = { kind: 'camera', id: a.id, name: a.name }; b.look = false; b.follow = false;
  ok('caméra parente d’une caméra', near(C.worldPose(b, 1000, cams, frame).x, 5 + b.tracks.x[0].v) && C.wouldLoop(a, b.id, cams) && !C.wouldLoop(b, a.id, [a]));
  // enchaînement : la dernière caméra commencée est à l'antenne ; une caméra écartée ne compte pas
  b.parent = null; for (const ch of C.CH) b.tracks[ch] = []; for (const ch of ['x', 'y', 'z']) { C.setKey(b, ch, 500, 0); C.setKey(b, ch, 1200, 1); }
  ok('enchaînement des caméras', C.activeCam(cams, 100) === a && C.activeCam(cams, 800) === b && C.activeCam(cams, 1500) === a && C.activeCam(cams, 5000) === a);
  b.on = false; ok('caméra écartée de la cinématique', C.activeCam(cams, 800) === a && C.cineRange(cams)[1] === 2000 && C.cineRange([b]) === null);
}

// ---------------------------------------------------------------- 7 : records du Studio (sans Electron)
async function checkRecords() {
  const REC = createRequire(import.meta.url)(path.join(root, 'src/records.js'));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bs-rec-'));
  try {
    const file = path.join(dir, REC.fileName({ room: '../../Ville<>' }));
    ok('nom de record sûr', path.dirname(file) === dir && REC.NAME_RE.test(path.basename(file)), path.basename(file));
    const w = REC.createWriter(file, { room: 'ville', roomName: 'La ville', radius: 5000, player: 'x'.repeat(200) }, { minMs: 0 });
    w.write('["R",0,{"id":"ville"}]\n["P",100,[1,2,3,0,0,0]]\n'); w.write('["P",2400,[1,2.5,3,0,0,1]]\n');
    // (l'écriture est asynchrone : on attend que les deux morceaux soient sur le disque — quelques millisecondes d'ordinaire)
    for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 100)); try { if (REC.measure(REC.readBody(file)).lines === 3) break; } catch { /* pas encore vidé */ } }
    // (jeu fermé net : pas d'en-tête définitif, mais tout ce qui a été envoyé se relit)
    const cut = path.join(dir, '2026-01-01_00-00-00_coupe.bsrec'); writeFileSync(cut, readFileSync(file));
    ok('record coupé net relisible', REC.readHeader(cut)?.done === false && REC.measure(REC.readBody(cut)).lines === 3);
    ok('record coupé réparé', REC.repair(cut)?.meta.dur === 2400);
    await w.close({ dur: 2500, lines: 3, reason: 'test' });
    const h = REC.readHeader(file);
    ok('record écrit et relu', h?.done && h.meta.dur === 2500 && h.meta.radius === 1000 && h.meta.player.length === 32 && REC.readBody(file).split('\n').length === 4);
    ok('morceau trop gros refusé', REC.createWriter(path.join(dir, 'x.bsrec'), {}).write('x'.repeat(REC.MAX_CHUNK + 1)) === false);
    ok('liste des records', REC.list(dir).filter(r => r.done).length === 2);
    ok('chemin de record hors dossier refusé', REC.safeFile(dir, '../x.bsrec') === null && REC.safeFile(dir, 'a/b.bsrec') === null && REC.safeFile(dir, 'x.txt') === null && !!REC.safeFile(dir, path.basename(file)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- le reste : dans Electron
async function checkRuntime() {
  process.env.BS_SELFTEST = '1';     // (posé avant le chargement de main.js)
  const { app } = await import('electron');
  await app.whenReady();

  // On charge main.js dans ce processus : ses fonctions internes sont alors
  // disponibles pour les contrôles (il n'ouvre aucune fenêtre tant que
  // BS_SELFTEST est posé).
  const m = createRequire(import.meta.url)(path.join(root, 'src/main.js'));

  const dir = mkdtempSync(path.join(os.tmpdir(), 'bs-selftest-'));
  // Les réglages réels sont remis en place à la fin : lancer les contrôles ne
  // doit ni déconnecter le joueur ni déplacer son dossier d'installation.
  const avant = m.readSettings();
  try {
    ok('chemin normal accepté', !!m.safeDest(dir, '/models/a.bbmodel'));
    ok('remontée de dossier refusée', m.safeDest(dir, '/models/../../etc/passwd') === null);
    ok('chemin hors ressources refusé', m.safeDest(dir, '/etc/passwd') === null);
    ok('RNNoise accepté', !!m.safeDest(dir, '/js/vendor/rnnoise/rnnoise.wasm'));
    ok('autre script refusé', m.safeDest(dir, '/js/main.js') === null);

    m.writeSettings({ installDir: dir, token: '', authNonce: null });
    await m.runInstall(dir);
    ok('installation complète', m.state().state === 'done', `${m.state().files} fichiers`);

    await m.runInstall(dir);
    ok('reprise sans retéléchargement', m.state().files === 0 && m.state().skipped > 0,
      `${m.state().skipped} déjà présents`);

    const victim = path.join(dir, 'models', 'chaise.bbmodel');
    const vrai = statSync(victim).size;
    writeFileSync(victim, 'abîmé');
    await m.runInstall(dir);
    ok('réparation d’un fichier abîmé', m.state().files === 1 && statSync(victim).size === vrai);

    await m.handleAuthLink('bigstreet://auth#session=JETON_FORGE');
    ok('lien de connexion forgé ignoré', m.readSettings().token === '');

    // (demande d'ami : sans le jeton de SA notification, le lien ne fait rien et le jeton reste)
    m.writeSettings({ token: 'JETON_TEST', friendNotified: { bottestami: 'a'.repeat(32) } });
    await m.handleFriendLink('bigstreet://friend?do=accept&name=BotTestAmi&k=' + 'b'.repeat(32));
    await m.handleFriendLink('bigstreet://friend?do=accept&name=BotTestAmi');
    ok('lien d’ami forgé ignoré', m.readSettings().friendNotified?.bottestami === 'a'.repeat(32));
    m.writeSettings({ token: '', friendNotified: {} });

    // (fenêtre de jeu : un envoi vers le site garde son Origin à travers le relais — sinon « Origine refusée »)
    {
      const { BrowserWindow, session } = createRequire(import.meta.url)('electron');
      const ses = session.fromPartition('bs-selftest-origin');
      m.serveLocalAssets(ses);
      const w = new BrowserWindow({ show: false, webPreferences: { session: ses } });
      try {
        await w.loadURL(SITE + '/');
        const r = await w.webContents.executeJavaScript(`fetch('/api/friends/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"x"}'}).then(r=>r.text())`);
        ok('envoi depuis le jeu accepté par le site', !/Origine refus/.test(r));
      } finally { w.destroy(); }
    }

    // (Studio : sa fenêtre charge son interface et le moteur du jeu par le relais local, et rien d'autre du site)
    {
      const { BrowserWindow, session } = createRequire(import.meta.url)('electron');
      const ses = session.fromPartition('bs-selftest-studio');
      m.studio.serveStudio(ses);
      const w = new BrowserWindow({ show: false, webPreferences: { session: ses, preload: path.join(root, 'src/studio-preload.js'), contextIsolation: true, sandbox: true } });
      try {
        await w.loadURL(SITE + '/__studio/studio.html');
        const r = await w.webContents.executeJavaScript(`Promise.all([document.querySelector('#recList') ? 1 : 0, typeof window.bsStudio?.list,
          fetch('/js/studio-play.js').then(r => r.status, () => 0), fetch('/api/servers').then(r => r.status, () => 0), fetch('/').then(r => r.status, () => 0),
          fetch('/__studio/../main.js').then(r => r.status, () => 0), fetch('/__studio/rec/..%2F..%2Fsettings.bsrec').then(r => r.status, () => 0)])`);
        ok('Studio : interface servie en local', r[0] === 1 && r[1] === 'function');
        ok('Studio : moteur du jeu par le relais', r[2] === 200, `état ${r[2]}`);
        ok('Studio : reste du site fermé', r[3] !== 200 && r[4] !== 200 && r[5] !== 200 && r[6] !== 200, r.slice(3).join(' '));
      } finally { w.destroy(); }
    }

    // (migration vers un autre dossier : tout arrive, vérifié, et l'ancienne copie disparaît)
    const dest = mkdtempSync(path.join(os.tmpdir(), 'bs-migre-'));
    try {
      const n = Object.keys(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).files).length;
      const r = await m.migrateDir(dest);
      while (['copy', 'clean'].includes(m.migState().state)) await new Promise(res => setTimeout(res, 100));
      const man = JSON.parse(readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
      ok(`migration — ${Object.keys(man.files).length}/${n} fichiers`, r.ok && m.migState().state === 'done'
        && Object.keys(man.files).length === n && m.installDir() === dest
        && !existsSync(path.join(dir, 'models')) && existsSync(path.join(dest, 'models')));
      const drives = await m.listDrives();
      ok(`liste des disques — ${drives.length}`, drives.length > 0 && drives.every(d => d.free >= 0 && d.size > 0));
    } finally { rmSync(dest, { recursive: true, force: true }); }
  } finally {
    m.writeSettings(avant);
    rmSync(dir, { recursive: true, force: true });
    console.log(failures ? `\n  ${failures} contrôle(s) en échec` : '\n  tout est vert');
    app.exit(failures ? 1 : 0);
  }
}

console.log(`Contrôles du launcher (site : ${SITE})\n`);
process.env.BS_STUDIO_DIR = mkdtempSync(path.join(os.tmpdir(), 'bs-studio-dir-'));     // (jamais le dossier Studio du joueur)
process.env.BS_STUDIO_CACHE = mkdtempSync(path.join(os.tmpdir(), 'bs-studio-cache-'));
process.on('exit', () => { for (const d of [process.env.BS_STUDIO_DIR, process.env.BS_STUDIO_CACHE]) rmSync(d, { recursive: true, force: true }); });
checkMarkup();
checkRecords().then(checkCams).then(checkRuntime, e => { console.error(e); process.exit(1); });
