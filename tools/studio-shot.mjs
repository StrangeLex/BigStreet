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
  // caméra libre : touche « avancer » (Z en AZERTY, W en QWERTY) maintenue une demi-seconde
  { const c0 = (await ev(`__studio.state`)).cam; win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W' }); await wait(700); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W' });
    const c1 = (await ev(`__studio.state`)).cam; console.log('caméra libre : avancée de', Math.hypot(c1.x - c0.x, c1.y - c0.y, c1.z - c0.z).toFixed(2), 'case(s)'); await ev(`__studio.set(${JSON.stringify(c0)}), 1`); }
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
  // coordonnées changées au clavier : X + 0,5 dans le champ → la caméra suit
  console.log('champ X :', JSON.stringify(await ev(`(() => { const f = document.getElementById('pX'), a = __studio.pose(1).x; f.value = (parseFloat(f.value) + 0.5).toFixed(2); f.dispatchEvent(new Event('input')); const b = __studio.pose(1).x; f.value = (parseFloat(f.value) - 0.5).toFixed(2); f.dispatchEvent(new Event('input')); return { avant: +a.toFixed(2), apres: +b.toFixed(2), remis: +__studio.pose(1).x.toFixed(2) }; })()`)));
  // déplacement au clavier (G puis X), annulé par Échap, puis rotation des poignées
  await ev(`(__studio.selectCam(__studio.cams[0].id), __studio.modalStart('G'), 1)`); await wait(300);
  console.log('G :', await ev(`document.querySelector('#modal').textContent`));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(300);
  await ev(`document.querySelector('#gRot').click(), 1`); await wait(1500);
  await drawn(); await shot('studio-rotation.png');
  await ev(`document.querySelector('#gMove').click(), 1`);
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
