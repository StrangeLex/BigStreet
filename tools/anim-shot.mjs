/**
 * Essai visuel des éléments animés du Studio (anim.js) : ouvre un record, anime un objet du décor, ajoute un PNJ posé, une lumière
 * colorée, un miroir, et enregistre des captures.
 *
 *     xvfb-run -a npx electron tools/anim-shot.mjs --no-sandbox <record.bsrec> <dossier de sortie>
 *
 * STEPS=objet,pnj,lumiere,miroir,ambiance,projet : seulement ces étapes. Rendu logiciel : lent, c'est un contrôle visuel.
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('anim-shot.mjs'));
const [record, outDir = '.'] = args;
if (!record) { console.error('usage : electron tools/anim-shot.mjs --no-sandbox <record.bsrec> <dossier de sortie>'); process.exit(2); }
const dir = mkdtempSync(path.join(os.tmpdir(), 'bs-anim-'));
process.env.BS_SELFTEST = '1'; process.env.BS_STUDIO_DIR = path.join(dir, 'records');
process.env.BS_STUDIO_CACHE = process.env.BS_STUDIO_CACHE || path.join(os.tmpdir(), 'bs-studio-cache');
mkdirSync(process.env.BS_STUDIO_DIR, { recursive: true }); mkdirSync(outDir, { recursive: true });
const name = path.basename(record).replace(/[^A-Za-z0-9._-]/g, '_');
copyFileSync(record, path.join(process.env.BS_STUDIO_DIR, name));

async function main() {
const { app } = await import('electron');
if (!process.env.NO_SW) for (const [k, v] of [['use-angle', 'swiftshader'], ['enable-unsafe-swiftshader'], ['ignore-gpu-blocklist'], ['disable-gpu-sandbox']]) app.commandLine.appendSwitch(k, v);
app.setPath('userData', path.join(dir, 'profil'));   // (son propre profil : un autre essai du launcher peut tourner en même temps)
await app.whenReady();
const m = createRequire(import.meta.url)(path.join(root, 'src/main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const STEPS = (process.env.STEPS || '').split(',').filter(Boolean), step = n => !STEPS.length || STEPS.includes(n);
const guard = setTimeout(() => { console.error('⏱️ essai coupé après 280 s'); app.exit(2); }, 280000);
let code = 0;
try {
  const win = m.studio.openStudio(); win.setSize(1440, 860);
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('  [page]', String(msg).slice(0, 400)); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const ev = js => win.webContents.executeJavaScript(js, true);
  const drawn = async (n = 3) => { const a = (await ev(`__studio.state.images`)) || 0; for (let i = 0; i < 80; i++) { await wait(250); if (((await ev(`__studio.state.images`)) || 0) >= a + n) break; } await wait(150); };
  const shot = async file => { const img = await win.webContents.capturePage(); writeFileSync(path.join(outDir, file), img.toPNG()); console.log('  capture', path.join(outDir, file)); };
  const say = async (label, js) => console.log(label, JSON.stringify(await ev(`(async () => { try { return await (${js}); } catch (e) { return 'ERREUR ' + (e.stack || e); } })()`)));
  await ev(`localStorage.setItem('cubik.gfx', JSON.stringify({ ultra: false, aa: false, res: 'auto', fps: 0 })), 1`);
  await wait(600);
  const t0 = Date.now();
  await ev(`__studio.open(${JSON.stringify(name)}).then(() => 1)`);
  console.log(`record ouvert en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (let i = 0; i < 30; i++) { await wait(400); const s = await ev(`__studio.state`); if (!s.chunks && i > 3) break; }
  await ev(`__studio.tab('scene'), 1`); await drawn(3);
  await say('départ :', `(() => { const S = __studio, w = S.world; return { cam: Object.values(S.state.cam).map(v => +v.toFixed(2)), objets: w.items.size, maillages: w.itemMeshes.size, programmes: S.anim.api.programs, reserve: Object.fromEntries(Object.entries(S.anim.api.pool).map(([k, L]) => [k, L.length])) }; })()`);
  await wait(1500);
  await say('objets du décor :', `(() => { const w = __studio.world; return { objets: w.items.size, maillages: w.itemMeshes.size, instancies: w.instanced?.length || 0, groupe: w.itemGroup.children.length, types: [...w.items.values()].map(i => i.type).join(',') }; })()`);
  await ev(`(window.__m = () => { const h = __studio.anim.itemOf(__it.id), m = h.m; if (h.i === undefined) return m; const M = new m.matrix.constructor(), o = { position: new m.position.constructor(), quaternion: new m.quaternion.constructor(), scale: new m.scale.constructor(), rotation: new m.rotation.constructor() }; m.getMatrixAt(h.i, M); M.decompose(o.position, o.quaternion, o.scale); o.rotation.setFromQuaternion(o.quaternion, 'YXZ'); return o; }, 1)`);
  const cam0 = (await ev(`__studio.state`)).cam;

  if (step('objet')) {
    // un objet du décor (du record) animé : il s'élève, tourne et retombe avec rebond ; captures à deux instants
    await say('objet animé :', `(() => { const S = __studio, A = S.anim.api, O = A.O, w = S.world, c = S.state.cam;
      const L = S.scene.list.filter(e => e.kind === 'objet' && S.anim.itemOf(e.id) && !/^(mur|sol)/.test(e.type)).map(e => { window.__it = { id: e.id }; const p = __m().position; return { e, m: { position: p }, d: Math.hypot(p.x - c.x, p.z - c.z) }; }).sort((a, b) => a.d - b.d);
      const pk = L.find(x => x.d > 2 && x.d < 9) || L[0]; if (!pk) return 'aucun objet';
      S.scene.select(pk.e); const o = A.entity(pk.e.key), y0 = pk.m.position.y;
      O.setKey(o, 'y', 0, y0 + 2.2); O.setKey(o, 'y', 1500, y0, null); O.easeAt(o, 'y', 0, 'rebond'); O.setKey(o, 'rz', 0, 0.9); O.setKey(o, 'rz', 1500, 0); O.setKey(o, 'sx', 0, 1.6); O.setKey(o, 'sx', 1500, 1); o.open = true;
      A.changed(); window.__it = { key: pk.e.key, id: pk.e.id, y0, name: pk.e.name }; S.seek(0); return window.__it; })()`);
    await drawn(4);
    await ev(`(() => { const S = __studio, m = __m(), c = S.state.cam; S.set({ yaw: Math.atan2(m.position.z - c.z, m.position.x - c.x), pitch: -0.25 }); return 1; })()`); await drawn(4);
    await say('  à 0 s :', `(() => { const m = __m(); return { y: +(m.position.y - __it.y0).toFixed(2), rz: +m.rotation.z.toFixed(2), sx: +m.scale.x.toFixed(2), poignees: !!__studio.giz.ext, lignes: document.querySelectorAll('#trackRows .lane').length, panneau: document.querySelectorAll('#entPanel .p-grid input').length }; })()`);
    await shot('anim-objet-0s.png');
    await ev(`__studio.seek(1500), 1`); await drawn(4);
    await say('  à 1,5 s :', `(() => { const m = __m(); return { y: +(m.position.y - __it.y0).toFixed(2), rz: +m.rotation.z.toFixed(2), sx: +m.scale.x.toFixed(2) }; })()`);
    await shot('anim-objet-1s5.png');
    // (une vraie poignée glissée à la souris : l'objet suit, une valeur fixe ou une clé est écrite)
    const g = await ev(`(() => { const S = __studio, m = __m(), p = m.position, d = S.giz.seen(p.x, p.y, p.z).dist; return { a: S.giz.screen(p.x + d * 0.09, p.y, p.z), b: S.giz.screen(p.x + d * 0.3, p.y, p.z), x: p.x }; })()`);
    const dbg = win.webContents.debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    let down = false; const mouse = (type, q) => dbg.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(q.x), y: Math.round(q.y), button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : down || type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
    win.webContents.focus(); await mouse('mouseMoved', { x: g.a.x - 3, y: g.a.y }); await wait(250); await mouse('mouseMoved', g.a); await wait(400);
    const survol = await ev(`__studio.giz.hover`);
    down = true; await mouse('mousePressed', g.a); await wait(200); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: g.a.x + (g.b.x - g.a.x) * i / 6, y: g.a.y + (g.b.y - g.a.y) * i / 6 }); await wait(160); } await mouse('mouseReleased', g.b); down = false; await drawn(3);
    await say('  poignée glissée :', `(() => { const S = __studio, m = __m(), o = S.anim.api.byEnt(__it.key); return { survol: ${survol}, deplacement: +(m.position.x - ${g.x}).toFixed(2), x: o.st.x ?? null, clesX: (o.tracks.x || []).length }; })()`);
    await ev(`__studio.undo && 1`);
  }
  if (step('pnj')) {
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    await say('PNJ ajouté :', `(() => { const S = __studio, A = S.anim.api, O = A.O; const o = A.add('perso', { npc: true, name: 'Figurant test', title: 'Acteur' }); if (o.error) return o;
      O.applyPose(o, 'saluer', 0, true); O.applyPose(o, 'bras_en_l_air', 2000, true); O.setKey(o, 'x', 0, o.st.x); O.setKey(o, 'x', 3000, o.st.x + 2);
      const j = A.add('perso', { npc: false, name: 'Faux joueur' }, { x: o.st.x + 1.2, y: o.st.y, z: o.st.z + 0.8, ry: o.st.ry }); O.applyPose(j, 'dab', 0, false); O.setClip(j, 2500, Object.keys(S.aiHost().shared().EMOTE_SHOP)[0]);
      A.changed(); window.__pn = o.uid; window.__pj = j.uid; return { uid: o.uid, canaux: Object.keys(o.tracks).length, dansLeRecord: S.scene.list.some(e => e.id === o.uid), arbre: document.querySelectorAll('.an-row').length }; })()`);
    await drawn(6);
    await say('  dans la scène :', `(() => { const S = __studio, a = S.world.avatars.get(__pn), b = S.world.avatars.get(__pj); return a ? { pos: [a.group.position.x, a.group.position.y, a.group.position.z].map(v => +v.toFixed(2)), brasD: +a.rig.bones.bras_d.rotation.z.toFixed(2), nom: a.name, joueurBrasD: b && +b.rig.bones.bras_d.rotation.x.toFixed(2), avatars: S.world.avatars.size } : 'pas construit'; })()`);
    await ev(`(() => { const S = __studio, o = S.anim.api.objs.find(x => x.uid === __pn); S.scene.select({ key: 'u:' + o.uid, id: o.uid }); S.anim.api.frame(o); return 1; })()`); await drawn(5);
    await shot('anim-pnj-pose.png');
    await ev(`__studio.seek(2000), 1`); await drawn(5);
    await say('  à 2 s :', `(() => { const a = __studio.world.avatars.get(__pn); return { x: +a.group.position.x.toFixed(2), brasD: +a.rig.bones.bras_d.rotation.z.toFixed(2), brasG: +a.rig.bones.bras_g.rotation.z.toFixed(2), panneauOs: document.querySelectorAll('#entPanel .an-bone').length }; })()`);
    await shot('anim-pnj-2s.png');
  }
  if (step('lumiere')) {
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    const p0 = await ev(`(window.__pr = new Map(__studio.world.renderer.info.programs.map(p => [p.id, p.cacheKey])), __pr.size)`);
    await say('lumière :', `(() => { const S = __studio, A = S.anim.api, O = A.O; const o = A.add('lumiere', { ltype: 'point', color: '#ff2a6d', intensity: 30, range: 14 }); if (o.error) return o; const s = A.add('lumiere', { ltype: 'spot', color: '#2affd5', intensity: 60, range: 20 }, { x: o.st.x + 1.5, y: o.st.y + 0.6, z: o.st.z + 1 });
      O.setKey(o, 'li', 0, 30); O.setKey(o, 'li', 2000, 2); A.changed(); A.select(o); window.__li = o.id; return { nom: o.name, spot: s.name, types: A.objs.filter(x => x.kind === 'lumiere').map(x => x.ltype) }; })()`);
    await drawn(6);
    const p1 = await ev(`__studio.anim.api.programs`);
    await say('  réserve :', `(() => { const P = __studio.anim.api.pool; return { programmesAvant: ${p0}, programmesApres: ${p1}, sansRecompilation: (() => { const now = new Map(__studio.world.renderer.info.programs.map(p => [p.id, p.cacheKey])); return [...__pr].every(([id, k]) => now.get(id) === k) && now.size - __pr.size <= 3; })(), ponctuelle: +P.point[0].intensity.toFixed(1), couleur: '#' + P.point[0].color.getHexString(), spot: +P.spot[0].intensity.toFixed(1), panneau: !document.querySelector('.an-panel').hidden }; })()`);
    await shot('anim-lumiere.png');
  }
  if (step('miroir')) {
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    await say('miroir :', `(() => { const S = __studio, A = S.anim.api; const o = A.add('miroir', { w: 2.4, h: 2.6, tint: '#cfe8ff' }); if (o.error) return o; const t = A.add('texte', { text: 'BIG STREET', color: '#ffd23d', size: 0.5 }, { x: o.st.x, y: o.st.y + 2.8, z: o.st.z, ry: o.st.ry }); A.select(o); A.frame(o); return { nom: o.name, texte: t.name }; })()`);
    await drawn(6);
    await say('  état :', `(() => { const S = __studio, n = [...S.anim.api.nodes.values()].find(x => x.mirror); return n ? { visible: n.node.visible, erreur: !!n.mirror.mesh.userData.err, taille: [n.mirror.w, n.mirror.h] } : 'absent'; })()`);
    await shot('anim-miroir.png');
  }
  if (step('modele')) {
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    await say('objet ajouté :', `(() => { const S = __studio, A = S.anim.api, O = A.O; const all = A.searchCatalog('', 5000), hit = A.searchCatalog('chaise', 5)[0] || all[0]; const o = A.add('modele', { model: hit.type, label: hit.name }); if (o.error) return o;
      O.setKey(o, 'y', 0, o.st.y + 2.5, 'rebond'); O.setKey(o, 'y', 1500, o.st.y); O.setKey(o, 'ry', 0, 0); O.setKey(o, 'ry', 1500, 3.14);
      const v = A.searchCatalog('voiture', 3)[0] || A.searchCatalog('lambo', 3)[0]; const c = v ? A.add('modele', { model: v.type, label: v.name }, { x: o.st.x + 2.5, y: o.st.y, z: o.st.z - 1, ry: 0.6 }) : null; A.changed(); A.select(o); window.__mo = o.id;
      return { catalogue: all.length, familles: [...new Set(all.map(m => m.cat))], objet: hit.type, vehicule: v?.type || null }; })()`);
    await ev(`__studio.seek(600), 1`); await drawn(8);
    await say('  dans la scène :', `(() => { const n = __studio.anim.api.nodes.get(__mo); return { maillages: n.node.children.length, y: +n.node.position.y.toFixed(2), cap: +n.node.rotation.y.toFixed(2), visible: n.node.visible }; })()`);
    await shot('anim-modele.png');
  }
  if (step('particules')) {
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(1000), 1`); await drawn(2);
    await say('particules :', `(() => { const A = __studio.anim.api; const o = A.add('particules', { ptype: 'confettis', count: 400, spread: 5, size: 1.5 }); const f = A.add('particules', { ptype: 'feu', count: 200, size: 1.4 }, { x: o.st.x + 1, y: o.st.y, z: o.st.z + 0.5 }); A.select(o); return [o.name, f.name]; })()`);
    await drawn(5); await shot('anim-particules.png');
  }
  if (step('ambiance')) {
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    await say('éclairage du lieu :', `(() => { const S = __studio, A = S.anim.api, O = A.O; const L = A.sceneLamps(50); const a = A.ambiance(true); O.setParam(a, 'expo', 0.3, 0); O.setParam(a, 'cb', 1, 0); O.setParam(a, 'cr', 0.6, 0); A.changed(); A.select(a); return { lampes: L.length, premieres: L.slice(0, 3) }; })()`);
    await drawn(5); await shot('anim-ambiance.png');
    await say('  rendu au moteur :', `(() => { const S = __studio; let n = 0, on = 0; S.world.scene.traverse(o => { if (o.isLight && !o.userData.stPool) { n++; if (o.intensity > 0) on++; } }); return { lumieres: n, allumees: on }; })()`);
  }
  if (step('projet')) {
    // enregistrement, annulation, relecture du projet
    await say('projet :', `(async () => { const S = __studio; S.flush(); const n = S.anim.api.objs.length; S.undo(); const apres = S.anim.api.objs.length; S.redo(); return { elements: n, apresAnnuler: apres, apresRetablir: S.anim.api.objs.length, historique: S.hist }; })()`);
    await ev(`document.querySelector('#saveProj').click(), 1`); await wait(900);
    const f = readdirSync(process.env.BS_STUDIO_DIR).find(x => x.endsWith('.bsproj'));
    if (f) { const pj = JSON.parse(readFileSync(path.join(process.env.BS_STUDIO_DIR, f), 'utf8')); console.log('  fichier :', f, JSON.stringify({ v: pj.v, cles: Object.keys(pj), elements: pj.anim?.objs.map(o => o.kind + ':' + o.name) })); } else console.log('  fichier : aucun .bsproj');
    await drawn(2); await shot('anim-fin.png');
  }
  if (STEPS.includes('final')) {
    // tout ensemble, comme une vraie cinématique : PNJ posé, lumière, miroir, lampes du lieu, vue à travers une caméra (raytracing), outils
    // de l'assistant sur le vrai moteur d'actions, puis projet enregistré, record rouvert, tout doit revenir
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    await say('lampes du lieu :', `(() => { const A = __studio.anim.api, L = A.sceneLamps(50); let n = 0, vis = 0; __studio.world.scene.traverse(o => { if (o.isPointLight || o.isSpotLight) { n++; if (o.visible && o.intensity > 0) vis++; } }); window.__lamps = L; return { ponctuellesOuSpots: n, allumeesVisibles: vis, listees: L.length, premieres: L.slice(0, 4).map(l => [l.key, l.type, l.intensite, Math.round(l.d)]) }; })()`);
    await shot('final-0-avant.png');
    await say('scène montée :', `(() => { const S = __studio, A = S.anim.api, O = A.O; const p = A.add('perso', { npc: true, name: 'Acteur', title: 'Figurant' }); O.applyPose(p, 'saluer', 0, true); O.applyPose(p, 'victoire', 3000, true); window.__pn = p.uid;
      const l = A.add('lumiere', { ltype: 'point', color: '#ff2a6d', intensity: 25, range: 12 }, { x: p.st.x + 0.8, y: p.st.y + 2.2, z: p.st.z + 0.6 }); const m = A.add('miroir', { w: 2, h: 2.4 }, { x: p.st.x - 1.6, y: p.st.y, z: p.st.z - 0.4, ry: p.st.ry + 0.5 });
      const off = __lamps[0] ? A.lampObj(__lamps[0].key, true) : null; if (off) O.setParam(off, 'lm', 0, 0); const a = A.ambiance(true); O.setParam(a, 'expo', 0.55, 0);
      S.scene.setLook(p.uid, { look: { shirt: 1 } }); A.changed(); S.addCam(); S.cams[0].rt = 0.6; S.cams[0].name = 'Plan final'; S.refreshUi(); return { elements: A.objs.map(o => o.kind + ':' + o.name), lampeEteinte: off?.lkey || null, surcharge: Object.keys(S.ents.over) }; })()`);
    await drawn(6); await shot('final-1-libre.png');
    const pr = await ev(`(window.__pr = new Map(__studio.world.renderer.info.programs.map(p => [p.id, p.cacheKey])), __pr.size)`);
    await ev(`(() => { const o = __studio.anim.api.objs.find(x => x.kind === 'lumiere'); o.st.li = 0; return 1; })()`); await drawn(3);
    await ev(`(() => { const o = __studio.anim.api.objs.find(x => x.kind === 'lumiere'); o.st.li = 30; return 1; })()`); await drawn(3);
    await say('lumière 0 → 30 :', `(() => { const now = new Map(__studio.world.renderer.info.programs.map(p => [p.id, p.cacheKey])); return { avant: ${pr}, apres: now.size, aucunShaderRecompile: now.size === __pr.size && [...__pr].every(([id, k]) => now.get(id) === k), intensite: __studio.anim.api.pool.point[0].intensity }; })()`);
    await ev(`(__studio.selectCam(__studio.cams[0].id), __studio.setMode('cam'), 1)`); await drawn(6);
    await ev(`(() => { const A = __studio.anim.api, o = A.O.newObj(A.data, 'effets'); o.st.shake = 0.8; __studio.seek(700); return 1; })()`); await drawn(3);
    await say('vue caméra :', `(() => { const S = __studio; return { mode: S.state.mode, filtre: S.state.filtre, tremblement: +(S.state.cam.x - S.pose(0).x).toFixed(3), panneauCache: document.querySelector('.an-panel').hidden, aide: [...S.anim.api.nodes.values()].flatMap(n => n.help || []).some(h => h.visible) }; })()`);
    await shot('final-2-camera.png');
    await ev(`(__studio.setMode('free'), 1)`); await drawn(2);
    await say('assistant (vrai moteur) :', `(async () => { const T = await import('/__studio/ai-tools.js'), S = __studio, E = T.createEngine(S.aiHost()), names = E.tools.map(t => t.function.name);
      const r1 = E.exec('list_elements', {}), r2 = E.exec('add_light', { type: 'spot', name: 'Poursuite', color: '#00ffcc', intensity: 30, look_at: { entity: 'Acteur' }, near: 'Acteur', y: 3 }), r3 = E.exec('animate_element', { element: 'Acteur', keys: [{ t: 0, cap: 0 }, { t: 2, cap: 180 }] }), r4 = E.exec('set_scene_lighting', { t: 4, brightness: 0.2 }), r5 = E.exec('make_fall', { element: 'i:' + S.scene.list.find(e => e.kind === 'objet' && !/^mur/.test(e.type)).id, t: 1, height: 2 });
      return { outils: names.length, uniques: new Set(names).size === names.length, resultats: [r1, r2, r3, r4, r5].map(r => r.text.slice(0, 90)) }; })()`);
    await drawn(3);
    await ev(`document.querySelector('#saveProj').click(), 1`); await wait(1200);
    const f = readdirSync(process.env.BS_STUDIO_DIR).find(x => x.endsWith('.bsproj')); const pj = f ? JSON.parse(readFileSync(path.join(process.env.BS_STUDIO_DIR, f), 'utf8')) : null;
    console.log('fichier :', JSON.stringify(pj ? { v: pj.v, elements: pj.anim?.objs.length, cams: pj.cams.length, surcharges: Object.keys(pj.ents?.over || {}) } : null));
    const before = await ev(`(() => { const S = __studio; return { elements: S.anim.api.objs.length, avatars: S.world.avatars.size }; })()`);
    await ev(`__studio.open(${JSON.stringify(name)}).then(() => 1)`); await wait(1500); await drawn(8);
    await say('record rouvert :', `(() => { const S = __studio, A = S.anim.api, a = S.world.avatars.get(__pn), P = A.pool; return { avant: ${JSON.stringify(before)}, elements: A.objs.length, avatars: S.world.avatars.size, acteur: a ? { nom: a.name, brasD: +a.rig.bones.bras_d.rotation.z.toFixed(2), chemise: a.look?.shirt } : null, lumiereRose: +P.point[0].intensity.toFixed(1), spot: +P.spot[0].intensity.toFixed(1), miroir: [...A.nodes.values()].some(n => n.mirror), cams: S.cams.length, dansLaScene: S.scene.list.some(e => e.id === __pn) }; })()`);
    await shot('final-3-rouvert.png');
  }
  if (STEPS.includes('suite')) {
    const { execFileSync } = await import('node:child_process');
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    // caméra attachée à un élément ajouté ; titre, fondu ; sujets de l'assistant
    await say('caméra sur un objet ajouté :', `(async () => { const S = __studio, A = S.anim.api, O = A.O; const o = A.add('modele', { model: A.searchCatalog('chaise', 1)[0].type, label: 'Chariot' }); O.setKey(o, 'x', 0, o.st.x); O.setKey(o, 'x', 4000, o.st.x + 3); O.setKey(o, 'x', 2000, o.st.x + 1); O.setKey(o, 'x', 3000, o.st.x + 2); o.open = true; A.changed(); window.__ch = o.id;
      S.addCam(); S.setParent(0, 'Chariot'); const p0 = S.pose(0, 0), p1 = S.pose(0, 4000);
      const T = await import('/__studio/ai-tools.js'), E = T.createEngine(S.aiHost()), r = [E.exec('frame_shot', { camera: 'Plan chariot', t: 1, subject: 'Chariot', shot: 'moyen' }), E.exec('add_title', { text: 'BIG STREET\\nle film', from: 0, to: 6, position: 'centre' }), E.exec('add_title', { text: 'Bonjour, un paquet de chips.', from: 0.5, to: 6, position: 'bas', box: true }), E.exec('set_fade', { t: 0, black: 100 }), E.exec('set_fade', { t: 2, black: 0 }), E.exec('add_object', { model: 'plante_verte_en_pot', at: 'Chariot' }), E.exec('find_models', { query: 'plante' })];
      return { parent: S.cams[0].parent, suit: +(p1.x - p0.x).toFixed(2), sujets: S.aiHost().entities().filter(e => e.added).map(e => e.name), outils: r.map(x => x.text.slice(0, 110)) }; })()`);
    await ev(`(__studio.selectCam(__studio.cams[0].id), __studio.setMode('cam'), __studio.seek(1000), 1)`); await drawn(6);
    await say('calque 2D :', `(() => { const ov = __studio.anim.api.overlay(1000, true); return { fondu: +ov.fade.toFixed(2), titres: ov.titles.map(t => [t.text.split('\\n')[0], +t.alpha.toFixed(2)]) }; })()`);
    await shot('suite-1-titres.png');
    await say('capture PNG :', `__studio.anim.api.capturePng(1920, 1080)`);
    // son : un fichier WAV fabriqué (1,5 s, 440 Hz), importé, puis un export WebM avec le son
    await say('son importé :', `(async () => { const S = __studio, A = S.anim.api; S.setMode('free'); S.seek(500); const n = 72000, b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 48000 * 2 * Math.PI * 440) * 12000 * Math.min(1, i / 4000), true);
      await new Promise(r => setTimeout(r, 300)); const o = await A.importAudio(b, 'bip.wav'); if (o.error) return o; A.O.setKey(o, 'vol', o.t0, 0); A.O.setKey(o, 'vol', o.t0 + 500, 1); A.changed(); const mix = await S.anim.mixAudio(0, 2500);
      return { nom: o.name, duree: o.dur, debut: o.t0, crete: +Math.max(...A.audio.peaks.get(o.hash)).toFixed(2), mixage: mix && { echantillons: mix.data[0].length, silenceAvant: Math.max(...mix.data[0].subarray(0, 20000).map(Math.abs)) < 0.001, sonApres: +Math.max(...mix.data[0].subarray(60000, 80000).map(Math.abs)).toFixed(2) }, bloc: document.querySelectorAll('canvas.an-block').length }; })()`);
    await drawn(3);
    const xr = await ev(`(async () => { try { const xp = __studio.aiHost().xport(); return await xp.run({ format: 'webm', width: 320, height: 180, fps: 10, start: 0, end: 2500, name: 'essai-son', reveal: false }); } catch (e) { return { ok: false, error: String(e.stack || e) }; } })()`);
    console.log('export WebM :', JSON.stringify(xr));
    if (xr?.ok) { const file = path.join(xr.dir, xr.name.endsWith('.webm') ? xr.name : xr.name + '.webm'); try { console.log('  ffprobe :', execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,channels:format=duration', '-of', 'csv', file]).toString().replace(/\n/g, ' | ')); } catch (e) { console.log('  ffprobe :', String(e.message).slice(0, 200)); } try { rmSync(file); } catch { /* tant pis */ } }
    // gestes de frise à la vraie souris : Ctrl+clic sur deux clés, glisser, Ctrl+C / Ctrl+V
    await ev(`(() => { const S = __studio, o = S.anim.api.byId(__ch); S.setMode('free'); for (const c of S.cams) c.open = false; S.anim.api.select(o); S.seek(0); S.refreshUi(); return 1; })()`); await drawn(3);
    await ev(`(() => { const rows = [...document.querySelectorAll('#trackRows .tr-head.sub')].filter(h => h.textContent.includes('Position X')); rows[rows.length - 1]?.scrollIntoView({ block: 'center' }); return 1; })()`); await wait(400);
    const dbg = win.webContents.debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    const mouse = (type, q, mod = 0, down = false) => dbg.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(q.x), y: Math.round(q.y), button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : down || type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers: mod });
    const key = (k, code, mod = 2) => dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mod, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }).then(() => dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mod }));
    const kfs = () => ev(`(() => { const rows = [...document.querySelectorAll('#trackRows .tr-head.sub')].filter(h => h.textContent.includes('Position X')); const lane = rows[rows.length - 1]?.nextElementSibling; return lane ? [...lane.querySelectorAll('.kf')].map(k => { const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, sel: k.classList.contains('sel') }; }) : []; })()`);
    const times = () => ev(`__studio.anim.api.byId(__ch).tracks.x.map(k => k.t)`);
    let K = await kfs(); console.log('frise : clés X à', JSON.stringify(await times()), '—', K.length, 'losanges');
    win.webContents.focus();
    if (K.length >= 4) {
      await mouse('mouseMoved', K[2]); await mouse('mousePressed', K[2], 2); await mouse('mouseReleased', K[2], 2); await wait(300);
      K = await kfs(); await mouse('mouseMoved', K[3]); await mouse('mousePressed', K[3], 2); await mouse('mouseReleased', K[3], 2); await wait(300);
      K = await kfs(); console.log('  Ctrl+clic ×2 → sélection :', JSON.stringify(await ev(`__studio.anim.api.selKeys.map(k => k.t)`)), 'losanges marqués :', K.filter(k => k.sel).length);
      await shot('suite-2-selection.png');
      // (glisser les deux clés de 60 pixels vers la droite, Alt enfoncé : sans aimantation)
      await mouse('mouseMoved', K[2]); await mouse('mousePressed', K[2], 1); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: K[2].x + i * 10, y: K[2].y }, 1, true); await wait(90); } await mouse('mouseReleased', { x: K[2].x + 60, y: K[2].y }, 1); await wait(300);
      console.log('  glisser groupé →', JSON.stringify(await times()), 'sélection :', JSON.stringify(await ev(`__studio.anim.api.selKeys.map(k => k.t)`)));
      await key('c', 'KeyC'); await wait(150); await ev(`__studio.seek(7000), 1`); await wait(400); await key('v', 'KeyV'); await wait(300);
      console.log('  Ctrl+C puis Ctrl+V à 7 s →', JSON.stringify(await times()));
      await key('z', 'KeyZ'); await wait(500); console.log('  Ctrl+Z →', JSON.stringify(await times()));
      await drawn(2); await shot('suite-3-frise.png');
    }
  }
  if (STEPS.includes('modeles')) {
    // modèle de projet par l'assistant, ralenti et image figée, prévisualisation
    await ev(`__studio.set(${JSON.stringify(cam0)}), __studio.seek(0), 1`); await drawn(2);
    await say('modèle « trailer » :', `(async () => { const S = __studio, T = await import('/__studio/ai-tools.js'), E = T.createEngine(S.aiHost()); const r = E.exec('apply_template', { template: 'trailer', title: 'TABAC DES LUCIOLES' }), sum = E.exec('cinematic_summary', {}), sp = E.exec('set_speed', { t: 2, speed: 0.25 }), fz = E.exec('set_speed', { t: 4, freeze: 1 });
      return { r: r.text, plans: (sum.data.plans || []).map(p => [p.camera, p.debut, p.fin]), problemes: (sum.data.problemes || []).length, sp: sp.text, fz: fz.text, cams: S.cams.length }; })()`);
    await ev(`(__studio.startCine(), __studio.play(false), __studio.seek(__studio.state.dur * 0.3), 1)`); await drawn(6); await shot('modeles-1-tour.png');
    await ev(`(__studio.seek(__studio.state.dur * 0.93), 1)`); await drawn(6); await shot('modeles-2-titre.png');
    await say('temps ralenti :', `(async () => { const S = __studio; S.setMode('free'); S.seek(1000); S.play(true); const t0 = S.state.T, r0 = performance.timeOrigin + 0; await new Promise(r => setTimeout(r, 2500)); S.play(false); const a = S.anim; return { avance: Math.round(S.state.T - t0), images: a.frameTimes(0, 6000, 100).length, sansRalenti: 61 }; })()`);
  }
  win.destroy();
} catch (e) { console.error('ÉCHEC', e); code = 1; }
clearTimeout(guard);
try { rmSync(dir, { recursive: true, force: true }); } catch { /* tant pis */ }
app.exit(code);
}
main();
