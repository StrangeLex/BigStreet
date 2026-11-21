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
 *  8. Studio : caméras d'un projet (anciens formats relus, une piste d'images-clés par paramètre, parents, enchaînement,
 *     coordonnées relatives au parent, clé sur tous les paramètres, aimantation, suppression d'une caméra)
 *  9. Studio : panneau « Scène » (arbre des entités, recherche), droits d'apparence selon les skins du compte
 * 10. Studio : moteur d'actions de l'assistant IA, piloté par un faux modèle (outils, cadrages, restauration)
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
  const sHtml = readFileSync(path.join(root, 'src/studio/studio.html'), 'utf8'), sJs = ['studio.js', 'cams.js', 'fx.js', 'gizmo.js', 'pip.js', 'scene.js', 'ents.js', 'ai.js', 'ai-tools.js'].map(f => readFileSync(path.join(root, 'src/studio', f), 'utf8')).join('\n');
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
  ok('projet version 3 écrit et relu', back.v === 4 && re.cams[0].id === a.id && re.cams[0].tracks.vignette.length === 2 && re.cams[0].tracks.x.length === 2);
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
  // coordonnées relatives au parent : (0, 0, 0) = la caméra est DANS son parent (l'origine d'un personnage : sa tête)
  const head = (p, t) => (p.id === 7 ? { x: 50 + t / 1000, y: 3 + C.ORIGIN_Y.perso, z: -8, yaw: 0.7 } : null);
  const r = C.newCam([], { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60 }, 0); r.parent = { kind: 'perso', id: 7, name: 'Nina' };
  const r0 = C.worldPose(r, 0, [r], head), r2 = C.worldPose(r, 2000, [r], head);
  ok('parent : 0 / 0 / 0 = dans le parent, et elle le suit', near(r0.x, 50) && near(r0.y, 3 + C.ORIGIN_Y.perso) && near(r0.z, -8) && near(r2.x, 52) && C.poseAt(r, 2000).x === 0);
  r.follow = true; C.setKey(r, 'x', 0, 2); const rf = C.worldPose(r, 0, [r], head);
  ok('parent : relatif à son orientation quand elle tourne avec lui', near(rf.x, 50 + 2 * Math.cos(0.7)) && near(rf.z, -8 + 2 * Math.sin(0.7)) && near(rf.yaw, 0.7));
  const old = C.loadProject({ v: 3, cams: [{ id: 'o', parent: { kind: 'perso', id: 7, name: 'Nina' }, tracks: { x: [{ t: 0, v: 1 }], y: [{ t: 0, v: 1.7 }], z: [{ t: 0, v: 0 }] } }] });
  ok('projet 1.6.1 : hauteurs converties (origine du parent passée du sol à la tête)', near(old.cams[0].tracks.y[0].v, 1.7 - C.ORIGIN_Y.perso) && old.cams[0].rt === 0 && old.cams[0].shadow === false && old.ents.hidden.length === 0);
  // clé sur tous les paramètres ; raytracing animable
  const k = C.newCam([], pose(1), 0); const made = C.keyAll(k, 1500);
  ok('clé sur tous les paramètres', made === C.PARAMS.length && C.allKeyed(k, 1500) && !C.allKeyed(k, 0) && C.delAt(k, null, 1500) === C.PARAMS.length && !C.hasKey(k, null, 1500));
  C.setKey(k, 'rt', 0, 0); C.setKey(k, 'rt', 1000, 1); k.shadow = true;
  ok('raytracing et ombre', near(C.fxAt(k, 500).rt, 0.5) && C.fxAt(k, 500).shadow === true && C.loadProject(JSON.parse(C.saveProject('x', 1, [k]))).cams[0].tracks.rt.length === 2);
  // aimantation : la tête de lecture d'abord, puis les autres clés, puis la seconde ; rien hors tolérance
  const S = (t, tol = 60) => C.snapTime(t, [[2040], [1990, 3500], [Math.round(t / 1000) * 1000]], tol);
  ok('aimantation', S(2010).t === 2040 && S(2010).snap === 0 && S(1960).t === 1990 && S(1960).snap === 1 && S(3470).t === 3500 && S(5030).t === 5000 && S(5030).snap === 2 && S(5400).t === 5400 && S(5400).snap === -1 && S(2010, 5).snap === -1);
  // suppression d'une caméra : celles qui lui étaient attachées sont détachées sans bouger
  const pa = C.newCam([], pose(10), 0), ch = C.newCam([pa], pose(13), 0); let L = [pa, ch];
  C.rebase(ch, L, frame, () => { ch.parent = { kind: 'camera', id: pa.id, name: pa.name }; });
  const before = C.worldPose(ch, 0, L, frame).x; L = C.removeCam(L, pa, frame);
  ok('suppression d’une caméra', L.length === 1 && L[0] === ch && ch.parent === null && near(before, 13) && near(C.worldPose(ch, 0, L, frame).x, 13));
  const pj = C.loadProject(JSON.parse(C.saveProject('x', 1, [], { over: { 'u:3': { name: 'Nina', look: { top: 5, bad: 'x' }, wd: { 'sk:top': 'hope', evil: 1 }, hold: 'glock17__or' }, '../x': { look: { top: 1 } } }, hidden: ['u:4', 'i:9', 'zz', 'u:4'] })));
  ok('surcharges d’entités écrites et relues (nettoyées)', pj.ents.hidden.join() === 'u:4,i:9' && pj.ents.over['u:3'].look.top === 5 && !('bad' in pj.ents.over['u:3'].look) && pj.ents.over['u:3'].wd['sk:top'] === 'hope' && !('evil' in pj.ents.over['u:3'].wd) && pj.ents.over['u:3'].hold === 'glock17__or' && Object.keys(pj.ents.over).length === 1);
  return C;
}

