/**
 * Essai du Studio hors du launcher : ouvre la fenêtre « Big Street Studio » sur un dossier de records d'essai,
 * charge un record, pose deux caméras, et enregistre des captures de la fenêtre.
 *
 *     xvfb-run -a npx electron tools/studio-shot.mjs --no-sandbox <record.bsrec> <dossier de sortie> [instant en s]
 *
 * (sans carte graphique : rendu logiciel, lent — c'est un contrôle visuel, pas un test de performances ; il n'écrit
 * que dans le dossier de sortie et un dossier temporaire, jamais dans les records du joueur)
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('studio-shot.mjs'));
const [record, outDir = '.', at = '3'] = args;
if (!record) { console.error('usage : electron tools/studio-shot.mjs --no-sandbox <record.bsrec> <dossier de sortie> [instant en s]'); process.exit(2); }
const dir = mkdtempSync(path.join(os.tmpdir(), 'bs-studio-'));
process.env.BS_SELFTEST = '1'; process.env.BS_STUDIO_DIR = path.join(dir, 'records');
process.env.BS_STUDIO_CACHE = process.env.BS_STUDIO_CACHE || path.join(os.tmpdir(), 'bs-studio-cache');
mkdirSync(process.env.BS_STUDIO_DIR, { recursive: true }); mkdirSync(outDir, { recursive: true });
const name = path.basename(record).replace(/[^A-Za-z0-9._-]/g, '_');
copyFileSync(record, path.join(process.env.BS_STUDIO_DIR, name));

// (Electron n'annonce « ready » qu'une fois ce module chargé : la suite tourne dans une fonction lancée sans l'attendre)
async function main() {
const { app } = await import('electron');
if (!process.env.NO_SW) for (const [k, v] of [['use-angle', 'swiftshader'], ['enable-unsafe-swiftshader'], ['ignore-gpu-blocklist'], ['disable-gpu-sandbox']]) app.commandLine.appendSwitch(k, v);
await app.whenReady();
const m = createRequire(import.meta.url)(path.join(root, 'src/main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const STEPS = (process.env.STEPS || '').split(',').filter(Boolean), step = n => !STEPS.length || STEPS.includes(n);   // (STEPS=poignees,apercu… : seulement ces étapes)
const guard = setTimeout(() => { console.error('⏱️ essai coupé après 160 s'); app.exit(2); }, 160000);
let code = 0;
try {
  const win = m.studio.openStudio();
  win.setSize(1440, 860);
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('  [page]', String(msg).slice(0, 300)); });
  win.webContents.on('did-fail-load', (_e, c, d, u) => console.log('  échec de chargement', c, d, u));
  await new Promise(r => win.webContents.once('did-finish-load', r));
  console.log('page chargée');
  const ev = js => win.webContents.executeJavaScript(js, true);
  // (rendu logiciel : on attend que n images aient vraiment été calculées avant une capture)
  const drawn = async (n = 3) => { const a = (await ev(`__studio.state.images`)) || 0; for (let i = 0; i < 80; i++) { await wait(250); if (((await ev(`__studio.state.images`)) || 0) >= a + n) break; } await wait(150); };
  const shot = async file => { const img = await win.webContents.capturePage(); writeFileSync(path.join(outDir, file), img.toPNG()); console.log('  capture', path.join(outDir, file)); };
  await ev(`localStorage.setItem('cubik.gfx', JSON.stringify({ ultra: ${process.env.ULTRA === '1'}, aa: false, res: 'auto', fps: 0 })), 1`);
  await wait(800);
  console.log('liste :', await ev(`[...document.querySelectorAll('.rec .name')].map(e => e.textContent).join(' | ')`));
  await shot('studio-liste.png');
  const t0 = Date.now();
  await ev(`__studio.open(${JSON.stringify(name)}).then(() => 1)`);
  console.log(`record ouvert en ${((Date.now() - t0) / 1000).toFixed(1)} s :`, JSON.stringify(await ev(`__studio.state`)));
  for (let i = 0; i < 40; i++) { await wait(500); const s = await ev(`__studio.state`); if (!s.chunks && i > 4) break; }
  await ev(`__studio.seek(${+at * 1000}), 1`); await wait(2500);
  if (process.env.CAM) await ev(`__studio.set(${process.env.CAM}), 1`);
  await wait(1500);
  console.log('scène :', JSON.stringify(await ev(`(() => { const w = __studio.world; return { nuit: w.night, heure: +w.gameHourNow().toFixed(2), fpv: !!w.fpv, objets: w.items.size, maillages: w.itemMeshes.size, avatars: [...w.avatars.values()].map(a => [a.name, +a.group.position.x.toFixed(1), +a.group.position.z.toFixed(1), a.group.visible, a.body.visible, a.st]) }; })()`)));
  await shot('studio-scene.png');
  if (process.env.ULTRA_LEVEL) {   // (rendu « Ultra » forcé à un niveau : sans carte graphique, le moteur le coupe de lui-même)
    await ev(`(__studio.world.ultra && (__studio.world.ultra.level = ${+process.env.ULTRA_LEVEL}), 1)`); await wait(4000);
    console.log('ultra :', JSON.stringify(await ev(`(() => { const u = __studio.world.ultra; return u ? { pret: u.ready, niveau: u.level, erreur: u.err || null, chaine: !!u.composer, passes: u.composer?.passes.length || 0 } : null; })()`)));
    await shot('studio-ultra.png');
  }
  if (process.env.WALK) {   // (un personnage en marche : relecture comparée aux trames P du record)
    const id = await ev(`__studio.world && (${process.env.WALK === '1' ? 'null' : JSON.stringify(process.env.WALK)})`);
    await ev(`__studio.seek(${+(process.env.WALK_AT || 0.6) * 1000}), __studio.play(true), 1`);
    for (let i = 0; i < 6; i++) { await wait(700);
      console.log('  marche :', JSON.stringify(await ev(`(() => { const w = __studio.world, s = __studio.state, me = __studio.me, a = w.avatars.get(me), q = __studio.where(s.T); return { T: Math.round(s.T), affiche: a && [+a.group.position.x.toFixed(2), +a.group.position.z.toFixed(2), +a.ang.toFixed(2)], record: q && [+q[0].toFixed(2), +q[1].toFixed(2), +q[3].toFixed(2)], marche: !!a?.fpLocal?.moving, drapeaux: q?.[4], jambe: a && +a.rig.bones.jambe_d.rotation.x.toFixed(2), bras: a && +a.rig.bones.bras_d.rotation.x.toFixed(2) }; })()`)));
      if (i === 2) await shot('studio-marche.png'); }
    await ev(`__studio.play(false), 1`);
  }
  if (step('libre')) {
  // caméra libre : touche « avancer » (Z en AZERTY, W en QWERTY) maintenue une demi-seconde
  { const c0 = (await ev(`__studio.state`)).cam; win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W' }); await wait(700); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W' });
    const c1 = (await ev(`__studio.state`)).cam; console.log('caméra libre : avancée de', Math.hypot(c1.x - c0.x, c1.y - c0.y, c1.z - c0.z).toFixed(2), 'case(s)'); await ev(`__studio.set(${JSON.stringify(c0)}), 1`); }
  }
  // Caméras : une caméra animée (deux clés, filtre nocturne), une caméra attachée au joueur (filtre thermique), puis les captures
  if (process.env.CAM) await ev(`__studio.set(${process.env.CAM}), 1`);
  const c0 = (await ev(`__studio.state`)).cam, tK = +at * 1000;
  // (les caméras sont posées devant le point de vue de départ, pour qu'on les voie depuis lui)
  const at3 = (f, r, u, o = {}) => `(() => { const c = ${JSON.stringify(c0)}, fx = Math.cos(c.yaw), fz = Math.sin(c.yaw); __studio.set({ ...c, x: c.x + fx * ${f} - fz * ${r}, z: c.z + fz * ${f} + fx * ${r}, y: c.y + ${u}, ...${JSON.stringify(o)} }); return 1; })()`;
  await ev(at3(3.2, -1.4, -1.2, { pitch: -0.12 })); await ev(`__studio.seek(${tK}), __studio.addCam(), 1`); await wait(300);
  await ev(at3(4.6, -0.2, -0.9, { pitch: -0.2, yaw: c0.yaw + 0.5 })); await ev(`__studio.seek(Math.min(__studio.state.dur, ${tK} + 4000)), 1`); await wait(700);
  await ev(`__studio.addKey(), 1`); await wait(300);
  const who = process.env.PARENT || (await ev(`__studio.parents()[0]`));
  await ev(at3(3.0, 1.5, -1.0, { pitch: -0.1 })); await ev(`__studio.seek(${tK} + 1000), __studio.addCam(), 1`); await wait(300);
  await ev(`(() => { const C = __studio.cams; C[0].name = 'Plan large'; C[0].filter = 'nuit'; C[1].name = 'Suiveuse'; C[1].filter = 'thermique'; __studio.setParent(1, ${JSON.stringify(who)}); C[1].look = true; __studio.refreshUi(); return 1; })()`);
  await ev(at3(0, 0, 0)); await ev(`__studio.seek(${tK} + 2000), 1`);
  if (step('pistes')) {
  // (pistes par paramètre : la première caméra dépliée, avec des clés propres à la FOV, au roulis et à la vignette)
  await ev(`(() => { const S = __studio, t = ${tK} / 1000; S.cams[0].open = true; S.setKey(0, 'fov', t + 1.2, 38); S.setKey(0, 'fov', t + 3.1, 82); S.setKey(0, 'roll', t + 2, 0.2); S.setKey(0, 'vignette', t, 0); S.setKey(0, 'vignette', t + 4, 0.8); S.selectCam(S.cams[0].id, 'fov', Math.round((t + 1.2) * 1000)); return 1; })()`);
  await drawn();
  console.log('pistes :', JSON.stringify(await ev(`(() => { const c = __studio.cams[0]; return { parParametre: Object.fromEntries(Object.entries(c.tracks).map(([k, L]) => [k, L.length])), lignes: document.querySelectorAll('.lane').length, sousLignes: document.querySelectorAll('.lane.sub').length, fovA: [${tK} / 1000, ${tK} / 1000 + 1.2, ${tK} / 1000 + 2, ${tK} / 1000 + 4].map(t => +__studio.valAt(0, 'fov', t).toFixed(1)), xA: [${tK} / 1000, ${tK} / 1000 + 2, ${tK} / 1000 + 4].map(t => +__studio.valAt(0, 'x', t).toFixed(2)), losangesPleins: document.querySelectorAll('#props .kd.on').length, cleChoisie: document.querySelector('#pKeyWhat').textContent }; })()`)));
  await shot('studio-pistes.png');
  // (champ FOV modifié à un instant sans clé : une clé apparaît sur la seule ligne FOV)
  console.log('champ FOV :', JSON.stringify(await ev(`(() => { const S = __studio, c = S.cams[0], n = k => c.tracks[k].length, a = [n('fov'), n('x')]; S.seek(${tK} + 2500); return new Promise(r => setTimeout(() => { const f = document.getElementById('pFov'); f.value = '55'; f.dispatchEvent(new Event('input')); r({ avant: a, apres: [n('fov'), n('x')], fov: +S.valAt(0, 'fov', (${tK} + 2500) / 1000).toFixed(1) }); }, 1500)); })()`)));
  await ev(`(__studio.selectCam(__studio.cams[1].id), __studio.seek(${tK} + 2000), 1)`);
  await wait(2500);
  console.log('caméras :', JSON.stringify(await ev(`(() => { const s = __studio.state; return { cams: s.cams, cles: s.keys, sel: s.sel, poignees: s.poignees, parent: __studio.cams[1].parent, suiveuse: (p => p && [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), p.lost])(__studio.pose(1)), pistes: document.querySelectorAll('.lane').length, clesAffichees: document.querySelectorAll('.kf').length, etiquettes: [...document.querySelectorAll('.cam-label')].map(e => e.textContent), champs: ['pX', 'pY', 'pZ', 'pYaw', 'pPitch', 'pRoll', 'pFov'].map(i => document.getElementById(i).value), parentAffiche: document.querySelector('#pParentInfo').textContent }; })()`)));
  await drawn(); await shot('studio-cameras.png');
  }
  if (step('poignees')) {
  // poignées : un vrai glisser de souris sur la flèche X de la caméra sélectionnée (la première, sans parent) → elle se déplace
  { await ev(`(__studio.setMode('free'), __studio.selectCam(__studio.cams[0].id), __studio.showCam(0), 1)`); await drawn(4);
    const g = await ev(`(() => { const S = __studio, p = S.pose(0), d = S.giz.seen(p.x, p.y, p.z).dist; return { p: [p.x, p.y, p.z], d, a: S.giz.screen(p.x + d * 0.09, p.y, p.z), b: S.giz.screen(p.x + d * 0.3, p.y, p.z), poignees: S.giz.hasHandles, vue: S.giz.seen(p.x, p.y, p.z) }; })()`);
    // (vraie souris, par le protocole de débogage de Chromium : mêmes événements « pointer » qu'une main sur la souris)
    const dbg = win.webContents.debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    const mouse = (type, q) => dbg.sendCommand('Input.dispatchMouseEvent', { type: { mouseMove: 'mouseMoved', mouseDown: 'mousePressed', mouseUp: 'mouseReleased' }[type], x: Math.round(q.x), y: Math.round(q.y), button: type === 'mouseMove' && !mouse.down ? 'none' : 'left', buttons: type === 'mouseUp' ? 0 : type === 'mouseDown' || mouse.down ? 1 : 0, clickCount: type === 'mouseMove' ? 0 : 1 }).then(() => { if (type === 'mouseDown') mouse.down = true; if (type === 'mouseUp') mouse.down = false; });
    await ev(`(window.__pm = 0, window.__pd = 0, document.querySelector('#view').addEventListener('pointermove', () => window.__pm++), document.querySelector('#view').addEventListener('pointerdown', () => window.__pd++), 1)`);
    win.webContents.focus(); await mouse('mouseMove', { x: g.a.x - 3, y: g.a.y }); await wait(250); await mouse('mouseMove', g.a); await wait(400);
    const survol = await ev(`__studio.giz.hover`);
    if (process.env.DEBUG_TC) console.log('  tc :', JSON.stringify(await ev(`(() => { const S = __studio, tc = S.giz.tc, T3 = S.world.camera.constructor, cv = document.querySelector('#view'), r = cv.getBoundingClientRect(), a = ${JSON.stringify(g.a)};
      const nd = { x: (a.x - r.left) / r.width * 2 - 1, y: -(a.y - r.top) / r.height * 2 + 1, button: 0 }; tc.pointerHover(nd);
      const pk = tc._gizmo.picker.translate; const out = { axe: tc.axis, enabled: tc.enabled, objet: !!tc.object, dragging: tc.dragging, mode: tc.mode, nd, cam: [S.world.camera.position.x, S.world.camera.position.y, S.world.camera.position.z].map(v => +v.toFixed(2)), camType: S.world.camera.type, layers: S.world.camera.layers.mask,
        pick: pk.children.slice(0, 4).map(c => ({ n: c.name, e: c.matrixWorld.elements.slice(12, 15).map(v => +v.toFixed(2)), s: +c.matrixWorld.elements[0].toFixed(3), auto: c.matrixWorldAutoUpdate })), gizAuto: [tc._gizmo.matrixWorldAutoUpdate, tc._root?.matrixWorldAutoUpdate, S.world.scene.matrixWorldAutoUpdate], rect: [r.left, r.top, r.width, r.height], inv: S.world.camera.projectionMatrixInverse.elements.slice(0, 6).map(v => +v.toFixed(3)), proj: S.world.camera.projectionMatrix.elements.slice(0, 6).map(v => +v.toFixed(3)) };
      return out; })()`)));
    console.log('  sous le pointeur :', JSON.stringify(await ev(`(() => { const e = document.elementFromPoint(${Math.round(g.a.x)}, ${Math.round(g.a.y)}); return { el: e && (e.id || e.className || e.tagName), mouvements: window.__pm, a: ${JSON.stringify(g.a)}, b: ${JSON.stringify(g.b)} }; })()`)));
    await mouse('mouseDown', g.a); await wait(150);
    for (let i = 1; i <= 6; i++) { await mouse('mouseMove', { x: g.a.x + (g.b.x - g.a.x) * i / 6, y: g.a.y + (g.b.y - g.a.y) * i / 6 }); await wait(120); }
    await mouse('mouseUp', g.b); await wait(500);
    const x1 = await ev(`__studio.pose(0).x`);
    console.log('poignées (glisser la flèche X) :', JSON.stringify({ chargees: g.poignees, visible: g.vue.on, distance: +g.d.toFixed(2), survol, xAvant: +g.p[0].toFixed(2), xApres: +x1.toFixed(2), deplacee: Math.abs(x1 - g.p[0]) > 0.05 }));
    await drawn(); await shot('studio-poignees.png');
    await ev(`(__studio.undo(), 1)`); await wait(300); console.log('  Ctrl+Z :', +(await ev(`__studio.pose(0).x`)).toFixed(2));
  }
  }
  if (step('champs')) {
  // coordonnées changées au clavier : X + 0,5 dans le champ → la caméra suit
  console.log('champ X :', JSON.stringify(await ev(`(() => { const f = document.getElementById('pX'), a = __studio.pose(1).x; f.value = (parseFloat(f.value) + 0.5).toFixed(2); f.dispatchEvent(new Event('input')); const b = __studio.pose(1).x; f.value = (parseFloat(f.value) - 0.5).toFixed(2); f.dispatchEvent(new Event('input')); return { avant: +a.toFixed(2), apres: +b.toFixed(2), remis: +__studio.pose(1).x.toFixed(2) }; })()`)));
  }
  if (step('clavier')) {
  // déplacement au clavier (G puis X), annulé par Échap, puis rotation des poignées
  await ev(`(__studio.selectCam(__studio.cams[0].id), __studio.modalStart('G'), 1)`); await wait(300);
  console.log('G :', await ev(`document.querySelector('#modal').textContent`));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(300);
  await ev(`document.querySelector('#gRot').click(), 1`); await wait(1500);
  await drawn(); await shot('studio-rotation.png');
  await ev(`document.querySelector('#gMove').click(), 1`);
  }
  if (step('filtres')) {
  // à travers chaque caméra : vision nocturne, puis thermique (attachée au joueur)
  await ev(`(__studio.selectCam(__studio.cams[0].id), __studio.setMode('cam'), 1)`); await wait(2500);
  console.log('vue caméra 1 :', JSON.stringify(await ev(`(s => ({ mode: s.mode, filtre: s.filtre }))(__studio.state)`)));
  await drawn(); await shot('studio-nocturne.png');
  await ev(`(__studio.setMode('free'), __studio.selectCam(__studio.cams[1].id), __studio.setMode('cam'), 1)`); await wait(2500);
  console.log('vue caméra 2 :', JSON.stringify(await ev(`(s => ({ mode: s.mode, filtre: s.filtre }))(__studio.state)`)));
  await drawn(); await shot('studio-thermique.png');
  if (process.env.FILTRE) { await ev(`(__studio.cams[1].filter = ${JSON.stringify(process.env.FILTRE)}, __studio.cams[1].dof = 0.8, __studio.cams[1].vignette = 0.5, 1)`); await drawn(); await shot('studio-filtre.png'); await ev(`(__studio.cams[1].filter = 'thermique', __studio.cams[1].dof = 0, __studio.cams[1].vignette = 0, 1)`); }
  await ev(`(__studio.setMode('free'), __studio.startCine(), 1)`); await wait(2500);
  console.log('cinématique :', JSON.stringify(await ev(`(s => ({ T: Math.round(s.T), mode: s.mode, filtre: s.filtre }))(__studio.state)`)));
  await drawn(); await shot('studio-travelling.png');
  await ev(`(__studio.play(false), __studio.setMode('free'), 1)`); await wait(2200);
  }
  // ---- Les nouveautés : clé sur tout, coordonnées relatives, aimantation, Suppr, aperçu, raytracing/ombre, scène, apparence, IA
  const mouseEv = (sel, type, x, y, extra = '') => `document.querySelector(${JSON.stringify(sel)})?.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles: true, clientX: ${x}, clientY: ${y}, button: 0${extra} }))`;
  if (step('relatif')) {
    console.log('relatif au parent :', JSON.stringify(await ev(`(async () => { const S = __studio; S.setMode('free'); S.selectCam(S.cams[1].id); S.cams[1].look = false; S.refreshUi(); await new Promise(r => setTimeout(r, 400));
      const set = (id, v) => { const f = document.getElementById(id); f.value = String(v); f.dispatchEvent(new Event('input')); };
      set('pX', 0); set('pY', 0); set('pZ', 0); await new Promise(r => setTimeout(r, 500));
      const w = S.pose(1), P = w.P; return { parent: S.cams[1].parent.name, etiquette: document.querySelector('#pRel').textContent, champs: ['pX', 'pY', 'pZ'].map(i => document.getElementById(i).value), ecartAuParent: +Math.hypot(w.x - P.x, w.y - P.y, w.z - P.z).toFixed(3), note: document.querySelector('#pNote').textContent }; })()`)));
    await ev(`(__studio.undo(), __studio.cams[1].look = true, __studio.refreshUi(), 1)`);
  }
  if (step('cles')) {
    console.log('clé sur tous les paramètres :', JSON.stringify(await ev(`(async () => { const S = __studio, c = S.cams[0]; S.selectCam(c.id); S.seek(${tK} + 2700); await new Promise(r => setTimeout(r, 500));
      const n0 = Object.values(c.tracks).reduce((n, L) => n + L.length, 0); document.querySelector('#pKeyAll').click(); const n1 = Object.values(c.tracks).reduce((n, L) => n + L.length, 0), partout = Object.values(c.tracks).every(L => L.some(k => Math.abs(k.t - (${tK} + 2700)) < 46)), txt = document.querySelector('#pKeyAll').textContent;
      await new Promise(r => setTimeout(r, 300)); document.querySelector('#pKeyAll').click(); const n2 = Object.values(c.tracks).reduce((n, L) => n + L.length, 0); return { avant: n0, apres: n1, partout, bouton: txt, retirees: n2 }; })()`)));
    // aimantation : une clé de FOV glissée à 4 px de la tête de lecture tombe pile dessus ; avec Alt, elle reste libre
    console.log('aimantation :', JSON.stringify(await ev(`(async () => { const S = __studio, c = S.cams[0], sleep = ms => new Promise(r => setTimeout(r, ms)); S.seek(${tK} + 2500); await sleep(400);
      const box = document.querySelectorAll('.lane.sub')[6].getBoundingClientRect(), xOf = t => box.left + t / S.state.dur * box.width, t0 = c.tracks.fov[1].t, head = Math.round(S.state.T);
      const keep = JSON.stringify(c.tracks.fov), lane = () => document.querySelectorAll('.lane.sub')[6];
      const drag = async (from, toX, alt) => { const kf = [...lane().querySelectorAll('.kf')].find(k => Math.abs(k.getBoundingClientRect().left + k.getBoundingClientRect().width / 2 - xOf(from)) < 4); if (!kf) return 'clé introuvable : ' + JSON.stringify({ lanes: document.querySelectorAll('.lane.sub').length, kfs: [...lane().querySelectorAll('.kf')].map(k => Math.round(k.getBoundingClientRect().left + k.getBoundingClientRect().width / 2)), x: Math.round(xOf(from)), head: lane().previousElementSibling.textContent });
        kf.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: xOf(from), clientY: 5 })); for (const x of [xOf(from) + 6, toX]) dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: 5, altKey: alt })); await sleep(50); const t = S.state.selT; dispatchEvent(new PointerEvent('pointerup', {})); await sleep(200); return t; };
      const a = await drag(t0, xOf(head) + 4, false), b = await drag(a, xOf(head) + 4 + 40, true), n = c.tracks.fov.length; c.tracks.fov = JSON.parse(keep); S.refreshUi();
      return { tete: head, depart: t0, aimantee: a, pile: a === head, libreAvecAlt: b, clesFov: n }; })()`)));
    await drawn(); await shot('studio-aimantation.png');
  }
  if (step('suppr')) {
    await ev(`(__studio.setMode('free'), __studio.selectCam(__studio.cams[1].id), 1)`); await wait(300); win.webContents.focus(); await ev(`document.activeElement?.blur(), 1`);
    const n0 = (await ev(`__studio.state`)).cams;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' }); await wait(500);
    const n1 = (await ev(`__studio.state`)).cams, msg = await ev(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] }); await wait(500);
    console.log('Suppr puis Ctrl+Z :', JSON.stringify({ avant: n0, apresSuppr: n1, message: msg, apresCtrlZ: (await ev(`__studio.state`)).cams, parentRevenu: await ev(`__studio.cams[1]?.parent?.name || null`) }));
    // R = rotation, L = flèches
    await ev(`(__studio.selectCam(__studio.cams[0].id), 1)`);
    const key = async k => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(350); return ev(`__studio.giz.mode`); };
    console.log('touches R puis L :', await key('R'), '→', await key('L'));
  }
  if (step('apercu')) {
    await ev(`(() => { const S = __studio; S.setMode('free'); S.selectCam(S.cams[0].id); S.showCam(0); S.cams[0].filter = ''; S.cams[0].rt = 0.7; S.cams[0].shadow = true; S.refreshUi(); return 1; })()`);
    await drawn(6);
    console.log('aperçu incrusté :', JSON.stringify(await ev(`(() => { const S = __studio, cv = document.querySelector('#pipCv'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0, mx = 0; for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; mx = Math.max(mx, d[i]); }
      const v = document.querySelector('#view'); return { visible: !document.querySelector('#pip').hidden, taille: [cv.width, cv.height], formatVue: +(v.clientWidth / v.clientHeight).toFixed(2), formatApercu: +(cv.width / cv.height).toFixed(2), images: S.pip.drawn, erreur: S.pip.error, moyenne: Math.round(s / (d.length / 4 * 3)), max: mx, nom: document.querySelector('#pipName').textContent }; })()`)));
    await drawn(); await shot('studio-apercu.png');
    await ev(`(__studio.setMode('cam'), 1)`); await drawn(5); await wait(600);
    console.log('raytracing 70 + ombre (vue caméra) :', JSON.stringify(await ev(`(s => ({ mode: s.mode, filtre: s.filtre, apercuCache: document.querySelector('#pip').hidden }))(__studio.state)`)));
    await shot('studio-raytracing.png');
    await ev(`(__studio.cams[0].rt = 0, __studio.cams[0].shadow = true, 1)`); await drawn(4); await shot('studio-ombre.png'); await ev(`(__studio.world.post.probe = true, 1)`); await drawn(2); console.log('ombre seule :', JSON.stringify(await ev(`(() => { const w = __studio.world; return { post: !!w.post, dernier: w.post?.last, mesure: w.post?.probed, erreur: w.post?.shadowErr || null }; })()`)));
    await ev(`(__studio.cams[0].rt = 0, __studio.cams[0].shadow = false, 1)`); await drawn(4); await shot('studio-sans-raytracing.png');
    await ev(`(__studio.cams[0].filter = 'nuit', __studio.setMode('free'), 1)`);
  }
  if (step('scene')) {
    await ev(`(__studio.setAccount({ name: 'Lex', admin: false, vip: false, owned: ['hat:5', 'skin:vet_top:hope', 'skin:vet_bottom:hope', 'skin:glock17:or', 'hairStyle:16'], online: true }), __studio.tab('scene'), __studio.setMode('free'), 1)`); await wait(400);
    const who = await ev(`(() => { const S = __studio.scene, e = S.list.find(x => x.kind === 'pnj'); S.select(e); S.frame(); return { nom: e.name, cle: e.key, id: e.id, groupes: [...document.querySelectorAll('.sc-group')].map(g => g.textContent), lignes: document.querySelectorAll('.sc-row').length }; })()`);
    console.log('scène :', JSON.stringify(who));
    await drawn(5);
    console.log('apparence (compte non admin) :', JSON.stringify(await ev(`(async () => { const S = __studio.scene, id = ${who.id}, sleep = ms => new Promise(r => setTimeout(r, ms));
      const a = S.setLook(id, { look: { top: 5, shirt: 3, bottom: 0, pants: 4, hat: 5, hairStyle: 17, glasses: 2 }, skins: { top: 'hope' }, hold: 'glock17__or', bag: 'sac_a_dos__pirate' }); await sleep(1500);
      const av = __studio.world.avatars.get(id), L = S.lookOf(id); return { fait: a.done.length, refuse: a.refused, porte: L.text, avatar: av && { top: av.look.top, hat: av.look.hat, skin: av.wd?.['sk:top'], main: av.holdId }, projet: __studio.ents.over['u:' + id], verrous: document.querySelectorAll('#entPanel option[disabled]').length, pastilles: document.querySelectorAll('#entPanel .sw').length }; })()`)));
    await drawn(6); await shot('studio-scene-apparence.png');
    console.log('masquer :', JSON.stringify(await ev(`(async () => { const S = __studio.scene, id = ${who.id}, a = __studio.world.avatars.get(id); S.setHidden('u:' + id, true); await new Promise(r => setTimeout(r, 900)); const h = a.group.visible; S.setHidden('u:' + id, false); await new Promise(r => setTimeout(r, 900)); return { cache: !h, revenu: a.group.visible, recherche: (document.querySelector('#sceneSearch').value = 'chaise', document.querySelector('#sceneSearch').dispatchEvent(new Event('input')), document.querySelectorAll('.sc-row').length) }; })()`)));
    await ev(`(document.querySelector('#sceneSearch').value = '', document.querySelector('#sceneSearch').dispatchEvent(new Event('input')), 1)`);
  }
  if (step('ia')) {
    await ev(`(__studio.setAccount({ name: 'Lex', admin: false, vip: false, owned: [], online: true }), __studio.tab('ai'), __studio.scene.select(null), __studio.selectCam(null), 1)`); await drawn(2); await shot('studio-ia-non-vip.png');
    console.log('IA sans VIP :', await ev(`document.querySelector('.ai-vip-t')?.textContent + ' · saisie cachée : ' + document.querySelector('#aiForm').hidden`));
    await ev(`(__studio.setAccount({ name: 'Lex', admin: false, vip: true, owned: ['hat:5'], online: true }), 1)`); await wait(300);
    // (un faux modèle : il joue un scénario d'appels d'outils, comme le relais du site le ferait)
    const res = await ev(`(async () => { const S = __studio, n0 = S.cams.length, me = S.scene.list.find(e => e.me), call = (name, args) => ({ id: name + Math.random(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
      const script = [{ content: 'Je regarde la scène.', tool_calls: [call('scene_info', {}), call('list_entities', { type: 'personnages' }), call('entity_path', { entity: 'joueur' })] },
        { content: '', tool_calls: [call('frame_shot', { camera: 'Ouverture', t: 1, subject: 'joueur', shot: 'demi_ensemble', side: 'trois_quarts_droit', height: 'plongee' }), call('frame_shot', { camera: 'Ouverture', t: 5, subject: 'joueur', shot: 'moyen', side: 'trois_quarts_droit', height: 'yeux', ease: 'doux' }),
          call('frame_shot', { camera: 'Visage', t: 5, subject: 'joueur', shot: 'gros_plan', side: 'face', thirds: 'gauche' }), call('frame_shot', { camera: 'Visage', t: 8, subject: 'joueur', shot: 'gros_plan', side: 'trois_quarts_gauche', thirds: 'gauche' }),
          call('update_camera', { camera: 'Visage', filter: 'cine', raytracing: 60, shadow: true, vignette: 25, dof: 40 }), call('orbit_shot', { camera: 'Tour', subject: 'joueur', from: 8, to: 13, degrees: 160, distance: 3.2 }), call('set_appearance', { entity: 'joueur', look: { hat: 5, hairStyle: 20 } })] },
        { content: '', tool_calls: [call('cinematic_summary', {}), call('seek', { t: 6 }), call('set_view', { mode: 'camera', camera: 'Visage' })] },
        { content: 'C’est prêt : une ouverture en plongée qui descend vers toi (4 s), un gros plan au tiers gauche avec le look film, puis un tour de 160° autour de toi. Je lance la prévisualisation, ou tu veux changer quelque chose ?' }];
      let n = 0; const r = await S.ai.send('Fais-moi une belle cinématique centrée sur moi.', async () => ({ ok: true, message: { role: 'assistant', ...script[n++] } }));
      return { tours: n, actions: r.actions.length, ok: r.actions.filter(a => a.ok).length, refus: r.actions.filter(a => !a.ok).map(a => a.text), camerasAvant: n0, cameras: S.cams.length, noms: S.cams.map(c => c.name), modifie: r.changed, T: Math.round(S.state.T), mode: S.state.mode, lignes: document.querySelectorAll('.ai-act').length, retour: !!document.querySelector('.ai-back'), chapeau: S.ents.over['u:' + me.id]?.look };
    })()`);
    console.log('IA (faux modèle) :', JSON.stringify(res));
    await drawn(6); await shot('studio-ia.png');
    console.log('IA, retour en arrière :', JSON.stringify(await ev(`(async () => { const S = __studio; document.querySelector('.ai-back').click(); await new Promise(r => setTimeout(r, 600)); return { cameras: S.cams.length, fil: S.ai.chat.length, historique: S.ai.history.length, saisie: document.querySelector('#aiInput').value, apparences: Object.keys(S.ents.over).length }; })()`)));
    await ev(`(__studio.setMode('free'), __studio.tab('scene'), 1)`);
  }
  if (process.env.EXPORT === '1') {   // (export vidéo : la cinématique rejouée et filmée)
    await ev(`__studio.play(false), document.querySelector('#export').click(), 1`);
    for (let i = 0; i < 60; i++) { await wait(1000); if (!(await ev(`!!document.querySelector('#export.on')`))) break; }
    await wait(800);
    for (const f of readdirSync(process.env.BS_STUDIO_DIR)) if (f.endsWith('.webm')) copyFileSync(path.join(process.env.BS_STUDIO_DIR, f), path.join(outDir, 'export.webm'));
  }
  console.log('dossier :', readdirSync(process.env.BS_STUDIO_DIR).map(f => `${f} (${statSync(path.join(process.env.BS_STUDIO_DIR, f)).size} o)`).join(', '));
} catch (e) { console.error('ÉCHEC', e); code = 1; }
clearTimeout(guard);
rmSync(dir, { recursive: true, force: true });
app.exit(code);
}
main();
