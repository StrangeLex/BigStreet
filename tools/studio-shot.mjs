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
  // deux caméras, puis la vue du travelling à mi-chemin
  await ev(`(() => { const s = __studio.state, c = s.cam; __studio.seek(${+at * 1000}); __studio.addCam(); __studio.set({ x: c.x + 3, y: c.y + 2.5, z: c.z - 2, yaw: c.yaw + 0.5, pitch: -0.45, fov: 40 }); return 1; })()`);
  await wait(400);
  await ev(`(() => { const s = __studio.state; __studio.seek(Math.min(s.dur, ${+at * 1000} + 4000)); return 1; })()`); await wait(600);
  await ev(`__studio.addCam(), 1`); await wait(300);
  await ev(`__studio.startCine(), 1`); await wait(2500);
  console.log('cinématique :', JSON.stringify(await ev(`__studio.state`)));
  console.log('rendu :', JSON.stringify(await ev(`(() => { const w = __studio.world, gl = w.renderer.getContext(), i = w.renderer.info; return { contextePerdu: gl.isContextLost(), triangles: i.render.triangles, appels: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, nuit: +(w.night || 0).toFixed(2), heure: +w.gameHourNow().toFixed(2), brouillard: [w.fogObj.near, w.fogObj.far], fond: w.scene.background?.getHexString?.() }; })()`)));
  await shot('studio-travelling.png');
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