// ---------------------------------------------------------------- 9 et 10 : scène, apparence, assistant IA (sans moteur 3D)
const mod = f => import('data:text/javascript;base64,' + readFileSync(path.join(root, 'src/studio', f)).toString('base64'));
function fakeRecord() {
  const K = (desc, pts) => ({ desc: [[0, desc]], gone: [], t: pts.map(p => p[0]), x: pts.map(p => p[1]), z: pts.map(p => p[2]), y: pts.map(() => 0), a: pts.map(() => 0), f: pts.map(() => 0), i: 0 });
  return { dur: 20000, room: { id: 'test', items: [{ id: 100, type: 'chaise', x: 3, y: 4 }, { id: 101, type: 'chaise', x: 5, y: 4 }, { id: 102, type: 'lampe', x: 1, y: 1 }] }, items: new Map(), events: [[4000, { t: 'chat', id: 2, text: 'Salut !' }]],
    users: new Map([[1, K({ id: 1, name: 'Lex', look: { gender: 0, top: 0, hat: 0, hairStyle: 0 } }, [[0, 10, 10], [10000, 20, 10], [20000, 20, 10]])], [2, K({ id: 2, name: 'Nina', npc: true, title: 'Boulangère', look: { gender: 1, top: 2, hat: 1 }, wd: { 'sk:top': 'x' } }, [[0, 14, 13]])], [3, K({ id: 3, name: 'Nina', npc: true, look: {} }, [[0, 30, 30]])]]),
    vehs: new Map([[7, K({ id: 7, model: 'lambo', owner: 'Lex' }, [[0, 0, 0]])]]) };
}
const FAKE_SH = { LOOK_STYLES: { gender: ['Homme', 'Femme'], top: ['T-shirt', 'Débardeur', 'Pull', 'Sweat', 'Chemise', 'Veste'], hat: ['Aucun', 'Casquette', 'Bonnet', 'Haut-de-forme'], hairStyle: ['Courte', 'Longue', 'Crête'], chest: ['Plate', 'Petite'], beard: ['Aucune', 'Moustache'] }, LOOK_COLORS: { shirt: ['#00f', '#f00', '#0f0'] },
  isPremium: (k, v) => (k === 'hat' && v === 3) || (k === 'hairStyle' && v === 2), ITEMS: { glock17: { name: 'Glock 17' }, sac_a_dos: { name: 'Sac à dos' } },
  SKINS: { vet_top: { hope: { name: 'Veste Hope', s: [5] }, uni: { name: 'Haut Uni' } }, glock17: { or: { name: 'Glock 17 Plaqué or' } }, sac_a_dos: { pirate: { name: 'Sac à dos Pirate' } } } };
