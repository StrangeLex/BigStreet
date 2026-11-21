/**
 * Contrôles des éléments animés du Studio (façon Mine-Imator) — appelés par tools/selftest.mjs :
 *  - objets.js : projet (anciens projets sans « anim », nettoyage, aller-retour), pistes et courbes, valeurs fixes / clés / clé auto,
 *    entités du record surchargées canal par canal, parents (repères), copier / coller / décaler / étirer des clés, visibilité,
 *    poses des personnages (bibliothèque, os), animations du jeu, lumières (réserve fixe), éclairage du lieu ;
 *  - cams.js : nouvelles courbes, projet version 5 ;
 *  - ai-tools-anim.js : les outils de l'assistant, exécutés sur un faux hôte (objets, PNJ, lumières, miroirs, poses, chute, éclairage).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export async function checkAnim(ok, root) {
  const mod = f => import('data:text/javascript;base64,' + readFileSync(path.join(root, 'src/studio', f)).toString('base64'));
  const O = await mod('objets.js'), C = await mod('cams.js'), X = await mod('ai-tools-anim.js');
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

  // ---- projet
  ok('anim : ancien projet (sans « anim ») → vide, illisible écarté', O.cleanAnim(undefined).objs.length === 0 && O.cleanAnim({ objs: [null, { kind: 'zzz' }, { id: '../x', kind: 'modele', model: 'a' }, { id: 'a', kind: 'modele' }, { id: 'b', kind: 'ref', ref: 'x:1' }, { id: 'c', kind: 'perso', uid: 3 }] }).objs.length === 0 && !O.hasAnim(O.emptyAnim()));
  ok('projet version 5 : parties ajoutées écrites à côté des caméras', C.PROJECT_VERSION >= 5 && JSON.parse(C.saveProject('x', 1, [], null, { anim: { v: 1, objs: [] } })).anim.v === 1 && C.loadProject({ v: 4, cams: [] }).cams.length === 0);
  const A = O.emptyAnim(), box = O.newObj(A, 'modele', { model: 'chaise', label: 'Chaise' }, { x: 1, y: 0, z: 2 });
  ok('anim : élément neuf (valeurs fixes, aucun mouvement)', box.name === 'Chaise' && box.st.x === 1 && box.st.sx === 1 && box.st.vis === 1 && O.keyCount(box) === 0 && O.chanAt(box, 'z', 5000) === 2 && O.newObj(A, 'modele', { model: 'chaise', label: 'Chaise' }).name === 'Chaise 2');
  A.objs.pop();

  // ---- valeurs fixes, clés, clé auto
  ok('anim : sans clé, une valeur reste fixe', O.setParam(box, 'x', 4, 3000) === 'fixe' && box.st.x === 4 && !box.tracks.x?.length);
  O.setParam(box, 'x', 4, 0, { force: true }); ok('anim : une seule clé = élément fixe (c’est elle qui change)', O.setParam(box, 'x', 6, 2000) === 'fixe' && box.tracks.x.length === 1 && box.tracks.x[0].v === 6);
  O.setKey(box, 'x', 2000, 10); ok('anim : piste animée → clé à l’instant', O.setParam(box, 'x', 8, 1000) === 'key' && box.tracks.x.length === 3 && near(O.chanAt(box, 'x', 1000), 8) && O.isAnimated(box, 'x'));
  const au = O.newObj(A, 'groupe', {}, { x: 0 }); O.setParam(au, 'x', 5, 2000, { auto: true });
  ok('anim : clé automatique (départ gardé, clé à l’instant)', au.tracks.x.length === 2 && au.tracks.x[0].t === 0 && au.tracks.x[0].v === 0 && au.tracks.x[1].v === 5);

  // ---- courbes
  const f = O.newObj(A, 'modele', { model: 'caisse' }, { y: 0 }); O.setKey(f, 'y', 0, 10, 'lineaire'); O.setKey(f, 'y', 1000, 0);
  const lin = O.chanAt(f, 'y', 250); O.easeAt(f, 'y', 0, 'rebond'); const b1 = O.chanAt(f, 'y', 500), b2 = O.chanAt(f, 'y', 1000); O.easeAt(f, 'y', 0, 'fixe'); const cst = O.chanAt(f, 'y', 999); O.easeAt(f, 'y', 0, 'depasse'); const ov = Math.min(...[700, 800, 900].map(t => O.chanAt(f, 'y', t)));
  ok('anim : courbes par clé (linéaire, rebond, constant, dépassement)', near(lin, 7.5) && b1 < 2.5 && b1 > 0 && near(b2, 0) && cst === 10 && ov < 0 && Object.keys(O.EASES).length === 9);
  const cam = C.newCam([], { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60 }, 0); C.setKey(cam, 'x', 1000, 10); C.easeAt(cam, 'x', 0, 'lineaire'); const cl = C.poseAt(cam, 250).x; C.easeAt(cam, 'x', 0, 'rebond');
  ok('caméras : nouvelles courbes (linéaire, rebond)', near(cl, 2.5) && C.poseAt(cam, 500).x > 7 && near(C.poseAt(cam, 1000).x, 10) && C.loadProject(JSON.parse(C.saveProject('x', 1, [cam]))).cams[0].tracks.x[0].ease === 'rebond');

  // ---- visible
  O.setKey(f, 'vis', 0, 0); O.setKey(f, 'vis', 800, 1);
  ok('anim : apparaître / disparaître (clé « visible », sans fondu)', O.worldAt(A, f, 799).vis === false && O.worldAt(A, f, 800).vis === true && f.tracks.vis[0].ease === 'fixe');

  // ---- entité du record : seul ce qui est donné remplace le record
  const ref = O.newObj(A, 'ref', { ref: 'i:100', name: 'Chaise du record' }), base = (o, t) => (o.ref === 'i:100' ? { x: 3 + t / 1000, y: 0, z: 4, ry: 0.5 } : null);
  const r0 = O.worldAt(A, ref, 2000, base); O.setKey(ref, 'y', 0, 5); O.setKey(ref, 'y', 2000, 0); const r1 = O.worldAt(A, ref, 1000, base);
  ok('anim : entité du record surchargée canal par canal', near(r0.x, 5) && near(r0.ry, 0.5) && O.chanAt(ref, 'x', 0) === null && near(r1.x, 4) && r1.y > 0 && r1.y < 5 && near(r1.ry, 0.5) && O.isSet(ref, 'y') && !O.isSet(ref, 'x'));
  O.clearChan(ref, 'y'); ok('anim : surcharge retirée → comme le record', O.worldAt(A, ref, 1000, base).y === 0 && O.worldAt(A, O.newObj(A, 'ref', { ref: 'u:99', name: 'Absent' }), 0, base).lost === true); A.objs.pop();

  // ---- parents
  const g = O.newObj(A, 'groupe', {}, { x: 10, y: 1, z: 0, ry: Math.PI / 2 }), kid = O.newObj(A, 'modele', { model: 'vase' }, { x: 1, y: 2, z: 3, ry: 0.3 }); kid.parent = g.id;
  const wk = O.worldAt(A, kid, 0), back = O.toLocal(wk.m, O.worldAt(A, g, 0).m, kid.st);
  ok('anim : parent → repère du monde, et retour', near(wk.x, 13) && near(wk.y, 3) && near(wk.z, -1) && near(wk.ry, 0.3 + Math.PI / 2) && near(back.x, 1) && near(back.z, 3) && near(back.ry, 0.3) && near(back.sx, 1));
  const m0 = O.compose({ x: 1, y: 2, z: 3, rx: 0.4, ry: -1.1, rz: 0.7, sx: 2, sy: 0.5, sz: 1.5 }), d0 = O.decompose(m0), id = O.matMul(m0, O.invert(m0));
  ok('anim : matrices (composer, décomposer, inverser)', near(d0.rx, 0.4) && near(d0.ry, -1.1) && near(d0.rz, 0.7) && near(d0.sx, 2) && near(d0.sy, 0.5) && near(id[0], 1) && near(id[5], 1) && near(id[12], 0) && near(id[1], 0));
  O.setKey(g, 'vis', 0, 0); ok('anim : un parent caché cache ses enfants ; pas de boucle', O.worldAt(A, kid, 0).vis === false && O.wouldLoop(A, g, kid.id) && !O.wouldLoop(A, kid, g.id) && O.tree(A).findIndex(x => x.o === kid) > O.tree(A).findIndex(x => x.o === g) && O.tree(A).find(x => x.o === kid).depth === 1);
  O.removeObj(A, g); ok('anim : parent supprimé → enfant détaché', kid.parent === null && !A.objs.includes(g));

  // ---- sélection multiple : copier, coller, décaler, étirer
  const k = O.newObj(A, 'modele', { model: 'balle' }, {}); for (const [t, v] of [[0, 0], [1000, 5], [2000, 9]]) { O.setKey(k, 'x', t, v); O.setKey(k, 'y', t, v * 2); }
  const clip = O.copyKeys(k, [{ ch: null, t: 1000 }, { ch: 'x', t: 2000 }]);
  const pasted = O.pasteKeys(k, clip, 5000);
  ok('anim : copier / coller des clés (instants relatifs)', clip.keys.length === 3 && clip.t0 === 1000 && pasted.length === 3 && O.keyAt(k.tracks.x, 5000, 0) >= 0 && O.keyAt(k.tracks.y, 5000, 0) >= 0 && O.keyAt(k.tracks.x, 6000, 0) >= 0 && O.keyAt(k.tracks.y, 6000, 0) < 0 && near(O.chanAt(k, 'x', 6000), 9));
  const sh = O.shiftKeys(k, [{ ch: null, t: 5000 }, { ch: 'x', t: 6000 }], 500);
  ok('anim : décaler plusieurs clés ensemble (bornées à la durée)', sh.length === 3 && sh.every(s => s.t === 5500 || s.t === 6500) && O.keyAt(k.tracks.x, 5000, 0) < 0 && O.shiftKeys(k, [{ ch: 'x', t: 0 }], -900)[0].t === 0 && O.shiftKeys(k, [{ ch: 'x', t: 6500 }], 9000, 7000)[0].t === 7000);
  const sc = O.scaleKeys(k, [{ ch: 'x', t: 1000 }, { ch: 'x', t: 2000 }], 2);
  ok('anim : étirer des clés', sc.map(s => s.t).join() === '1000,3000' && O.delAt(k, null, 3000) === 1 && O.keyTimes(k, 'x').join() === '0,1000,5500,7000');
  const other = O.newObj(A, 'lumiere', { ltype: 'point' }, {}); ok('anim : coller sur un autre élément (canaux de même nom)', O.pasteKeys(other, clip, 0, 10000, O.channelsOf(other)).length === 3 && other.tracks.x.length === 2);

  // ---- personnages : poses, os, animations du jeu
  const pn = O.newObj(A, 'perso', { npc: true, name: 'Marcel', title: 'Figurant', look: { top: 2 } }, { x: 5, z: 5 });
  const n1 = O.applyPose(pn, 'saluer', 0), n2 = O.applyPose(pn, 'bras_en_l_air', 2000), bm = O.bonesAt(pn, 1000);
  ok('anim : PNJ ajouté, poses par clés (18 canaux d’os)', pn.uid >= O.UID0 && pn.npc && n1 === 18 && n2 === 18 && near(O.bonesAt(pn, 0)['bras_d.z'], 155 * Math.PI / 180) && bm['bras_g.z'] < -0.5 && bm['bras_g.z'] > -165 * Math.PI / 180 && O.channelsOf(pn).length === 29 && Object.keys(O.POSES).length >= 20);
  const j = O.newObj(A, 'perso', { npc: false, name: 'Doublure' }, {}); O.applyPose(j, 'assis', 0, false);
  ok('anim : faux joueur, pose fixe puis retirée', j.npc === false && j.uid !== pn.uid && near(O.bonesAt(j, 9000)['jambe_d.x'], -Math.PI / 2) && O.keyCount(j) === 0 && (O.clearPose(j), Object.keys(O.bonesAt(j, 0)).length === 0));
  O.setClip(pn, 1000, 'applaudir'); O.setClip(pn, 3000, ''); O.setClip(pn, 1010, 'salto');
  ok('anim : animations du jeu lancées et arrêtées à un instant', O.clipAt(pn, 500) === null && O.clipAt(pn, 2000).id === 'salto' && O.clipAt(pn, 2000).at === 990 && O.clipAt(pn, 3500) === null && pn.clips.length === 2 && O.delClip(pn, 3000) === 1);
  const rc = O.newObj(A, 'ref', { ref: 'u:2', name: 'Nina' }); O.setKey(rc, 'tete.y', 0, 0.8);
  ok('anim : personnage du record posé os par os', O.isChar(rc) && near(O.bonesAt(rc, 0)['tete.y'], 0.8) && Object.keys(O.bonesAt(rc, 0)).length === 1 && !O.isChar(ref) && O.entKey(rc) === 'u:2' && O.entKey(pn) === `u:${pn.uid}`);

  // ---- lumières et éclairage du lieu
  const sp = O.newObj(A, 'lumiere', { ltype: 'spot', color: '#ff0000', intensity: 20 }, { y: 3 }); O.setKey(sp, 'li', 0, 20); O.setKey(sp, 'li', 1000, 0, 'lineaire'); O.easeAt(sp, 'li', 0, 'lineaire');
  ok('anim : lumière (couleur, intensité animable, réserve fixe)', sp.ltype === 'spot' && sp.st.cr === 1 && sp.st.cg === 0 && near(O.chanAt(sp, 'li', 500), 10) && O.POOL.point === 4 && O.POOL.spot === 3 && O.POOL.dir === 1 && O.rgbHex(1, 0, 0) === '#ff0000' && O.channelsOf(sp).includes('la'));
  ok('anim : éclairage du lieu non réglé → rien n’est touché', O.lightingAt(O.emptyAnim(), 0) === null);
  const amb = O.newObj(A, 'ambiance'), lp = O.newObj(A, 'lampe', { lkey: O.lightKey(12.3, 2.6, 7.1) }); O.setKey(amb, 'expo', 0, 1); O.setKey(amb, 'expo', 2000, 0.2, 'lineaire'); O.easeAt(amb, 'expo', 0, 'lineaire'); O.setParam(lp, 'lm', 0, 0);
  const LF = O.lightingAt(A, 1000);
  ok('anim : éclairage du lieu (luminosité animée, lampe éteinte)', near(LF.expo, 0.6) && LF.amb === 1 && LF.lampes.get('12.5,2.5,7').k === 0 && O.newObj(A, 'ambiance') === amb && O.newObj(A, 'lampe', { lkey: '12.5,2.5,7' }) === lp && O.noTR(amb) && O.channelsOf(amb).join() === O.AMB_CH.join());

  const fxc = O.newObj(A, 'effets'); O.setKey(fxc, 'shake', 1000, 0); O.setKey(fxc, 'shake', 1200, 1, 'lineaire'); O.setKey(fxc, 'shake', 2000, 0);
  const sk1 = O.shakeAt(A, 1210), sk2 = O.shakeAt(A, 1210);
  ok('anim : tremblement de caméra (animable, nul hors du choc, même instant = même image)', O.shakeAt(A, 500) === null && sk1 && Math.abs(sk1.x) <= 0.13 && Math.abs(sk1.yaw) <= 0.04 && JSON.stringify(sk1) === JSON.stringify(sk2) && O.shakeAt(A, 2500) === null && O.newObj(A, 'effets') === fxc && O.shakeAt(O.emptyAnim(), 0) === null);
  const ti = O.newObj(A, 'titre', { text: 'BIG STREET\nle film', pos: 'centre', t0: 1000, t1: 4000, fade: 500 }); O.setKey(fxc, 'fade', 0, 1); O.setKey(fxc, 'fade', 1000, 0, 'lineaire'); O.easeAt(fxc, 'fade', 0, 'lineaire'); fxc.cutfade = 400;
  const o1 = O.overlayAt(A, 500), o2 = O.overlayAt(A, 1250), o3 = O.overlayAt(A, 3000, [3100]), o4 = O.overlayAt(A, 4500), calls = [];
  const gFake = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : typeof k === 'string' && /^(fill|stroke|clear)/.test(k) && !/Style$/.test(k) ? (...a) => calls.push([k, ...a]) : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
  O.paintOverlay(gFake, 1920, 1080, o2); O.paintOverlay(gFake, 1920, 1080, null);
  ok('anim : fondus et titres à l’écran (calque 2D, apparition en fondu, fondu aux changements de plan)', near(o1.fade, 0.5) && o1.titles.length === 0 && o2.titles.length === 1 && near(o2.titles[0].alpha, 0.5) && near(o3.titles[0].alpha, 1) && near(o3.fade, 0.5) && o4 === null && calls.filter(c => c[0] === 'fillText').length === 2 && calls.some(c => c[0] === 'fillText' && c[1] === 'le film' && near(c[2], 960)) && ti.name === 'BIG STREET');
  { const R = O.emptyAnim(), fx2 = O.newObj(R, 'effets'), plain = O.frameTimes(R, 0, 1000, 100).length; const none = !O.hasRemap(R);
    O.setKey(fx2, 'speed', 0, 1, 'fixe'); O.setKey(fx2, 'speed', 1000, 0.5, 'fixe'); O.setKey(fx2, 'speed', 2000, 1, 'fixe'); fx2.holds = [{ t: 3000, ms: 500 }];
    const FT = O.frameTimes(R, 0, 4000, 100), st = O.advanceTime(R, { T: 900, used: {} }, 300), at3 = FT.filter(t => Math.abs(t - 3000) < 0.5).length;
    ok('anim : ralenti par segment et image figée (temps de la vidéo ≠ temps du record)', none && plain === 11 && O.hasRemap(R) && near(st.T, 1100, 1) && FT.length === 56 && at3 === 6 && FT[FT.length - 1] === 4000 && FT.every((t, i) => !i || t >= FT[i - 1]) && O.cleanAnim(JSON.parse(JSON.stringify(R))).objs[0].holds[0].ms === 500); }
  { const R = O.emptyAnim(), L = [C.newCam([], { x: 0, y: 1, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60 }, 0)], sub = { id: 1, name: 'Lex', at: t => ({ x: 10 + t / 1000, y: 0, z: 10, yaw: 0 }) }, frame = (p, t) => (p.id === 1 ? { x: 10 + t / 1000, y: 1.5, z: 10, yaw: 0 } : null);
    const r = O.applyTemplate(C, L, R, 'trailer', { dur: 45000, subject: sub }), plans = L.slice(1), w = C.worldPose(plans[2], plans[2].tracks.x[0].t, L, frame), rr = O.applyTemplate(C, [], O.emptyAnim(), 'lieu', { dur: 20000, subject: null, place: 'Laverie', radius: 4 }), L3 = []; O.applyTemplate(C, L3, O.emptyAnim(), 'lieu', { dur: 20000, subject: null, center: { x: 5, y: 0, z: 5 }, radius: 4 });
    const lw = C.worldPose(L3[0], L3[0].tracks.x[0].t, L3, frame), toC = Math.atan2(5 - lw.z, 5 - lw.x);
    ok('anim : modèles de projets (bande-annonce, lieu) — plans enchaînés, sujet regardé, fondus et titre', !r.error && r.cams.length === 5 && r.end === 30000 && L[0].on === false && plans.every(c => c.on && c.parent?.id === 1 && c.look) && C.cineRange(L)[1] === 30000 && C.activeCam(L, 100) === plans[0] && C.activeCam(L, 29000) === plans[4] && Math.hypot(w.x - (10 + plans[2].tracks.x[0].t / 1000), w.z - 10) < 1.6
      && near(O.overlayAt(R, 0).fade, 1) && O.overlayAt(R, 27000).titles[0].text === 'BIG STREET' && !rr.error && rr.cams.length === 4 && Math.abs(Math.atan2(Math.sin(lw.yaw - toC), Math.cos(lw.yaw - toC))) < 0.01 && !!O.applyTemplate(C, [], O.emptyAnim(), 'trailer', { dur: 20000, subject: null }).error && !!O.applyTemplate(C, [], O.emptyAnim(), 'lieu', { dur: 1000 }).error); }
  { // poignées de tangente (Bézier), chemin, regarder vers, bibliothèque
    const R = O.emptyAnim(), b = O.newObj(R, 'modele', { model: 'balle' }, {}); O.setKey(b, 'y', 0, 0); O.setKey(b, 'y', 1000, 0); const flat = O.chanAt(b, 'y', 500); Object.assign(b.tracks.y[0], { hm: 'libre', ro: [500, 10] }); Object.assign(b.tracks.y[1], { hm: 'aligne', li: [-500, 10], ro: [300, -6] });
    const cb2 = C.newCam([], { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60 }, 0); C.setKey(cb2, 'x', 1000, 0); Object.assign(cb2.tracks.x[0], { hm: 'libre', ro: [500, 10] }); Object.assign(cb2.tracks.x[1], { hm: 'libre', li: [-500, 10] });
    const back = O.cleanAnim(JSON.parse(JSON.stringify(R))).objs[0].tracks.y, cback = C.loadProject(JSON.parse(C.saveProject('x', 1, [cb2]))).cams[0];
    ok('anim : poignées de tangente (Bézier) par clé — éléments et caméras, gardées dans le projet', flat === 0 && near(O.chanAt(b, 'y', 500), 7.5) && O.chanAt(b, 'y', 0) === 0 && near(O.chanAt(b, 'y', 1000), 0) && back[1].hm === 'aligne' && back[1].ro[1] === -6 && near(C.poseAt(cb2, 500).x, 7.5) && cback.tracks.x[0].ro[0] === 500 && near(C.poseAt(cback, 500).x, 7.5) && O.copyKeys(b, [{ ch: 'y', t: 0 }]).keys[0].ro[1] === 10 && Object.keys(O.HMODES).length === 3);
    const car = O.newObj(R, 'modele', { model: 'lambo' }, { x: 50 }); car.path = { pts: [[0, 0, 0], [10, 0, 0], [10, 0, 10]], orient: true, closed: false }; O.setKey(car, 'prog', 0, 0, 'lineaire'); O.setKey(car, 'prog', 2000, 1);
    const w0 = O.worldAt(R, car, 0), w1 = O.worldAt(R, car, 500), w2 = O.worldAt(R, car, 2000), rb = O.cleanAnim(JSON.parse(JSON.stringify(R))).objs[1];
    ok('anim : contrainte « suivre un chemin » (avancée animable, tourné vers l’avant)', near(w0.x, 0) && near(w1.x, 5, 0.01) && near(w1.ry, Math.PI / 2, 0.2) && near(w2.x, 10) && near(w2.z, 10) && rb.path.pts.length === 3 && O.channelsOf(car).includes('prog') && !O.channelsOf(b).includes('prog') && near(O.pathAt({ pts: [[0, 0, 0], [4, 0, 0]], closed: true }, 0.75).x, 2, 0.6));
    const am = O.aimAt({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }), ad = O.aimAt({ x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 3 }, true);
    car.look = { kind: 'ent', id: 'u:2', name: 'Nina' }; ok('anim : contrainte « regarder vers » (angles, cible gardée dans le projet)', near(am.ry, Math.PI / 4) && near(am.rx, 0) && near(ad.ry, 0) && ad.rx < 0 && ad.rx > -Math.PI / 2 && O.aimAt({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }) === null && O.cleanAnim(JSON.parse(JSON.stringify(R))).objs[1].look.id === 'u:2');
    const p1 = O.newObj(R, 'perso', { name: 'A' }, {}), p2 = O.newObj(R, 'perso', { name: 'B' }, { x: 7 }); O.applyPose(p1, 'saluer', 1000); O.applyPose(p1, 'victoire', 2000); O.setKey(p1, 'x', 1000, 3); O.setKey(p1, 'x', 2000, 5);
    const sp = O.capturePose(p1, 1000, 'Mon salut'), sa = O.captureAnim(p1, 0, 5000, 'Salut puis victoire'), n1 = O.applySaved(p2, O.cleanSaved(JSON.parse(JSON.stringify(sp))), 4000), n2 = O.applySaved(p2, O.cleanSaved(JSON.parse(JSON.stringify(sa))), 6000);
    ok('anim : bibliothèque de l’utilisateur (pose et animation gardées, réappliquées ailleurs, fichier .bspose relu)', sp.kind === 'pose' && Object.keys(sp.bones).length === 18 && n1 === 18 && near(O.bonesAt(p2, 4000)['bras_d.z'], 155 * Math.PI / 180) && sa.dur === 1000 && n2 === 38 && near(O.chanAt(p2, 'x', 6000), 7) && near(O.chanAt(p2, 'x', 7000), 9) && near(O.bonesAt(p2, 7000)['bras_d.x'], -170 * Math.PI / 180)
      && O.cleanSaved({ kind: 'pose', bones: { evil: 1 } }) === null && O.cleanSaved(null) === null && O.capturePose(O.newObj(O.emptyAnim(), 'perso', { name: 'C' }, {}), 0, 'x') === null && O.applySaved(b, O.cleanSaved(sp), 0) === 0);
    R.focus = { c1: { key: 'u:3', name: 'Nina' }, 'bad id!': { key: 'u:1' }, c2: { key: 'zz' } }; const fz = O.cleanAnim(JSON.parse(JSON.stringify(R))).focus;
    ok('anim : mise au point par caméra gardée dans le projet', fz.c1.key === 'u:3' && Object.keys(fz).length === 1 && O.hasAnim({ ...O.emptyAnim(), focus: { c: { key: 'u:1' } } })); }
  // ---- miroir, texte, aller-retour du projet
  const pa = O.newObj(A, 'particules', { ptype: 'etincelles', count: 50 }, {}), pp = new Float32Array(150), pc = new Float32Array(200), pp2 = new Float32Array(150);
  const pn1 = O.particlesAt(pa, 1234, pp, pc); O.particlesAt(pa, 1234, pp2, pc); pa.ptype = 'pluie'; O.particlesAt(pa, 500, pp2, pc);
  ok('anim : particules calculées d’après l’instant (même instant = même image)', pn1 === 50 && pp.some(v => v !== 0) && [...pp].every(Number.isFinite) && (O.particlesAt({ ...pa, ptype: 'etincelles' }, 1234, pp2, pc), pp.every((v, i) => v === pp2[i])) && Object.keys(O.PTYPES).every(k => O.PSPEC[k]));
  const mi = O.newObj(A, 'miroir', { w: 3, h: 2, tint: '#aabbcc', q: 1024 }, {}), tx = O.newObj(A, 'texte', { text: 'FIN', size: 2, face: true }, {});
  const A2 = O.cleanAnim(JSON.parse(JSON.stringify(A)));
  if (process.env.ANIM_DEBUG) A.objs.forEach((o, i) => { if (JSON.stringify(o) !== JSON.stringify(A2.objs[i])) console.log(JSON.stringify(o), '\n', JSON.stringify(A2.objs[i])); });
  ok('anim : projet écrit et relu à l’identique', JSON.stringify(A2) === JSON.stringify(A) && A2.objs.find(o => o.kind === 'miroir').q === 1024 && A2.objs.find(o => o.kind === 'texte').face === true && O.hasAnim(A2) && mi.w === 3 && tx.text === 'FIN');
  const bad = JSON.parse(JSON.stringify(A)); bad.objs[0].tracks.x.push({ t: 'x' }, { t: 99, v: NaN }); bad.objs.push({ ...bad.objs[0] }); bad.objs[1].parent = 'nulle-part'; bad.loop = { on: 1, a: -5, b: 'z' };
  const A3 = O.cleanAnim(bad); ok('anim : projet abîmé nettoyé (clés illisibles, doublons, parent inconnu)', A3.objs.length === A.objs.length && A3.objs[1].parent === null && A3.loop.on === true && A3.loop.a === 0 && O.clampAnim(A3, 1500).objs.every(o => Object.values(o.tracks).every(L => L.every(q => q.t <= 1500))));
  const dup = O.dupObj(A, pn); ok('anim : dupliquer (clés gardées, autre numéro)', dup.uid !== pn.uid && O.keyCount(dup) === O.keyCount(pn) && dup.name !== pn.name && O.dupObj(A, ref) === null && O.lastKey(A) >= 7000);

  // ---- les outils de l'assistant, sur un faux hôte
  const B = O.emptyAnim(), ents = [{ key: 'u:1', id: 1, kind: 'joueur', name: 'Lex', me: true }, { key: 'u:2', id: 2, kind: 'pnj', name: 'Nina' }, { key: 'i:100', id: 100, kind: 'objet', name: 'Chaise' }, { key: 'v:7', id: 7, kind: 'vehicule', name: 'lambo #7' }];
  const cat = [{ type: 'chaise', name: 'Chaise en bois', cat: 'Mobilier et décor' }, { type: 'caisse', name: 'Caisse', cat: 'Mobilier et décor' }, { type: 'lambo', name: 'Lambo', cat: 'Véhicules' }], LAMPS = [{ key: '2,2.5,2', type: 'ponctuelle', x: 2, y: 2.5, z: 2, intensite: 3, couleur: '#fff', d: 0 }, { key: '30,2.5,30', type: 'ponctuelle', x: 30, y: 2.5, z: 30, intensite: 3, couleur: '#fff', d: 0 }];
  const nm = s => String(s ?? '').toLowerCase(); let changes = 0;
  const api = { O, get data() { return B; }, get objs() { return B.objs; }, find: q => B.objs.find(o => o.id === q || nm(o.name) === nm(q)) || null, byEnt: key => B.objs.find(o => O.entKey(o) === key) || null,
    entity(key, create = true) { let o = this.byEnt(key); if (!o && create) o = O.newObj(B, 'ref', { ref: key, name: ents.find(e => e.key === key)?.name || key }); return o || null; },
    add(kind, props, pose) { if (kind === 'lumiere' && B.objs.filter(o => o.kind === 'lumiere' && o.ltype === (props.ltype || 'point')).length >= O.POOL[props.ltype || 'point']) return { error: 'maximum atteint' }; if (kind === 'miroir' && B.objs.filter(o => o.kind === 'miroir').length >= O.MAX.miroir) return { error: 'maximum atteint' }; return O.newObj(B, kind, props, pose || { x: 1, y: 0, z: 1, ry: 0 }) || { error: 'trop' }; },
    remove(o) { O.removeObj(B, o); }, setParent(o, pid, bone = '') { if (pid && O.wouldLoop(B, o, pid)) return false; o.parent = pid; o.bone = bone; return true; }, ws: (o, t) => O.worldAt(B, o, t, () => ({ x: 3, y: 0, z: 4, ry: 0 })), changed() { changes++; }, syncPersos() {},
    ambiance: (c = false) => B.objs.find(o => o.kind === 'ambiance') || (c ? O.newObj(B, 'ambiance') : null), lampObj: (key, c = false) => B.objs.find(o => o.kind === 'lampe' && o.lkey === key) || (c ? O.newObj(B, 'lampe', { lkey: key }) : null),
    sceneLamps: (max, c) => LAMPS.map(l => ({ ...l, d: c ? Math.hypot(l.x - c.x, l.z - c.z) : 0 })), searchCatalog: (q, max = 60) => cat.filter(m => nm(`${m.name} ${m.type}`).includes(nm(q))).slice(0, max),
    lib: [], libLoad() { return this.lib; }, savePose(o, name, kind) { const e = kind === 'pose' ? O.capturePose(o, 0, name) : O.captureAnim(o, 0, 20000, name); if (!e) return { error: 'rien' }; this.lib.unshift(e); return e; }, applyLib(o, name, t) { const e = this.lib.find(x => x.name === name); if (!e) return { error: 'absent' }; return { n: O.applySaved(o, e, t), name: e.name, kind: e.kind }; }, focus: {}, setFocus(id, key, name) { if (key) this.focus[id] = { key, name }; else delete this.focus[id]; },
    emotes: () => [{ id: 'coucou', nom: 'Coucou (salut de la main)', duree: 2.6 }, { id: 'applaudir', nom: 'Applaudir', duree: 3 }, { id: 'dodo', nom: 'Dodo', duree: 'en boucle' }] };
  const H = { geo: { topOf: () => 0.9, pieceAt: () => null, pieces: () => [{ nom: 'Cuisine', x: [10, 14], z: [20, 26], centre: { x: 12, z: 23 } }, { nom: 'Réserve', x: [28, 32], z: [28, 32], centre: { x: 30, z: 30 } }], geo: () => ({ status: p => ({ floor: 0, ceil: Math.abs(p.x - 3) < 0.1 || p.x === 12 ? 3.2 : null }) }) }, anim: api, T: 0, dur: 20000, entities: () => ents, posAt: (key, t) => (ents.some(e => e.key === key) ? { x: 3, y: 0, z: 4, yaw: 0 } : null) };
  const fakeCam = { id: 'cA', name: 'Plan large', dof: 0, tracks: { dof: [] } };
  const kit = { camOf: q => (nm(q) === 'plan large' ? fakeCam : null), ok: (text, data = {}) => ({ ok: true, text: `✓ ${text}`, data }), ko: text => ({ ok: false, text: `✗ ${text}`, data: {} }), ms: (v, d = null) => (Number.isFinite(+v) && v !== null && v !== undefined && v !== '' ? Math.round(Math.max(0, Math.min(20, +v)) * 1000) : d),
    ent: q => ents.find(e => String(e.id) === String(q) || nm(e.name) === nm(q) || (q === 'joueur' && e.me)) || null };
  const ext = X.createAnimExt(), R = ext.create(H, kit).RUN, run = (n, a = {}) => R[n](a);
  ok('assistant (anim) : chaque outil décrit a son exécution', ext.tools.every(t => typeof R[t.name] === 'function' && t.parameters.type === 'object' && t.description.length > 20) && Object.keys(R).length === ext.tools.length && new Set(ext.tools.map(t => t.name)).size === ext.tools.length && ext.prompt.includes('animate_element'));
  const s1 = run('search_models', { search: 'chaise' }), a1 = run('add_object', { model: 'Caisse', name: 'Caisse qui tombe', x: 5, y: 0, z: 6, cap: 90 });
  ok('assistant (anim) : catalogue et ajout d’un objet', s1.ok && s1.data.modeles[0].model === 'chaise' && a1.ok && B.objs[0].model === 'caisse' && B.objs[0].st.x === 5 && near(B.objs[0].st.ry, 0) && !run('add_object', { model: 'licorne' }).ok);
  const fm = run('find_models', { query: 'chaise bois' }), ap = run('add_object', { model: 'voiture_lambo_rouge', name: 'Bolide' }), lc = run('add_light', { type: 'point', name: 'Plafonnier', at: 'cuisine' }), lz = run('add_light', { type: 'point', at: 'grenier' });
  ok('assistant (anim) : modèle au nom approché accepté (et dit), lumière placée dans une pièce nommée', fm.ok && fm.data.modeles[0].model === 'chaise' && ap.ok && api.find('Bolide').model === 'lambo' && /le plus proche/.test(ap.text) && lc.ok && api.find('Plafonnier').st.x === 12 && api.find('Plafonnier').st.z === 23 && near(api.find('Plafonnier').st.y, 2.9) && /Cuisine/.test(lc.text) && !lz.ok && /Cuisine/.test(lz.text));
  B.objs = B.objs.filter(o => o.name !== 'Bolide' && o.name !== 'Plafonnier');
  const f1 = run('make_fall', { element: 'Caisse qui tombe', t: 2, height: 6, duration: 1 }), cb = B.objs[0];
  ok('assistant (anim) : un objet qui tombe (rebond, caché avant)', f1.ok && near(O.chanAt(cb, 'y', 2000), 6) && near(O.chanAt(cb, 'y', 3000), 0) && cb.tracks.y[0].ease === 'rebond' && O.worldAt(B, cb, 1000).vis === false && O.worldAt(B, cb, 2500).vis === true && O.chanAt(cb, 'y', 2500) < 3);
  { const fc = run('make_fall', { element: 'i:100', t: 3, height: 3 }), ef = api.byEnt('i:100'), bl = run('set_pose', { character: 'Nina', t: 2, pose: 'saluer', blend: 50 });
    ok('assistant (anim) : chute limitée par le plafond (3,2 m), pose mélangée sur un personnage du record', fc.ok && /plafond/.test(fc.text) && near(O.chanAt(ef, 'y', 3000), 3.2 - 0.9 - 0.1) && fc.data.plafond === 3.2 && bl.ok && near(O.chanAt(api.byEnt('u:2'), 'pmix', 2000), 0.5) && O.chanAt(O.newObj(O.emptyAnim(), 'ref', { ref: 'u:9', name: 'x' }), 'pmix', 0) === 1); api.remove(ef); api.remove(api.byEnt('u:2')); }
  const e1 = run('animate_element', { element: 'i:100', keys: [{ t: 0, y: 3, roll: 45 }, { t: 2, y: 0, roll: 0, ease: 'rebond' }] }), er = api.byEnt('i:100');
  ok('assistant (anim) : entité du record animée (seuls y et roulis remplacent le record)', e1.ok && er && er.kind === 'ref' && er.tracks.y.length === 2 && near(er.tracks.rz[0].v, Math.PI / 4) && !er.tracks.x && O.chanAt(er, 'x', 0) === null && !run('animate_element', { element: 'inconnu', keys: [{ t: 0, x: 1 }] }).ok && !run('animate_element', { element: 'Chaise', keys: [{ t: 0 }] }).ok);
  const c1 = run('add_character', { kind: 'pnj', name: 'Figurant', title: 'Client', near: 'Nina' }), ch = api.find('Figurant');
  const p1 = run('set_pose', { character: 'Figurant', t: 0, pose: 'saluer' }), p2 = run('set_pose', { character: 'Figurant', t: 2, bones: { tete: [0, 40, 0], bras_g: [-90, 0, 0] }, ease: 'doux' }), p3 = run('play_emote', { character: 'Nina', t: 4, emote: 'Applaudir' });
  ok('assistant (anim) : PNJ ajouté, posé et animé ; émote sur un personnage du record', c1.ok && ch.kind === 'perso' && ch.title === 'Client' && near(ch.st.x, 3) && near(ch.st.z, 5.2) && p1.ok && p2.ok && ch.tracks['bras_d.z'].length === 1 && near(O.bonesAt(ch, 2000)['tete.y'], 40 * Math.PI / 180) && ch.tracks['bras_g.x'].length === 2 && p3.ok && api.byEnt('u:2').clips[0].id === 'applaudir' && !run('set_pose', { character: 'Caisse qui tombe', pose: 'saluer' }).ok && !run('set_pose', { character: 'Figurant', pose: 'inexistante' }).ok && run('list_poses').data.poses.length >= 20);
  const l1 = run('add_light', { type: 'spot', name: 'Poursuite', x: 3, y: 4, z: 0, color: '#00ffcc', intensity: 40, look_at: { entity: 'Nina' } }), lo = api.find('Poursuite');
  const l2 = run('animate_element', { element: 'Poursuite', keys: [{ t: 0, intensity: 40, color: '#00ffcc' }, { t: 3, intensity: 0, color: '#ff0000' }] });
  for (let i = 0; i < 2; i++) run('add_light', { type: 'spot' }); const l5 = run('add_light', { type: 'spot' });
  ok('assistant (anim) : projecteur visé, coloré, animé ; réserve respectée', l1.ok && lo.st.cg === 1 && lo.st.cr === 0 && lo.st.rx < 0 && near(lo.st.ry, Math.atan2(0, 4)) && l2.ok && lo.tracks.li.length === 2 && near(O.chanAt(lo, 'cr', 3000), 1) && !l5.ok && /maximum/.test(l5.text));
  const q1 = run('add_particles', { type: 'confettis', near: 'Lex', spread: 6, count: 300 }); ok('assistant (anim) : particules', q1.ok && B.objs.find(o => o.kind === 'particules').count === 300 && B.objs.find(o => o.kind === 'particules').spread === 6);
  const m1 = run('add_mirror', { x: 1, y: 0, z: 1, cap: 0, width: 3 }); run('add_mirror', {}); const m3 = run('add_mirror', {}), t1 = run('add_text', { text: 'BIG STREET', size: 2, face_camera: true });
  ok('assistant (anim) : miroirs (deux au plus) et texte', m1.ok && B.objs.find(o => o.kind === 'miroir').w === 3 && !m3.ok && t1.ok && B.objs.find(o => o.kind === 'texte').face === true);
  const g1 = run('set_scene_lighting', { preset: 'nuit_americaine' }), g2 = run('set_scene_lighting', { t: 5, brightness: 0.1, ease: 'doux' }), am = api.ambiance();
  ok('assistant (anim) : éclairage du lieu (ambiance, puis baisse animée)', g1.ok && near(am.st.expo, 0.35) && am.st.cb === 1 && g2.ok && am.tracks.expo.length === 2 && near(am.tracks.expo[0].v, 0.35) && near(O.lightingAt(B, 5000).expo, 0.1) && g2.data.animee === true && !run('set_scene_lighting', {}).ok);
  const z1 = run('set_scene_light', { near: 'Nina', radius: 6, on: false }), z2 = run('list_scene_lights', { near: 'Nina', radius: 6 }), z3 = run('set_scene_light', { light: '30,2.5,30', intensity: 2, color: '#ff8800', t: 3 });
  ok('assistant (anim) : lampes d’une zone éteintes, une lampe réglée par clé', z1.ok && api.lampObj('2,2.5,2').st.lm === 0 && !api.lampObj('30,2.5,30')?.st.lm === false && z2.data.lampes.length === 1 && z3.ok && api.lampObj('30,2.5,30').tracks.lm.length === 2 && near(O.lightingAt(B, 3000).lampes.get('30,2.5,30').k, 2) && O.lightingAt(B, 0).lampes.get('2,2.5,2').k === 0);
  const k1 = run('set_camera_shake', { t: 5, intensity: 80, frequency: 14 }); ok('assistant (anim) : tremblement de caméra par clés', k1.ok && B.objs.find(o => o.kind === 'effets').tracks.shake.length === 2 && near(O.chanAt(B.objs.find(o => o.kind === 'effets'), 'shake', 5000), 0.8) && O.shakeAt(B, 5000) !== null && O.shakeAt(B, 0) === null);
  const w1 = run('add_title', { text: 'Bonjour !', from: 4, to: 6, position: 'bas', box: true }), w2 = run('set_fade', { t: 0, black: 100 }), w3 = run('set_fade', { t: 1, black: 0, cut_fade: 0.4 }), wo = O.overlayAt(B, 4500, []);
  ok('assistant (anim) : sous-titre et ouverture au noir', w1.ok && w2.ok && w3.ok && wo.titles[0].text === 'Bonjour !' && wo.titles[0].box === true && near(O.overlayAt(B, 0).fade, 1) && O.overlayAt(B, 2000) === null && B.objs.find(o => o.kind === 'effets').cutfade === 400 && !run('add_title', { text: 'x', from: 5, to: 2 }).ok);
  const v1 = run('set_speed', { t: 5, speed: 0.25 }), v2 = run('set_speed', { t: 8, freeze: 1.5 }), fxb = B.objs.find(o => o.kind === 'effets');
  ok('assistant (anim) : ralenti et image figée', v1.ok && v2.ok && fxb.tracks.speed.length === 2 && fxb.tracks.speed[0].v === 1 && fxb.holds[0].ms === 1500 && O.hasRemap(B) && run('set_speed', { reset: true }).ok && !O.hasRemap(B));
  { const y1 = run('set_pose', { character: 'Figurant', t: 9, pose: 'salut' }), y2 = run('play_emote', { character: 'Figurant', t: 10, emote: 'saluer' }), y3 = run('play_emote', { character: 'Figurant', t: 11, emote: 'pointer' }), y4 = run('play_emote', { character: 'Figurant', t: 12, emote: 'moonwalk' }), fg = api.find('Figurant');
    ok('assistant (anim) : synonymes de poses et d’émotes, « coucou », erreur qui liste les animations', y1.ok && near(O.bonesAt(fg, 9000)['bras_d.z'], 155 * Math.PI / 180) && y2.ok && fg.clips.some(c => c.t === 10000 && c.id === 'coucou') && y3.ok && /pose « pointer »/.test(y3.text) && near(O.bonesAt(fg, 11000)['bras_d.x'], -88 * Math.PI / 180) && !y4.ok && /coucou, applaudir, dodo/.test(y4.text));
    const h1 = run('add_character', { name: 'Nina', kind: 'pnj' }), h2 = run('add_character', { name: 'Nina', kind: 'pnj' });
    ok('assistant (anim) : pas d’homonyme d’un personnage du record', h1.ok && h2.ok && !!api.find('Nina 2') && !!api.find('Nina 3') && !B.objs.some(o => o.kind === 'perso' && o.name === 'Nina') && /Nina 2/.test(h1.text)); B.objs = B.objs.filter(o => !/^Nina \d/.test(o.name));
    const n0 = B.objs.filter(o => o.kind === 'lampe').length, q1 = run('set_scene_light', { near: 'Cuisine', on: false }), q2 = run('set_scene_light', { near: 'réserve', on: false }), q3 = run('list_scene_lights', { near: 'reserve' }), q4 = run('set_scene_light', { near: 'grenier', on: false });
    ok('assistant (anim) : lampes par nom de pièce (rien n’est éteint ailleurs, et c’est dit)', !q1.ok && /RIEN n’a été éteint/.test(q1.text) && q2.ok && /Réserve/.test(q2.text) && api.lampObj('30,2.5,30').st.lm === 0 && B.objs.filter(o => o.kind === 'lampe').length <= n0 + 1 && q3.ok && q3.data.lampes.length === 1 && q3.data.pieces.join() === 'Cuisine,Réserve' && !q4.ok && /Cuisine, Réserve/.test(q4.text)); }
  { const la = run('set_look_at', { element: 'Poursuite', target: 'Nina' }), lb = run('set_look_at', { element: 'Poursuite', target: 'Plan large' }), lcx = run('set_look_at', { element: 'Poursuite', target: 'personne' }), ld = run('set_look_at', { element: 'Poursuite', target: null });
    const pa = run('set_path', { element: 'Caisse qui tombe', points: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 8 }], from: 2, to: 9 }), cq = api.find('Caisse qui tombe'), pb2 = run('set_path', { element: 'Caisse qui tombe', points: [{ x: 1, z: 1 }] });
    const fo = run('set_focus', { camera: 'Plan large', subject: 'Nina' }), fo2 = run('set_focus', { camera: 'inconnue', subject: 'Nina' });
    const sv = run('save_to_library', { element: 'Figurant', name: 'Geste', kind: 'animation' }), av = run('apply_from_library', { element: 'Nina', name: 'Geste', t: 12 }), av2 = run('apply_from_library', { element: 'Nina', name: 'rien' });
    if (process.env.ANIM_DEBUG) console.log([la.ok, lb.ok, !lcx.ok, ld.ok, pa.ok, pa.text, cq.path?.pts.length, cq.tracks.prog?.length, O.worldAt(B, cq, 9000).z, !pb2.ok, fo.ok, fo.text, api.focus, !fo2.ok, sv.ok, sv.text, av.ok, av.text, !av2.ok]);
    ok('assistant (anim) : regarder vers, suivre un chemin, mise au point, bibliothèque', la.ok && lb.ok && !lcx.ok && ld.ok && !api.find('Poursuite').look && pa.ok && cq.path.pts.length === 3 && cq.tracks.prog.length === 2 && near(O.worldAt(B, cq, 9000).z, 8) && /14 m/.test(pa.text) && !pb2.ok && fo.ok && api.focus.cA.key === 'u:2' && /flou/.test(fo.text) && !fo2.ok && sv.ok && av.ok && !av2.ok && run('list_poses').data.bibliotheque[0].nom === 'Geste');
    delete cq.path; delete cq.tracks.prog; }
  { const n0 = B.objs.length, x1 = run('add_object', { model: 'Otter (mascotte)' }), x2 = run('add_object', { model: 'Cocodrile' }), x3 = run('add_object', { model: 'chaise de bureau', name: 'Siège' }), x4 = run('set_pose', { character: 'Figurant', t: 13, pose: 'bras_croise' }), x5 = run('set_pose', { character: 'Figurant', t: 13, pose: 'victoir_totale' }), x6 = run('set_pose', { character: 'Figurant', t: 14, pose: 'bras croisés' });
    ok('assistant (anim) : nom de modèle absurde refusé (rien ajouté), proche accepté ; pose inconnue → poses proches proposées', !x1.ok && !x2.ok && /RIEN n’a été ajouté/.test(x1.text) && x3.ok && api.find('Siège').model === 'chaise' && B.objs.length === n0 + 1 && x4.ok && !x5.ok && /victoire/.test(x5.text.split('Toutes')[0]) && x6.ok && !!O.POSES.bras_croises);
    api.remove(api.find('Siège')); }
  const u1 = run('update_element', { element: 'Caisse qui tombe', parent: 'Figurant', bone: 'bras_d' }), le = run('list_elements'), d1 = run('delete_element', { element: 'Chaise' }), d2 = run('delete_element_keys', { element: 'Poursuite', from: 0, to: 10 });
  ok('assistant (anim) : parent (tenu en main), liste, suppression', u1.ok && cb.parent === ch.id && cb.bone === 'bras_d' && le.ok && le.data.elements.length >= 6 && le.data.lumieres_restantes.spot === 0 && le.data.eclairage_du_lieu.teinte !== '#ffffff' && d1.ok && !api.byEnt('i:100') && d2.ok && O.keyCount(lo) === 0 && changes > 10);
}