async function checkScene() {
  const E = await mod('ents.js'), rec = fakeRecord(), L = E.listEntities(rec, 1, { chaise: { name: 'Chaise en bois' } });
  ok('scène : entités du record', L.length === 7 && L[0].me && L[0].name === 'Lex' && L[0].sub === 'le joueur' && L.filter(e => e.kind === 'pnj').map(e => e.name).join() === 'Nina,Nina #3' && L.some(e => e.key === 'v:7' && e.kind === 'vehicule') && L.some(e => e.key === 'i:100' && e.name === 'Chaise en bois'));
  const T0 = E.buildTree([{ id: 'c1', name: 'Plan large', color: '#fff', on: true, parent: null }], L), g = k => T0.find(x => x.kind === k);
  ok('scène : arbre par familles', T0.map(x => x.kind).join() === 'camera,joueur,pnj,vehicule,objet' && g('camera').rows[0].key === 'c:c1' && g('joueur').total === 1 && g('pnj').total === 2 && g('vehicule').total === 1 && g('objet').total === 3);
  const T1 = E.buildTree([], L, 'boulangere'), T2 = E.buildTree([], L, 'CHAISE'), T3 = E.buildTree([], L, '', 2);
  ok('scène : recherche (sans accents ni majuscules) et liste bornée', T1.find(x => x.kind === 'pnj').found === 1 && T1.find(x => x.kind === 'objet').found === 0 && T2.find(x => x.kind === 'objet').found === 2 && T3.find(x => x.kind === 'objet').rows.length === 2 && T3.find(x => x.kind === 'objet').more === 1);
  // apparence : seulement les skins du compte ; un administrateur a tout ; ce que le personnage porte déjà reste permis
  const base = { name: 'Nina', look: { gender: 1, top: 2, hat: 1, hairStyle: 0 }, wd: { 'sk:top': 'uni' } };
  const guest = E.rights(null, FAKE_SH), own = E.rights({ owned: ['hat:3', 'skin:vet_top:hope', 'skin:glock17:or'] }, FAKE_SH), adm = E.rights({ admin: true, owned: [] }, FAKE_SH);
  const g1 = E.changeLook(base, null, { look: { hat: 3, top: 5 }, skins: { top: 'hope' }, hold: 'glock17__or', bag: 'sac_a_dos__pirate' }, guest, FAKE_SH);
  ok('apparence : sans les skins du compte, le payant est refusé', g1.over.look.top === 5 && !('hat' in g1.over.look) && !g1.over.wd && !('hold' in g1.over) && !('bag' in g1.over) && g1.refused.length === 4);
  const o1 = E.changeLook(base, null, { look: { hat: 3, top: 5, hairStyle: 2 }, skins: { top: 'hope' }, hold: 'glock17__or', bag: 'sac_a_dos__pirate' }, own, FAKE_SH);
  ok('apparence : limitée aux skins possédés', o1.over.look.hat === 3 && o1.over.wd['sk:top'] === 'hope' && o1.over.hold === 'glock17__or' && !('bag' in o1.over) && !('hairStyle' in o1.over.look) && o1.refused.length === 2);
  const a1 = E.changeLook(base, null, { look: { hat: 3, hairStyle: 2, top: 9 }, bag: 'sac_a_dos__pirate', hold: 'bazooka' }, adm, FAKE_SH);
  ok('apparence : un administrateur a tout (mais pas l’inexistant)', a1.over.look.hat === 3 && a1.over.look.hairStyle === 2 && a1.over.bag === 'sac_a_dos__pirate' && !('top' in a1.over.look) && !('hold' in a1.over) && a1.refused.length === 2);
  const eff = E.applyOver(base, { look: { top: 0 } }, FAKE_SH), eff2 = E.applyOver(base, o1.over, FAKE_SH);
  ok('apparence : surcharge appliquée, skin retiré s’il ne va plus', eff.look.top === 0 && eff.wd?.['sk:top'] === 'uni' && eff2.look.top === 5 && eff2.wd['sk:top'] === 'hope' && eff2.hold === 'glock17__or' && base.look.top === 2 && E.applyOver({ look: { top: 5 }, wd: { 'sk:top': 'hope' } }, { look: { top: 1 } }, FAKE_SH).wd === undefined);
  return { E, L, rec };
}
async function checkAI(C, { E, L, rec }) {
  const A = await mod('ai-tools.js');
  // (un faux Studio : positions tirées du faux record, apparences par ents.js — et un faux modèle qui joue un scénario d'appels d'outils)
  const posAt = (key, t) => { const [k, id] = key.split(':'), K = (k === 'u' ? rec.users : rec.vehs).get(+id); if (k === 'i') { const it = rec.room.items.find(i => i.id === +id); return it ? { x: it.x, y: 0, z: it.y, yaw: 0, present: true } : null; } if (!K) return null;
    let i = 0; while (i + 1 < K.t.length && K.t[i + 1] <= t) i++; const j = Math.min(i + 1, K.t.length - 1), u = j === i ? 0 : Math.max(0, Math.min(1, (t - K.t[i]) / (K.t[j] - K.t[i])));
    return { x: K.x[i] + (K.x[j] - K.x[i]) * u, y: 0, z: K.z[i] + (K.z[j] - K.z[i]) * u, yaw: 0, present: true }; };
  const st = { cams: [], ents: { over: {}, hidden: [] }, T: 0, seeks: [], changes: 0 }, acc = { name: 'Lex', admin: false, owned: ['hat:3'] };
  const frame = (p, t) => { const q = posAt(`${p.kind === 'vehicule' ? 'v' : 'u'}:${p.id}`, t); return q ? { x: q.x, y: q.y + C.ORIGIN_Y[p.kind], z: q.z, yaw: q.yaw } : null; };
  const H = { C, get cams() { return st.cams; }, set cams(v) { st.cams = v; }, get T() { return st.T; }, dur: rec.dur, frame,
    info: () => ({ lieu: 'Boulangerie', interieur: true, heure: 14, nuit: false, joueur: { id: 1, nom: 'Lex' }, compte: { pseudo: 'Lex', admin: false } }),
    entities: () => L, find: q => (['joueur', 'le joueur'].includes(E.norm(q)) ? L.find(e => e.me) : L.find(e => String(e.id) === String(q) && e.kind !== 'objet') || L.find(e => E.norm(e.name) === E.norm(q)) || null),
    posAt, blocked: (x, z) => x < -50 || z < -50, aspect: () => 16 / 9, isHidden: k => st.ents.hidden.includes(k), stateOf: () => ({ etat: 'debout' }),
    lookOf: id => { const d = E.applyOver(rec.users.get(id).desc[0][1], st.ents.over[`u:${id}`], FAKE_SH); return { ...d, text: E.describeLook(d, FAKE_SH) }; }, lookOptions: () => ({ attributs: {} }),
    events: (a, b) => rec.events.filter(([t]) => t >= a && t <= b).map(([t, m]) => ({ t, id: m.id, type: 'parole', name: 'Nina', text: m.text })),
    seek: t => { st.T = t; st.seeks.push(t); }, setRate() {}, play() {}, view() {}, preview: () => !!C.cineRange(st.cams), exportVideo: () => false,
    setLook: (id, patch) => { const r = E.changeLook(rec.users.get(id).desc[0][1], st.ents.over[`u:${id}`], patch, E.rights(acc, FAKE_SH), FAKE_SH); if (r.done.length) st.ents.over[`u:${id}`] = r.over; return r; },
    resetLook: id => { delete st.ents.over[`u:${id}`]; }, setHidden: (k, on) => { st.ents.hidden = on ? [...st.ents.hidden, k] : st.ents.hidden.filter(x => x !== k); }, changed: () => { st.changes++; } };
  const schemas = A.toolSchemas();
  ok('assistant : outils décrits (schémas « function »)', schemas.length >= 24 && schemas.every(t => t.type === 'function' && t.function.name && t.function.description.length > 20 && t.function.parameters.type === 'object') && A.SYSTEM_PROMPT.length > 4000);
  const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const script = [
    { content: 'Je regarde la scène.', tool_calls: [call('scene_info', {}), call('get_entity', { entity: 'joueur', t: 5 }), call('entity_path', { entity: 'Lex', from: 0, to: 10 }), call('list_events', {})] },
    { content: '', tool_calls: [call('frame_shot', { camera: 'Plan large', t: 0, subject: 'joueur', shot: 'ensemble', side: 'face', height: 'plongee' }), call('frame_shot', { camera: 'Plan large', t: 4, subject: 'joueur', shot: 'ensemble', side: 'face', height: 'plongee', ease: 'doux' }),
      call('frame_shot', { camera: 'Gros plan', t: 4, subject: 'Nina', shot: 'gros_plan', side: 'trois_quarts_droit', thirds: 'gauche' }), call('set_keys', { camera: 'Gros plan', keys: [{ t: 7, fov: 28, raytracing: 60, ease: 'doux' }, { t: 4, raytracing: 0 }] }),
      call('update_camera', { camera: 'Gros plan', filter: 'cine', shadow: true, vignette: 30 }), call('orbit_shot', { camera: 'Tour', subject: 'joueur', from: 7, to: 12, degrees: 180, distance: 3 }),
      call('set_appearance', { entity: 'Nina', look: { hat: 3, hairStyle: 2 } }), call('set_visibility', { entity: 3, visible: false }), call('set_keys', { camera: 'Inconnue', keys: [{ t: 1, x: 0 }] }), call('nimporte_quoi', {})] },
    { content: '', tool_calls: [call('cinematic_summary', {}), call('get_camera', { camera: 'Tour', t: 9 }), call('seek', { t: 4 })] },
    { content: 'Trois plans : ouverture large, gros plan sur Nina, tour autour de toi. Je prévisualise ?' },
  ];
  const seen = []; let n = 0;
  const ask = async req => { seen.push(req); return { ok: true, message: { role: 'assistant', ...script[n++] } }; };
  const history = [], snap0 = JSON.stringify({ cams: st.cams, ents: st.ents }), events = [];
  const res = await A.runTurn(H, history, 'Fais-moi une belle cinématique.', ask, ev => events.push(ev));
  const cam = nm => st.cams.find(c => c.name === nm), wide = cam('Plan large'), close = cam('Gros plan'), tour = cam('Tour');
  ok('assistant : boucle outils → résultats → modèle', n === 4 && !res.error && res.changed && res.text.startsWith('Trois plans') && res.actions.length === 17 && seen[0].messages[0].role === 'system' && seen[0].messages[1].content.includes('[État du Studio]') && seen[0].messages[1].content.includes('"joueur":{"id":1') && seen[1].messages.filter(m => m.role === 'tool').length === 4 && seen[0].tools.length === schemas.length);
  const path0 = JSON.parse(history.find(m => m.role === 'tool' && m.content.includes('parcouru_m')).content);
  ok('assistant : il voit les entités, leurs trajectoires et les événements', path0.parcouru_m === 10 && path0.points[0].x === 10 && path0.points.at(-1).x === 20 && history.some(m => m.role === 'tool' && m.content.includes('Salut !')) && history.some(m => m.role === 'tool' && m.content.includes('"vitesse_m_s":1')));
  const w0 = wide && C.worldPose(wide, 0, st.cams, frame), w4 = wide && C.worldPose(wide, 4000, st.cams, frame);
  ok('assistant : cadrage d’un sujet (caméra créée, face au joueur, en plongée, elle le garde dans l’axe)', !!w0 && st.cams.length === 3 && w0.x > 10 && near2(w0.z, 10) && w0.y > 3 && w0.pitch < -0.3 && near2(Math.abs(w0.yaw), Math.PI) && near2(w4.x - w0.x, 4) && wide.tracks.x.length === 2 && wide.tracks.x[1].ease === 'doux');
  const c4 = close && C.worldPose(close, 4000, st.cams, frame);
  ok('assistant : clés par paramètre, filtres, raytracing, ombre', !!c4 && close.tracks.fov.length === 2 && near2(C.poseAt(close, 7000).fov, 28) && close.tracks.x.length === 1 && close.tracks.rt.length === 2 && near2(C.fxAt(close, 7000).rt, 0.6) && close.filter === 'cine' && close.shadow === true && near2(close.vignette, 0.3) && Math.hypot(c4.x - 14, c4.z - 13) < 2.2);
  const t9 = tour && C.worldPose(tour, 9500, st.cams, frame), p9 = posAt('u:1', 9500);
  ok('assistant : travelling circulaire attaché au sujet (parent, il le regarde)', !!t9 && tour.parent?.id === 1 && tour.look && !tour.follow && near2(Math.hypot(t9.x - p9.x, t9.z - p9.z), 3, 0.25) && near2(t9.yaw, Math.atan2(p9.z - t9.z, p9.x - t9.x), 0.05) && tour.tracks.x.length === 7);
  ok('assistant : apparence dans la limite du compte, visibilité, erreurs dites en clair', st.ents.over['u:2']?.look.hat === 3 && !('hairStyle' in st.ents.over['u:2'].look) && st.ents.hidden.join() === 'u:3' && res.actions.filter(a => !a.ok).length === 2 && res.actions.some(a => a.text.includes('pas dans les skins du compte')) && res.actions.every(a => /^[✓✗] /.test(a.text)) && res.actions.some(a => a.text.startsWith('✓ Caméra « Plan large » créée')));
  const sum = JSON.parse(history.filter(m => m.role === 'tool' && m.content.includes('"plans"')).pop().content);
  ok('assistant : montage (les plans s’enchaînent), lecture pilotée', sum.plans.map(p => p.camera).join() === 'Plan large,Gros plan,Tour' && sum.duree === 12 && st.seeks.join() === '4000' && st.changes >= 8 && events.filter(e => e.type === 'action').length === 17);
  // point de restauration : l'instantané d'avant le message remet le projet et la conversation
  const back = JSON.parse(snap0); st.cams = C.loadProject({ v: 4, cams: back.cams }).cams; st.ents = back.ents; history.length = 0;
  ok('assistant : point de restauration', st.cams.length === 0 && st.ents.hidden.length === 0);
  // modèle sans appel d'outils natif : actions en JSON dans le texte ; refus VIP ; modèle muet
  let m = 0; const alt = await A.runTurn(H, history, 'Un plan fixe.', async () => ({ message: { role: 'assistant', content: m++ ? 'Voilà un plan fixe.' : 'Je m’en occupe.\n{"actions":[{"outil":"create_camera","arguments":{"name":"Fixe","t":1,"x":5,"y":2,"z":5,"look_at":{"entity":"joueur"}}},{"outil":"set_keys","arguments":{"camera":"Fixe","keys":[{"t":5,"x":5}]}}],"message":"Je pose un plan fixe."}' } }));
  ok('assistant : actions en JSON dans le texte (modèle sans outils)', alt.actions.length === 2 && alt.actions.every(a => a.ok) && st.cams.length === 1 && st.cams[0].name === 'Fixe' && st.cams[0].tracks.x.length === 2 && alt.text.startsWith('Voilà un plan fixe.') && alt.text.includes('Montage réel : 1 plan') && near2(C.poseAt(st.cams[0], 1000).yaw, Math.atan2(10 - 5, 11 - 5), 0.05));
  // (les erreurs vues en vrai le 21/11 : liste vide pour un type approximatif, paramètre manquant, caméra réglée avant d'être créée,
  // nom approché, plan de 0,4 s, résumé faux, site qui répond 429 — rejouées par un faux modèle)
  st.cams = []; st.ents = { over: {}, hidden: [] };
  const real = [
    { content: '', tool_calls: [call('list_entities', { type: 'npc', t: 0 }, 'l1'), call('list_entities', { search: 'zzz', t: 0 }, 'l2'), call('list_entities', { near: 'joueur', radius: 1, t: 0 }, 'l3'), call('list_entities', { type: 'Personnage' }, 'l4')] },
    { content: '', tool_calls: [call('frame_shot', { camera: 'Ouverture', subject: 'joueur', t: 0 }, 'f1'), call('frame_shot', { camera: 'ouverture', t: 3, shot: 'Plan large', side: 'derrière', height: 'drone' }, 'f2'),
      call('update_camera', { camera: 'Orbit_Lex_chute', filter: 'cine', raytracing: 50 }, 'u1'), call('set_keys', { camera: 'Orbit_Lex_chute', keys: [{ t: 4, fov: 40 }] }, 'k1'), call('orbit_shot', { camera: 'Orbit Lex-chute', subject: 'joueur', from: 3, to: 6 }, 'o1'),
      call('frame_shot', { camera: 'Insert', subject: 'Nina', shot: 'gros plan', t: 6 }, 'f3'), call('frame_shot', { camera: 'Insert', subject: 'Nina', shot: 'gros_plan', t: 6.4 }, 'f4'),
      call('set_keys', { camera: 'Finale', keys: [{ t: 6.4, x: 12, y: 3, z: 4, look_at: { entity: 'joueur' } }, { t: 10, x: 14, y: 3, z: 4, look_at: { entity: 'joueur' } }] }, 'k2'), call('frame_shot', { t: 1 }, 'f5')] },
    { content: 'Voilà : 5 plans magnifiques.' },
    { content: '', tool_calls: [call('delete_camera', { camera: 'INSERT' }, 'd1'), call('set_keys', { camera: 'finale', keys: [{ t: 6, x: 12, y: 3, z: 4 }] }, 'k3'), call('cinematic_summary', {}, 's1')] },
    { content: 'Trois plans : ouverture, tour autour de toi, plan final.' },
  ];
  let q = 0, busy = 2; const waits = [], h2 = [], notes = [];
  const r2 = await A.runTurn(H, h2, 'Fais-moi une cinématique stylée.', async () => (busy-- > 0 ? { error: 'Doucement : une demande à la fois.', status: 429 } : { ok: true, message: { role: 'assistant', ...real[q++] } }), ev => { if (ev.type !== 'action') notes.push(ev.type); }, 14, async t => { waits.push(t); });
  const tool = id => JSON.parse(h2.find(m => m.tool_call_id === id).content), act = i => r2.actions[i];
  ok('assistant : site occupé (429) → attente et nouvel essai', waits.join() === '1500,3000' && notes.includes('wait') && !r2.error && q === 5);
  ok('assistant : liste d’entités jamais vide à tort (type approximatif, recherche sans résultat, rayon trop court)', tool('l1').total === 2 && tool('l1').entites.every(e => e.type === 'pnj') && tool('l2').total >= 3 && tool('l2').remarques.length === 1 && tool('l3').total >= 2 && tool('l4').total === 3 && act(0).ok && act(1).ok);
  ok('assistant : paramètre manquant → valeur par défaut annoncée, ou erreur qui nomme le paramètre', tool('f1').ok && tool('f1').plan === 'moyen' && tool('f1').valeurs_par_defaut.some(x => x.startsWith('shot manquant')) && tool('f2').ok && tool('f2').plan === 'ensemble' && tool('f2').sujet === 'Lex' && tool('f2').creee === false && !tool('f5').ok && tool('f5').message.includes('« camera »'));
  const orb = st.cams.find(c => c.name === 'Orbit Lex-chute');
  ok('assistant : caméra réglée avant d’être créée → appel rejoué après la création, nom approché accepté', !!orb && orb.filter === 'cine' && Math.abs(orb.rt - 0.5) < 1e-9 && tool('u1').ok && tool('u1').message.includes('rejoué') && tool('k1').ok && orb.tracks.fov.some(k => k.t === 4000 && k.v === 40) && st.cams.filter(c => /orbit/i.test(c.name)).length === 1);
  ok('assistant : set_keys crée la caméra quand il en donne la position', tool('k2').ok && tool('k2').message.includes('Caméra « Finale » créée') && !!st.cams.find(c => c.name === 'Finale'));
  const sum2 = tool('s1');
  ok('assistant : plan trop court refusé à la vérification, résumé conforme au montage réel', notes.includes('check') && h2.some(m => m.role === 'user' && m.content.includes('[Vérification automatique du Studio]') && m.content.includes('« Insert » trop court')) && !st.cams.some(c => c.name === 'Insert') && sum2.problemes.length === 0 && sum2.nombre_de_plans === 3 && sum2.plans.every(p => p.duree >= A.MIN_SHOT) && r2.text.includes('Montage réel : 3 plans') && r2.text.includes('« Finale » 6→10 s') && r2.recap.plans.length === 3 && A.SYSTEM_PROMPT.includes('Règles de montage OBLIGATOIRES'));
  const vip = await A.runTurn(H, [], 'Salut', async () => ({ error: 'Fonctionnalité Studio VIP', vip: false })), mute = await A.runTurn(H, [], 'Salut', async () => { throw new Error('coupé'); });
  ok('assistant : refus VIP et panne signalés', vip.error?.vip === false && vip.error.text === 'Fonctionnalité Studio VIP' && mute.error?.text === 'coupé' && !vip.changed);
}
const near2 = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

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
checkRecords().then(checkCams).then(async C => checkAI(C, await checkScene())).then(checkRuntime, e => { console.error(e); process.exit(1); });
